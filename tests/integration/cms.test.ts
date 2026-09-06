/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { getSettings, updateSettingsGroup } from "~server/settings/service.server";
import {
  addBlock,
  addFormField,
  addMenuItem,
  blocksForPage,
  CmsValidationError,
  createForm,
  createPage,
  getPageBySlug,
  publishPage,
  restoreVersion,
  listVersions,
  submitForm,
  toggleBlockVisible,
  updateBlockProps,
} from "~server/cms/service.server";
import { renderSnapshot, resolvePublicImageUrls } from "~server/cms/render.server";
import { sanitizeRichText } from "~server/cms/sanitize.server";
import { createCourse, createGrade, createProgram, createSubject, createUnit } from "~server/content/service.server";
import { auditLogs, files as filesTable } from "~server/db/schema";
import type { PageSnapshot } from "~/cms/registry";
import { eq } from "drizzle-orm";

const actor = { userId: "00000000-0000-4000-8000-0000000000a1", role: "super_admin" };

async function wipe() {
  const db = getDb(env);
  for (const table of [
    "form_submissions", "form_fields", "forms", "menu_items", "menus",
    "page_versions", "blocks", "pages", "role_permissions",
    "units", "courses", "subjects", "grades", "programs", "files", "audit_logs",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

beforeEach(wipe);

describe("rich-text sanitizer (no arbitrary HTML/script execution)", () => {
  it("strips scripts, event handlers, unsafe hrefs; keeps allowlisted markup", async () => {
    const out = await sanitizeRichText(
      `<p onclick="steal()">hello</p><script>alert(1)</script>` +
      `<a href="javascript:alert(1)">bad</a><a href="https://ok.example" target="_blank">ok</a>` +
      `<div>unwrapped text</div><img src="x" onerror="y">`
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)"); // script content discarded wholesale
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("<p>hello</p>");
    expect(out).toContain("unwrapped text");
    expect(out).not.toContain("<div");
    expect(out).not.toContain("<img");
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('href="https://ok.example"');
  });

  it("empty input sanitizes to empty string", async () => {
    expect(await sanitizeRichText("   ")).toBe("");
  });
});

describe("page lifecycle: draft → publish → restore (public only ever sees snapshots)", () => {
  it("publish freezes a validated, sanitized snapshot and audits it", async () => {
    const db = getDb(env);
    const page = await createPage(db, { titleAr: "عن", titleEn: "About" }, actor);
    const section = await addBlock(db, { pageId: page.id, parentId: null, type: "section" }, actor);
    const text = await addBlock(db, { pageId: page.id, parentId: section.id, type: "rich_text" }, actor);
    await updateBlockProps(db, text.id, { html: { ar: "<p>مرحبا<script>x()</script></p>", en: "Hi" } }, actor);

    // draft state: no snapshot yet
    let row = await getPageBySlug(db, page.slug);
    expect(row?.publishedSnapshot).toBeNull();

    await publishPage(db, page.id, actor, "first");
    row = await getPageBySlug(db, page.slug);
    const snap = row?.publishedSnapshot as unknown as { sections: Array<{ children: Array<{ props: { html: { ar: string } } }> }> };
    expect(snap.sections).toHaveLength(1);
    const html = snap.sections[0].children[0].props.html.ar;
    expect(html).toContain("مرحبا");
    expect(html).not.toContain("<script"); // sanitized at publish

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "cms.page.published"));
    expect(audits.length).toBe(1);

    // version history + restore into draft (non-destructive; blocks are recreated with fresh ids)
    const versions = await listVersions(db, page.id);
    expect(versions).toHaveLength(1);
    await toggleBlockVisible(db, text.id, actor); // draft now hidden
    await restoreVersion(db, page.id, versions[0].id, actor);
    const tree = await blocksForPage(db, page.id);
    const restoredChild = tree[0]?.children.find((c) => c.type === "rich_text");
    expect(restoredChild?.visible).toBe(true); // restore brought the published (visible) state back
    expect((restoredChild?.props as { html: { ar: string } }).html.ar).not.toContain("<script");
    const versionsAfter = await listVersions(db, page.id);
    expect(versionsAfter).toHaveLength(2); // auto-saved draft snapshot + original version
  });

  it("rejects publishing blocks that violate the schema (unsafe link)", async () => {
    const db = getDb(env);
    const page = await createPage(db, { titleAr: "س", titleEn: "Bad Page" }, actor);
    const section = await addBlock(db, { pageId: page.id, parentId: null, type: "section" }, actor);
    const btns = await addBlock(db, { pageId: page.id, parentId: section.id, type: "buttons" }, actor);
    // force invalid props straight into the draft row (simulates legacy/corrupted data)
    await db.run(`UPDATE blocks SET props = '{"items":[{"label":{"ar":"","en":"x"},"href":"javascript:alert(1)","target":"_self","variant":"primary","icon":""}],"align":"start","stackMobile":false}' WHERE id = '${btns.id}'`);
    await expect(publishPage(db, page.id, actor)).rejects.toBeInstanceOf(CmsValidationError);
  });
});

describe("render resolvers: content × presentation → view models (empty-first)", () => {
  it("resolves course cards merged with presentation settings; private/missing images omitted", async () => {
    const db = getDb(env);
    const program = await createProgram(db, { titleAr: "ب", titleEn: "Render Program", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Render Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Render Subject", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Render Course", status: "published", visibility: "featured", accessLevel: "public", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);

    const page = await createPage(db, { titleAr: "ر", titleEn: "Render Page" }, actor);
    const section = await addBlock(db, { pageId: page.id, parentId: null, type: "section" }, actor);
    const cards = await addBlock(db, { pageId: page.id, parentId: section.id, type: "course_cards" }, actor);
    await updateBlockProps(db, cards.id, { heading: { ar: "", en: "" }, subheading: { ar: "", en: "" }, source: "featured", manualIds: [], limit: 6, ctaLabelOverride: { ar: "", en: "" } }, actor);
    await publishPage(db, page.id, actor);

    const settings = await getSettings(db);
    const row = await getPageBySlug(db, page.slug);
    const rendered = await renderSnapshot(db, row!.publishedSnapshot as unknown as PageSnapshot, { settings, locale: "en" });
    const rows = rendered.ctx.dynamic[cards.id];
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toBe("/courses/render-course");
    expect(rows[0].badge).toEqual({ ar: "مجاني", en: "Free" });
    expect(rows[0].cta?.en).toBe(settings.presentation.courseCard.ctaLabelEn);
    expect(rows[0].meta?.en).toContain("0 lessons");
    expect(rendered.ctx.images).toEqual({}); // no images anywhere → empty map (no placeholders)

    // presentation toggle changes the view model, not the content
    await updateSettingsGroup(db, "presentation", { courseCard: { ...settings.presentation.courseCard, showLessonCount: false, showBadge: false } }, actor);
    const settings2 = await getSettings(db);
    const rendered2 = await renderSnapshot(db, row!.publishedSnapshot as unknown as PageSnapshot, { settings: settings2, locale: "en" });
    expect(rendered2.ctx.dynamic[cards.id][0].badge).toBeNull();
    expect(rendered2.ctx.dynamic[cards.id][0].meta?.en ?? "").not.toContain("lessons");
  });

  it("image resolution exposes PUBLIC files only", async () => {
    const db = getDb(env);
    const now = Date.now();
    const pub = crypto.randomUUID();
    const priv = crypto.randomUUID();
    for (const [id, visibility] of [[pub, "public"], [priv, "private"]] as const) {
      await db.insert(filesTable).values({
        id, r2Key: `k/${id}`, bucket: visibility === "public" ? "PUBLIC_ASSETS" : "PRIVATE_FILES",
        kind: "image", originalFilename: "x.png", mime: "image/png", byteSize: 1,
        checksumSha256: "0", visibility, downloadAllowed: false, createdBy: null, createdAt: now,
      });
    }
    const urls = await resolvePublicImageUrls(db, [pub, priv, "00000000-0000-4000-8000-deadbeef0000"]);
    expect(urls[pub]).toBe(`/files/${pub}`);
    expect(urls[priv]).toBeUndefined();
    expect(urls["00000000-0000-4000-8000-deadbeef0000"]).toBeUndefined();
  });
});

describe("configurable forms: declarative validation, consent, storage", () => {
  it("validates per field config, enforces consent, stores submissions", async () => {
    const db = getDb(env);
    const form = await createForm(db, { titleAr: "تواصل", titleEn: "Contact", actionType: "contact" }, actor);
    await addFormField(db, form.id, { name: "email", type: "email", labelAr: "بريد", labelEn: "Email", required: true }, actor);

    const bad = await submitForm(db, form.slug, { email: "nope" }, {});
    expect(bad.ok).toBe(false);

    const good = await submitForm(db, form.slug, { email: "a@b.co" }, {});
    expect(good.ok).toBe(true);

    // consent required → enforced server-side
    await db.run(`UPDATE forms SET consent_required = 1 WHERE id = '${form.id}'`);
    const noConsent = await submitForm(db, form.slug, { email: "a@b.co" }, {});
    expect(noConsent.ok).toBe(false);
    const withConsent = await submitForm(db, form.slug, { email: "a@b.co", __consent: "on" }, {});
    expect(withConsent.ok).toBe(true);

    // disabled form is not submittable
    await db.run(`UPDATE forms SET status = 'disabled' WHERE id = '${form.id}'`);
    const disabled = await submitForm(db, form.slug, { email: "a@b.co", __consent: "on" }, {});
    expect(disabled.ok).toBe(false);
  });

  it("field names are constrained; unknown option values rejected", async () => {
    const db = getDb(env);
    const form = await createForm(db, { titleAr: "ن", titleEn: "Survey" }, actor);
    await expect(addFormField(db, form.id, { name: "Bad Name!", type: "text", labelAr: "س", labelEn: "Q" }, actor)).rejects.toBeInstanceOf(CmsValidationError);
    await addFormField(db, form.id, { name: "choice", type: "select", labelAr: "اختر", labelEn: "Pick", options: [{ value: "a", labelAr: "أ", labelEn: "A" }] }, actor);
    const smuggled = await submitForm(db, form.slug, { choice: "not-an-option" }, {});
    expect(smuggled.ok).toBe(false);
  });
});

describe("resolveForms batches multiple form blocks (W9 regression)", () => {
  it("resolves all forms on a page with correct field grouping and ordering", async () => {
    const db = getDb(env);

    // Two forms with distinct fields and a deliberately different sort order.
    const formA = await createForm(db, { titleAr: "أ", titleEn: "Form A" }, actor);
    await addFormField(db, formA.id, { name: "email", type: "email", labelAr: "بريد", labelEn: "Email", required: true }, actor);
    await addFormField(db, formA.id, { name: "name", type: "text", labelAr: "اسم", labelEn: "Name" }, actor);

    const formB = await createForm(db, { titleAr: "ب", titleEn: "Form B" }, actor);
    await addFormField(db, formB.id, { name: "phone", type: "text", labelAr: "هاتف", labelEn: "Phone" }, actor);

    // One page with two form blocks referencing the two different forms.
    const page = await createPage(db, { titleAr: "ن", titleEn: "Forms Page" }, actor);
    const section = await addBlock(db, { pageId: page.id, parentId: null, type: "section" }, actor);
    const blockA = await addBlock(db, { pageId: page.id, parentId: section.id, type: "form_block" }, actor);
    const blockB = await addBlock(db, { pageId: page.id, parentId: section.id, type: "form_block" }, actor);
    await updateBlockProps(db, blockA.id, { formId: formA.id, heading: { ar: "", en: "" } }, actor);
    await updateBlockProps(db, blockB.id, { formId: formB.id, heading: { ar: "", en: "" } }, actor);
    await publishPage(db, page.id, actor);

    const settings = await getSettings(db);
    const row = await getPageBySlug(db, page.slug);
    const rendered = await renderSnapshot(db, row!.publishedSnapshot as unknown as PageSnapshot, { settings, locale: "en" });

    // Both forms resolved (by id and by slug alias), each with its own fields.
    const a = rendered.ctx.forms[formA.id];
    const b = rendered.ctx.forms[formB.id];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.title.en).toBe("Form A");
    expect(b.title.en).toBe("Form B");
    expect(rendered.ctx.forms[formA.slug]).toBe(a);
    expect(rendered.ctx.forms[formB.slug]).toBe(b);

    // Field grouping is per-form (no cross-contamination) and order is preserved.
    expect(a.fields.map((f) => f.name)).toEqual(["email", "name"]);
    expect(b.fields.map((f) => f.name)).toEqual(["phone"]);
    expect(a.fields[0].required).toBe(true);
    expect(b.fields[0].required).toBe(false);
  });
});

describe("navigation builder rejects authorization-bypassing / unsafe links", () => {
  it("javascript: and data: hrefs are refused", async () => {
    const db = getDb(env);
    await expect(addMenuItem(db, "header", { labelAr: "خ", labelEn: "Bad", href: "javascript:alert(1)" }, actor)).rejects.toBeInstanceOf(CmsValidationError);
    await expect(addMenuItem(db, "header", { labelAr: "خ", labelEn: "Bad", href: "data:text/html,<script>" }, actor)).rejects.toBeInstanceOf(CmsValidationError);
    const ok = await addMenuItem(db, "header", { labelAr: "الصفحات", labelEn: "Pages", href: "/p/about" }, actor);
    expect(ok).toBeTruthy();
  });
});
