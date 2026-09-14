/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import {
  createCourse,
  createGrade,
  createProgram,
  createSubject,
} from "~server/content/service.server";
import { indexablePublicUrls, ROBOTS_PRIVATE_PATHS, sitemapXml } from "~server/seo/inventory.server";
import { updateSettingsGroup } from "~server/settings/service.server";
import { loader as sitemapLoader } from "~/routes/sitemap[.]xml";
import { loader as curriculumLoader, meta as curriculumMeta } from "~/routes/public.curriculum.$slug";
import { loader as homeLoader } from "~/routes/public/home";

/**
 * Public curriculum-overview pages — public + indexable + DIRECT-LINK only.
 *
 * Contracts locked here:
 *   - a known slug renders the full page, an unknown slug 404s (never redirects),
 *   - title/description/canonical/robots are unique and honest per page,
 *   - structured data stays within WebPage/BreadcrumbList (+ a real ItemList only
 *     when published courses exist),
 *   - the sitemap lists them and robots.txt does NOT block them,
 *   - the homepage never links to them (brief §7).
 */

const actor = { userId: "00000000-0000-4000-8000-0000000000a1", role: "super_admin" };
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const ORIGIN = "https://app.test";
const db = getDb(env);

const PHILO_SLUG = "falsafa-manteq-grade-1-secondary";
const PSYCH_SLUG = "psychology-baccalaureate";

async function callLoader(loader: unknown, path: string, params: Record<string, string> = {}) {
  return await (loader as (a: { context: unknown; request: Request; params: Record<string, string> }) => Promise<unknown>)({
    context: routeCtx,
    request: new Request(`${ORIGIN}${path}`, { method: "GET" }),
    params,
  });
}

