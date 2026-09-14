/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { createCourse, createGrade, createLesson, createProgram, createSubject, createUnit, updateNode } from "~server/content/service.server";
import { loader as unitLoader, meta as unitMeta } from "~/routes/public.courses.$slug.units.$unitId";
import { meta as learnMeta } from "~/routes/learn.$courseSlug.$lessonSlug";
import { getSettings, updateSettingsGroup } from "~server/settings/service.server";
import { files as filesTable } from "~server/db/schema";
import { loader as courseLoader, meta as courseMeta } from "~/routes/public.courses.$slug";
import { loader as catalogLoader, meta as catalogMeta } from "~/routes/public.courses";
import { loader as subjectLoader, meta as subjectMeta } from "~/routes/public.subjects.$slug";
import { loader as programLoader, meta as programMeta } from "~/routes/public.programs.$slug";

/**
 * Owner-controllability regression (admin audit, Phase 2/3).
 *
 * Catalog & content routes have NO per-row SEO form by design: the owner edits
 * title / description / thumbnail in Admin → Content, and those columns are the
 * source of truth for the document title and the social share card. These tests
 * drive the REAL route loader + meta() pair against D1, so the guarantee is
 * behavioural rather than a source-code inspection:
 *
 *   admin edit (updateNode — the very call the Admin editor makes on save)
 *     → route loader → meta() → <title> / description / og:* / twitter:card
 */

const actor = { userId: "00000000-0000-4000-8000-0000000000a1", role: "super_admin" };
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

type Meta = Array<Record<string, unknown>>;

const call = (fn: unknown, req: Request, params: Record<string, string> = {}) =>
  (fn as (args: unknown) => unknown)({ context: routeCtx, request: req, params });

const get = (path: string) =>
  new Request(`https://app.test${path}`, { method: "GET", headers: { "user-agent": UA } });

/**
 * Mimics the ROOT loader's data — what meta() reads locale + platform identity
 * from. It reads live settings on every call, exactly as the real root loader
 * does, so an Appearance → System edit is observable here (the alternative — a
 * frozen fixture — would test the stub instead of the loop).
 */
const rootMatch = async (locale: "ar" | "en") => {
  const platform = (await getSettings(getDb(env))).platform;
  return {
    id: "root",
    data: {
      locale,
      platform: {
        nameAr: platform.nameAr,
        nameEn: platform.nameEn,
        taglineAr: platform.taglineAr,
        taglineEn: platform.taglineEn,
      },
    },
  };
};

/**
 * Invoke a route `meta()` the way React Router does. The generated MetaArgs type
 * describes the full UIMatch shape; a test only needs `{loaderData, matches}`, so
 * the call goes through `unknown` (same convention as `call` above).
 */
const metaOf = async (metaFn: unknown, loaderData: unknown, locale: "ar" | "en") =>
  (metaFn as (a: unknown) => Meta)({ loaderData, matches: [await rootMatch(locale)] });

const titleOf = (m: Meta) => (m.find((x) => typeof x.title === "string")?.title as string) ?? "";
const descOf = (m: Meta) => (m.find((x) => x.name === "description")?.content as string) ?? null;
const ogOf = (m: Meta, p: string) => (m.find((x) => x.property === p)?.content as string) ?? null;
const canonicalOf = (m: Meta) => (m.find((x) => x.rel === "canonical")?.href as string) ?? null;
const canonicalTagName = (m: Meta) => (m.find((x) => x.rel === "canonical")?.tagName as string) ?? null;
const twitterCardOf = (m: Meta) => (m.find((x) => x.name === "twitter:card")?.content as string) ?? null;

async function wipe() {
  const db = getDb(env);
  for (const table of ["units", "courses", "subjects", "grades", "programs", "files", "audit_logs"]) {
    await db.run(`DELETE FROM ${table}`);
  }
}
beforeEach(wipe);

async function seedCatalog(thumbnailFileId: string | null) {
  const db = getDb(env);
  const program = await createProgram(
    db,
    {
      titleAr: "الثانوية العامة", titleEn: "General Secondary", status: "published", sortOrder: 0,
      descriptionAr: "وصف البرنامج", descriptionEn: "Program description",
    },
    actor
  );
  const grade = await createGrade(
    db,
    { programId: program.id, titleAr: "الصف الثالث", titleEn: "Grade 3", status: "published", sortOrder: 0 },
    actor
  );
  const subject = await createSubject(
    db,
    {
      gradeId: grade.id, titleAr: "الفيزياء", titleEn: "Physics", status: "published", sortOrder: 0,
      descriptionAr: "وصف المادة", descriptionEn: "Subject description", thumbnailFileId: null,
    },
    actor
  );
  const course = await createCourse(
    db,
    {
      subjectId: subject.id, titleAr: "مراجعة شاملة", titleEn: "Full Revision", status: "published",
      visibility: "catalog", accessLevel: "public", sortOrder: 0,
      descriptionAr: "دورة شاملة تغطي المنهج بالكامل", descriptionEn: "A complete course covering the syllabus",
      thumbnailFileId, teacherId: null, publishAt: null, expiresAt: null,
    },
    actor
  );
  return { program, grade, subject, course };
}

