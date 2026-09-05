/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { sql } from "drizzle-orm";
import { registerUser } from "~server/auth/service.server";
import { chainForCourse, chainForLesson, createCourse, createGrade, createLesson, createProgram, createSubject, createUnit } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { grantEntitlement, revokeEntitlement } from "~server/entitlements/grant.server";
import { entitlements } from "~server/db/schema";

/**
 * End-to-end access resolution with REAL D1 rows: RBAC ranks, access levels,
 * entitlement coverage via ancestors, expiry, revocation, publish windows.
 */
const actor = { userId: "00000000-0000-4000-8000-000000000002", role: "super_admin" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

const anon = { userId: null, roleRank: 0 };
const student = { userId: null as string | null, roleRank: 1 };
const admin = { userId: null as string | null, roleRank: 4 };

let ids: { subjectId: string; courseId: string; lessonEntitledId: string; lessonFreeId: string; lessonAuthId: string };
let studentId: string;
const db = getDb(env);

beforeEach(async () => {
  // wipe content + entitlements for isolation
  for (const table of ["lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs", "entitlements"]) {
    await db.run(`DELETE FROM ${table}`);
  }
  // ensure a student (unique IP per run — register rate limit is 5/h/IP)
  const r = crypto.randomUUID().slice(0, 8);
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const email = `access-${r}@test.local`;
  const reg = await registerUser(env, { email, fullName: "Access Student", password: "Str0ngPass!x" }, new Request("https://app.test/register", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } }));
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed");
  studentId = reg.userId;
  student.userId = studentId;

  const program = await createProgram(db, { titleAr: "ب", titleEn: "Access Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Access Grade", status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Access Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
  const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Access Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
  const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "Access Unit", status: "published", sortOrder: 0 }, actor);
  const lessonEntitled = await createLesson(db, { unitId: unit.id, titleAr: "م1", titleEn: "Entitled Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  const lessonFree = await createLesson(db, { unitId: unit.id, titleAr: "م2", titleEn: "Free Lesson", status: "published", accessLevel: "entitled", freePreview: true, sortOrder: 1, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  const lessonAuth = await createLesson(db, { unitId: unit.id, titleAr: "م3", titleEn: "Auth Lesson", status: "published", accessLevel: "authenticated", freePreview: false, sortOrder: 2, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  ids = { subjectId: subject.id, courseId: course.id, lessonEntitledId: lessonEntitled.id, lessonFreeId: lessonFree.id, lessonAuthId: lessonAuth.id };
});

describe("resolveContentAccess (server-side verdicts)", () => {
  it("anon: entitled lesson → anon denial", async () => {
    const chain = await chainForLesson(db, ids.lessonEntitledId);
    expect(await resolveContentAccess(db, anon, chain!)).toEqual({ allowed: false, reason: "anon" });
  });

  it("student without grants: entitled denied, authenticated allowed, free_preview allowed", async () => {
    const entitled = await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonEntitledId))!);
    expect(entitled).toEqual({ allowed: false, reason: "no_entitlement" });

    const authed = await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonAuthId))!);
    expect(authed).toEqual({ allowed: true, reason: "authenticated" });

    const free = await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonFreeId))!);
    expect(free).toEqual({ allowed: true, reason: "free_preview" });
  });

  it("subject-level grant covers descendant lessons through the ancestry chain", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: ids.subjectId, days: 30, note: "test" }, actor);
    const verdict = await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonEntitledId))!);
    expect(verdict).toEqual({ allowed: true, reason: "entitlement" });
  });

  it("course-level grant covers the course page AND its lessons", async () => {
    await grantEntitlement(db, { studentId, resourceType: "course", resourceId: ids.courseId, days: null }, actor);
    expect(await resolveContentAccess(db, student, (await chainForCourse(db, ids.courseId))!)).toEqual({ allowed: true, reason: "entitlement" });
    expect(await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonEntitledId))!)).toEqual({ allowed: true, reason: "entitlement" });
  });

  it("grant on an UNRELATED course does not grant access", async () => {
    await grantEntitlement(db, { studentId, resourceType: "course", resourceId: "00000000-0000-4000-8000-0000000000ff", days: null }, actor);
    expect(await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonEntitledId))!)).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("expired grant does not grant; revoked grant does not grant", async () => {
    // expired: starts in the past with expiry in the past
    await db.insert(entitlements).values({
      id: crypto.randomUUID(), studentId, sourceType: "admin_grant", resourceType: "subject",
      resourceId: ids.subjectId, status: "active", startsAt: Date.now() - 90_000, expiresAt: Date.now() - 60_000,
      grantedAt: Date.now() - 90_000, grantedBy: actor.userId,
    });
    expect(await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonEntitledId))!)).toEqual({ allowed: false, reason: "no_entitlement" });

    // revoked
    const g = await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: ids.subjectId, days: 30 }, actor);
    await revokeEntitlement(db, g.id, "test revoke", actor);
    expect(await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonEntitledId))!)).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("admin bypasses content gating (rank ≥ 3)", async () => {
    admin.userId = "00000000-0000-4000-8000-000000000003";
    const verdict = await resolveContentAccess(db, admin, (await chainForLesson(db, ids.lessonEntitledId))!);
    expect(verdict).toEqual({ allowed: true, reason: "admin" });
  });

  it("draft lessons are invisible to everyone (lifecycle precedes RBAC)", async () => {
    await db.run(sql`UPDATE lessons SET status = 'draft' WHERE id = ${ids.lessonEntitledId}`);
    admin.userId = "00000000-0000-4000-8000-000000000003";
    expect(await resolveContentAccess(db, admin, (await chainForLesson(db, ids.lessonEntitledId))!)).toEqual({ allowed: false, reason: "not_published" });
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: ids.subjectId, days: 30 }, actor);
    expect(await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonEntitledId))!)).toEqual({ allowed: false, reason: "not_published" });
  });

  it("scheduled lesson (publish_at future) is denied", async () => {
    await db.run(sql`UPDATE lessons SET publish_at = ${Date.now() + 3_600_000} WHERE id = ${ids.lessonEntitledId}`);
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: ids.subjectId, days: 30 }, actor);
    expect(await resolveContentAccess(db, student, (await chainForLesson(db, ids.lessonEntitledId))!)).toEqual({ allowed: false, reason: "scheduled" });
  });
});
