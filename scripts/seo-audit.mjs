#!/usr/bin/env node
/**
 * SEO forensic audit — HTTP sweep of public routes against a live worker.
 * Usage: node scripts/seo-audit.mjs [baseUrl]
 * Prints: status, title, meta description, canonical (tag+href), robots, og tags,
 *         hreflang, JSON-LD blocks, h1 count/text, external links, for each route.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";

const routes = [
  "/",
  "/courses",
  "/programs",
  "/programs/al-Thanawiya-al-3amma",
  "/subjects/physics-3s",
  "/courses/physics-3s-full",
  "/courses/physics-3s-full/units/PROBE",
  "/learn/physics-3s-full/electrostatics-intro",
  "/products/physics-3s-full-access",
  "/p/resources",
  "/p/faq",
  "/p/contact",
  "/p/nonexistent-page",
  "/login",
  "/register",
  "/forgot-password",
  "/dashboard",
  "/admin",
  "/sitemap.xml",
  "/robots.txt",
  "/no-such-route",
  "/courses?sort=latest",
];

const UA = "Mozilla/5.0 (compatible; SEOAudit/1.0)";

function getAttr(tagRe, html, attr) {
  const m = html.match(tagRe);
  if (!m) return null;
  const a = html.slice(m.index).match(new RegExp(`${attr}="([^"]*)"`, "i"));
  return a ? a[1] : null;
}

for (const path of routes) {
  const url = BASE + path;
  let res;
  try {
    res = await fetch(url, { headers: { "user-agent": UA }, redirect: "manual" });
  } catch (e) {
    console.log(`\n${path} → FETCH ERROR ${e.message}`);
    continue;
  }
  const html = res.headers.get("content-type")?.includes("html") ? await res.text() : "";
  const status = res.status;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/gi) || []).length > 0
    ? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim()
    : null;
  const desc = getAttr(/<meta[^>]+name=["']description["'][^>]*>/i, html, "content");
  const canonicalTag = (html.match(/<(link|meta)[^>]+rel=["']canonical["'][^>]*>/i) || [])[0] || null;
  const canonicalHref = getAttr(/<(link|meta)[^>]+rel=["']canonical["'][^>]*>/i, html, "href");
  const robots = getAttr(/<meta[^>]+name=["']robots["'][^>]*>/i, html, "content");
  const ogTitle = getAttr(/<meta[^>]+property=["']og:title["'][^>]*>/i, html, "content");
  const ogType = getAttr(/<meta[^>]+property=["']og:type["'][^>]*>/i, html, "content");
  const ogImage = getAttr(/<meta[^>]+property=["']og:image["'][^>]*>/i, html, "content");
  const hreflangCount = (html.match(/hreflang="/gi) || []).length;
  const jsonLd = (html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []).length;
  const h1s = (html.match(/<h1[\s>]/gi) || []).length;
  const h1First = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 80) || null;
  const loc = res.headers.get("location");

  console.log(`\n===== ${path} → ${status}${loc ? ` → ${loc}` : ""}`);
  console.log(`  title:    ${title ?? "∅"}`);
  console.log(`  desc:     ${desc ? desc.slice(0, 120) : "∅"}`);
  console.log(`  canonical: ${canonicalTag ? canonicalTag.replace(/\s+/g, " ").slice(0, 120) : "∅"}${canonicalHref ? "" : ""}`);
  console.log(`  robots:   ${robots ?? "∅"}`);
  console.log(`  og:title: ${ogTitle ?? "∅"} | og:type: ${ogType ?? "∅"} | og:image: ${ogImage ?? "∅"}`);
  console.log(`  hreflang: ${hreflangCount} | json-ld: ${jsonLd} | h1: ${h1s} (${h1First ?? ""})`);
}
console.log("\nDone.");
