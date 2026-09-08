/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import {
  allLessonsForCourse,
  createCourse,
  createGrade,
  createLesson,
  createLessonItem,
  createProgram,
  createSubject,
  createUnit,
  duplicateNode,
  itemsForLesson,
  unitsForCourse,
} from "~server/content/service.server";
import { courses, entitlements, lessonProgress, auditLogs } from "~server/db/schema";
import { registerMockVideo } from "~server/video/service.server";
import { insertFile } from "~server/files/storage.server";
import { and, eq, inArray } from "drizzle-orm";

const actor = { userId: "00000000-0000-4000-8000-000000000001", role: "super_admin" };
const studentId = "00000000-0000-4000-8000-000000000002";

async function wipe() {
  const db = getDb(env);
  for (const table of ["entitlements", "lesson_progress", "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs", "videos", "files", "audit_logs"]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

beforeEach(wipe);

describe("deep clone (duplicate course subtree)", () => {
  it("creates an independent draft copy sharing media refs and copying no progress/entitlements/audit", async () => {
    const db = getDb(env);
    const program = await createProgram(db, { titleAr: "برنامج", titleEn: "Clone Program", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "صف", titleEn: "Clone Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "مادة", titleEn: "Clone Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    const future = Date.now() + 86_400_000;
    const srcCourse = await createCourse(db, { subjectId: subject.id, titleAr: "دورة", titleEn: "Clone Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: future, expiresAt: null }, actor);
    const srcUnit1 = await createUnit(db, { courseId: srcCourse.id, titleAr: "وحدة", titleEn: "Unit One", status: "published", sortOrder: 0 }, actor);
    const srcUnit2 = await createUnit(db, { courseId: srcCourse.id, titleAr: "و", titleEn: "Unit Two", status: "published", sortOrder: 1 }, actor);
    const srcLesson = await createLesson(db, { unitId: srcUnit1.id, titleAr: "درس", titleEn: "Lesson A", status: "published", accessLevel: "entitled", freePreview: true, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: future }, actor);
    await createLesson(db, { unitId: srcUnit2.id, titleAr: "د", titleEn: "Lesson B", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);

    const video = await registerMockVideo(db, { title: "Clone video" });
    const fileId = await insertFile(db, { r2Key: `private/pdf/${crypto.randomUUID()}/clone-doc.pdf`, bucket: "PRIVATE_FILES", kind: "pdf", originalFilename: "clone-doc.pdf", mime: "application/pdf", byteSize: 10, checksumSha256: "test", visibility: "private" });
    await createLessonItem(db, { lessonId: srcLesson.id, itemType: "video", videoId: video.id, fileId: null, examId: null, sortOrder: 0, required: true }, actor);
    await createLessonItem(db, { lessonId: srcLesson.id, itemType: "file", videoId: null, fileId, examId: null, sortOrder: 1, required: true }, actor);

    // Source-side learner footprint that a clone MUST NOT copy.
    const now = Date.now();
    await db.insert(lessonProgress).values({ id: crypto.randomUUID(), studentId, lessonId: srcLesson.id, status: "completed", completedAt: now, lastActivityAt: now, createdAt: now, updatedAt: now });
    await db.insert(entitlements).values({ id: crypto.randomUUID(), studentId, sourceType: "admin_grant", sourceId: null, resourceType: "course", resourceId: srcCourse.id, status: "active", startsAt: now, expiresAt: null, grantedAt: now, grantedBy: actor.userId, revokedAt: null, revokeReason: null, metadata: null });

    const srcLessons = await allLessonsForCourse(db, srcCourse.id);
    expect(srcLessons.length).toBe(2);

    const dup = await duplicateNode(db, "course", srcCourse.id, actor);
    if (!dup.ok) throw new Error("duplicate failed");
    const newCourseId = dup.id;
    expect(newCourseId).not.toBe(srcCourse.id);

    // Independent top-level row, forced to draft + scheduling cleared.
    const newCourse = (await db.select().from(courses).where(eq(courses.id, newCourseId)))[0];
    expect(newCourse.id).not.toBe(srcCourse.id);
    expect(newCourse.status).toBe("draft");
    expect(newCourse.publishAt).toBeNull();
    expect(newCourse.expiresAt).toBeNull();
    expect(newCourse.slug).not.toBe(srcCourse.slug);

    // Original is unmodified: still published, scheduled, lesson intact.
    const srcAfter = (await db.select().from(courses).where(eq(courses.id, srcCourse.id)))[0];
    expect(srcAfter.status).toBe("published");
    expect(srcAfter.publishAt).toBe(future);

    // Distinct subtree ids/slugs at every level.
    const srcUnits = await unitsForCourse(db, srcCourse.id);
    const newUnits = await unitsForCourse(db, newCourseId);
    expect(newUnits.length).toBe(srcUnits.length);
    const srcUnitIds = new Set(srcUnits.map((u) => u.id));
    expect(newUnits.every((u) => !srcUnitIds.has(u.id))).toBe(true);

    const newLessons = await allLessonsForCourse(db, newCourseId);
    expect(newLessons.length).toBe(2);
    const srcLessonIds = new Set(srcLessons.map((l) => l.id));
    expect(newLessons.every((l) => !srcLessonIds.has(l.id))).toBe(true);
    // slugs are unique per table (would throw if collided) and copy resets freePreview to false.
    expect(newLessons.every((l) => l.freePreview === false)).toBe(true);
    const srcSlugs = new Set(srcLessons.map((l) => l.slug));
    expect(newLessons.some((l) => srcSlugs.has(l.slug))).toBe(false);

    // Media refs are SHARED (same asset ids), not duplicated binaries/rows.
    const srcItems = (await Promise.all(srcLessons.map((l) => itemsForLesson(db, l.id)))).flat();
    const newItems = (await Promise.all(newLessons.map((l) => itemsForLesson(db, l.id)))).flat();
    expect(newItems.length).toBe(srcItems.length);
    expect(newItems.every((i) => !srcItems.some((s) => s.id === i.id))).toBe(true); // item rows independent
    const srcAssets = srcItems.map((i) => `${i.itemType}:${i.videoId ?? i.fileId ?? i.examId}`).sort();
    const newAssets = newItems.map((i) => `${i.itemType}:${i.videoId ?? i.fileId ?? i.examId}`).sort();
    expect(newAssets).toEqual(srcAssets); // shared assets

    // No learner footprint copied onto the clone.
    const newLessonIds = newLessons.map((l) => l.id);
    const copiedProgress = await db.select({ id: lessonProgress.id }).from(lessonProgress).where(and(inArray(lessonProgress.lessonId, newLessonIds), eq(lessonProgress.studentId, studentId)));
    expect(copiedProgress.length).toBe(0);
    const copiedEntitlements = await db.select({ id: entitlements.id }).from(entitlements).where(eq(entitlements.resourceId, newCourseId));
    expect(copiedEntitlements.length).toBe(0);

    // Clone is created through the validated create* paths (audited, not raw copy).
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "content.course.created"), eq(auditLogs.entityId, newCourseId)));
    expect(audit.length).toBe(1);
    expect(newUnits.length).toBeGreaterThan(0);
  });

  it("returns not_found for a missing course", async () => {
    const db = getDb(env);
    const res = await duplicateNode(db, "course", "00000000-0000-4000-8000-00000000dead", actor);
    expect(res.ok).toBe(false);
  });
});
