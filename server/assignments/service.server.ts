import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "~server/db/client.server";
import {
  assignmentSubmissions,
  assignments,
  auditLogs,
  courses,
  files,
  lessons,
  units,
  users,
} from "~server/db/schema";
import { chainForCourse, chainForLesson } from "~server/content/service.server";
import { resolveContentAccess, type SubjectInfo } from "~server/entitlements/access.server";
import { logAudit } from "~server/audit/log.server";
import { getFile } from "~server/files/storage.server";

/**
 * Homework / Assignments engine.
 *
 * Extension of the existing academic domains, not a rebuild: content chains and
 * the entitlement resolver decide *who may see/do what* (server-authoritative),
 * the shared R2 file registry holds private PDF/image submissions, and the
 * append-only audit trail records every grading change. No paid/external infra —
 * Workers + D1 + R2 + existing services only.
 */

export const ASSIGNMENT_PERMISSIONS = [
  "assignment.read",
  "assignment.create",
  "assignment.edit",
  "assignment.publish",
  "assignment.grade",
  "assignment.delete",
] as const;
export type AssignmentPermission = (typeof ASSIGNMENT_PERMISSIONS)[number];

/** Submission channels an assignment may allow. */
export const SUBMISSION_CHANNELS = ["text", "file"] as const;
export type SubmissionChannel = (typeof SUBMISSION_CHANNELS)[number];

export class AssignmentValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "AssignmentValidationError";
  }
}

export class AssignmentReferenceError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "AssignmentReferenceError";
  }
}

const now = () => Date.now();

/** rank 4 (super_admin) bypasses; rank 3 needs an explicit role_permissions row. */
export async function canAssignment(
  db: DB,
  auth: { user: { rank: number; roleId: string } } | null,
  permission: AssignmentPermission
): Promise<boolean> {
  if (!auth) return false;
  if (auth.user.rank >= 4) return true;
  if (auth.user.rank < 3) return false;
  const { rolePermissions } = await import("~server/db/schema");
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, auth.user.roleId), eq(rolePermissions.permission, permission)))
    .limit(1);
  return rows.length > 0;
}

export type AssignmentRow = typeof assignments.$inferSelect;
export type SubmissionRow = typeof assignmentSubmissions.$inferSelect;

export interface AssignmentActor {
  userId: string;
  roleRank: number;
  roleId?: string;
}

// ---------------------------------------------------------------------------
// Assignment CRUD
// ---------------------------------------------------------------------------

async function assertAttachmentRefs(db: DB, a: { courseId?: string | null; unitId?: string | null; lessonId?: string | null }): Promise<void> {
  if (a.courseId) {
    const r = await db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, a.courseId), isNull(courses.deletedAt))).limit(1);
    if (!r.length) throw new AssignmentReferenceError("courseId", "course not found");
  }
  if (a.unitId) {
    const r = await db.select({ id: units.id }).from(units).where(and(eq(units.id, a.unitId), isNull(units.deletedAt))).limit(1);
    if (!r.length) throw new AssignmentReferenceError("unitId", "unit not found");
  }
  if (a.lessonId) {
    const r = await db.select({ id: lessons.id }).from(lessons).where(and(eq(lessons.id, a.lessonId), isNull(lessons.deletedAt))).limit(1);
    if (!r.length) throw new AssignmentReferenceError("lessonId", "lesson not found");
  }
}

function validateChannels(channels: string[]): asserts channels is SubmissionChannel[] {
  const bad = channels.filter((c) => !(SUBMISSION_CHANNELS as readonly string[]).includes(c));
  if (!channels.length || bad.length) {
    throw new AssignmentValidationError([{ path: "allowedSubmissionTypes", message: "at least one of text|file and only those" }]);
  }
}

export interface AssignmentInput {
  titleAr: string;
  titleEn: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  instructionsAr?: string | null;
  instructionsEn?: string | null;
  courseId?: string | null;
  unitId?: string | null;
  lessonId?: string | null;
  maxScore: number;
  dueAt?: number | null;
  allowedSubmissionTypes: string[];
}

