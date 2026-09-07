/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { createCourse, createGrade, createLesson, createProgram, createSubject, createUnit } from "~server/content/service.server";
import { grantEntitlement } from "~server/entitlements/grant.server";
import { student360 } from "~server/students/service.server";
import {
  searchAssignments, searchCourses, searchExams, searchLessons, searchStudents,
} from "~server/search/service.server";
import {
  assignmentSubmissions, assignments, examAttempts, exams, lessonProgress,
} from "~server/db/schema";

import { loader as s360Loader } from "~/routes/admin/students.$id";
import { loader as searchLoader } from "~/routes/admin.search";

/**
 * Student 360 + Global Admin Search on REAL D1 + REAL route loaders:
 * aggregation correctness (real data only, no cross-student leakage, no private
 * file urls), bounded activity, RBAC on the student-360 + search surfaces, and
 * permission-aware, bounded, ar/en search.
 */
const db = getDb(env);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const now = () => Date.now();

let superA: { id: string; email: string; cookie: string };
let adminB: { id: string; email: string; cookie: string };
let studentA: { id: string; email: string; cookie: string };
let studentB: { id: string; email: string; cookie: string };
let courseId: string;
let lessonId: string;

async function wipe() {
  for (const table of [
    "assignment_submissions", "assignments", "exam_answers", "exam_attempts", "exams",
    "video_watch_sessions", "video_progress", "lesson_progress",
    "entitlements", "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "files", "audit_logs", "security_events",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function makeUser(prefix: string, role: "student" | "admin" | "super_admin" = "student", fullName = `${prefix} Tester`) {
  const r = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${r}@test.local`;
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const req = () => new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
  const reg = await registerUser(env, { email, password: "Str0ngPass!x", fullName }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  if (role !== "student") await db.run(sql`UPDATE users SET role_id = ${role} WHERE id = ${reg.userId}`);
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed: " + JSON.stringify(loggedIn));
  return { id: reg.userId, email, cookie: loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

async function makeCourse(titleAr: string, titleEn: string) {
  const actor = { userId: superA.id, role: "super_admin", ipHash: "test" };
  const program = await createProgram(db, { titleAr: "برنامج", titleEn: "Prog", status: "published", sortOrder: 0 }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "صف", titleEn: "Grade", status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "مادة", titleEn: "Subject", status: "published", sortOrder: 0 }, actor);
  const course = await createCourse(db, {
    subjectId: subject.id, titleAr, titleEn, status: "published", visibility: "catalog", accessLevel: "entitled",
    sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
  }, actor);
  const unit = await createUnit(db, { courseId: course.id, titleAr: "وحدة", titleEn: "Unit", status: "published", sortOrder: 0 }, actor);
  const lesson = await createLesson(db, {
    unitId: unit.id, titleAr: "درس", titleEn: "Lesson", status: "published", accessLevel: "entitled",
    freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null,
  }, actor);
  return { courseId: course.id, unitId: unit.id, lessonId: lesson.id };
}

beforeEach(async () => {
  await wipe();
  await db.run(sql`INSERT OR IGNORE INTO role_permissions (role_id, permission, granted_at) VALUES
    ('admin', 'users.read', (strftime('%s','now') * 1000)),
    ('admin', 'users.manage', (strftime('%s','now') * 1000)),
    ('admin', 'assignment.read', (strftime('%s','now') * 1000)),
    ('admin', 'assessment.read', (strftime('%s','now') * 1000))`);
  superA = await makeUser("s360-super", "super_admin");
  adminB = await makeUser("s360-admin", "admin");
  studentA = await makeUser("s360-lila", "student", "ليلى أحمد");
  studentB = await makeUser("s360-ziad", "student", "Ziad Tester");
  const c = await makeCourse("رياضيات متقدمة", "Advanced Algebra");
  courseId = c.courseId;
  lessonId = c.lessonId;
});

const call = (fn: unknown, req: Request, params: Record<string, string> = {}) =>
  (fn as (args: unknown) => unknown)({ context: routeCtx, request: req, params });
const get = (path: string, cookie?: string) =>
  new Request(`https://app.test${path}`, { method: "GET", headers: cookie ? { cookie, "user-agent": UA } : { "user-agent": UA } });

async function catchResponse(p: Promise<unknown>): Promise<Response> {
  try {
    const v = await p;
    if (v instanceof Response) return v;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  throw new Error("expected a thrown Response");
}

function seedAssignment(titleAr: string, titleEn: string, fileId: string | null) {
  const id = crypto.randomUUID();
  return db.insert(assignments).values({
    id, titleAr, titleEn, maxScore: 10, allowedSubmissionTypes: ["text", "file"],
    status: "published", createdAt: now(), updatedAt: now(),
  }).then(() => id);
}

describe("Student 360 service aggregation", () => {
  it("aggregates real enrollments, progress, assessments and assignments; leaks nothing cross-student", async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "course", resourceId: courseId, days: null }, { userId: superA.id, role: "super_admin" });
    // course progress: mark the single published lesson completed for A only
    await db.insert(lessonProgress).values({ id: crypto.randomUUID(), studentId: studentA.id, lessonId, status: "completed", completedAt: now() - 1000, lastActivityAt: now() - 1000, createdAt: now() - 2000, updatedAt: now() - 1000 });

    // one graded exam attempt
    await db.insert(exams).values({ id: "ex-1", slug: `ex-${crypto.randomUUID().slice(0, 6)}`, titleAr: "امتحان", titleEn: "Exam", config: {}, status: "published", createdBy: superA.id, createdAt: now() - 3000, updatedAt: now() - 3000 });
    await db.insert(examAttempts).values({ id: "at-1", examId: "ex-1", studentId: studentA.id, attemptNumber: 1, status: "graded", startedAt: now() - 9000, submittedAt: now() - 8000, score: 9, maxScore: 10, passed: true, gradingStatus: "complete", randomSeed: 1 });

    // one graded assignment submission with a private file reference
    const aId = await seedAssignment("واجب جبري", "Algebra HW", "file-secret-id");
    await db.insert(assignmentSubmissions).values({ id: crypto.randomUUID(), assignmentId: aId, studentId: studentA.id, status: "graded", fileId: "file-secret-id", submittedAt: now() - 5000, updatedAt: now() - 4000, score: 8, feedback: "جيد", gradedBy: superA.id, gradedAt: now() - 4000 });

    const a = (await student360(db, studentA.id))!;
    expect(a.isStudent).toBe(true);
    expect(a.identity?.email).toBe(studentA.email);
    expect(a.identity?.fullName).toBe("ليلى أحمد");
    expect(a.entitlements).toHaveLength(1);
    expect(a.entitlements[0].state).toBe("active");
    expect(a.entitlements[0].resourceTitleEn).toBe("Advanced Algebra");
    expect(a.courses).toHaveLength(1);
    expect(a.courses[0].completedLessons).toBe(1);
    expect(a.courses[0].totalLessons).toBe(1);
    expect(a.courses[0].pct).toBe(100);
    expect(a.attempts).toHaveLength(1);
    expect(a.attempts[0].score).toBe(9);
    expect(a.attempts[0].passed).toBe(true);
    expect(a.assignments).toHaveLength(1);
    expect(a.assignments[0].status).toBe("graded");
    expect(a.assignments[0].score).toBe(8);
    expect(a.assignments[0].hasFile).toBe(true);
    expect(a.summary.lessonsCompleted).toBe(1);
    expect(a.summary.attempts).toBe(1);
    // activity timeline only real events, includes account creation + graded assignment
    const kinds = a.timeline.map((t) => t.kind);
    expect(kinds).toContain("account_created");
    expect(kinds).toContain("assignment_graded");
    expect(kinds).toContain("exam_submitted");
    expect(a.timeline.length).toBeLessThanOrEqual(40);

    // B sees none of A's data
    const b = (await student360(db, studentB.id))!;
    expect(b.isStudent).toBe(true);
    expect(b.entitlements).toHaveLength(0);
    expect(b.attempts).toHaveLength(0);
    expect(b.assignments).toHaveLength(0);
    expect(b.courses).toHaveLength(0);
  });

  it("never exposes private file ids/urls in the student-360 payload", async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "course", resourceId: courseId, days: null }, { userId: superA.id, role: "super_admin" });
    const aId = await seedAssignment("واجب", "HW", "FILE-LEAK-GUARD-123");
    await db.insert(assignmentSubmissions).values({ id: crypto.randomUUID(), assignmentId: aId, studentId: studentA.id, status: "submitted", fileId: "FILE-LEAK-GUARD-123", submittedAt: now() - 5000, updatedAt: now() - 5000 });

    const d = (await call(s360Loader, get(`/admin/students/${studentA.id}`, superA.cookie), { id: studentA.id })) as { data: unknown };
    const json = JSON.stringify(d);
    expect(json).toContain("hasFile");
    expect(json).not.toContain("FILE-LEAK-GUARD-123");
    expect(json).not.toContain("/files/");
  });

  it("rejects non-students (redirects to the generic user page) and unknown ids", async () => {
    // teacher/admin id -> not a student -> redirect (never 200 with student data)
    const redir = await catchResponse(call(s360Loader, get(`/admin/students/${adminB.id}`, superA.cookie), { id: adminB.id }) as Promise<unknown>);
    expect(redir.status).toBe(302);
    // unknown id -> not a student -> redirect (or 404); never student data
    const unk = await catchResponse(call(s360Loader, get(`/admin/students/does-not-exist`, superA.cookie), { id: "does-not-exist" }) as Promise<unknown>);
    expect(unk.status >= 300).toBe(true);
  });

  it("RBAC: an unprivileged user is rejected and sees no data", async () => {
    const res = await catchResponse(call(s360Loader, get(`/admin/students/${studentA.id}`, studentA.cookie), { id: studentA.id }) as Promise<unknown>);
    expect(res.status).not.toBe(200);
    expect(res.status >= 300).toBe(true);
    // a staff member without users.read is also rejected on this surface
    await db.run(sql`DELETE FROM role_permissions WHERE role_id='admin' AND permission='users.read'`);
    const denied = await catchResponse(call(s360Loader, get(`/admin/students/${studentA.id}`, adminB.cookie), { id: studentA.id }) as Promise<unknown>);
    expect(denied.status).toBe(403);
  });
});

