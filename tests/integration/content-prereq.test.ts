/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import {
  ContentReferenceError,
  PrerequisiteCycleError,
  coursePrereqGate,
  createCourse,
  createGrade,
  createLesson,
  createProgram,
  createSubject,
  createUnit,
  prerequisitesForCourse,
  prerequisiteClosureFor,
  setCoursePrerequisites,
} from "~server/content/service.server";
import { auditLogs, courses, lessonProgress, lessons, units } from "~server/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const actor = { userId: "00000000-0000-4000-8000-000000000001", role: "super_admin" };
const studentId = "00000000-0000-4000-8000-000000000002";

async function wipe() {
  const db = getDb(env);
  for (const table of ["course_prerequisites", "lesson_progress", "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs", "videos", "files", "audit_logs"]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

beforeEach(wipe);

/** Creates one program/grade/subject (shared) then a published course with one published lesson. */
async function mkCourse(tag: string) {
  const db = getDb(env);
  const program = await createProgram(db, { titleAr: `برنامج ${tag}`, titleEn: `Prg ${tag}`, status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: `صف ${tag}`, titleEn: `Grd ${tag}`, status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: `مادة ${tag}`, titleEn: `Sub ${tag}`, status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
  const course = await createCourse(db, { subjectId: subject.id, titleAr: `دورة ${tag}`, titleEn: `Course ${tag}`, status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
  const unit = await createUnit(db, { courseId: course.id, titleAr: `وحدة ${tag}`, titleEn: `Unit ${tag}`, status: "published", sortOrder: 0 }, actor);
  const lesson = await createLesson(db, { unitId: unit.id, titleAr: `درس ${tag}`, titleEn: `Lesson ${tag}`, status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  return { program, grade, subject, course, unit, lesson };
}

async function markCompleted(courseId: string, studentId: string) {
  const db = getDb(env);
  const us = await db.select({ id: units.id }).from(units).where(eq(units.courseId, courseId));
  const ls = us.length ? await db.select({ id: lessons.id }).from(lessons).where(inArray(lessons.unitId, us.map((u) => u.id))) : [];
  const now = Date.now();
  for (const l of ls) {
    const existing = await db.select({ id: lessonProgress.id }).from(lessonProgress).where(and(eq(lessonProgress.studentId, studentId), eq(lessonProgress.lessonId, l.id))).limit(1);
    if (existing.length === 0) {
      await db.insert(lessonProgress).values({ id: crypto.randomUUID(), studentId, lessonId: l.id, status: "completed", completedAt: now, lastActivityAt: now, createdAt: now, updatedAt: now });
    } else {
      await db.update(lessonProgress).set({ status: "completed", completedAt: now, lastActivityAt: now, updatedAt: now }).where(eq(lessonProgress.id, existing[0].id));
    }
  }
}

describe("course prerequisites", () => {
  it("stores, lists and replaces a course's prerequisite set (audited)", async () => {
    const db = getDb(env);
    const a = await mkCourse("A");
    const b = await mkCourse("B");
    const c = await mkCourse("C");

    await setCoursePrerequisites(db, a.course.id, [b.course.id, c.course.id, b.course.id, a.course.id, ""], actor);
    const prereqs = await prerequisitesForCourse(db, a.course.id);
    expect(prereqs.map((p) => p.courseId).sort()).toEqual([b.course.id, c.course.id].sort());
    expect(prereqs.every((p) => p.titleEn && p.slug)).toBe(true);

    // replace the whole set
    await setCoursePrerequisites(db, a.course.id, [c.course.id], actor);
    const after = await prerequisitesForCourse(db, a.course.id);
    expect(after.map((p) => p.courseId)).toEqual([c.course.id]);

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "content.course.prerequisites"));
    expect(audits.length).toBe(2);
    expect(audits[1].entityId).toBe(a.course.id);
  });

  it("rejects unknown prerequisite courses and self/duplicate-only inputs", async () => {
    const db = getDb(env);
    const a = await mkCourse("A");
    await expect(setCoursePrerequisites(db, a.course.id, ["00000000-0000-4000-8000-00000000dead"], actor)).rejects.toBeInstanceOf(ContentReferenceError);
    await expect(setCoursePrerequisites(db, "00000000-0000-4000-8000-00000000dead", [a.course.id], actor)).rejects.toBeInstanceOf(ContentReferenceError);
    // clearing (empty) is valid and just removes everything
    await setCoursePrerequisites(db, a.course.id, [], actor);
    expect(await prerequisitesForCourse(db, a.course.id)).toEqual([]);
  });

  it("rejects introducing a cycle (A requires B, then B requires A)", async () => {
    const db = getDb(env);
    const a = await mkCourse("A");
    const b = await mkCourse("B");
    await setCoursePrerequisites(db, a.course.id, [b.course.id], actor);
    await expect(setCoursePrerequisites(db, b.course.id, [a.course.id], actor)).rejects.toBeInstanceOf(PrerequisiteCycleError);
    // state unchanged
    expect((await prerequisitesForCourse(db, b.course.id)).length).toBe(0);
    expect((await prerequisitesForCourse(db, a.course.id)).length).toBe(1);
  });

  it("computes the transitive closure (C requires B, B requires A => A,B)", async () => {
    const db = getDb(env);
    const a = await mkCourse("A");
    const b = await mkCourse("B");
    const c = await mkCourse("C");
    await setCoursePrerequisites(db, b.course.id, [a.course.id], actor);
    await setCoursePrerequisites(db, c.course.id, [b.course.id], actor);
    const closure = await prerequisiteClosureFor(db, c.course.id);
    expect(closure.map((p) => p.courseId).sort()).toEqual([a.course.id, b.course.id].sort());
  });

  it("gates a student behind completion of live prerequisites and unlocks after completion", async () => {
    const db = getDb(env);
    const a = await mkCourse("A");
    const b = await mkCourse("B");
    await setCoursePrerequisites(db, b.course.id, [a.course.id], actor);

    const subject = { userId: studentId, roleRank: 1 };
    // not yet complete => locked, listing the missing prereq
    const lock = await coursePrereqGate(db, subject, b.course.id);
    expect(lock.locked).toBe(true);
    expect(lock.missing.map((m) => m.courseId)).toEqual([a.course.id]);

    // complete the prerequisite course's lesson
    await markCompleted(a.course.id, studentId);
    const open = await coursePrereqGate(db, subject, b.course.id);
    expect(open.locked).toBe(false);
    expect(open.missing).toEqual([]);

    // a course with no prerequisites is never locked for a student
    const noPrereq = await coursePrereqGate(db, subject, a.course.id);
    expect(noPrereq.locked).toBe(false);
  });

  it("bypasses gating for anonymous viewers and staff (teachers/admins)", async () => {
    const db = getDb(env);
    const a = await mkCourse("A");
    const b = await mkCourse("B");
    await setCoursePrerequisites(db, b.course.id, [a.course.id], actor);
    const gate = await coursePrereqGate(db, { userId: null, roleRank: 0 }, b.course.id);
    expect(gate.locked).toBe(false);
    expect((await coursePrereqGate(db, { userId: "tch", roleRank: 2 }, b.course.id)).locked).toBe(false);
    expect((await coursePrereqGate(db, { userId: "adm", roleRank: 3 }, b.course.id)).locked).toBe(false);
  });

  it("does not lock a course whose only prerequisite is archived/draft (not live)", async () => {
    const db = getDb(env);
    const a = await mkCourse("A");
    const b = await mkCourse("B");
    await setCoursePrerequisites(db, b.course.id, [a.course.id], actor);
    // archive the prerequisite -> it is no longer a live gate
    await db.update(courses).set({ status: "archived" }).where(eq(courses.id, a.course.id));
    const gate = await coursePrereqGate(db, { userId: studentId, roleRank: 1 }, b.course.id);
    expect(gate.locked).toBe(false);
    expect(gate.missing).toEqual([]);
  });
});