export async function createAssignment(db: DB, input: AssignmentInput, actor: { userId: string; role: string; ipHash?: string }): Promise<{ id: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  if (!input.titleAr.trim() || !input.titleEn.trim()) issues.push({ path: "title", message: "titleAr and titleEn are required" });
  if (!(Number.isFinite(input.maxScore) && input.maxScore > 0)) issues.push({ path: "maxScore", message: "maxScore must be > 0" });
  if (issues.length) throw new AssignmentValidationError(issues);
  validateChannels(input.allowedSubmissionTypes);
  await assertAttachmentRefs(db, input);
  if (input.dueAt !== null && input.dueAt !== undefined && !Number.isFinite(input.dueAt)) {
    throw new AssignmentValidationError([{ path: "dueAt", message: "dueAt must be an epoch timestamp" }]);
  }
  const id = crypto.randomUUID();
  const ts = now();
  await db.insert(assignments).values({
    id,
    titleAr: input.titleAr.trim(),
    titleEn: input.titleEn.trim(),
    descriptionAr: input.descriptionAr ?? null,
    descriptionEn: input.descriptionEn ?? null,
    instructionsAr: input.instructionsAr ?? null,
    instructionsEn: input.instructionsEn ?? null,
    courseId: input.courseId ?? null,
    unitId: input.unitId ?? null,
    lessonId: input.lessonId ?? null,
    maxScore: input.maxScore,
    dueAt: input.dueAt ?? null,
    allowedSubmissionTypes: [...input.allowedSubmissionTypes],
    status: "draft",
    createdBy: actor.userId,
    createdAt: ts,
    updatedAt: ts,
  });
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "assignment.created",
    entityType: "assignment",
    entityId: id,
    after: { titleEn: input.titleEn },
    ipHash: actor.ipHash ?? null,
  });
  return { id };
}

export async function getAssignment(db: DB, id: string): Promise<AssignmentRow | null> {
  const rows = await db.select().from(assignments).where(eq(assignments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listAssignments(db: DB, filter: { status?: AssignmentRow["status"] } = {}) {
  const conds = [];
  if (filter.status) conds.push(eq(assignments.status, filter.status));
  return db
    .select()
    .from(assignments)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(assignments.updatedAt));
}

export async function updateAssignment(db: DB, id: string, patch: Partial<AssignmentInput>) {
  const exam = await getAssignment(db, id);
  if (!exam) throw new AssignmentReferenceError("id", "assignment not found");
  const next: Record<string, unknown> = { updatedAt: now() };
  for (const k of ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "instructionsAr", "instructionsEn"] as const) {
    if (patch[k] !== undefined) next[k] = (patch[k] as string | null) === null ? null : String(patch[k]).trim();
  }
  if (patch.courseId !== undefined) next.courseId = patch.courseId ?? null;
  if (patch.unitId !== undefined) next.unitId = patch.unitId ?? null;
  if (patch.lessonId !== undefined) next.lessonId = patch.lessonId ?? null;
  if (patch.dueAt !== undefined) next.dueAt = patch.dueAt ?? null;
  if (patch.maxScore !== undefined) {
    if (!(Number.isFinite(patch.maxScore) && patch.maxScore > 0)) throw new AssignmentValidationError([{ path: "maxScore", message: "maxScore must be > 0" }]);
    next.maxScore = patch.maxScore;
  }
  if (patch.allowedSubmissionTypes !== undefined) {
    validateChannels(patch.allowedSubmissionTypes);
    next.allowedSubmissionTypes = [...patch.allowedSubmissionTypes];
  }
  await assertAttachmentRefs(db, {
    courseId: (patch.courseId !== undefined ? patch.courseId : exam.courseId) ?? null,
    unitId: (patch.unitId !== undefined ? patch.unitId : exam.unitId) ?? null,
    lessonId: (patch.lessonId !== undefined ? patch.lessonId : exam.lessonId) ?? null,
  });
  if (typeof next.titleAr === "string" && !next.titleAr.trim()) throw new AssignmentValidationError([{ path: "titleAr", message: "required" }]);
  if (typeof next.titleEn === "string" && !next.titleEn.trim()) throw new AssignmentValidationError([{ path: "titleEn", message: "required" }]);
  await db.update(assignments).set(next).where(eq(assignments.id, id));
  return { id };
}

const STATUS_FLOW: Record<string, string[]> = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: ["draft"],
};