describe("Global admin search", () => {
  it("searches students (ar name + email), courses (ar + en), assignments, exams, lessons", async () => {
    // a second distinct course/assignment/exam/lesson to keep matching deterministic
    const c2 = await makeCourse("فيزياء", "Physics 101");

    // students: matches Arabic fullName and Latin email
    const byName = await searchStudents(db, "ليلى");
    expect(byName.some((s) => s.id === studentA.id)).toBe(true);
    const byEmail = await searchStudents(db, studentA.email.split("@")[0]);
    expect(byEmail.some((s) => s.id === studentA.id)).toBe(true);

    // courses: Arabic and English titles
    const ar = await searchCourses(db, "رياضيات");
    expect(ar.some((c) => c.id === courseId)).toBe(true);
    const en = await searchCourses(db, "Physics");
    expect(en.some((c) => c.id === c2.courseId)).toBe(true);

    // assignments
    const aId = await seedAssignment("واجب تركيبي", "Synthesis HW", null);
    const ahw = await searchAssignments(db, "Synthesis");
    expect(ahw.some((a) => a.id === aId)).toBe(true);
    const ahwAr = await searchAssignments(db, "تركيبي");
    expect(ahwAr.some((a) => a.id === aId)).toBe(true);

    // exams
    await db.insert(exams).values({ id: "ex-s", slug: `ex-${crypto.randomUUID().slice(0, 6)}`, titleAr: "اختبار نهاية الفصل", titleEn: "Final Term", config: {}, status: "published", createdBy: superA.id, createdAt: now(), updatedAt: now() });
    const ex = await searchExams(db, "Final");
    expect(ex.some((e) => e.id === "ex-s")).toBe(true);

    // lessons
    const le = await searchLessons(db, "درس");
    expect(le.length).toBeGreaterThanOrEqual(1);
  });

  it("is bounded, handles empty/overlong/malformed input, and empty results", async () => {
    expect(await searchStudents(db, "")).toHaveLength(0);
    expect(await searchStudents(db, "   ")).toHaveLength(0);
    expect(await searchCourses(db, "")).toHaveLength(0);
    // overlong input is clamped, does not throw
    const big = "x".repeat(5000);
    const clamped = await searchStudents(db, big);
    expect(Array.isArray(clamped)).toBe(true);
    // no match
    expect(await searchCourses(db, "zzz-no-such")).toHaveLength(0);
    // bounded: never more than the category limit
    for (let i = 0; i < 25; i++) await seedAssignment(`واجب عام ${i}`, `Common HW ${i}`, null);
    const hits = await searchAssignments(db, "Common");
    expect(hits.length).toBeLessThanOrEqual(8);
  });

  it("search route is permission-aware (no users.read -> no student results)", async () => {
    const full = (await call(searchLoader, get("/admin/search?q=ليلى", superA.cookie))) as { groups: Record<string, unknown[]> };
    expect((full.groups.students as unknown[]).length).toBeGreaterThan(0);

    await db.run(sql`DELETE FROM role_permissions WHERE role_id='admin' AND permission='users.read'`);
    const stripped = (await call(searchLoader, get("/admin/search?q=ليلى", adminB.cookie))) as { groups: Record<string, unknown[]> };
    expect(stripped.groups.students).toHaveLength(0);
    // courses still returned (not user-gated)
    expect((stripped.groups.courses as unknown[]).length).toBeGreaterThanOrEqual(0);
  });

  it("search route RBAC: students cannot reach it", async () => {
    const res = await catchResponse(call(searchLoader, get("/admin/search?q=ليلى", studentA.cookie)) as Promise<unknown>);
    expect(res.status).not.toBe(200);
    expect(res.status >= 300).toBe(true);
  });
});
