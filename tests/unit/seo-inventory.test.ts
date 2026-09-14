import { describe, expect, it } from "vitest";
import { ROBOTS_PRIVATE_PATHS, robotsTxtBody, sitemapXml, type SitemapUrl } from "~server/seo/inventory.server";

/**
 * Pure-helper contracts for the crawl foundation (SEO Master Phase).
 * The DB-backed behaviour (published-only inventory) is covered in
 * tests/integration/seo-crawl.test.ts against real D1.
 */

const urls: SitemapUrl[] = [
  { path: "/", lastmodMs: null },
  { path: "/courses", lastmodMs: Date.UTC(2026, 0, 15) },
  { path: "/p/resources", lastmodMs: null },
];

describe("sitemapXml", () => {
  it("emits a well-formed sitemap 0.9 document with absolute locs", () => {
    const xml = sitemapXml(urls, "https://tito.example");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://tito.example/</loc>");
    expect(xml).toContain("<loc>https://tito.example/courses</loc>");
    // trailing slash on the origin must not double up
    expect(sitemapXml(urls, "https://tito.example/")).toContain("<loc>https://tito.example/courses</loc>");
    expect(xml.endsWith("</urlset>\n")).toBe(true);
  });

  it("formats lastmod as a UTC calendar date and omits it when unknown", () => {
    const xml = sitemapXml(urls, "https://tito.example");
    expect(xml).toContain("<lastmod>2026-01-15</lastmod>");
    // the home row (null lastmod) carries no lastmod element
    const homeEntry = xml.split("<url>")[1];
    expect(homeEntry).not.toContain("lastmod");
  });

  it("XML-escapes values so a hostile slug cannot break the document", () => {
    const xml = sitemapXml([{ path: "/p/a<b&c\"", lastmodMs: null }], "https://x.test");
    expect(xml).toContain("/p/a&lt;b&amp;c&quot;");
    expect(xml).not.toContain("/p/a<b&c\"");
  });

  it("handles an empty inventory (still valid document)", () => {
    const xml = sitemapXml([], "https://x.test");
    expect(xml).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    expect(xml.endsWith("</urlset>\n")).toBe(true);
    expect(xml).not.toContain("<url>");
  });

  it("never emits query strings or relative locs", () => {
    const xml = sitemapXml([{ path: "/courses", lastmodMs: null }], "https://x.test");
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    for (const loc of locs) {
      expect(loc).toMatch(/^https:\/\/x\.test\//);
      expect(loc).not.toContain("?");
    }
  });
});

describe("robotsTxtBody", () => {
  const body = robotsTxtBody("https://tito.example/sitemap.xml");

  it("points at an absolute sitemap URL", () => {
    expect(body).toContain("Sitemap: https://tito.example/sitemap.xml");
  });

  it("allows the site and disallows exactly the private surface", () => {
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    for (const p of ROBOTS_PRIVATE_PATHS) expect(body).toContain(`Disallow: ${p}`);
  });

  it("restricts the sensitive surfaces (auth, student, admin, learn, api, files, webhooks)", () => {
    for (const p of ["/admin/", "/dashboard", "/learn/", "/login", "/register", "/files/", "/api/", "/webhooks/", "/beacons/"]) {
      expect(ROBOTS_PRIVATE_PATHS).toContain(p);
    }
  });

  it("does NOT disallow the public educational surface", () => {
    for (const p of ["/courses", "/subjects", "/programs", "/grades", "/products", "/p/", "/about"]) {
      expect(body).not.toContain(`Disallow: ${p}`);
    }
  });

  it("has exactly one Sitemap directive", () => {
    expect(body.split("\n").filter((l) => l.startsWith("Sitemap:"))).toHaveLength(1);
  });
});
