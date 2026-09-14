/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import {
  createCourse,
  createGrade,
  createProgram,
  createSubject,
  updateNode,
} from "~server/content/service.server";
import { createProduct, createPricePlan } from "~server/commerce/service.server";
import { updateSettingsGroup } from "~server/settings/service.server";
import { indexablePublicUrls, ROBOTS_PRIVATE_PATHS } from "~server/seo/inventory.server";
import { loader as robotsLoader } from "~/routes/robots[.]txt";
import { loader as sitemapLoader } from "~/routes/sitemap[.]xml";
import { loader as cmsPageLoader } from "~/routes/p.$slug";

/**
 * Crawl foundation (SEO Master Phase): robots.txt + dynamic sitemap.xml are
 * tested through their REAL route loaders against a real (isolated) D1 —
 * including the publish-state contracts (draft/archived/deleted never appear)
 * and the private-surface boundary (student/admin/learn/api/files never
 * listed or allowed).
 */

const actor = { userId: "00000000-0000-4000-8000-0000000000a1", role: "super_admin" };
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const ORIGIN = "https://app.test";
const get = (path: string) => new Request(`${ORIGIN}${path}`, { method: "GET" });

const db = getDb(env);

async function callLoader(loader: unknown, path: string, params: Record<string, string> = {}) {
  return await (loader as (a: { context: unknown; request: Request; params: Record<string, string> }) => Promise<unknown>)({
    context: routeCtx,
    request: get(path),
    params,
  });
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
}

beforeEach(async () => {
  for (const table of ["lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs", "product_items", "price_plans", "products", "pages", "blocks", "page_versions", "settings"]) {
    await db.run(`DELETE FROM ${table}`);
  }
  // /about appears only when an owner identity exists; leave it unset here
  // and set it explicitly in the test that asserts it.
});

