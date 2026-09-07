import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "~server/db/client.server";
import {
  assignmentSubmissions,
  assignments,
  courses,
  examAttempts,
  exams,
  lessonProgress,
  lessons,
  securityEvents,
  subjects,
  users,
} from "~server/db/schema";
import { entitlementsForStudent } from "~server/entitlements/grant.server";
import { courseProgressBatch } from "~server/progress/service.server";

/**
 * Student 360 — a single bounded, real-data view of one student for authorized
 * admin/staff. Aggregates ONLY rows already stored by the app (no fabrication,
 * no synthetic activity). Every query is scoped to `studentId` and capped so a
 * whole student population is never scanned into memory. Never returns private
 * file ids/urls; private-file presence is exposed as a boolean only, and the
 * signed-file mechanism is only reached through the existing assignment routes.
 */

export interface S360Identity {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: "active" | "suspended";
  localePref: string | null;
  emailVerified: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface S360Entitlement {
  id: string;
  resourceType: string;
  resourceId: string | null;
  resourceTitleAr: string | null;
  resourceTitleEn: string | null;
  sourceType: string;
  /** effective access state derived from stored dates/status. */
  state: "active" | "upcoming" | "expired" | "revoked";
  grantedAt: number;
  expiresAt: number | null;
  grantedBy: string | null;
}

export interface S360CourseProgress {
  courseId: string;
  titleAr: string;
  titleEn: string;
  totalLessons: number;
  completedLessons: number;
  pct: number;
}

export interface S360Attempt {
  id: string;
  examId: string;
  examTitleAr: string;
  examTitleEn: string;
  status: string;
  gradingStatus: string | null;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  startedAt: number;
  submittedAt: number | null;
  needsManual: boolean;
}

export interface S360Assignment {
  assignmentId: string;
  assignmentTitleAr: string;
  assignmentTitleEn: string;
  maxScore: number;
  status: "submitted" | "graded";
  score: number | null;
  feedback: string | null;
  hasFile: boolean;
  submittedAt: number;
  gradedAt: number | null;
}

export type S360TimelineKind =
  | "account_created"
  | "entitlement_granted"
  | "entitlement_revoked"
  | "lesson_completed"
  | "exam_started"
  | "exam_submitted"
  | "assignment_submitted"
  | "assignment_graded";

export interface S360TimelineItem {
  ts: number;
  kind: S360TimelineKind;
  /** localized label key under the `s360.timeline` namespace. */
  labelKey: string;
  /** short entity detail (resolved title). */
  detail: string | null;
}

export interface Student360 {
  isStudent: boolean;
  identity: S360Identity | null;
  entitlements: S360Entitlement[];
  courses: S360CourseProgress[];
  summary: {
    activeCourses: number;
    lessonsCompleted: number;
    attempts: number;
    pendingManual: number;
    assignmentsAwaiting: number;
    assignmentsGraded: number;
  };
  attempts: S360Attempt[];
  assignments: S360Assignment[];
  timeline: S360TimelineItem[];
  recentSecurity: Array<{ id: string; type: string; createdAt: number }>;
}

const now = () => Date.now();

async function resolveResourceTitles(db: DB, ents: Array<{ resourceType: string; resourceId: string | null }>) {
  const ids: Record<"subject" | "course" | "lesson", Set<string>> = { subject: new Set(), course: new Set(), lesson: new Set() };
  for (const e of ents) {
    if (e.resourceId && (e.resourceType === "subject" || e.resourceType === "course" || e.resourceType === "lesson")) {
      ids[e.resourceType].add(e.resourceId);
    }
  }
  const titles = new Map<string, { titleAr: string; titleEn: string }>();
  if (ids.subject.size) {
    const rows = await db.select({ id: subjects.id, titleAr: subjects.titleAr, titleEn: subjects.titleEn }).from(subjects).where(inArray(subjects.id, [...ids.subject]));
    for (const r of rows) titles.set(r.id, { titleAr: r.titleAr, titleEn: r.titleEn });
  }
  if (ids.course.size) {
    const rows = await db.select({ id: courses.id, titleAr: courses.titleAr, titleEn: courses.titleEn }).from(courses).where(inArray(courses.id, [...ids.course]));
    for (const r of rows) titles.set(r.id, { titleAr: r.titleAr, titleEn: r.titleEn });
  }
  if (ids.lesson.size) {
    const rows = await db.select({ id: lessons.id, titleAr: lessons.titleAr, titleEn: lessons.titleEn }).from(lessons).where(inArray(lessons.id, [...ids.lesson]));
    for (const r of rows) titles.set(r.id, { titleAr: r.titleAr, titleEn: r.titleEn });
  }
  return titles;
}

function entitlementState(e: { status: string; startsAt: number; expiresAt: number | null }, nowMs: number): S360Entitlement["state"] {
  if (e.status === "revoked") return "revoked";
  if (e.startsAt > nowMs) return "upcoming";
  if (e.status === "expired" || (e.expiresAt !== null && e.expiresAt <= nowMs)) return "expired";
  return "active";
}

export async function student360(db: DB, studentId: string, nowMs: number = now()): Promise<Student360> {
  const empty = { isStudent: false, identity: null, entitlements: [], courses: [], summary: { activeCourses: 0, lessonsCompleted: 0, attempts: 0, pendingManual: 0, assignmentsAwaiting: 0, assignmentsGraded: 0 }, attempts: [], assignments: [], timeline: [], recentSecurity: [] } as Student360;

  const uRows = await db
    .select({
      id: users.id, email: users.email, fullName: users.fullName, phone: users.phone,
      status: users.status, roleId: users.roleId, localePref: users.localePref,
      emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, studentId))
    .limit(1);
  const u = uRows[0];
  if (!u || u.deletedAt || u.roleId !== "student") return empty;

  const identity: S360Identity = {
    id: u.id, email: u.email, fullName: u.fullName, phone: u.phone,
    status: u.status, localePref: u.localePref,
    emailVerified: u.emailVerifiedAt !== null, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
  };

  const [entRows, attemptRows, assignRows, lessonRows, secRows, manualCount, awaitingCount, gradedCount] = await Promise.all([
    entitlementsForStudent(db, studentId),
    db
      .select({
        id: examAttempts.id, examId: examAttempts.examId, titleAr: exams.titleAr, titleEn: exams.titleEn,
        status: examAttempts.status, gradingStatus: examAttempts.gradingStatus, score: examAttempts.score,
        maxScore: examAttempts.maxScore, passed: examAttempts.passed, startedAt: examAttempts.startedAt,
        submittedAt: examAttempts.submittedAt,
      })
      .from(examAttempts)
      .innerJoin(exams, eq(exams.id, examAttempts.examId))
      .where(eq(examAttempts.studentId, studentId))
      .orderBy(desc(examAttempts.startedAt))
      .limit(12),
    db
      .select({
        assignmentId: assignments.id, titleAr: assignments.titleAr, titleEn: assignments.titleEn,
        maxScore: assignments.maxScore, status: assignmentSubmissions.status, score: assignmentSubmissions.score,
        feedback: assignmentSubmissions.feedback, hasFile: assignmentSubmissions.fileId, submittedAt: assignmentSubmissions.submittedAt,
        gradedAt: assignmentSubmissions.gradedAt,
      })
      .from(assignmentSubmissions)
      .innerJoin(assignments, eq(assignments.id, assignmentSubmissions.assignmentId))
      .where(eq(assignmentSubmissions.studentId, studentId))
      .orderBy(desc(assignmentSubmissions.submittedAt))
      .limit(12),
    db
      .select({ lessonId: lessonProgress.lessonId, titleAr: lessons.titleAr, titleEn: lessons.titleEn, status: lessonProgress.status, completedAt: lessonProgress.completedAt })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .where(eq(lessonProgress.studentId, studentId))
      .orderBy(desc(lessonProgress.lastActivityAt))
      .limit(12),
    db
      .select({ id: securityEvents.id, type: securityEvents.type, createdAt: securityEvents.createdAt })
      .from(securityEvents)
      .where(eq(securityEvents.userId, studentId))
      .orderBy(desc(securityEvents.createdAt))
      .limit(6),
    db.$count(examAttempts, and(eq(examAttempts.studentId, studentId), eq(examAttempts.gradingStatus, "needs_manual"))),
    db.$count(assignmentSubmissions, and(eq(assignmentSubmissions.studentId, studentId), eq(assignmentSubmissions.status, "submitted"))),
    db.$count(assignmentSubmissions, and(eq(assignmentSubmissions.studentId, studentId), eq(assignmentSubmissions.status, "graded"))),
  ]);

  const titles = await resolveResourceTitles(db, entRows);
  const entitlementsOut: S360Entitlement[] = entRows.map((e) => ({
    id: e.id,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    resourceTitleAr: e.resourceId ? titles.get(e.resourceId)?.titleAr ?? null : null,
    resourceTitleEn: e.resourceId ? titles.get(e.resourceId)?.titleEn ?? null : null,
    sourceType: e.sourceType,
    state: entitlementState(e, nowMs),
    grantedAt: e.grantedAt,
    expiresAt: e.expiresAt,
    grantedBy: e.grantedBy,
  }));

  const activeCourseIds = entRows
    .filter((e) => e.resourceType === "course" && !!e.resourceId && entitlementState(e, nowMs) === "active")
    .map((e) => e.resourceId as string);

  let coursesOut: S360CourseProgress[] = [];
  if (activeCourseIds.length) {
    const pctMap = await courseProgressBatch(db, studentId, activeCourseIds);
    const courseRows = await db.select({ id: courses.id, titleAr: courses.titleAr, titleEn: courses.titleEn }).from(courses).where(inArray(courses.id, activeCourseIds));
    coursesOut = courseRows.map((c) => {
      const p = pctMap.get(c.id);
      return { courseId: c.id, titleAr: c.titleAr, titleEn: c.titleEn, totalLessons: p?.total ?? 0, completedLessons: p?.completed ?? 0, pct: p?.pct ?? 0 };
    });
  }

  const attempts: S360Attempt[] = attemptRows.map((a) => ({
    id: a.id, examId: a.examId, examTitleAr: a.titleAr, examTitleEn: a.titleEn,
    status: a.status, gradingStatus: a.gradingStatus, score: a.score, maxScore: a.maxScore,
    passed: a.passed, startedAt: a.startedAt, submittedAt: a.submittedAt,
    needsManual: a.gradingStatus === "needs_manual" || a.status === "grading",
  }));

  const assignmentsOut: S360Assignment[] = assignRows.map((s) => ({
    assignmentId: s.assignmentId,
    assignmentTitleAr: s.titleAr,
    assignmentTitleEn: s.titleEn,
    maxScore: s.maxScore,
    status: s.status,
    score: s.score,
    feedback: s.feedback,
    hasFile: s.hasFile !== null,
    submittedAt: s.submittedAt,
    gradedAt: s.gradedAt,
  }));

  const timeline = buildTimeline(identity, entRows, attemptRows, lessonRows, assignmentsOut);

  return {
    isStudent: true,
    identity,
    entitlements: entitlementsOut,
    courses: coursesOut,
    summary: {
      activeCourses: activeCourseIds.length,
      lessonsCompleted: lessonRows.filter((l) => l.status === "completed").length,
      attempts: attemptRows.length,
      pendingManual: manualCount,
      assignmentsAwaiting: awaitingCount,
      assignmentsGraded: gradedCount,
    },
    attempts,
    assignments: assignmentsOut,
    timeline,
    recentSecurity: secRows,
  };
}

/** Bounded, recent-first timeline assembled ONLY from real stored timestamps. */
function buildTimeline(
  identity: S360Identity,
  entRows: Awaited<ReturnType<typeof entitlementsForStudent>>,
  attemptRows: Array<{ startedAt: number; submittedAt: number | null; titleAr: string; titleEn: string }>,
  lessonRows: Array<{ status: string; completedAt: number | null; titleAr: string; titleEn: string }>,
  assignments: S360Assignment[],
  cap = 40
): S360TimelineItem[] {
  const out: S360TimelineItem[] = [];
  out.push({ ts: identity.createdAt, kind: "account_created", labelKey: "s360.timeline.accountCreated", detail: null });
  for (const e of entRows.slice(0, 12)) {
    if (e.grantedAt) out.push({ ts: e.grantedAt, kind: "entitlement_granted", labelKey: "s360.timeline.enrolled", detail: null });
    if (e.revokedAt) out.push({ ts: e.revokedAt, kind: "entitlement_revoked", labelKey: "s360.timeline.accessRevoked", detail: null });
  }
  for (const a of attemptRows) {
    out.push({ ts: a.startedAt, kind: "exam_started", labelKey: "s360.timeline.examStarted", detail: a.titleAr || a.titleEn });
    if (a.submittedAt) out.push({ ts: a.submittedAt, kind: "exam_submitted", labelKey: "s360.timeline.examSubmitted", detail: a.titleAr || a.titleEn });
  }
  for (const l of lessonRows) {
    if (l.status === "completed" && l.completedAt) out.push({ ts: l.completedAt, kind: "lesson_completed", labelKey: "s360.timeline.lessonCompleted", detail: l.titleAr || l.titleEn });
  }
  for (const s of assignments) {
    out.push({ ts: s.submittedAt, kind: "assignment_submitted", labelKey: "s360.timeline.assignmentSubmitted", detail: s.assignmentTitleAr || s.assignmentTitleEn });
    if (s.status === "graded" && s.gradedAt) out.push({ ts: s.gradedAt, kind: "assignment_graded", labelKey: "s360.timeline.assignmentGraded", detail: s.assignmentTitleAr || s.assignmentTitleEn });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, cap);
}

/** Append an audit entry when staff inspect a student (actor is the staff member). */
export async function auditStudent360Access(db: DB, actor: { userId: string; role: string }, studentId: string, actorIpHash: string | null): Promise<void> {
  const { auditLogs } = await import("~server/db/schema");
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "student360.viewed",
    entityType: "user",
    entityId: studentId,
    ipHash: actorIpHash,
    createdAt: Date.now(),
  });
}