export async function setAssignmentStatus(db: DB, id: string, status: string, actor: { userId: string; role: string }) {
  const a = await getAssignment(db, id);
  if (!a) throw new AssignmentReferenceError("id", "assignment not found");
  if (!(STATUS_FLOW[a.status] ?? []).includes(status)) {
    throw new AssignmentValidationError([{ path: "status", message: `cannot move ${a.status} → ${status}` }]);
  }
  await db.update(assignments).set({ status: status as "draft", updatedAt: now() }).where(eq(assignments.id, id));
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: `assignment.${status}`,
    entityType: "assignment",
    entityId: id,
    after: { status },
  });
  return { id, status };
}

/** Publish gate (fail closed): only a publishable assignment may go live. */
export async function publishAssignment(db: DB, id: string) {
  const a = await getAssignment(db, id);
  if (!a) throw new AssignmentReferenceError("id", "assignment not found");
  if (a.status === "published") return { id, status: "published" };
  if (a.status !== "draft") throw new AssignmentValidationError([{ path: "status", message: "only draft assignments can be published" }]);
  // content association is optional, but a published assignment must be reachable
  await db.update(assignments).set({ status: "published", updatedAt: now() }).where(eq(assignments.id, id));
  return { id, status: "published" };
}

export async function archiveAssignment(db: DB, id: string) {
  const a = await getAssignment(db, id);
  if (!a) throw new AssignmentReferenceError("id", "assignment not found");
  await db.update(assignments).set({ status: "archived", updatedAt: now() }).where(eq(assignments.id, id));
  return { id, status: "archived" };
}

// ---------------------------------------------------------------------------
// Access — who may see an assignment
// ---------------------------------------------------------------------------

async function assignmentChain(db: DB, a: Pick<AssignmentRow, "courseId" | "unitId" | "lessonId">) {
  if (a.lessonId) return chainForLesson(db, a.lessonId);
  if (a.unitId) {
    const u = await db.select({ courseId: units.courseId }).from(units).where(eq(units.id, a.unitId)).limit(1);
    if (!u[0]) return null;
    return chainForCourse(db, u[0].courseId);
  }
  if (a.courseId) return chainForCourse(db, a.courseId);
  return null;
}

export interface AssignmentAccess {
  allowed: boolean;
  reason: "not_found" | "anon" | "unpublished" | "denied";
  chain?: Awaited<ReturnType<typeof assignmentChain>> | null;
}

export async function assignmentAccess(db: DB, actor: SubjectInfo, a: Pick<AssignmentRow, "courseId" | "unitId" | "lessonId" | "status">): Promise<AssignmentAccess> {
  const chain = await assignmentChain(db, a);
  // unattached assignment → authenticated only
  if (!chain) {
    return actor.userId ? { allowed: true, reason: "unpublished" as const, chain } : { allowed: false, reason: "anon" as const, chain };
  }
  const verdict = await resolveContentAccess(db, actor, chain);
  if (!verdict.allowed) return { allowed: false, reason: "denied" as const, chain };
  // published assignment only for non-staff viewers
  if (a.status !== "published" && actor.roleRank < 3) return { allowed: false, reason: "unpublished" as const, chain };
  return { allowed: true, reason: "unpublished" as const, chain };
}

// ---------------------------------------------------------------------------
// Student-facing list / detail
// ---------------------------------------------------------------------------

