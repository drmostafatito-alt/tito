import { and, eq, inArray, isNull, not } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { courses, grades, pages, programs, products, subjects, units } from "../db/schema";
import { catalogCourses } from "../content/service.server";
import { pricePlansForProduct } from "../commerce/service.server";
import { getSettings } from "../settings/service.server";
import { getCurriculumLessons } from "../curriculum/service.server";

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
 *
 * Enhanced in Content Architecture Phase:
 *   - curriculum index (/curriculum) — 48 real lessons grouped, not thin
 *   - curriculum lesson hubs (/curriculum/:lessonSlug) — one strong page per
 *     real lesson (48 pages), each with official name, hierarchy, semantic,
 *     related lessons, internal links, external exams link. Serves all intents
 *     (شرح+ملخص+مراجعة+فيديو+PDF) as one canonical, questions → external platform.
 *   - These are static curriculum pages (from CSV, no guessing), not doorway,
 *     with rich internal linking and educational context.
 */

export interface SitemapUrl {
  path: string;
  lastmodMs: number | null;
}

const publishedProgramsWhere = and(eq(programs.status, "published"), isNull(programs.deletedAt));
const publishedGradesWhere = and(eq(grades.status, "published"), isNull(grades.deletedAt));
const publishedSubjectsWhere = and(eq(subjects.status, "published"), isNull(subjects.deletedAt));

export async function indexablePublicUrls(db: DB): Promise<SitemapUrl[]> {
  const out: SitemapUrl[] = [];

  const homeRow = await db
    .select({ publishedAt: pages.publishedAt, updatedAt: pages.updatedAt })
    .from(pages)
    .where(and(eq(pages.slug, "home"), eq(pages.status, "published"), isNull(pages.deletedAt)))
    .limit(1);
  out.push({ path: "/", lastmodMs: homeRow[0]?.publishedAt ?? homeRow[0]?.updatedAt ?? null });

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
    if (!liveProgramIds.has(g.programId)) continue;
    out.push({ path: `/grades/${g.slug}`, lastmodMs: g.updatedAt });
  }

  const catalog = await catalogCourses(db);
  const subjectCourseCount: Record<string, number> = {};
  for (const r of catalog) subjectCourseCount[r.subjectSlug] = (subjectCourseCount[r.subjectSlug] ?? 0) + 1;

  const subjectsRows = await db
    .select({ slug: subjects.slug, updatedAt: subjects.updatedAt })
    .from(subjects)
    .where(publishedSubjectsWhere);
  for (const s of subjectsRows) {
    if ((subjectCourseCount[s.slug] ?? 0) > 0) out.push({ path: `/subjects/${s.slug}`, lastmodMs: s.updatedAt });
  }

  if (catalog.length > 0) {
    out.push({ path: "/courses", lastmodMs: Math.max(...catalog.map((r) => r.course.updatedAt)) });
    for (const r of catalog) out.push({ path: `/courses/${r.course.slug}`, lastmodMs: r.course.updatedAt });
  }

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

  // --- curriculum: 48 real lessons (Content Architecture Phase) ---
  // Curriculum index is always indexable (has 48 lessons grouped, not thin)
  out.push({ path: "/curriculum", lastmodMs: null });
  // Each lesson hub is indexable (one strong page per real lesson, with hierarchy, semantic, related, internal links)
  // These are static pages from CSV (no guessing), not doorway, with rich context
  const curriculumLessons = getCurriculumLessons();
  for (const lesson of curriculumLessons) {
    out.push({ path: `/curriculum/${lesson.slug}`, lastmodMs: null });
  }

  const productRows = await db
    .select({ slug: products.slug, id: products.id, updatedAt: products.updatedAt })
    .from(products)
    .where(and(eq(products.active, true), isNull(products.archivedAt)));
  for (const p of productRows) {
    const plans = await pricePlansForProduct(db, p.id, { activeOnly: true });
    if (plans.length > 0) out.push({ path: `/products/${p.slug}`, lastmodMs: p.updatedAt });
  }

  const pageRows = await db
    .select({ slug: pages.slug, updatedAt: pages.updatedAt })
    .from(pages)
    .where(and(eq(pages.status, "published"), isNull(pages.deletedAt), not(eq(pages.slug, "home"))));
  for (const p of pageRows) out.push({ path: `/p/${p.slug}`, lastmodMs: p.updatedAt });

  const settings = await getSettings(db);
  if (settings.identity.ownerNameAr.trim() !== "" || settings.identity.ownerNameEn.trim() !== "") {
    out.push({ path: "/about", lastmodMs: null });
  }

  return out.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
}

export function sitemapXml(urls: SitemapUrl[], origin: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  const base = origin.replace(/\/$/, "");
  const rows = urls
    .map((u) => {
      const lastmod = u.lastmodMs != null ? `<lastmod>${new Date(u.lastmodMs).toISOString().slice(0, 10)}</lastmod>` : "";
      return `  <url><loc>${esc(`${base}${u.path}`)}</loc>${lastmod}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

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