async function seedPublicImage() {
  const db = getDb(env);
  const id = crypto.randomUUID();
  await db.insert(filesTable).values({
    id, r2Key: `k/${id}`, bucket: "PUBLIC_ASSETS", kind: "image", originalFilename: "cover.png",
    mime: "image/png", byteSize: 1, checksumSha256: "0", visibility: "public",
    downloadAllowed: false, createdBy: null, createdAt: Date.now(),
  });
  return id;
}

const courseData = (slug: string) => call(courseLoader, get(`/courses/${slug}`), { slug });

describe("course page SEO/social metadata comes from the admin-edited content row", () => {
  it("emits title + description + OG from the course (Arabic)", async () => {
    const { course } = await seedCatalog(null);
    const meta = await metaOf(courseMeta, await courseData(course.slug), "ar");

    expect(titleOf(meta)).toBe("مراجعة شاملة — د/ مصطفى تيتو");
    expect(descOf(meta)).toBe("دورة شاملة تغطي المنهج بالكامل");
    expect(ogOf(meta, "og:title")).toBe("مراجعة شاملة — د/ مصطفى تيتو");
    expect(ogOf(meta, "og:description")).toBe("دورة شاملة تغطي المنهج بالكامل");
    expect(canonicalOf(meta)).toBe(`https://app.test/courses/${course.slug}`);
    // must be a real <link rel="canonical">, not an inert <meta rel="canonical">
    expect(canonicalTagName(meta)).toBe("link");
  });

  it("is independently bilingual — the English render uses the English columns", async () => {
    const { course } = await seedCatalog(null);
    const meta = await metaOf(courseMeta, await courseData(course.slug), "en");

    expect(titleOf(meta)).toBe("Full Revision — Dr mostafa tito");
    expect(descOf(meta)).toBe("A complete course covering the syllabus");
    expect(titleOf(meta)).not.toContain("مراجعة");
  });

  it("an Admin → Content edit propagates to the share card with no code change", async () => {
    const db = getDb(env);
    const { course } = await seedCatalog(null);

    const before = await metaOf(courseMeta, await courseData(course.slug), "ar");
    expect(descOf(before)).toBe("دورة شاملة تغطي المنهج بالكامل");

    // the exact call the Admin → Content editor makes on save
    await updateNode(
      db, "course", course.id,
      { descriptionAr: "نسخة محدثة من الوصف", descriptionEn: "Updated description" },
      actor
    );

    const after = await metaOf(courseMeta, await courseData(course.slug), "ar");
    expect(descOf(after)).toBe("نسخة محدثة من الوصف");
    expect(ogOf(after, "og:description")).toBe("نسخة محدثة من الوصف");
  });

  it("attaches og:image + summary_large_image only when the thumbnail is a PUBLIC file", async () => {
    const thumb = await seedPublicImage();
    const { course } = await seedCatalog(thumb);
    const data = (await courseData(course.slug)) as { course: { thumbnail: string | null } };
    expect(data.course.thumbnail).toBe(`/files/${thumb}`);

    const meta = await metaOf(courseMeta, data, "ar");
    expect(ogOf(meta, "og:image")).toBe(`/files/${thumb}`);
    expect(twitterCardOf(meta)).toBe("summary_large_image");

    // no thumbnail → no og:image and a plain summary card (never a placeholder)
    const bare = await seedCatalog(null);
    const bareMeta = await metaOf(courseMeta, await courseData(bare.course.slug), "ar");
    expect(ogOf(bareMeta, "og:image")).toBeNull();
    expect(twitterCardOf(bareMeta)).toBe("summary");
  });
});

describe("catalog index SEO uses owner-editable settings, not hardcoded copy", () => {
  it("takes the description from the platform tagline (Appearance → System)", async () => {
    const db = getDb(env);
    await seedCatalog(null);

    const meta = await metaOf(catalogMeta, await call(catalogLoader, get("/courses")), "ar");
    expect(descOf(meta)).toBe("الفلسفة وعلم النفس");
    expect(titleOf(meta)).toContain("د/ مصطفى تيتو");

    await updateSettingsGroup(db, "platform", { taglineAr: "منصة الفلسفة", taglineEn: "Philosophy hub" }, actor);

    const after = await metaOf(catalogMeta, await call(catalogLoader, get("/courses")), "ar");
    expect(descOf(after)).toBe("منصة الفلسفة");

    const en = await metaOf(catalogMeta, await call(catalogLoader, get("/courses")), "en");
    expect(descOf(en)).toBe("Philosophy hub");
  });
});

