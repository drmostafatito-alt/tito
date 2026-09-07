/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import {
  createCourse, createGrade, createLesson, createProgram, createSubject, createUnit,
} from "~server/content/service.server";
import { assignmentSubmissions, examAttempts } from "~server/db/schema";
import { adminOps } from "~server/analytics/service.server";
import { loader as homeLoader } from "~/routes/admin/home";

/**
 * Phase B operational counters on REAL D1 + REAL route loader: the dashboard's
 * "needs attention" strip counts only real data (published courses, submissions
 * awaiting assignment grading, exam attempts parked in `grading`) and is present
 * for authorized admins and hidden when analytics.read is absent.
 */
const db = getDb(env);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

let superA: { id: string; email: string; cookie: string };
let adminB: { id: string; email: string; cookie: string };
let studentA: { id: string; email: string; cookie: string };

async function wipe() {
  for (const table of [
    "assignment_submissions", "assignments", "exam_answers", "exam_attempts", "exams",
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "entitlements", "audit_logs", "events", "security_events", "sessions", "devices",
    "users",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function makeUser(prefix: string, role: "student" | "admin" | "super_admin" = "student") {
  const r = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${r}@test.local`;
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const req = () => new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
  const reg = await registerUser(env, { email, password: "Str0ngPass!x", fullName: `${prefix} Tester` }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  if (role !== "student") await db.run(sql`UPDATE users SET role_id = ${role} WHERE id = ${reg.userId}`);
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed: " + JSON.stringify(loggedIn));
  return { id: reg.userId, email, cookie: loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

async function makePublishedCourse() {
  const actor = { userId: superA.id, role: "super_admin", ipHash: "test" };
  const program = await createProgram(db, { titleAr: "برنامج", titleEn: "Prog", status: "published", sortOrder: 0 }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "صف", titleEn: "Grade", status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "مادة", titleEn: "Subject", status: "published", sortOrder: 0 }, actor);
  const course = await createCourse(db, {
    subjectId: subject.id, titleAr: "كورس", titleEn: "Course", status: "published", visibility: "catalog",
    accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null,
    teacherId: null, publishAt: null, expiresAt: null,
  }, actor);
  return course.id;
}

beforeEach(async () => {
  await wipe();
  await db.run(sql`INSERT OR IGNORE INTO role_permissions (role_id, permission, granted_at) VALUES
    ('admin', 'analytics.read', (strftime('%s','now') * 1000))`);
  superA = await makeUser("ops-super", "super_admin");
  adminB = await makeUser("ops-admin", "admin");
  studentA = await makeUser("ops-stu");
});

const call = (fn: unknown, req: Request, params: Record<string, string> = {}) =>
  (fn as (args: unknown) => unknown)({ context: routeCtx, request: req, params });
const get = (path: string, cookie?: string) =>
  new Request(`https://app.test${path}`, { method: "GET", headers: cookie ? { cookie, "user-agent": UA } : { "user-agent": UA } });

describe("Phase B operational counters", () => {
  it("counts only real published courses / submitted assignments / grading-parked exam attempts", async () => {
    await makePublishedCourse();
    // pending assignment grading: one submission awaiting grading
    await db.insert(assignmentSubmissions).values({
      id: crypto.randomUUID(), assignmentId: "asg-1", studentId: studentA.id, status: "submitted",
      submittedAt: Date.now() - 1000, updatedAt: Date.now() - 1000,
    });
    // a graded one must NOT count
    await db.insert(assignmentSubmissions).values({
      id: crypto.randomUUID(), assignmentId: "asg-2", studentId: studentA.id, status: "graded",
      score: 8, submittedAt: Date.now() - 2000, updatedAt: Date.now() - 1000,
    });
    // pending essay grading: one attempt parked in `grading`
    await db.insert(examAttempts).values({
      id: "att-1", examId: "ex-1", studentId: studentA.id, attemptNumber: 1, status: "grading",
      startedAt: Date.now() - 5000, gradingStatus: "needs_manual", randomSeed: 1,
    });
    // a fully graded attempt must NOT count
    await db.insert(examAttempts).values({
      id: "att-2", examId: "ex-2", studentId: studentA.id, attemptNumber: 1, status: "graded",
      startedAt: Date.now() - 6000, gradingStatus: "complete", randomSeed: 2,
    });

    const ops = await adminOps(db);
    expect(ops.publishedCourses).toBe(1);
    expect(ops.pendingAssignmentGrading).toBe(1);
    expect(ops.pendingEssayGrading).toBe(1);
  });

  it("home loader exposes ops for authorized admins and hides them without analytics.read", async () => {
    const withPerm = (await call(homeLoader, get("/admin", adminB.cookie))) as { ops: unknown; canAnalytics: boolean };
    expect(withPerm.canAnalytics).toBe(true);
    expect(withPerm.ops).not.toBeNull();

    await db.run(sql`DELETE FROM role_permissions WHERE role_id='admin' AND permission='analytics.read'`);
    const noPerm = (await call(homeLoader, get("/admin", adminB.cookie))) as { ops: unknown; canAnalytics: boolean };
    expect(noPerm.canAnalytics).toBe(false);
    expect(noPerm.ops).toBeNull();
  });
});