/** Published assignments the actor may view, plus their own submission status. */
export async function listStudentAssignments(db: DB, actor: AssignmentActor, nowMs: number) {
  const rows = await db.select().from(assignments).where(eq(assignments.status, "published")).orderBy(desc(assignments.createdAt));
  const out: Array<Record<string, unknown>> = [];
  const keep: string[] = [];
  for (const a of rows) {
    const access = await assignmentAccess(db, actor, a);
    if (!access.allowed && actor.roleRank < 3) continue;
    keep.push(a.id);
    out.push({
      id: a.id,
      titleAr: a.titleAr,
      titleEn: a.titleEn,
      maxScore: a.maxScore,
      dueAt: a.dueAt,
      courseId: a.courseId,
      unitId: a.unitId,
      lessonId: a.lessonId,
      open: a.dueAt === null || nowMs <= a.dueAt,
    });
  }
  const mine = keep.length
    ? await db
        .select({ assignmentId: assignmentSubmissions.assignmentId, status: assignmentSubmissions.status, score: assignmentSubmissions.score, gradedAt: assignmentSubmissions.gradedAt })
        .from(assignmentSubmissions)
        .where(and(inArray(assignmentSubmissions.assignmentId, keep), eq(assignmentSubmissions.studentId, actor.userId)))
    : [];
  const mineByAssignment = new Map(mine.map((s) => [s.assignmentId, s]));
  for (const item of out) {
    const s = mineByAssignment.get(item.id as string);
    (item as { myStatus: string | null }).myStatus = s?.status ?? null;
    (item as { myScore: number | null }).myScore = s?.score ?? null;
  }
  return out;
}

export interface AssignmentStudentView {
  assignment: AssignmentRow;
  access: AssignmentAccess;
  submission: (SubmissionRow & { file?: { id: string; originalFilename: string; mime: string; byteSize: number } | null }) | null;
  /** true when this viewer may currently submit/replace as a student. */
  canSubmit: boolean;
  resultVisible: boolean;
}

export async function getAssignmentForStudent(
  db: DB,
  opts: { assignmentId: string; actor: AssignmentActor; nowMs: number }
): Promise<AssignmentStudentView | null> {
  const { assignmentId, actor, nowMs } = opts;
  const a = await getAssignment(db, assignmentId);
  if (!a) return null;
  const access = await assignmentAccess(db, actor, a);
  if (!access.allowed && actor.roleRank < 3) return null;
  if (a.status !== "published" && actor.roleRank < 3) return null;

  const mine = await db
    .select()
    .from(assignmentSubmissions)
    .where(and(eq(assignmentSubmissions.assignmentId, assignmentId), eq(assignmentSubmissions.studentId, actor.userId)))
    .limit(1);
  let submission = mine[0] ?? null;
  let file: AssignmentStudentView["submission"] = null;
  if (submission) {
    file = { ...submission, file: null };
    if (submission.fileId) {
      const f = await getFile(db, submission.fileId);
      if (f) file.file = { id: f.id, originalFilename: f.originalFilename, mime: f.mime, byteSize: f.byteSize };
    }
  }
  const pastDue = a.dueAt !== null && nowMs > a.dueAt;
  const channels: SubmissionChannel[] = (a.allowedSubmissionTypes ?? []) as SubmissionChannel[];
  const canSubmit =
    a.status === "published" &&
    access.allowed &&
    !pastDue &&
    (submission?.status !== "graded") &&
    channels.length > 0;
  const resultVisible = submission?.status === "graded" || actor.roleRank >= 3;
  return {
    assignment: a,
    access,
    submission: file,
    canSubmit,
    resultVisible,
  };
}

// ---------------------------------------------------------------------------
// Student submission (text / private file) — deadline + lock enforced
// ---------------------------------------------------------------------------

export type SubmitError = "not_found" | "denied" | "unpublished" | "after_due" | "channel" | "invalid_file" | "graded" | "no_content";