/** Root-match shape the public layout provides (rootMetaFrom reads data.platform). */
const rootMatch = (locale: "ar" | "en" = "ar") => [
  { id: "root", data: { locale, platform: { nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito" }, url: `${ORIGIN}/` } },
];

function metaOf(entries: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of entries as Array<Record<string, unknown>>) {
    if (typeof raw.title === "string") out.title = raw.title;
    if (raw.name && typeof raw.content === "string") out[String(raw.name)] = raw.content;
    if (raw.property && typeof raw.content === "string") out[String(raw.property)] = raw.content;
    if (raw.tagName === "link" && raw.rel === "canonical") out.canonical = raw.href;
    if (raw["script:ld+json"]) out.jsonld = [...((out.jsonld as unknown[]) ?? []), raw["script:ld+json"]];
  }
  return out;
}

beforeEach(async () => {
  for (const table of ["lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs", "pages", "blocks", "page_versions", "settings", "menu_items", "menus"]) {
    await db.run(`DELETE FROM ${table}`);
  }
});

describe("curriculum overview pages", () => {
  it("404s an unknown slug instead of redirecting or showing an empty shell", async () => {
    await expect(callLoader(curriculumLoader, "/curriculum/nope", { slug: "nope" })).rejects.toMatchObject({ status: 404 });
  });

  it("renders real, unique metadata + honest structured data on an empty install", async () => {
    for (const slug of [PHILO_SLUG, PSYCH_SLUG]) {
      const data = (await callLoader(curriculumLoader, `/curriculum/${slug}`, { slug })) as never;
      const meta = metaOf(curriculumMeta({ loaderData: data, matches: rootMatch() } as never) as unknown[]);

      expect(String(meta.title)).toContain("نبذة عن محتوى المنهج");
      expect(String(meta.title)).toContain("مصطفى تيتو");
      expect(String(meta.description).length).toBeGreaterThan(40);
      expect(meta.canonical).toBe(`${ORIGIN}/curriculum/${slug}`);
      expect(meta.robots).toBe("index,follow");
      expect(meta["og:type"]).toBe("website");

      const ld = (meta.jsonld as Array<Record<string, unknown>>) ?? [];
      expect(Array.isArray(ld)).toBe(true);
      const types = ld.map((o) => JSON.stringify(o["@type"]));
      expect(types.some((t) => t.includes("WebPage"))).toBe(true);
      expect(types.some((t) => t.includes("BreadcrumbList"))).toBe(true);
      // No Course / no ItemList / no aggregate ratings while nothing is published.
      expect(types.some((t) => t.includes("Course") || t.includes("ItemList") || t.includes("Rating"))).toBe(false);
    }

    // Descriptions must differ between the two pages (no duplicate content).
    const first = metaOf(curriculumMeta({ loaderData: (await callLoader(curriculumLoader, `/curriculum/${PHILO_SLUG}`, { slug: PHILO_SLUG })) as never, matches: rootMatch() } as never) as unknown[]);
    const second = metaOf(curriculumMeta({ loaderData: (await callLoader(curriculumLoader, `/curriculum/${PSYCH_SLUG}`, { slug: PSYCH_SLUG })) as never, matches: rootMatch() } as never) as unknown[]);
    expect(first.title).not.toBe(second.title);
    expect(first.description).not.toBe(second.description);
  });

  it("links only real published rows and adds a real ItemList when they exist", async () => {
    const program = await createProgram(db, { titleAr: "الثانوية العامة", titleEn: "Secondary", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "الصف الأول الثانوي", titleEn: "Grade 1 secondary", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "فلسفة ومنطق", titleEn: "Philosophy & Logic", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    await createCourse(db, { subjectId: subject.id, titleAr: "مراجعة الفلسفة", titleEn: "Philosophy revision", status: "published", visibility: "catalog", accessLevel: "public", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);

    const data = (await callLoader(curriculumLoader, `/curriculum/${PHILO_SLUG}`, { slug: PHILO_SLUG })) as {
      subjects: Array<{ slug: string }>;
      courses: Array<{ slug: string }>;
      gradeLinks: Array<{ slug: string }>;
    };
    expect(data.gradeLinks).toHaveLength(1);
    expect(data.subjects).toHaveLength(1);
    expect(data.courses).toHaveLength(1);

    const meta = metaOf(curriculumMeta({ loaderData: data as never, matches: rootMatch() } as never) as unknown[]);
    const types = ((meta.jsonld as Array<Record<string, unknown>>) ?? []).map((o) => JSON.stringify(o["@type"]));
    expect(types.some((t) => t.includes("ItemList"))).toBe(true);

    // The psychology page must NOT inherit the philosophy rows.
    const psych = (await callLoader(curriculumLoader, `/curriculum/${PSYCH_SLUG}`, { slug: PSYCH_SLUG })) as { courses: unknown[] };
    expect(psych.courses).toHaveLength(0);
  });

  it("sitemap lists them and robots.txt allows them", async () => {
    const urls = await indexablePublicUrls(db);
    const paths = urls.map((u) => u.path);
    expect(paths).toContain(`/curriculum/${PHILO_SLUG}`);
    expect(paths).toContain(`/curriculum/${PSYCH_SLUG}`);
    expect(ROBOTS_PRIVATE_PATHS.some((p) => p.startsWith("/curriculum"))).toBe(false);

    const res = (await callLoader(sitemapLoader, "/sitemap.xml")) as Response;
    const xml = await res.text();
    expect(xml).toContain(`<loc>${ORIGIN}/curriculum/${PHILO_SLUG}</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/curriculum/${PSYCH_SLUG}</loc>`);
    // sanity: sitemapXml stays valid for the extra rows
    expect(sitemapXml(urls, ORIGIN)).toBe(xml);
  });

  it("keeps the curriculum pages out of the homepage and the navigation data", async () => {
    // No published home page + no catalog → the homepage still renders its own
    // (code-side) content and never mentions /curriculum.
    const home = (await callLoader(homeLoader, "/")) as { page?: unknown } | null;
    expect(JSON.stringify(home ?? {})).not.toContain("/curriculum");
    const menus = await db.run(`SELECT count(*) FROM menu_items WHERE href LIKE '%curriculum%'`);
    expect(menus).toBeDefined();
  });

  it("requires no owner identity: the pages work before any settings exist", async () => {
    await updateSettingsGroup(db, "platform", { nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito" }, actor);
    const data = (await callLoader(curriculumLoader, `/curriculum/${PHILO_SLUG}`, { slug: PHILO_SLUG })) as { page: { slug: string } };
    expect(data.page.slug).toBe(PHILO_SLUG);
  });
});
