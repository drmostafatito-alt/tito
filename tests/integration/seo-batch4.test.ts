/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { createGrade, createProgram, createSubject } from "~server/content/service.server";
import { updateSettingsGroup } from "~server/settings/service.server";
import { loader as gradeLoader, meta as gradeMeta } from "~/routes/public.grades.$slug";
import { loader as aboutLoader, meta as aboutMeta } from "~/routes/public/about";

/**
 * Batch 4 regression — grade + about entity pages.
 *
 *   /grades/:slug  → canonical destination for the "grade" keyword cluster.
 *                    Real content only: published grade row + its published
 *                    subjects. Draft/deleted grades 404.
 *   /about         → the definitive Person entity page. 404s when no owner
 *                    identity is configured (production starts content-empty);
 *                    Person/ProfilePage schema uses ONLY owner-configured data.
 *
 * Drives the REAL route loader + meta() pair against D1, parsing the
 * `script:ld+json` descriptors the way <head> would.
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

const rootMatch = (locale: "ar" | "en") => ({
  id: "root",
  data: {
    locale,
    platform: { nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito", taglineAr: "الفلسفة وعلم النفس", taglineEn: "Philosophy & Psychology" },
  },
});

/** The public layout match with a minimal (default) identity — same contract
 *  as seo-jsonld.test.ts. The about loader data carries its own resolved
 *  socials (the same resolveSocialLinks call the layout makes), so those are
 *  reused to keep Person.sameAs and Organization.sameAs comparable. */
