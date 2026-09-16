/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { addBlock, createPage, publishPage, updateBlockProps } from "~server/cms/service.server";
import {
  createAcademicYear,
  createCourse,
  createGrade,
  createProgram,
  createSubject,
  createTerm,
} from "~server/content/service.server";
import { loader as homeLoader } from "~/routes/public/home";

/**
 * Homepage discovery lists REAL published study subjects (studyHub).
 * Empty-first: with no published term containers the list is [] and HomeDiscover
 * renders nothing. Draft rows never appear.
 */

const actor = { userId: "00000000-0000-4000-8000-0000000000a1", role: "super_admin" };
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

type DiscoverItem = { slug: string; titleAr: string; gradeTitleAr: string };

async function wipe() {
  const db = getDb(env);
  for (const table of [
    "form_submissions", "form_fields", "forms", "menu_items", "menus",
    "page_versions", "blocks", "pages", "page_templates", "role_permissions",
    "units", "courses", "subjects", "grades", "programs", "terms", "academic_years",
    "files", "audit_logs",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
}
beforeEach(wipe);

async function publishHome() {
  const db = getDb(env);
  const page = await createPage(db, { titleAr: "الرئيسية", titleEn: "Home", slug: "home" }, actor);
  const section = await addBlock(db, { pageId: page.id, parentId: null, type: "section" }, actor);
  const text = await addBlock(db, { pageId: page.id, parentId: section.id, type: "text" }, actor);
  await updateBlockProps(db, text.id, { content: { ar: "مرحبا", en: "Hello" }, size: "lead", align: "start" }, actor);
  await publishPage(db, page.id, actor, "first");
}

async function seedPublishedStudySubject() {
  const db = getDb(env);
  const program = await createProgram(
    db,
    { titleAr: "الثانوية العامة", titleEn: "Secondary", status: "published", sortOrder: 0, descriptionAr: "", descriptionEn: "" },
    actor
  );
  const grade = await createGrade(
    db,
    { programId: program.id, titleAr: "الصف الثالث الثانوي", titleEn: "Grade 3", status: "published", sortOrder: 0 },
    actor
  );
  const subject = await createSubject(
    db,
    {
      gradeId: grade.id, titleAr: "الفلسفة", titleEn: "Philosophy", status: "published", sortOrder: 0,
      descriptionAr: "", descriptionEn: "", thumbnailFileId: null,
    },
    actor
  );
  const year = await createAcademicYear(
    db,
    { titleAr: "2026/2027", titleEn: "2026/2027", startYear: 2026, endYear: 2027, isCurrent: true, status: "published", sortOrder: 0 },
    actor
  );
  const term = await createTerm(db, { titleAr: "الترم الأول", titleEn: "Term 1", status: "published", sortOrder: 0 }, actor);
  await createCourse(
    db,
    {
      subjectId: subject.id, academicYearId: year.id, termId: term.id,
      titleAr: "الترم الأول", titleEn: "Term 1", status: "published", visibility: "catalog",
      accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null,
      thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
    },
    actor
  );
  return { grade, subject };
}

describe("homepage discovery lists real published subjects", () => {
  it("published home with a live term container: discover includes the subject", async () => {
    await publishHome();
    const { subject } = await seedPublishedStudySubject();
    const data = (await (homeLoader as (a: unknown) => unknown)({
      context: routeCtx,
      request: new Request("https://app.test/", { method: "GET", headers: { "user-agent": UA } }),
    })) as { discover: DiscoverItem[] };
    expect(data.discover.map((s) => s.slug)).toContain(subject.slug);
    expect(data.discover.find((s) => s.slug === subject.slug)?.titleAr).toBe("الفلسفة");
  });

  it("no published term containers: discover is an empty list (clean shell)", async () => {
    await publishHome();
    const data = (await (homeLoader as (a: unknown) => unknown)({
      context: routeCtx,
      request: new Request("https://app.test/", { method: "GET", headers: { "user-agent": UA } }),
    })) as { discover: unknown };
    expect(data.discover).toEqual([]);
  });

  it("draft subjects never appear in discovery", async () => {
    const db = getDb(env);
    await publishHome();
    const program = await createProgram(
      db,
      { titleAr: "ب", titleEn: "P", status: "published", sortOrder: 0, descriptionAr: "", descriptionEn: "" },
      actor
    );
    await createGrade(
      db,
      { programId: program.id, titleAr: "مسودة", titleEn: "Draft", status: "draft", sortOrder: 0 },
      actor
    );
    const data = (await (homeLoader as (a: unknown) => unknown)({
      context: routeCtx,
      request: new Request("https://app.test/", { method: "GET", headers: { "user-agent": UA } }),
    })) as { discover: unknown };
    expect(data.discover).toEqual([]);
  });

  it("unpublished (draft) home page: empty shell, no discovery cards", async () => {
    const db = getDb(env);
    await createPage(db, { titleAr: "ر", titleEn: "H", slug: "home" }, actor);
    await seedPublishedStudySubject();
    const data = (await (homeLoader as (a: unknown) => unknown)({
      context: routeCtx,
      request: new Request("https://app.test/", { method: "GET", headers: { "user-agent": UA } }),
    })) as { empty: boolean; discover: unknown };
    expect(data.empty).toBe(true);
    expect(data.discover).toEqual([]);
  });
});