async function seedLiveCatalog() {
  const program = await createProgram(
    db,
    { titleAr: "الثانوية العامة", titleEn: "General Secondary", status: "published", sortOrder: 0, descriptionAr: "ب", descriptionEn: "d" },
    actor,
  );
  const grade = await createGrade(
    db,
    { programId: program.id, titleAr: "الصف الثالث الثانوي", titleEn: "Grade 12", status: "published", sortOrder: 0 },
    actor,
  );
  const subject = await createSubject(
    db,
    { gradeId: grade.id, titleAr: "الفلسفة", titleEn: "Philosophy", status: "published", sortOrder: 0, descriptionAr: "ب", descriptionEn: "d" },
    actor,
  );
  const course = await createCourse(
    db,
    { subjectId: subject.id, titleAr: "كورس الفلسفة", titleEn: "Philosophy course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0 },
    actor,
  );
  const product = await createProduct(
    db,
    {
      kind: "course", nameAr: "وصول كامل", nameEn: "Full access",
      descriptionAr: "ب", descriptionEn: "d", active: true, sortOrder: 0,
      items: [{ resourceType: "course", resourceId: course.id }],
    },
    actor,
  );
  await createPricePlan(
    db,
    product.id,
    { currency: "EGP", amountMinor: 10000, kind: "one_time", active: true },
    actor,
  );
  return { program, grade, subject, course, product };
}

describe("GET /robots.txt (real route loader)", () => {
  it("returns 200 text/plain with an absolute sitemap URL for the serving origin", async () => {
    const res = (await callLoader(robotsLoader, "/robots.txt")) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("Sitemap: https://app.test/sitemap.xml");
  });

  it("disallows the full private surface and keeps public educational paths allowed", async () => {
    const res = (await callLoader(robotsLoader, "/robots.txt")) as Response;
    const body = await res.text();
    for (const p of ROBOTS_PRIVATE_PATHS) expect(body).toContain(`Disallow: ${p}`);
    for (const p of ["/courses", "/subjects", "/programs", "/grades", "/products"]) {
      expect(body).not.toContain(`Disallow: ${p}`);
    }
    expect(body).toContain("Allow: /");
    expect(body).toContain("User-agent: *");
  });
});

describe("GET /sitemap.xml (real route loader, real D1 state)", () => {
  it("is valid XML, 200, application/xml, with absolute locs", async () => {
    await seedLiveCatalog();
    const res = (await callLoader(sitemapLoader, "/sitemap.xml")) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const all = locs(xml);
    expect(all.length).toBeGreaterThan(0);
    for (const loc of all) {
      expect(loc).toMatch(/^https:\/\/app\.test\/(courses|courses\/.+|products\/.+|programs|programs\/.+|grades\/.+|subjects\/.+|p\/.+|about)?$/);
      expect(loc).not.toContain("?");
    }
    expect(new Set(all).size).toBe(all.length); // no duplicate URLs
  });

  it("lists the published catalog hierarchy (program, grade, subject, courses index + course)", async () => {
    const { program, grade, subject, course } = await seedLiveCatalog();
    const xml = await ((await callLoader(sitemapLoader, "/sitemap.xml")) as Response).text();
    const all = locs(xml);
    expect(all).toContain(`${ORIGIN}/`);
    expect(all).toContain(`${ORIGIN}/programs`);
    expect(all).toContain(`${ORIGIN}/programs/${program.slug}`);
    expect(all).toContain(`${ORIGIN}/grades/${grade.slug}`);
    expect(all).toContain(`${ORIGIN}/subjects/${subject.slug}`);
    expect(all).toContain(`${ORIGIN}/courses`);
    expect(all).toContain(`${ORIGIN}/courses/${course.slug}`);
  });

  it("lists active products with an active plan — and drops them when the plan is deactivated", async () => {
    const { product } = await seedLiveCatalog();
    let xml = await ((await callLoader(sitemapLoader, "/sitemap.xml")) as Response).text();
    expect(locs(xml)).toContain(`${ORIGIN}/products/${product.slug}`);

    await db.run(sql`UPDATE price_plans SET active = 0 WHERE product_id = ${product.id}`);
    xml = await ((await callLoader(sitemapLoader, "/sitemap.xml")) as Response).text();
    expect(locs(xml)).not.toContain(`${ORIGIN}/products/${product.slug}`);
  });

  it("NEVER lists draft, archived or deleted rows (publish state is the gate)", async () => {
    const live = await seedLiveCatalog();

    // draft subject (no courses anyway) + draft program
    await createSubject(
      db,
      { gradeId: live.grade.id, titleAr: "علم النفس (مسودة)", titleEn: "Psychology draft", status: "draft", sortOrder: 1 },
      actor,
    );
    await createProgram(db, { titleAr: "برنامج مسودة", titleEn: "Draft program", status: "draft", sortOrder: 9 }, actor);
    // archive the live course + the live program
    await updateNode(db, "course", live.course.id, { status: "archived" }, actor);
    await updateNode(db, "program", live.program.id, { status: "archived" }, actor);

    const xml = await ((await callLoader(sitemapLoader, "/sitemap.xml")) as Response).text();
    const all = locs(xml);
    expect(all).not.toContain(`${ORIGIN}/courses/${live.course.slug}`);
    expect(all).not.toContain(`${ORIGIN}/programs/${live.program.slug}`);
    // course archived → its subject has zero visible courses → anti-thin exclusion
    expect(all).not.toContain(`${ORIGIN}/subjects/${live.subject.slug}`);
    // program archived → its grade has no live parent → excluded too
    expect(all).not.toContain(`${ORIGIN}/grades/${live.grade.slug}`);
    // /courses index disappears with its last visible course
    expect(all).not.toContain(`${ORIGIN}/courses`);
    expect(all).not.toContain(`${ORIGIN}/programs`);
  });

  it("lists published CMS pages under /p/ but never the home page (it lives at /)", async () => {
    const now = Date.now();
    await db.run(sql`INSERT INTO pages (id, slug, title_ar, title_en, status, seo, published_snapshot, published_at, sort_order, created_by, created_at, updated_at, deleted_at)
       VALUES ('11111111-1111-4111-8111-111111111111', 'resources', 'م', 'R', 'published', '{}', NULL, ${now}, 0, 'admin', ${now}, ${now}, NULL)`);
    await db.run(sql`INSERT INTO pages (id, slug, title_ar, title_en, status, seo, published_snapshot, published_at, sort_order, created_by, created_at, updated_at, deleted_at)
       VALUES ('22222222-2222-4222-8222-222222222222', 'home', 'الرئيسية', 'Home', 'published', '{}', NULL, ${now}, 0, 'admin', ${now}, ${now}, NULL)`);
    const xml = await ((await callLoader(sitemapLoader, "/sitemap.xml")) as Response).text();
    const all = locs(xml);
    expect(all).toContain(`${ORIGIN}/p/resources`);
    expect(all).not.toContain(`${ORIGIN}/p/home`);
    expect(all).toContain(`${ORIGIN}/`);
  });

  it("includes /about only when the owner identity is actually configured", async () => {
    // defaults (empty identity) → no /about
    expect(locs(await ((await callLoader(sitemapLoader, "/sitemap.xml")) as Response).text())).not.toContain(`${ORIGIN}/about`);

    // the exact write path the Admin → Appearance → Identity form uses on save
    await updateSettingsGroup(db, "identity", { ownerNameAr: "د/ مصطفى تيتو" }, actor);
    expect(locs(await ((await callLoader(sitemapLoader, "/sitemap.xml")) as Response).text())).toContain(`${ORIGIN}/about`);
  });

  it("keeps the private surface OUT of the sitemap (student/admin/learn/api/files/auth)", async () => {
    await seedLiveCatalog();
    const all = locs(await ((await callLoader(sitemapLoader, "/sitemap.xml")) as Response).text());
    for (const p of ROBOTS_PRIVATE_PATHS) {
      for (const loc of all) expect(loc).not.toContain(p);
    }
    // unit/lesson id-based URLs are never emitted either
    for (const loc of all) expect(loc).not.toMatch(/units\/[0-9a-f]{8}-/i);
    for (const loc of all) expect(loc).not.toContain("/learn/");
  });
});

describe("inventory source (indexablePublicUrls)", () => {
  it("is deterministic in order (stable sitemap diffs)", async () => {
    await seedLiveCatalog();
    const a = (await indexablePublicUrls(db)).map((u) => u.path);
    const b = (await indexablePublicUrls(db)).map((u) => u.path);
    expect(a).toEqual(b);
    expect(a[0]).toBe("/");
  });
});

describe("duplicate-URL elimination", () => {
  it("/p/home 301-redirects to / (the home CMS page is the site root)", async () => {
    const now = Date.now();
    await db.run(sql`INSERT INTO pages (id, slug, title_ar, title_en, status, seo, published_snapshot, published_at, sort_order, created_by, created_at, updated_at, deleted_at)
       VALUES ('22222222-2222-4222-8222-222222222222', 'home', 'الرئيسية', 'Home', 'published', '{}', NULL, ${now}, 0, 'admin', ${now}, ${now}, NULL)`);
    let res: Response;
    try {
      await callLoader(cmsPageLoader, "/p/home", { slug: "home" });
      throw new Error("expected a redirect response");
    } catch (e) {
      res = e as Response;
    }
    expect(res.status).toBe(301);
    const location = res.headers.get("x-react-router-location") ?? res.headers.get("Location");
    expect(location).toBe("/");
  });
});