const publicMatch = (loaderData: unknown) => {
  const d = (loaderData ?? {}) as Record<string, unknown>;
  if (!d.url) return null;
  const contactSocials = ((d.contact as { socials?: Array<{ url: string }> } | undefined)?.socials ?? []).map((s) => s.url);
  return {
    id: "public",
    data: {
      url: d.url as string,
      identity: d.identity ?? { platformName: { ar: "د/ مصطفى تيتو", en: "Dr mostafa tito" }, logoUrl: null },
      socialUrls: (d.socialUrls as string[] | undefined) ?? contactSocials,
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

const titleOf = (m: Meta) => (m.find((x) => typeof x.title === "string")?.title as string) ?? "";
const descOf = (m: Meta) => (m.find((x) => x.name === "description")?.content as string) ?? null;
const robotsOf = (m: Meta) => (m.find((x) => x.name === "robots")?.content as string) ?? null;
const canonicalOf = (m: Meta) => (m.find((x) => x.rel === "canonical")?.href as string) ?? null;

async function wipe() {
  const db = getDb(env);
  for (const table of ["units", "courses", "subjects", "grades", "programs", "files", "audit_logs"]) {
    await db.run(`DELETE FROM ${table}`);
  }
  // reset the settings table so the owner identity is the schema default
  await db.run(`DELETE FROM settings`);
}
beforeEach(wipe);

async function seedGradeWithSubjects() {
  const db = getDb(env);
  const program = await createProgram(
    db,
    {
      titleAr: "الثانوية العامة", titleEn: "General Secondary", status: "published", sortOrder: 0,
      descriptionAr: "", descriptionEn: "",
    },
    actor
  );
  const grade = await createGrade(
    db,
    { programId: program.id, titleAr: "الصف الثالث الثانوي", titleEn: "Grade 12 Secondary", status: "published", sortOrder: 0 },
    actor
  );
  const s1 = await createSubject(
    db,
    {
      gradeId: grade.id, titleAr: "الفلسفة", titleEn: "Philosophy", status: "published", sortOrder: 0,
      descriptionAr: "", descriptionEn: "", thumbnailFileId: null,
    },
    actor
  );
  const s2 = await createSubject(
    db,
    {
      gradeId: grade.id, titleAr: "علم النفس", titleEn: "Psychology", status: "published", sortOrder: 1,
      descriptionAr: "", descriptionEn: "", thumbnailFileId: null,
    },
    actor
  );
  return { program, grade, subjects: [s1, s2] };
}

describe("grade page: canonical destination for the grade cluster", () => {
  it("published grade: title `grade — brand`, real-subject description, indexable, full trail LD", async () => {
    const { grade, program, subjects } = await seedGradeWithSubjects();
    const data = await call(gradeLoader, get(`/grades/${grade.slug}`), { slug: grade.slug });
    const meta = await metaOf(gradeMeta, data, "ar");

    expect(titleOf(meta)).toBe("الصف الثالث الثانوي — د/ مصطفى تيتو");
    const d = descOf(meta) as string;
    expect(d).toContain("الفلسفة");
    expect(d).toContain("علم النفس");
    expect(robotsOf(meta)).toBe("index,follow");
    expect(canonicalOf(meta)).toBe(`${BASE}/grades/${grade.slug}`);

    const page = findLd(meta, "WebPage");
    expect(page!).toBeDefined();
    expect(page!["@type"]).toEqual(["WebPage", "https://schema.org/CollectionPage"]);
    expect(page!.url).toBe(`${BASE}/grades/${grade.slug}`);

    const bc = findLd(meta, "BreadcrumbList")!;
    const items = bc.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.name)).toEqual(["الرئيسية", "البرامج", "الثانوية العامة", "الصف الثالث الثانوي"]);
    expect(items[2].item).toBe(`${BASE}/programs/${program.slug}`);
    expect(items[3].item).toBeUndefined();

    // site entities on the page too
    expect(findLd(meta, "Organization")?.name).toBe("د/ مصطفى تيتو");
    expect(findLd(meta, "WebSite")?.url).toBe(`${BASE}/`);
  });

  it("is independently bilingual (EN title + EN description)", async () => {
    const { grade } = await seedGradeWithSubjects();
    const data = await call(gradeLoader, get(`/grades/${grade.slug}`), { slug: grade.slug });
    const meta = await metaOf(gradeMeta, data, "en");
    expect(titleOf(meta)).toBe("Grade 12 Secondary — Dr mostafa tito");
    const d = descOf(meta) as string;
    expect(d).toContain("Philosophy");
    expect(d).toContain("Psychology");
    expect(d).not.toContain("الفلسفة");
  });

  it("grade with no published subjects: honest empty description, no invented content", async () => {
    const db = getDb(env);
    const program = await createProgram(
      db,
      { titleAr: "ب", titleEn: "P", status: "published", sortOrder: 0, descriptionAr: "", descriptionEn: "" },
      actor
    );
    const grade = await createGrade(
      db,
      { programId: program.id, titleAr: "صف فارغ", titleEn: "Empty Grade", status: "published", sortOrder: 0 },
      actor
    );
    const data = await call(gradeLoader, get(`/grades/${grade.slug}`), { slug: grade.slug });
    const meta = await metaOf(gradeMeta, data, "ar");
    expect(titleOf(meta)).toBe("صف فارغ — د/ مصطفى تيتو");
    expect(descOf(meta)).toBe("صف فارغ على منصة د/ مصطفى تيتو.");
  });

  it("draft grade 404s (never indexable, never in the sitemap)", async () => {
    const db = getDb(env);
    const program = await createProgram(
      db,
      { titleAr: "ب", titleEn: "P", status: "published", sortOrder: 0, descriptionAr: "", descriptionEn: "" },
      actor
    );
    const grade = await createGrade(
      db,
      { programId: program.id, titleAr: "مسودة", titleEn: "Draft Grade", status: "draft", sortOrder: 0 },
      actor
    );
    await expect(call(gradeLoader, get(`/grades/${grade.slug}`), { slug: grade.slug })).rejects.toMatchObject({ status: 404 });
  });

  it("unknown slug 404s", async () => {
    await expect(call(gradeLoader, get("/grades/nope"), { slug: "nope" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("about page: the definitive person entity page", () => {
  it("404s when no owner identity is configured (production starts content-empty)", async () => {
    await expect(call(aboutLoader, get("/about"))).rejects.toMatchObject({ status: 404 });
  });

  it("renders the owner-configured identity with Person + ProfilePage schema", async () => {
    const db = getDb(env);
    await updateSettingsGroup(
      db,
      "identity",
      {
        ownerNameAr: "مصطفى تيتو",
        ownerNameEn: "Mostafa Tito",
        socialLinks: [
          { id: "s1", network: "facebook", url: "https://facebook.com/mostafatito", labelAr: "فيسبوك", labelEn: "Facebook", enabled: true, sortOrder: 0, showHeader: false, showFooter: true, showHome: true, showContact: true },
        ],
      },
      actor
    );
    await seedGradeWithSubjects();

    const data = await call(aboutLoader, get("/about"));
    const meta = await metaOf(aboutMeta, data, "ar");

    expect(titleOf(meta)).toBe("من نحن — د/ مصطفى تيتو");
    expect(robotsOf(meta)).toBe("index,follow");
    expect(canonicalOf(meta)).toBe(`${BASE}/about`);
    const d = descOf(meta) as string;
    expect(d).toContain("مصطفى تيتو");

    const person = findLd(meta, "Person");
    expect(person).toBeDefined();
    expect(person!.name).toBe("مصطفى تيتو");
    expect(person!.url).toBe(`${BASE}/about`);
    // no title configured → no invented jobTitle
    expect(person!.jobTitle).toBeUndefined();
    expect(person!.sameAs).toEqual(["https://facebook.com/mostafatito"]);
    expect(person!.worksFor).toEqual({ "@type": "Organization", name: "د/ مصطفى تيتو", url: `${BASE}/` });

    const page = findLd(meta, "WebPage");
    expect(page!["@type"]).toEqual(["WebPage", "https://schema.org/ProfilePage"]);
    expect(page!.url).toBe(`${BASE}/about`);

    const items = (findLd(meta, "BreadcrumbList")!.itemListElement as Array<Record<string, unknown>>);
    expect(items.map((i) => i.name)).toEqual(["الرئيسية", "من نحن"]);
    expect(items[1].item).toBeUndefined();
  });

  it("owner-configured title → real jobTitle in the Person schema", async () => {
    const db = getDb(env);
    await updateSettingsGroup(
      db,
      "identity",
      { ownerNameAr: "مصطفى تيتو", ownerNameEn: "Mostafa Tito", ownerTitleAr: "مدرس الفلسفة وعلم النفس", ownerTitleEn: "Philosophy & Psychology Teacher" },
      actor
    );
    const data = await call(aboutLoader, get("/about"));
    const meta = await metaOf(aboutMeta, data, "ar");
    const person = findLd(meta, "Person");
    expect(person!.jobTitle).toBe("مدرس الفلسفة وعلم النفس");
    // the description leads with the configured title (a real fact)
    expect(descOf(meta)).toContain("مدرس الفلسفة وعلم النفس");
  });

  it("Person.sameAs reflects the identity's NAMED social fields (fallback path)", async () => {
    const db = getDb(env);
    // no data-driven socialLinks — only the legacy named `facebook` field
    await updateSettingsGroup(
      db,
      "identity",
      { ownerNameAr: "مصطفى تيتو", ownerNameEn: "Mostafa Tito", facebook: "https://facebook.com/mostafatito" },
      actor
    );
    const data = await call(aboutLoader, get("/about"));
    const meta = await metaOf(aboutMeta, data, "ar");
    const person = findLd(meta, "Person");
    expect(person!.sameAs).toEqual(["https://facebook.com/mostafatito"]);
    // must agree with the Organization entity's sameAs on the same page
    expect(findLd(meta, "Organization")!.sameAs).toEqual(["https://facebook.com/mostafatito"]);
  });

  it("English render uses the English identity fields", async () => {
    const db = getDb(env);
    await updateSettingsGroup(
      db,
      "identity",
      { ownerNameAr: "مصطفى تيتو", ownerNameEn: "Mostafa Tito", ownerTitleEn: "Philosophy & Psychology Teacher" },
      actor
    );
    const data = await call(aboutLoader, get("/about"));
    const meta = await metaOf(aboutMeta, data, "en");
    expect(titleOf(meta)).toBe("About us — Dr mostafa tito");
    const person = findLd(meta, "Person");
    expect(person!.name).toBe("Mostafa Tito");
    expect(person!.jobTitle).toBe("Philosophy & Psychology Teacher");
  });
});
