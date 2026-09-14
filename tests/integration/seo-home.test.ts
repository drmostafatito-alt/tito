/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { addBlock, createPage, publishPage, updateBlockProps } from "~server/cms/service.server";
import { createGrade, createProgram, createSubject } from "~server/content/service.server";
import { loader as homeLoader } from "~/routes/public/home";

/**
 * Batch 5 regression — homepage discovery (Phase I semantics + Phase O
 * internal linking). The homepage lists the REAL published subjects and
 * grades as contextual internal links; with no published content the
 * discovery data is absent (empty-first platforms keep a clean shell).
 */

const actor = { userId: "00000000-0000-4000-8000-0000000000a1", role: "super_admin" };
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

async function wipe() {
  const db = getDb(env);
  for (const table of [
    "form_submissions", "form_fields", "forms", "menu_items", "menus",
    "page_versions", "blocks", "pages", "page_templates", "role_permissions",
    "units", "courses", "subjects", "grades", "programs", "files", "audit_logs",
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

async function seedContent() {
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
  return { grade, subject };
}

describe("homepage discovery lists real published subjects + grades", () => {
  it("published home with content: discover carries the published subject + grade slugs", async () => {
    await publishHome();
    const { grade, subject } = await seedContent();
    const data = (await (homeLoader as (a: unknown) => unknown)({
      context: routeCtx,
      request: new Request("https://app.test/", { method: "GET", headers: { "user-agent": UA } }),
    })) as { discover: { subjects: Array<{ slug: string; titleAr: string }>; grades: Array<{ slug: string; titleAr: string }> } | null };
    expect(data.discover).not.toBeNull();
    expect(data.discover!.subjects.map((s) => s.slug)).toContain(subject.slug);
    expect(data.discover!.grades.map((g) => g.slug)).toContain(grade.slug);
    // anchor text comes from the rows themselves (natural, not keyword-stuffed)
    expect(data.discover!.subjects.find((s) => s.slug === subject.slug)?.titleAr).toBe("الفلسفة");
  });

  it("no published subjects/grades: discover is null (clean shell, no dead links)", async () => {
    await publishHome();
    const data = (await (homeLoader as (a: unknown) => unknown)({
      context: routeCtx,
      request: new Request("https://app.test/", { method: "GET", headers: { "user-agent": UA } }),
    })) as { discover: unknown };
    expect(data.discover).toBeNull();
  });

  it("draft subjects/grades never appear in discovery", async () => {
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
    expect(data.discover).toBeNull();
  });

  it("unpublished (draft) home page: empty shell, no discovery", async () => {
    const db = getDb(env);
    await createPage(db, { titleAr: "ر", titleEn: "H", slug: "home" }, actor); // never published
    await seedContent();
    const data = (await (homeLoader as (a: unknown) => unknown)({
      context: routeCtx,
      request: new Request("https://app.test/", { method: "GET", headers: { "user-agent": UA } }),
    })) as { empty: boolean; discover: unknown };
    expect(data.empty).toBe(true);
    expect(data.discover).toBeNull();
  });
});
