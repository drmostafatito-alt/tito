#!/usr/bin/env node
/**
 * Crawl every internal link reachable from a set of seed routes and report the
 * HTTP status of each destination, plus any link that has no usable
 * destination at all (`#`, empty, `javascript:`).
 *
 * This is the "every link actually goes somewhere" check: the per-page audit
 * (qa/product-audit.mjs) only sees the links on the page it is looking at,
 * while this walks the whole reachable graph for a given role.
 *
 * Usage:
 *   node qa/link-crawl.mjs --who=anon --seeds=/,/study,/about [--max=120]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE, launchBrowser, ensureAuth } from "./lib.mjs";

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const who = arg("who", "anon");
const seeds = arg("seeds", "/").split(",").filter(Boolean);
const max = Number(arg("max", "150"));
const OUT = resolve(process.cwd(), "qa-out", `links-${who}`);
mkdirSync(OUT, { recursive: true });

// Destinations that intentionally mutate state or leave the app; we record the
// link but never navigate to it during a crawl.
const NO_FOLLOW = /^\/(logout|set-locale)|^\/files\/|^\/api\//;

const browser = await launchBrowser();
let page, ctx;
if (who === "anon") {
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
  page = await ctx.newPage();
} else {
  ({ page, ctx } = await ensureAuth(browser, who, { locale: "ar", viewport: { width: 1280, height: 900 } }));
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
}

const queue = [...seeds];
const seen = new Set(seeds);
const pages = [];
const dead = [];
const external = new Map();

while (queue.length && pages.length < max) {
  const route = queue.shift();
  let status = 0;
  let links = [];
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    status = resp ? resp.status() : 0;
    await page.waitForTimeout(120);
    links = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll("a")) {
        const r = a.getBoundingClientRect();
        const cs = getComputedStyle(a);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const href = a.getAttribute("href");
        const label = (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 50);
        out.push({ href, label, hidden: r.width === 0 && r.height === 0 });
      }
      return out;
    });
  } catch (e) {
    status = `ERR ${String(e).slice(0, 80)}`;
  }
  pages.push({ route, status, links: links.length });

  for (const l of links) {
    const h = l.href;
    if (h == null || h === "" || h === "#" || h.startsWith("javascript:")) {
      dead.push({ on: route, label: l.label, href: h });
      continue;
    }
    if (/^(https?:)?\/\//i.test(h) && !h.startsWith(BASE)) {
      external.set(h, (external.get(h) || new Set()).add(route));
      continue;
    }
    if (h.startsWith("mailto:") || h.startsWith("tel:") || h.startsWith("#")) continue;
    let path = h.startsWith(BASE) ? h.slice(BASE.length) : h;
    path = path.split("#")[0];
    if (!path.startsWith("/")) continue;
    if (NO_FOLLOW.test(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    queue.push(path);
  }
}

const bad = pages.filter((p) => typeof p.status !== "number" || p.status >= 400);
const lines = [];
lines.push(`# Link crawl · ${who} · ${pages.length} pages visited`);
lines.push("");
lines.push(`## Broken destinations (${bad.length})`);
for (const b of bad) lines.push(`- ${b.route} → ${b.status}`);
lines.push("");
lines.push(`## Links with no destination (${dead.length})`);
for (const d of dead) lines.push(`- on ${d.on}: "${d.label}" href=${JSON.stringify(d.href)}`);
lines.push("");
lines.push(`## External destinations (${external.size})`);
for (const [h, froms] of external) lines.push(`- ${h}  ← ${[...froms].join(", ")}`);
lines.push("");
lines.push(`## All pages`);
for (const p of pages.sort((a, b) => String(a.route).localeCompare(String(b.route)))) {
  lines.push(`- ${p.status}  ${p.route}  (${p.links} links)`);
}
const md = lines.join("\n");
writeFileSync(resolve(OUT, "links.md"), md);
writeFileSync(resolve(OUT, "links.json"), JSON.stringify({ pages, dead, external: [...external].map(([h, f]) => ({ href: h, from: [...f] })) }, null, 2));
console.log(md);
console.log(`\n→ ${OUT}`);
await browser.close();
process.exit(bad.length || dead.length ? 1 : 0);
