/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import {
  createCourse,
  createGrade,
  createLesson,
  createProgram,
  createSubject,
  createUnit,
} from "~server/content/service.server";
import { updateSettingsGroup } from "~server/settings/service.server";
import { loader as courseLoader, meta as courseMeta } from "~/routes/public.courses.$slug";
import { loader as catalogLoader, meta as catalogMeta } from "~/routes/public.courses";
import { loader as subjectLoader, meta as subjectMeta } from "~/routes/public.subjects.$slug";
import { loader as programLoader, meta as programMeta } from "~/routes/public.programs.$slug";
import { loader as unitLoader, meta as unitMeta } from "~/routes/public.courses.$slug.units.$unitId";
import { loader as publicLayoutLoader, meta as publicLayoutMeta } from "~/routes/public/layout";

/**
 * Structured-data (JSON-LD) regression — SEO Master Phase, batch 3.
 *
 * Drives the REAL route loader + meta() pair against D1, then parses the
 * `script:ld+json` descriptors the way <head> would. The contract under test:
 *
 *   - every public page declares the Organization + WebSite entities (layout);
 *   - Course / WebPage / BreadcrumbList / ItemList only ever contain data the
 *     page actually shows — absolute URLs, real lesson counts, no price,
 *     no aggregateRating, no SearchAction;
 *   - sameAs/logo only from owner-configured identity data (https-only).
 */

const actor = { userId: "00000000-0000-4000-8000-0000000000a1", role: "super_admin" };
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const BASE = "https://app.test";

type Meta = Array<Record<string, unknown>>;
type Ld = Record<string, unknown>;

const call = (fn: unknown, req: Request, params: Record<string, string> = {}) =>
  (fn as (args: unknown) => unknown)({ context: routeCtx, request: req, params });

const get = (path: string) => new Request(`${BASE}${path}`, { method: "GET", headers: { "user-agent": UA } });

/** Root match the way meta() receives it (live settings, as the real root loader emits). */
const rootMatch = (locale: "ar" | "en") => ({
  id: "root",
  data: {
    locale,
    platform: { nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito", taglineAr: "الفلسفة وعلم النفس", taglineEn: "Philosophy & Psychology" },
  },
});

/**
 * The public LAYOUT match in `matches`. Route metas read the site identity
 * (platform name / logo / social profiles) from the layout's loader data — so
 * the match must carry it. When the given loaderData IS the layout's own data
 * (the layout-meta tests) it is used verbatim; otherwise a minimal identity
 * with the default platform name stands in (child loaders don't fetch it).
 */
const publicMatch = (loaderData: unknown) => {
  const d = (loaderData ?? {}) as Record<string, unknown>;
  if (!d.url) return null;
  return {
    id: "public",
    data: {
      url: d.url as string,
      identity:
        d.identity ?? { platformName: { ar: "د/ مصطفى تيتو", en: "Dr mostafa tito" }, logoUrl: null },
      socialUrls: (d.socialUrls as string[] | undefined) ?? [],
    },
  };
};

const metaOf = (metaFn: unknown, loaderData: unknown, locale: "ar" | "en") => {
  const pub = publicMatch(loaderData);
  return (metaFn as (a: unknown) => Meta)({
    loaderData,
    matches: [rootMatch(locale), ...(pub ? [pub] : [])],
  });
};

/** Parse every `script:ld+json` descriptor (object or already-stringified). */
const ldBlocks = (m: Meta): Ld[] =>
  m
    .filter((x) => "script:ld+json" in x)
    .map((x) => x["script:ld+json"])
    .map((v) => (typeof v === "string" ? JSON.parse(v) : (v as Ld)));

const findLd = (m: Meta, type: string): Ld | undefined =>
  ldBlocks(m).find((b) => {
    const t = b["@type"];
    return Array.isArray(t) ? t.includes(type) : t === type;
  });

/**
 * RR7 renders only the LEAF route's meta, so the site entities must be part of
 * every route's own meta (see siteEntitiesMeta). Every public route is
 * asserted to carry them — this is what makes the Organization entity visible
 * to crawlers on each page.
 */
const expectSiteEntities = (m: Meta, name = "د/ مصطفى تيتو") => {
  const org = findLd(m, "Organization");
  expect(org).toBeDefined();
  expect(org!.name).toBe(name);
  expect(org!.url).toBe(`${BASE}/`);
  const site = findLd(m, "WebSite");
  expect(site).toBeDefined();
  expect(site!.name).toBe(name);
  expect(site!.url).toBe(`${BASE}/`);
  expect(site!.potentialAction).toBeUndefined();
};

async function wipe() {
  const db = getDb(env);
  for (const table of ["units", "courses", "subjects", "grades", "programs", "files", "audit_logs"]) {
    await db.run(`DELETE FROM ${table}`);
  }
}
beforeEach(wipe);

async function seedCatalog() {
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
      thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
    },
    actor
  );
  return { program, grade, subject, course };
}

