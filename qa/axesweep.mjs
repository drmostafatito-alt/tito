/**
 * Phase 3 full-surface axe sweep: every reachable admin/student/public page,
 * with admin detail pages auto-discovered from list links.
 * Run: node qa/axesweep.mjs   (requires dev server on :5173, fresh DB with seed)
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, ensureAuth } from "./lib.mjs";

const ADMIN_LIST_PAGES = [
  "/admin",
  "/admin/users",
  "/admin/content?type=subject",
  "/admin/content?type=course",
  "/admin/content?type=unit",
  "/admin/content?type=lesson",
  "/admin/assessment?tab=questions",
  "/admin/assessment?tab=exams",
  "/admin/assessment?tab=attempts",
  "/admin/commerce?tab=products",
  "/admin/commerce?tab=orders",
  "/admin/commerce?tab=payments",
  "/admin/commerce?tab=subscriptions",
  "/admin/commerce?tab=codes",
  "/admin/commerce?tab=discounts",
  "/admin/cms",
  "/admin/cms?tab=templates",
  "/admin/cms?tab=menus",
  "/admin/cms?tab=forms",
  "/admin/appearance",
  "/admin/files",
  "/admin/announcements",
  "/admin/analytics",
  "/admin/security",
  "/admin/audit",
  "/admin/entitlements",
  "/admin/videos",
];

const STUDENT_LIST_PAGES = [
  "/dashboard",
  "/courses",
  "/exams",
  "/orders",
  "/activate",
  "/notifications",
  "/profile",
  "/results",
];

const STUDENT_DETAIL_TRY = [
  "/courses/physics-3s-full",
  "/exams/electrostatics-check",
  "/learn/physics-3s-full",
];

const PUBLIC_PAGES = ["/", "/courses", "/p/faq", "/p/contact", "/p/resources", "/products/physics-3s-full-access", "/login"];

const DETAIL_PATTERNS = [
  /^\/admin\/users\/[0-9a-f-]{8,}/,
  /^\/admin\/content\/(subject|course|unit|lesson)\/[0-9a-f-]{8,}/,
  /^\/admin\/assessment\/(questions|exams|attempts)\/[0-9a-f-]{8,}/,
  /^\/admin\/commerce\/(products|orders|batches)\/[0-9a-f-]{8,}/,
  /^\/admin\/cms\/pages\/[0-9a-f-]{8,}/,
];

// login handled by ensureAuth (reuses saved device state — device policy)

async function auditPage(page, url, who, results) {
  const rec = { who, url };
  results.push(rec);
  try {
    await gotoStable(page, url);
    await page.waitForTimeout(350);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document, {
        rules: { "color-contrast-enhanced": { enabled: false } },
      });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        sample: v.nodes.slice(0, 4).map((n) => {
          const tgt = (n.target || []).join(" ");
          const summary = (n.failureSummary || "").split("\n").slice(0, 2).join(" | ");
          const html = (n.html || "").slice(0, 140);
          return `${tgt} :: ${html} :: ${summary}`;
        }),
      }));
    });
    rec.ok = violations.length === 0;
    rec.violations = violations;
    save(results);
    console.log(
      `${violations.length === 0 ? "✓" : "✗"} [${who}] ${url}${
        violations.length ? ` — ${violations.map((v) => `${v.id}×${v.nodes}`).join(", ")}` : ""
      }`
    );
  } catch (err) {
    rec.ok = false;
    rec.error = String(err).slice(0, 300);
    save(results);
    console.log(`! [${who}] ${url} — ${rec.error.split("\n")[0]}`);
  }
}

const axeSource = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

function save(results) {
  try {
    writeFileSync("qa-out/axesweep.json", JSON.stringify(results, null, 1));
  } catch {}
}

async function gotoStable(page, url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 25000 });
      return true;
    } catch (err) {
      lastErr = err;
      if (String(err).includes("ERR_CONNECTION_REFUSED")) {
        console.log(`  (server hiccup on ${url} — waiting 5s, retry ${i + 1}/${tries})`);
        await page.waitForTimeout(5000);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function run() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];

  // ---- admin session ----
  const admin = await ensureAuth(browser, "admin", { locale: "en", viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const adminCtx = admin.ctx;
  const ap = admin.page;
  const adminPages = [...ADMIN_LIST_PAGES];
  // pre-discover detail links from each list page in one pass (they'll be re-audited below)
  for (const url of ADMIN_LIST_PAGES) {
    try {
      await gotoStable(ap, url);
      const hrefs = await ap.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
      for (const h of hrefs) {
        if (DETAIL_PATTERNS.some((pat) => pat.test(h)) && !adminPages.includes(h)) {
          adminPages.push(h);
        }
      }
    } catch {}
  }
  console.log(`admin surface: ${adminPages.length} pages (incl. discovered details)`);
  for (const url of adminPages) await auditPage(ap, url, "admin", results);

  // ---- student session ----
  const stud = await ensureAuth(browser, "student", { locale: "en", viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const sp = stud.page;
  for (const url of STUDENT_LIST_PAGES) await auditPage(sp, url, "student", results);
  // discover dynamic student links from these pages
  const studentExtra = new Set();
  for (const url of STUDENT_LIST_PAGES) {
    try {
      await gotoStable(sp, url);
      const hrefs = await sp.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
      for (const h of hrefs) {
        if (
          /^\/(courses|exams|learn|orders|results|products)\//.test(h) &&
          !h.includes("?") &&
          !studentExtra.has(h)
        )
          studentExtra.add(h);
      }
    } catch {}
  }
  for (const url of studentExtra) await auditPage(sp, url, "student", results);

  // ---- public anonymous ----
  const pubCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const pp = await pubCtx.newPage();
  for (const url of PUBLIC_PAGES) await auditPage(pp, url, "public", results);
  await pp.close();

  await browser.close();

  const bad = results.filter((r) => !r.ok);
  console.log(`\n═══ TOTAL ${results.length} pages, ${bad.length} with findings ═══`);
  for (const b of bad) {
    console.log(`\n[${b.who}] ${b.url}`);
    if (b.error) console.log("  ERROR:", b.error);
    for (const v of b.violations || []) {
      console.log(`  ${v.id} (${v.impact}) ×${v.nodes}`);
      for (const s of v.sample) console.log("    →", s);
    }
  }
  writeFileSync("qa-out/axesweep.json", JSON.stringify(results, null, 1));
  console.log("\nwrote qa-out/axesweep.json");
  process.exit(bad.length ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