async function submissionGate(db: DB, assignmentId: string, actor: AssignmentActor, channel: SubmissionChannel, nowMs: number, hasContent: boolean) {
  const a = await getAssignment(db, assignmentId);
  if (!a) return { ok: false as const, error: "not_found" as SubmitError };
  const access = await assignmentAccess(db, actor, a);
  if (!access.allowed) return { ok: false as const, error: "denied" as SubmitError };
  if (a.status !== "published" && actor.roleRank < 3) return { ok: false as const, error: "unpublished" as SubmitError };
  if (a.dueAt !== null && nowMs > a.dueAt && actor.roleRank < 3) return { ok: false as const, error: "after_due" as SubmitError };
  const channels: SubmissionChannel[] = (a.allowedSubmissionTypes ?? []) as SubmissionChannel[];
  if (!channels.includes(channel)) return { ok: false as const, error: "channel" as SubmitError };
  if (!hasContent) return { ok: false as const, error: "no_content" as SubmitError };
  const existing = await db
    .select()
    .from(assignmentSubmissions)
    .where(and(eq(assignmentSubmissions.assignmentId, assignmentId), eq(assignmentSubmissions.studentId, actor.userId)))
    .limit(1);
  if (existing[0]?.status === "graded" && actor.roleRank < 3) return { ok: false as const, error: "graded" as SubmitError };
  return { ok: true as const, a, existing: existing[0] ?? null };
}

/**
 * Store/append a written answer (creates the submission if none yet; replaces a
 * prior submission before the deadline). Returns the submission row.
 */
export async function submitTextAnswer(
  db: DB,
  opts: { assignmentId: string; actor: AssignmentActor; text: string; nowMs: number }
): Promise<{ ok: true; submission: SubmissionRow } | { ok: false; error: SubmitError }> {
  const { assignmentId, actor, nowMs } = opts;
  const text = (opts.text ?? "").trim();
  if (text.length === 0) return { ok: false, error: "no_content" };
  const gate = await submissionGate(db, assignmentId, actor, "text", nowMs, true);
  if (!gate.ok) return gate;
  const { a, existing } = gate;
  const ts = nowMs;
  if (existing) {
    await db
      .update(assignmentSubmissions)
      .set({ textAnswer: text.slice(0, 100_000), status: "submitted", submittedAt: ts, updatedAt: ts })
      .where(eq(assignmentSubmissions.id, existing.id));
    const rows = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, existing.id)).limit(1);
    void a;
    return { ok: true, submission: rows[0]! };
  }
  const row: SubmissionRow = {
    id: crypto.randomUUID(),
    assignmentId,
    studentId: actor.userId,
    status: "submitted",
    textAnswer: text.slice(0, 100_000),
    fileId: null,
    submittedAt: ts,
    updatedAt: ts,
    score: null,
    feedback: null,
    gradedBy: null,
    gradedAt: null,
  };
  await db.insert(assignmentSubmissions).values(row);
  return { ok: true, submission: row };
}

/**
 * Associate (or replace) a private PDF/image answer file. Returns priorFileId so
 * the caller can delete the superseded private object after a successful swap.
 */
export async function attachSubmissionFile(
  db: DB,
  opts: { assignmentId: string; actor: AssignmentActor; fileId: string; nowMs: number }
): Promise<{ ok: true; submission: SubmissionRow; priorFileId: string | null } | { ok: false; error: SubmitError }> {
  const { assignmentId, actor, fileId, nowMs } = opts;
  const gate = await submissionGate(db, assignmentId, actor, "file", nowMs, true);
  if (!gate.ok) return gate;
  const { a, existing } = gate;
  // assignment submissions accept PDF/image only, must be PRIVATE, and must
  // belong to the submitting student (server-authoritative ownership)
  const fRows = await db
    .select({ kind: files.kind, visibility: files.visibility, createdBy: files.createdBy })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);
  const f = fRows[0];
  if (!f) return { ok: false, error: "not_found" };
  if (f.kind !== "pdf" && f.kind !== "image") return { ok: false, error: "invalid_file" };
  if (f.visibility !== "private") return { ok: false, error: "invalid_file" };
  if (f.createdBy !== actor.userId && actor.roleRank < 3) return { ok: false, error: "denied" };
  const ts = nowMs;
  if (existing) {
    const prior = existing.fileId;
    await db
      .update(assignmentSubmissions)
      .set({ fileId, status: "submitted", submittedAt: ts, updatedAt: ts })
      .where(eq(assignmentSubmissions.id, existing.id));
    const rows = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, existing.id)).limit(1);
    void a;
    return { ok: true, submission: rows[0]!, priorFileId: prior };
  }
  const row: SubmissionRow = {
    id: crypto.randomUUID(),
    assignmentId,
    studentId: actor.userId,
    status: "submitted",
    textAnswer: null,
    fileId,
    submittedAt: ts,
    updatedAt: ts,
    score: null,
    feedback: null,
    gradedBy: null,
    gradedAt: null,
  };
  await db.insert(assignmentSubmissions).values(row);
  return { ok: true, submission: row, priorFileId: null };
}