describe("public layout declares Organization + WebSite on every public page", () => {
  it("emits both entities with absolute URLs and owner identity data", async () => {
    await seedCatalog();
    const data = await call(publicLayoutLoader, get("/"));
    const meta = await metaOf(publicLayoutMeta, data, "ar");

    const org = findLd(meta, "Organization");
    expect(org).toBeDefined();
    expect(org!.name).toBe("د/ مصطفى تيتو");
    expect(org!.url).toBe(`${BASE}/`);
    // identity not configured → no logo / sameAs stubs
    expect(org!.logo).toBeUndefined();
    expect(org!.sameAs).toBeUndefined();

    const site = findLd(meta, "WebSite");
    expect(site).toBeDefined();
    expect(site!.name).toBe("د/ مصطفى تيتو");
    expect(site!.url).toBe(`${BASE}/`);
    // no public search page → no SearchAction
    expect(site!.potentialAction).toBeUndefined();
    expect(site!.searchAction).toBeUndefined();
  });

  it("sameAs follows the Admin → Identity social links (the only official profiles)", async () => {
    const db = getDb(env);
    await seedCatalog();
    await updateSettingsGroup(
      db,
      "identity",
      {
        socialLinks: [
          { id: "s1", network: "facebook", url: "https://facebook.com/mostafatito", labelAr: "فيسبوك", labelEn: "Facebook", enabled: true, sortOrder: 0, showHeader: false, showFooter: true, showHome: true, showContact: true },
          { id: "s2", network: "globe", url: "https://youtube.com/@tito", labelAr: "يوتيوب", labelEn: "YouTube", enabled: true, sortOrder: 1, showHeader: false, showFooter: true, showHome: true, showContact: true },
        ],
      },
      actor
    );
    const data = await call(publicLayoutLoader, get("/"));
    const meta = await metaOf(publicLayoutMeta, data, "ar");
    const org = findLd(meta, "Organization");
    expect(org!.sameAs).toEqual(["https://facebook.com/mostafatito", "https://youtube.com/@tito"]);
  });
});

describe("course page: Course + BreadcrumbList", () => {
  it("describes the course honestly (no price, no ratings) and mirrors the visible trail", async () => {
    const db = getDb(env);
    const { course, subject } = await seedCatalog();
    const unit = await createUnit(db, { courseId: course.id, titleAr: "و1", titleEn: "U1", status: "published", sortOrder: 0 }, actor);
    for (let i = 0; i < 2; i++) {
      await createLesson(
        db,
        { unitId: unit.id, titleAr: `درس ${i}`, titleEn: `Lesson ${i}`, accessLevel: "entitled", freePreview: false, status: "published", sortOrder: i },
        actor
      );
    }

    const data = await call(courseLoader, get(`/courses/${course.slug}`), { slug: course.slug });
    const meta = await metaOf(courseMeta, data, "ar");

    const courseLd = findLd(meta, "Course");
    expect(courseLd).toBeDefined();
    expect(courseLd!.name).toBe("مراجعة شاملة");
    expect(courseLd!.url).toBe(`${BASE}/courses/${course.slug}`);
    expect(courseLd!.description).toBe("دورة شاملة تغطي المنهج بالكامل");
    expect(courseLd!.numberOfItems).toBe(2);
    expect(courseLd!.provider).toEqual({ "@type": "Organization", name: "د/ مصطفى تيتو", url: `${BASE}/` });
    // honesty: no offers/price/ratings — none of these exist on the page
    expect(courseLd!.offers).toBeUndefined();
    expect(courseLd!.price).toBeUndefined();
    expect(courseLd!.aggregateRating).toBeUndefined();

    // site entities ride along on the course page's own meta
    expectSiteEntities(meta);

    const bc = findLd(meta, "BreadcrumbList");
    expect(bc).toBeDefined();
    const items = bc!.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.name)).toEqual(["الرئيسية", "الكورسات", "الفيزياء", "مراجعة شاملة"]);
    expect(items[0].item).toBe(`${BASE}/`);
    expect(items[1].item).toBe(`${BASE}/courses`);
    expect(items[2].item).toBe(`${BASE}/subjects/${subject.slug}`);
    expect(items[3].item).toBeUndefined(); // current page crumb carries no link
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
  });

  it("omits numberOfItems when no lessons are published yet", async () => {
    const { course } = await seedCatalog();
    const data = await call(courseLoader, get(`/courses/${course.slug}`), { slug: course.slug });
    const meta = await metaOf(courseMeta, data, "ar");
    const courseLd = findLd(meta, "Course");
    expect(courseLd!.numberOfItems).toBeUndefined();
  });
});