describe("subject & program pages expose the same admin-driven metadata", () => {
  it("subject page meta comes from the subject row, with its grade in the title (grade+subject cluster)", async () => {
    const { subject } = await seedCatalog(null);
    const meta = await metaOf(subjectMeta, await call(subjectLoader, get(`/subjects/${subject.slug}`), { slug: subject.slug }), "ar");
    // Deterministic title system: `المادة — الصف — brand` (the grade row is real
    // content, never invented) — targets both the subject and grade+subject clusters.
    expect(titleOf(meta)).toBe("الفيزياء — الصف الثالث — د/ مصطفى تيتو");
    expect(descOf(meta)).toBe("وصف المادة");
  });

  it("subject page synthesizes a data-derived description when the owner wrote none", async () => {
    const db = getDb(env);
    const { subject } = await seedCatalog(null);
    await updateNode(db, "subject", subject.id, { descriptionAr: null, descriptionEn: null }, actor);
    const meta = await metaOf(subjectMeta, await call(subjectLoader, get(`/subjects/${subject.slug}`), { slug: subject.slug }), "ar");
    const d = descOf(meta);
    expect(d).toBeTruthy();
    expect(d).toContain("الفيزياء");
    expect(d).toContain("الصف الثالث");
    expect(d).toContain("د/ مصطفى تيتو");
    const enMeta = await metaOf(subjectMeta, await call(subjectLoader, get(`/subjects/${subject.slug}`), { slug: subject.slug }), "en");
    const de = descOf(enMeta);
    expect(de).toBeTruthy();
    expect(de).toContain("Physics");
    expect(de).not.toContain("الفيزياء");
  });

  it("program page meta comes from the program row", async () => {
    const { program } = await seedCatalog(null);
    const meta = await metaOf(programMeta, await call(programLoader, get(`/programs/${program.slug}`), { slug: program.slug }), "en");
    expect(titleOf(meta)).toBe("General Secondary — Dr mostafa tito");
    expect(descOf(meta)).toBe("Program description");
  });
});

// ---------------------------------------------------------------------------
// Indexability boundary + unit/lesson meta (SEO Master Phase)
// ---------------------------------------------------------------------------

const robotsOf = (m: Meta) => (findMeta(m, "robots")?.content as string) ?? null;
const findMeta = (m: Meta, name: string) => m.find((x) => (x as Record<string, unknown>).name === name) as { content?: string } | undefined;

describe("unit + lesson pages carry deterministic meta and the correct index directive", () => {
  it("unit page: indexable, title `unit — course — brand`, data-derived description", async () => {
    const db = getDb(env);
    const { course } = await seedCatalog(null);
    const unit = await createUnit(db, { courseId: course.id, titleAr: "الوحدة الأولى", titleEn: "Unit One", status: "published", sortOrder: 0 }, actor);
    const data = await call(unitLoader, get(`/courses/${course.slug}/units/${unit.id}`), { slug: course.slug, unitId: unit.id });
    const meta = await metaOf(unitMeta, data, "ar");
    expect(titleOf(meta)).toBe("الوحدة الأولى — مراجعة شاملة — د/ مصطفى تيتو");
    expect(robotsOf(meta)).toBe("index,follow");
    expect(canonicalOf(meta)).toBe(`https://app.test/courses/${course.slug}/units/${unit.id}`);
    expect(canonicalTagName(meta)).toBe("link");
    const d = descOf(meta);
    expect(d).toContain("الوحدة الأولى");
    expect(d).toContain("مراجعة شاملة");
  });

  it("lesson page: NOINDEX (gated + per-user) but unique branded title + canonical", async () => {
    const db = getDb(env);
    const { course } = await seedCatalog(null);
    const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "U", status: "published", sortOrder: 0 }, actor);
    const lesson = await createLesson(
      db,
      { unitId: unit.id, titleAr: "درس الشحنة", titleEn: "Charge lesson", descriptionAr: "شرح مبسط", descriptionEn: "A simple explainer", accessLevel: "entitled", freePreview: false, status: "published", sortOrder: 0 },
      actor,
    );
    // meta() contract: build the loaderData shape the loader returns (the loader
    // itself is access-gated; meta is a pure function of that data).
    const loaderData = {
      url: `https://app.test/learn/${course.slug}/${lesson.slug}`,
      course: { slug: course.slug, titleAr: "مراجعة شاملة", titleEn: "Full Revision" },
      lesson: { titleAr: lesson.titleAr, titleEn: lesson.titleEn, descriptionAr: lesson.descriptionAr, descriptionEn: lesson.descriptionEn },
    };
    const meta = await metaOf(learnMeta, loaderData, "ar");
    expect(robotsOf(meta)).toBe("noindex,follow");
    expect(titleOf(meta)).toBe("درس الشحنة — مراجعة شاملة — د/ مصطفى تيتو");
    expect(descOf(meta)).toBe("شرح مبسط");
    expect(canonicalOf(meta)).toBe(`https://app.test/learn/${course.slug}/${lesson.slug}`);
  });
});
