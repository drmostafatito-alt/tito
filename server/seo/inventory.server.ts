import { and, eq, inArray, isNull, not } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { courses, grades, pages, programs, products, subjects, units } from "../db/schema";
import { catalogCourses } from "../content/service.server";
import { pricePlansForProduct } from "../commerce/service.server";
import { getSettings } from "../settings/service.server";
import { CURRICULUM_PAGES, curriculumPagePath } from "./curriculum-pages.server";

/**
 * SEO crawl inventory — the SINGLE SOURCE OF TRUTH for "which public URLs are
 * indexable". Consumed by:
 *   - the dynamic /sitemap.xml route
 *   - the Admin → SEO health dashboard (sitemap-membership diagnostics)
 *   - integration tests
 *
 * Rules (anti-thin-page / anti-doorway guarantees):
 *   - only PUBLISHED, non-deleted rows ever appear (drafts/archived/deleted
 *     vanish automatically on the next request — no manual sitemap upkeep);
 *   - index pages appear only when they have real content (empty-first, the
 *     same policy as the UI);
 *   - no query strings, no ids, no dates in paths — stable across years;
 *   - private areas (student/admin/learn/api/files) are never listed;
 *   - the CMS `home` page is listed as `/` only (its `/p/home` twin is a
 *     duplicate — the route 301s it to `/`, see p.$slug.tsx).
 *
 * Enhanced in SEO Lesson Phase:
 *   - unit pages (/courses/:slug/units/:unitId) are now included when their
 *     course is in the public catalog (published, visible, ancestors published)
 *     and the unit itself is published. This enables lesson discovery SEO:
 *     each unit page lists its published lessons (public titles) and is the
 *     canonical target for lesson_discovery intent.
 *   - lesson pages (/learn/...) remain EXCLUDED (private, noindex, per-user progress)
 */
export interface SitemapUrl {
  /** Absolute path (origin added by the sitemap route). */
  path: string;
  /** Epoch ms of the most recent content change (null = unknown/always). */
  lastmodMs: number | null;
}

const publishedProgramsWhere = and(eq(programs.status, "published"), isNull(programs.deletedAt));
const publishedGradesWhere = and(eq(grades.status, "published"), isNull(grades.deletedAt));
const publishedSubjectsWhere = and(eq(subjects.status, "published"), isNull(subjects.deletedAt));