describe("catalog index: ItemList of the published courses shown on the page", () => {
  it("lists published courses with absolute URLs", async () => {
    const db = getDb(env);
    const { course, subject } = await seedCatalog();
    // a second published course in the same subject
    const other = await createCourse(
      db,
      {
        subjectId: subject.id, titleAr: "أساسيات", titleEn: "Basics", status: "published",
        visibility: "catalog", accessLevel: "public", sortOrder: 1,
        descriptionAr: "", descriptionEn: "", thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
      },
      actor
    );

    const data = await call(catalogLoader, get("/courses"));
    const meta = await metaOf(catalogMeta, data, "ar");
    const list = findLd(meta, "ItemList");
    expect(list).toBeDefined();
    expect(list!.numberOfItems).toBe(2);
    const items = list!.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.url)).toEqual([
      `${BASE}/courses/${course.slug}`,
      `${BASE}/courses/${other.slug}`,
    ]);
    expectSiteEntities(meta);
  });

  it("emits an honest empty ItemList when nothing is published", async () => {
    const data = await call(catalogLoader, get("/courses"));
    const meta = await metaOf(catalogMeta, data, "ar");
    const list = findLd(meta, "ItemList");
    expect(list).toBeDefined();
    expect(list!.numberOfItems).toBe(0);
  });
});

describe("subject + program pages: WebPage + BreadcrumbList", () => {
  it("subject page: CollectionPage WebPage, trail Home → Courses → Program → Subject", async () => {
    const { subject, program } = await seedCatalog();
    const data = await call(subjectLoader, get(`/subjects/${subject.slug}`), { slug: subject.slug });
    const meta = await metaOf(subjectMeta, data, "ar");

    const page = findLd(meta, "WebPage");
    expect(page).toBeDefined();
    expect(page!["@type"]).toEqual(["WebPage", "https://schema.org/CollectionPage"]);
    expect(page!.name).toBe("الفيزياء");
    expect(page!.url).toBe(`${BASE}/subjects/${subject.slug}`);
    expect(page!.description).toBe("وصف المادة");

    const items = (findLd(meta, "BreadcrumbList")!.itemListElement as Array<Record<string, unknown>>);
    expect(items.map((i) => i.name)).toEqual(["الرئيسية", "الكورسات", "الثانوية العامة", "الفيزياء"]);
    expect(items[2].item).toBe(`${BASE}/programs/${program.slug}`);
    expect(items[3].item).toBeUndefined();
    expectSiteEntities(meta);
  });

  it("program page: CollectionPage WebPage, trail Home → Programs → Program", async () => {
    const { program } = await seedCatalog();
    const data = await call(programLoader, get(`/programs/${program.slug}`), { slug: program.slug });
    const meta = await metaOf(programMeta, data, "ar");

    const page = findLd(meta, "WebPage");
    expect(page!).toBeDefined();
    expect(page!.name).toBe("الثانوية العامة");
    expect(page!.url).toBe(`${BASE}/programs/${program.slug}`);

    const items = (findLd(meta, "BreadcrumbList")!.itemListElement as Array<Record<string, unknown>>);
    expect(items.map((i) => i.name)).toEqual(["الرئيسية", "البرامج", "الثانوية العامة"]);
    expect(items[1].item).toBe(`${BASE}/programs`);
    expect(items[2].item).toBeUndefined();
    expectSiteEntities(meta);
  });
});

describe("unit page: WebPage + BreadcrumbList", () => {
  it("trail Home → Courses → Course → Unit, with a factual description", async () => {
    const db = getDb(env);
    const { course } = await seedCatalog();
    const unit = await createUnit(db, { courseId: course.id, titleAr: "الوحدة الأولى", titleEn: "Unit One", status: "published", sortOrder: 0 }, actor);
    const data = await call(unitLoader, get(`/courses/${course.slug}/units/${unit.id}`), { slug: course.slug, unitId: unit.id });
    const meta = await metaOf(unitMeta, data, "ar");

    const page = findLd(meta, "WebPage");
    expect(page!).toBeDefined();
    expect(page!.name).toBe("الوحدة الأولى");
    expect(page!.url).toBe(`${BASE}/courses/${course.slug}/units/${unit.id}`);
    expect(page!.description).toContain("الوحدة الأولى");
    expect(page!.description).toContain("مراجعة شاملة");

    const items = (findLd(meta, "BreadcrumbList")!.itemListElement as Array<Record<string, unknown>>);
    expect(items.map((i) => i.name)).toEqual(["الرئيسية", "الكورسات", "مراجعة شاملة", "الوحدة الأولى"]);
    expect(items[2].item).toBe(`${BASE}/courses/${course.slug}`);
    expect(items[3].item).toBeUndefined();
    expectSiteEntities(meta);
  });
});
