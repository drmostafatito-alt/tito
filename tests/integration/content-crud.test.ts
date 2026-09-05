/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import {
  adminTree,
  archiveNode,
  catalogCourses,
  courseBySlug,
  ContentReferenceError,
  createCourse,
  createGrade,
  createLesson,
  createLessonItem,
  createProgram,
  createSubject,
  createUnit,
  itemsForLesson,
  lessonsForUnit,
  moveNode,
  unitsForCourse,
  updateNode,
} from "~server/content/service.server";
import { auditLogs, files as filesTable } from "~server/db/schema";
import { registerMockVideo } from "~server/video/service.server";
import { insertFile } from "~server/files/storage.server";
import { eq } from "drizzle-orm";

const actor = { userId: "00000000-0000-4000-8000-000000000001", role: "super_admin" };

async function wipe() {
  const db = getDb(env);
  for (const table of ["lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs", "videos", "files", "audit_logs"]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

beforeEach(wipe);

describe("content CRUD", () => {
  it("creates the full hierarchy with auto slugs and audits each insert", async () => {
    const db = getDb(env);
    const program = await createProgram(db, { titleAr: "برنامج", titleEn: "Crud Program", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    expect(program.slug).toBe("crud-program");
    const grade = await createGrade(db, { programId: program.id, titleAr: "صف", titleEn: "Crud Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "مادة", titleEn: "Crud Subject", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    const course = await createCourse(db, { subjectId: subject.id, titleAr: "دورة", titleEn: "Crud Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
    const unit = await createUnit(db, { courseId: course.id, titleAr: "وحدة", titleEn: "Crud Unit", status: "published", sortOrder: 0 }, actor);
    const lesson = await createLesson(db, { unitId: unit.id, titleAr: "درس", titleEn: "Crud Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);

    expect(program.slug).toMatch(/^crud-program/);
    expect(grade.slug).toMatch(/^crud-grade/);
    expect(lesson.slug).toBe("crud-lesson");

    const tree = await adminTree(db);
    const walk = (n: (typeof tree)[number]): string[] => [`${n.type}:${n.titleEn}`, ...n.children.flatMap(walk)];
    expect(walk(tree[0])).toEqual([
      "program:Crud Program",
      "grade:Crud Grade",
      "subject:Crud Subject",
      "course:Crud Course",
      "unit:Crud Unit",
      "lesson:Crud Lesson",
    ]);

    const audit = await db.select({ action: auditLogs.action }).from(auditLogs);
    expect(audit.filter((a) => a.action.startsWith("content.")).length).toBeGreaterThanOrEqual(6);
  });

  it("deduplicates slugs with -2 suffixes", async () => {
    const db = getDb(env);
    const a = await createProgram(db, { titleAr: "أ", titleEn: "Dup Name", status: "draft", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const b = await createProgram(db, { titleAr: "ب", titleEn: "Dup Name", status: "draft", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    expect(a.slug).toBe("dup-name");
    expect(b.slug).toBe("dup-name-2");
  });

  it("updates whitelisted fields and ignores rogue keys", async () => {
    const db = getDb(env);
    const p = await createProgram(db, { titleAr: "أ", titleEn: "Patchable", status: "draft", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const res = await updateNode(db, "program", p.id, { titleAr: "جديد", status: "published", hax: "DROP TABLE" }, actor);
    expect(res.ok).toBe(true);
    const row = await courseBySlug(db, "patchable"); // wrong table → null, just probing db alive
    expect(row).toBeNull();
    const tree = await adminTree(db);
    expect(tree[0].titleAr).toBe("جديد");
    expect(tree[0].status).toBe("published");
  });

  it("archives a course and drops it from the catalog", async () => {
    const db = getDb(env);
    const program = await createProgram(db, { titleAr: "ب", titleEn: "Arch Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Arch Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Arch Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Arch Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);

    expect((await catalogCourses(db)).length).toBe(1);
    expect(await archiveNode(db, "course", course.id, actor)).toBe(true);
    expect((await catalogCourses(db)).length).toBe(0);
  });

  it("hidden + scheduled courses stay out of the catalog", async () => {
    const db = getDb(env);
    const program = await createProgram(db, { titleAr: "ب", titleEn: "Vis Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Vis Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Vis Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    await createCourse(db, { subjectId: subject.id, titleAr: "خ", titleEn: "Hidden Course", status: "published", visibility: "hidden", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
    await createCourse(db, { subjectId: subject.id, titleAr: "م", titleEn: "Future Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 1, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: Date.now() + 3_600_000, expiresAt: null }, actor);
    await createCourse(db, { subjectId: subject.id, titleAr: "ن", titleEn: "Expired Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 2, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: Date.now() - 1_000 }, actor);

    const catalog = await catalogCourses(db);
    expect(catalog.length).toBe(0);
  });
});

describe("ordering", () => {
  it("renumbers siblings and swaps on move; boundary moves report no_neighbor", async () => {
    const db = getDb(env);
    const program = await createProgram(db, { titleAr: "ب", titleEn: "Order Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Order Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Order Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Order Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
    const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "Order Unit", status: "published", sortOrder: 0 }, actor);
    const l1 = await createLesson(db, { unitId: unit.id, titleAr: "١", titleEn: "L one", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 5, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
    const l2 = await createLesson(db, { unitId: unit.id, titleAr: "٢", titleEn: "L two", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 2, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
    const l3 = await createLesson(db, { unitId: unit.id, titleAr: "٣", titleEn: "L three", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 9, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);

    // initial order: two(2), one(5), three(9)
    let lessons = await lessonsForUnit(db, unit.id);
    expect(lessons.map((l) => l.titleEn)).toEqual(["L two", "L one", "L three"]);

    // move three up → two, three, one
    expect((await moveNode(db, "lesson", l3.id, "up")).ok).toBe(true);
    lessons = await lessonsForUnit(db, unit.id);
    expect(lessons.map((l) => l.titleEn)).toEqual(["L two", "L three", "L one"]);
    // renumbered 0..2 despite original 2/5/9
    expect(lessons.map((l) => l.sortOrder)).toEqual([0, 1, 2]);

    // boundary: one is last — moving down fails cleanly
    expect(await moveNode(db, "lesson", l1.id, "down")).toEqual({ ok: false, error: "no_neighbor" });
    // first lesson up fails
    expect(await moveNode(db, "lesson", l2.id, "up")).toEqual({ ok: false, error: "no_neighbor" });

    // unknown id
    expect(await moveNode(db, "lesson", "nope", "up")).toEqual({ ok: false, error: "not_found" });
  });

  it("lesson items: video item requires videoId; ordering preserved", async () => {
    const db = getDb(env);
    const program = await createProgram(db, { titleAr: "ب", titleEn: "Item Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Item Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Item Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Item Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
    const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "Item Unit", status: "published", sortOrder: 0 }, actor);
    const lesson = await createLesson(db, { unitId: unit.id, titleAr: "د", titleEn: "Item Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);

    await expect(
      createLessonItem(db, { lessonId: lesson.id, itemType: "video", videoId: null, fileId: null, examId: null, sortOrder: 0, required: true }, actor)
    ).rejects.toThrow(/videoId/);

    // real video + file rows — items must reference persisted assets
    const video = await registerMockVideo(db, { title: "Item video" });
    const fileId = await insertFile(db, {
      r2Key: `private/pdf/${crypto.randomUUID()}/item-doc.pdf`,
      bucket: "PRIVATE_FILES",
      kind: "pdf",
      originalFilename: "item-doc.pdf",
      mime: "application/pdf",
      byteSize: 10,
      checksumSha256: "test",
      visibility: "private",
    });

    // regression guard (file-ID mismatch bug class): a reference that does not
    // match a persisted row is rejected at write time — never stored dangling
    await expect(
      createLessonItem(db, { lessonId: lesson.id, itemType: "video", videoId: "not-a-real-video", fileId: null, examId: null, sortOrder: 0, required: true }, actor)
    ).rejects.toBeInstanceOf(ContentReferenceError);
    await expect(
      createLessonItem(db, { lessonId: lesson.id, itemType: "file", videoId: null, fileId: "not-a-real-file", examId: null, sortOrder: 0, required: true }, actor)
    ).rejects.toBeInstanceOf(ContentReferenceError);
    // dangling parent references are rejected too
    await expect(
      createGrade(db, { programId: "not-a-real-program", titleAr: "ص", titleEn: "Orphan Grade", status: "draft", sortOrder: 0 }, actor)
    ).rejects.toBeInstanceOf(ContentReferenceError);

    await createLessonItem(db, { lessonId: lesson.id, itemType: "video", videoId: video.id, fileId: null, examId: null, sortOrder: 0, required: true }, actor);
    await createLessonItem(db, { lessonId: lesson.id, itemType: "file", videoId: null, fileId, examId: null, sortOrder: 1, required: false }, actor);
    const items = await itemsForLesson(db, lesson.id);
    expect(items.map((i) => i.itemType)).toEqual(["video", "file"]);
    expect(items[1].required).toBe(false);
    // the stored references ARE the persisted rows (exact IDs, both directions)
    expect(items[0].videoId).toBe(video.id);
    expect(items[1].fileId).toBe(fileId);
    const fileRow = (await db.select().from(filesTable).where(eq(filesTable.id, fileId)))[0];
    expect(fileRow?.id).toBe(fileId);

    const us = await unitsForCourse(db, course.id);
    expect(us.length).toBe(1);
  });
});
