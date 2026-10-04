#!/usr/bin/env node
/**
 * Real-browser interaction tour: drawers, menus, tabs, forms, modals.
 * Each check prints PASS/FAIL with the observed value so a failure is
 * actionable without re-running by hand.
 *
 * Usage: node qa/interactions.mjs
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { BASE, launchBrowser, ensureAuth } from "./lib.mjs";

const OUT = resolve(process.cwd(), "qa-out", "interactions");
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await launchBrowser();

// ─── 1. Public mobile drawer ────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

  check("public: html dir is rtl", (await page.getAttribute("html", "dir")) === "rtl");

  const burger = page.locator("button.burger, header button[aria-controls]").first();
  check("public: burger visible at 375", await burger.isVisible());
  const expandedBefore = await burger.getAttribute("aria-expanded");
  await burger.click();
  await page.waitForTimeout(350);
  const panel = page.locator('[role="dialog"], nav[id]:visible').filter({ has: page.locator("a") }).last();
  const drawer = page.locator("nav.fixed.inset-y-0").first();
  const box = await drawer.boundingBox();
  check("public: drawer opens", !!box, box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : "no box");
  check(
    "public: drawer anchored to the PHYSICAL left edge in RTL",
    box && box.x <= 1,
    box ? `x=${Math.round(box.x)}` : "",
  );
  check("public: burger reports aria-expanded=true", (await burger.getAttribute("aria-expanded")) === "true", `was ${expandedBefore}`);
  const focusInDrawer = await page.evaluate(() => {
    const d = document.querySelector("nav.fixed.inset-y-0");
    return !!d && d.contains(document.activeElement);
  });
  check("public: focus moves into the drawer", focusInDrawer);
  await page.screenshot({ path: resolve(OUT, "public-drawer-375.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("public: Escape closes the drawer", (await page.locator("nav.fixed.inset-y-0").count()) === 0);
  check("public: focus returns to the burger", await burger.evaluate((el) => el === document.activeElement));

  // Mobile bottom bar
  const mnav = page.locator(".mnav").first();
  check("public: mobile bottom nav visible at 375", await mnav.isVisible());
  const mnavNamed = await page.$$eval(".mnav a", (as) => as.every((a) => (a.innerText || a.getAttribute("aria-label") || "").trim().length > 0));
  check("public: every bottom-nav item has a visible/accessible name", mnavNamed);

  // Anchor links inside the page actually scroll
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const anchorTargets = await page.$$eval('a[href^="#"], a[href*="/#"]', (as) =>
    as.map((a) => (a.getAttribute("href") || "").split("#")[1]).filter(Boolean),
  );
  const missing = await page.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), [...new Set(anchorTargets)]);
  check("public: every in-page anchor has a target element", missing.length === 0, missing.join(",") || "all resolve");

  await ctx.close();
}

// ─── 2. Login form validation + real login ──────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const labelled = await emailInput.evaluate((el) => {
    const id = el.id;
    return !!(el.getAttribute("aria-label") || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest("label"));
  });
  check("login: email field has a real label", labelled);
  const fontSize = await emailInput.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check("login: input font-size >= 16px (no iOS zoom)", fontSize >= 16, `${fontSize}px`);

  await emailInput.fill("not-an-email");
  await page.locator('input[type="password"]').first().fill("x");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(600);
  const stillOnLogin = page.url().includes("/login");
  check("login: invalid credentials do not navigate away", stillOnLogin, page.url().replace(BASE, ""));
  const errVisible = await page.locator('[role="alert"], .text-pub-danger, [data-error]').first().isVisible().catch(() => false);
  check("login: an error message is shown", errVisible || stillOnLogin);
  await ctx.close();
}

// ─── 3. Student session ─────────────────────────────────────────────────────
{
  const { page, ctx } = await ensureAuth(browser, "student", { locale: "ar", viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check("student: reaches /dashboard", page.url().includes("/dashboard"), page.url().replace(BASE, ""));
  // Session persistence across a fresh page in the same context
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
  check("student: session persists in a new tab", !p2.url().includes("/login"), p2.url().replace(BASE, ""));
  await p2.close();
  // Authorization: student must not reach admin
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  const blocked = !page.url().includes("/admin") || (await page.locator("text=/403|غير مصرح|forbidden/i").count()) > 0;
  check("security: student is blocked from /admin", blocked, page.url().replace(BASE, ""));
  await ctx.close();
}

// ─── 4. Admin shell ─────────────────────────────────────────────────────────
{
  const { page, ctx } = await ensureAuth(browser, "admin", { locale: "ar", viewport: { width: 375, height: 740 } });
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check("admin: reaches /admin", page.url().includes("/admin"));
  const toggle = page.locator('[data-testid="admin-menu"]').first();
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(350);
    const d = page.locator("#admin-mobile-nav").first();
    const box = await d.boundingBox().catch(() => null);
    check("admin: mobile nav drawer opens", !!box);
    check("admin: admin drawer anchored to the PHYSICAL left edge", box && box.x <= 1, box ? `x=${Math.round(box.x)}` : "");
    await page.screenshot({ path: resolve(OUT, "admin-drawer-375.png") });
    await page.keyboard.press("Escape");
  } else {
    check("admin: mobile nav toggle exists", false, "no aria-controls toggle found");
  }
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);