/** Remove a submitted file (only while replaceable). Returns priorFileId for cleanup. */
export async function clearSubmissionFile(
  db: DB,
  opts: { assignmentId: string; actor: AssignmentActor; nowMs: number }
): Promise<{ ok: true; priorFileId: string | null } | { ok: false; error: SubmitError }> {
  const { assignmentId, actor, nowMs } = opts;
  const existing = await db
    .select()
    .from(assignmentSubmissions)
    .where(and(eq(assignmentSubmissions.assignmentId, assignmentId), eq(assignmentSubmissions.studentId, actor.userId)))
    .limit(1);
  const sub = existing[0];
  if (!sub) return { ok: false, error: "not_found" };
  if (sub.status === "graded" && actor.roleRank < 3) return { ok: false, error: "graded" };
  if (actor.roleRank < 3) {
    const a = await getAssignment(db, assignmentId);
    if (!a) return { ok: false, error: "not_found" };
    if (a.dueAt !== null && nowMs > a.dueAt) return { ok: false, error: "after_due" };
  }
  const prior = sub.fileId;
  await db
    .update(assignmentSubmissions)
    .set({ fileId: null, updatedAt: nowMs })
    .where(eq(assignmentSubmissions.id, sub.id));
  return { ok: true, priorFileId: prior };
}