/** Indexable public URLs derived from live, published content state. */
export async function indexablePublicUrls(db: DB): Promise<SitemapUrl[]> {
  const out: SitemapUrl[] = [];

  // Home: the brand root always exists (empty-first rendering is still a real
  // branded page). lastmod = the published home page's publish time, if any.
  const homeRow = await db
    .select({ publishedAt: pages.publishedAt, updatedAt: pages.updatedAt })
    .from(pages)
    .where(and(eq(pages.slug, "home"), eq(pages.status, "published"), isNull(pages.deletedAt)))
    .limit(1);
  out.push({ path: "/", lastmodMs: homeRow[0]?.publishedAt ?? homeRow[0]?.updatedAt ?? null });

  // --- catalog hierarchy (published ancestors enforced per row) -------------
  const progs = await db
    .select({ id: programs.id, slug: programs.slug, updatedAt: programs.updatedAt })
    .from(programs)
    .where(publishedProgramsWhere)
    .orderBy(programs.sortOrder);

  if (progs.length > 0) {
    out.push({ path: "/programs", lastmodMs: Math.max(...progs.map((p) => p.updatedAt)) });
    for (const p of progs) out.push({ path: `/programs/${p.slug}`, lastmodMs: p.updatedAt });
  }

  const gradesRows = await db
    .select({ slug: grades.slug, updatedAt: grades.updatedAt, programId: grades.programId })
    .from(grades)
    .where(publishedGradesWhere);
  const liveProgramIds = new Set(progs.map((p) => p.id));
  for (const g of gradesRows) {
    if (!liveProgramIds.has(g.programId)) continue; // parent program must be live
    out.push({ path: `/grades/${g.slug}`, lastmodMs: g.updatedAt });
  }

  // Catalog (published + catalog/featured + publish window + published
  // ancestors — the exact public visibility rule used by /courses).
  const catalog = await catalogCourses(db);
  const subjectCourseCount: Record<string, number> = {};
  for (const r of catalog) subjectCourseCount[r.subjectSlug] = (subjectCourseCount[r.subjectSlug] ?? 0) + 1;

  const subjectsRows = await db
    .select({ slug: subjects.slug, updatedAt: subjects.updatedAt })
    .from(subjects)
    .where(publishedSubjectsWhere);
  for (const s of subjectsRows) {
    // Anti-thin: a subject page is listed only when it has visible catalog
    // courses (a subject with zero courses renders an empty state).
    if ((subjectCourseCount[s.slug] ?? 0) > 0) out.push({ path: `/subjects/${s.slug}`, lastmodMs: s.updatedAt });
  }

  if (catalog.length > 0) {
    out.push({ path: "/courses", lastmodMs: Math.max(...catalog.map((r) => r.course.updatedAt)) });
    for (const r of catalog) out.push({ path: `/courses/${r.course.slug}`, lastmodMs: r.course.updatedAt });
  }

  // --- unit pages: public, indexable, lesson discovery (SEO Lesson Phase) ---
  // Only for courses that are in the public catalog (same gate as /courses)
  // and units that are published, non-deleted.
  if (catalog.length > 0) {
    const catalogCourseIds = new Set(catalog.map((r) => r.course.id));
    const catalogCourseSlugById = new Map(catalog.map((r) => [r.course.id, r.course.slug] as const));
    const unitRows = await db
      .select({ id: units.id, courseId: units.courseId, updatedAt: units.updatedAt })
      .from(units)
      .where(and(eq(units.status, "published"), isNull(units.deletedAt)));
    for (const u of unitRows) {
      if (!catalogCourseIds.has(u.courseId)) continue;
      const slug = catalogCourseSlugById.get(u.courseId);
      if (!slug) continue;
      out.push({ path: `/courses/${slug}/units/${u.id}`, lastmodMs: u.updatedAt });
    }
  }

  // --- storefront: active products with at least one active price plan ------
  const productRows = await db
    .select({ slug: products.slug, id: products.id, updatedAt: products.updatedAt })
    .from(products)
    .where(and(eq(products.active, true), isNull(products.archivedAt)));
  for (const p of productRows) {
    const plans = await pricePlansForProduct(db, p.id, { activeOnly: true });
    if (plans.length > 0) out.push({ path: `/products/${p.slug}`, lastmodMs: p.updatedAt });
  }

  // --- published CMS pages (`home` is excluded — it lives at /) -------------
  const pageRows = await db
    .select({ slug: pages.slug, updatedAt: pages.updatedAt })
    .from(pages)
    .where(and(eq(pages.status, "published"), isNull(pages.deletedAt), not(eq(pages.slug, "home"))));
  for (const p of pageRows) out.push({ path: `/p/${p.slug}`, lastmodMs: p.updatedAt });

  // --- /about: only when the owner identity actually exists -----------------
  const settings = await getSettings(db);
  if (settings.identity.ownerNameAr.trim() !== "" || settings.identity.ownerNameEn.trim() !== "") {
    out.push({ path: "/about", lastmodMs: null });
  }

  // --- public curriculum-overview pages -------------------------------------
  // Derived from the owner-provided curriculum source (not from catalog rows),
  // so these are real pages on day one. Reachable by direct link and Google
  // only — never from the homepage or the navigation.
  for (const cp of CURRICULUM_PAGES) out.push({ path: curriculumPagePath(cp.slug), lastmodMs: null });

  // Deterministic order (stable sitemap diffs): home first, then by path.
  return out.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
}

/** Render the inventory as sitemap XML (sitemap 0.9). Caller owns the Response. */
export function sitemapXml(urls: SitemapUrl[], origin: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const base = origin.replace(/\/$/, "");
  const rows = urls
    .map((u) => {
      const lastmod =
        u.lastmodMs != null ? `<lastmod>${new Date(u.lastmodMs).toISOString().slice(0, 10)}</lastmod>` : "";
      return `  <url><loc>${esc(`${base}${u.path}`)}</loc>${lastmod}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

/**
 * robots.txt body. Keep the allow/deny list in ONE place: the sitemap route
 * and the Admin → SEO dashboard both read these rules so a change can never
 * silently desync what we ask Google to crawl from what we index.
 */
export const ROBOTS_PRIVATE_PATHS: string[] = [
  "/admin/",
  "/dashboard",
  "/profile",
  "/assignments",
  "/checkout/",
  "/orders",
  "/activate",
  "/notifications",
  "/learn/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email-change",
  "/set-locale",
  "/logout",
  "/files/",
  "/api/",
  "/beacons/",
  "/webhooks/",
  // Strictly test-gated email inbox (404 unless ENVIRONMENT=test + capture
  // transport + synthetic secret). Crawl hygiene only — the gate is server-side.
  "/__test/",
];

export function robotsTxtBody(sitemapUrl: string): string {
  const lines = [
    "# Dr Mostafa Tito — educational platform",
    "# Public educational content is crawlable; private/student/admin/API",
    "# surfaces are restricted (they are auth-gated server-side regardless —",
    "# robots.txt is crawl hygiene, never the security boundary).",
    "User-agent: *",
    "Allow: /",
    ...ROBOTS_PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ];
  return lines.join("\n");
}