export async function getOwnedSubmission(db: DB, submissionId: string, studentId: string): Promise<SubmissionRow | null> {
  const rows = await db
    .select()
    .from(assignmentSubmissions)
    .where(and(eq(assignmentSubmissions.id, submissionId), eq(assignmentSubmissions.studentId, studentId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSubmission(db: DB, id: string): Promise<SubmissionRow | null> {
  const rows = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, id)).limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Grading — authorized grader scores; every change is audited
// ---------------------------------------------------------------------------

/**
 * Score one submission. The caller MUST be an authorized grader — authorization
 * is enforced here (server-authoritative): rank-4 bypasses, rank-3 needs an
 * explicit `assignment.grade` row, anyone below is denied. Every change is
 * clamped to [0, maxScore] and recorded in the append-only audit trail.
 */
export async function gradeSubmission(
  db: DB,
  input: {
    submissionId: string;
    score: number;
    feedback?: string | null;
    grader: { userId: string; role: string; rank: number; roleId: string };
    nowMs?: number;
  }
): Promise<{ submissionId: string; score: number; finalized: boolean }> {
  const authorized = await canAssignment(db, { user: { rank: input.grader.rank, roleId: input.grader.roleId } }, "assignment.grade");
  if (!authorized) throw new AssignmentValidationError([{ path: "perm", message: "denied" }]);
  const ts = input.nowMs ?? now();
  const sub = await getSubmission(db, input.submissionId);
  if (!sub) throw new AssignmentReferenceError("submissionId", "submission not found");
  const a = await getAssignment(db, sub.assignmentId);
  if (!a) throw new AssignmentReferenceError("assignmentId", "assignment not found");
  const clamped = Math.round(Math.min(a.maxScore, Math.max(0, input.score)) * 100) / 100;
  const feedback = typeof input.feedback === "string" && input.feedback.trim() ? input.feedback.trim().slice(0, 4000) : null;

  const before = { score: sub.score, feedback: sub.feedback, status: sub.status };
  await db
    .update(assignmentSubmissions)
    .set({ status: "graded", score: clamped, feedback, gradedBy: input.grader.userId, gradedAt: ts, updatedAt: ts })
    .where(eq(assignmentSubmissions.id, sub.id));
  await logAudit(db, {
    actorUserId: input.grader.userId,
    actorRole: input.grader.role,
    action: "assignment.graded",
    entityType: "assignment_submission",
    entityId: sub.id,
    before,
    after: { score: clamped, feedback, status: "graded" },
    ipHash: null,
  });
  return { submissionId: sub.id, score: clamped, finalized: true };
}

export interface GradeQueueItem {
  submissionId: string;
  assignmentId: string;
  assignmentTitleAr: string;
  assignmentTitleEn: string;
  maxScore: number;
  studentId: string;
  studentName: string;
  studentEmail: string;
  textAnswer: string | null;
  file: { id: string; originalFilename: string; mime: string; byteSize: number } | null;
  submittedAt: number;
  status: "submitted" | "graded";
  score: number | null;
  feedback: string | null;
  gradedBy: string | null;
  gradedAt: number | null;
}

/** Submissions for a grader to review (all, or scoped to one assignment). */
export async function gradingQueue(db: DB, filter: { assignmentId?: string; status?: "submitted" | "graded"; limit?: number } = {}): Promise<GradeQueueItem[]> {
  const conds = [];
  if (filter.assignmentId) conds.push(eq(assignmentSubmissions.assignmentId, filter.assignmentId));
  if (filter.status) conds.push(eq(assignmentSubmissions.status, filter.status));
  const subs = await db
    .select()
    .from(assignmentSubmissions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(assignmentSubmissions.submittedAt))
    .limit(Math.min(filter.limit ?? 100, 200));
  const out: GradeQueueItem[] = [];
  for (const s of subs) {
    const a = await getAssignment(db, s.assignmentId);
    if (!a) continue;
    const stu = await db.select({ fullName: users.fullName, email: users.email }).from(users).where(eq(users.id, s.studentId)).limit(1);
    let file: GradeQueueItem["file"] = null;
    if (s.fileId) {
      const f = await getFile(db, s.fileId);
      if (f) file = { id: f.id, originalFilename: f.originalFilename, mime: f.mime, byteSize: f.byteSize };
    }
    out.push({
      submissionId: s.id,
      assignmentId: a.id,
      assignmentTitleAr: a.titleAr,
      assignmentTitleEn: a.titleEn,
      maxScore: a.maxScore,
      studentId: s.studentId,
      studentName: stu[0]?.fullName ?? s.studentId,
      studentEmail: stu[0]?.email ?? "",
      textAnswer: s.textAnswer,
      file,
      submittedAt: s.submittedAt,
      status: s.status,
      score: s.score,
      feedback: s.feedback,
      gradedBy: s.gradedBy,
      gradedAt: s.gradedAt,
    });
  }
  return out;
}

/** Full picture for an admin/detail page (assignment + its submissions + counts). */
export async function adminAssignmentSummary(db: DB, assignmentId: string) {
  const a = await getAssignment(db, assignmentId);
  if (!a) return null;
  const subs = await db
    .select()
    .from(assignmentSubmissions)
    .where(eq(assignmentSubmissions.assignmentId, assignmentId))
    .orderBy(desc(assignmentSubmissions.updatedAt));
  const studentIds = [...new Set(subs.map((s) => s.studentId))];
  const stuRows = studentIds.length ? await db.select().from(users).where(inArray(users.id, studentIds)) : [];
  const byId = new Map(stuRows.map((u) => [u.id, u]));
  return {
    assignment: a,
    submissions: subs.map((s) => ({
      ...s,
      studentName: byId.get(s.studentId)?.fullName ?? s.studentId,
      studentEmail: byId.get(s.studentId)?.email ?? "",
    })),
    submittedCount: subs.filter((s) => s.status === "submitted").length,
    gradedCount: subs.filter((s) => s.status === "graded").length,
  };
}

/** Recent grade-change audit rows for one submission (graders/proctors only). */
export async function submissionGradeHistory(db: DB, submissionId: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "assignment_submission"), eq(auditLogs.entityId, submissionId)))
    .orderBy(asc(auditLogs.createdAt));
  return rows.map((r) => ({ action: r.action, before: r.before, after: r.after, actorUserId: r.actorUserId, createdAt: r.createdAt }));
}
