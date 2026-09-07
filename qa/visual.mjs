/**
 * Visual QA capture (local dev only) — real screenshots with the Playwright
 * registry Chromium (153) at the required matrix points, plus computed-style
 * facts (font stacks, dir/lang, switcher presence) recorded to report.json.
 * Screenshots land in qa-out/visual/ as artifacts.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, ensureAuth } from "./lib.mjs";

const OUT = "qa-out/visual";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const report = { browser: await browser.version(), shots: {} };

async function publicShot(name, locale, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: "edu_locale", value: locale, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const data = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const cs = (el) => (el ? getComputedStyle(el).fontFamily : null);
    return {
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      h1Font: cs(h1),
      bodyFont: cs(document.body),
      h1Text: h1?.textContent?.trim().slice(0, 70) ?? null,
      langSwitcherVisible: [...document.querySelectorAll("a,button")].some((el) => /^(English|العربية)$/.test(el.textContent.trim())),
      headerNav: [...document.querySelectorAll("header a")].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 8),
      socialIcons: document.querySelectorAll("footer a[aria-label], a[href*='twitter'], a[href*='facebook'], a[href*='youtube'], a[href*='instagram'], a[href*='whatsapp'], a[href*='t.me']").length,
      footerText: document.querySelector("footer")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
  report.shots[name] = data;
  console.log(`✓ ${name}: dir=${data.dir} lang=${data.lang} switcher=${data.langSwitcherVisible} overflow=${data.scrollWidth > data.clientWidth ? data.scrollWidth + ">" + data.clientWidth : "none"}`);
  await ctx.close();
  return { ctx, page };
}

// 1–4) homepage matrix
await publicShot("home-ar-desktop", "ar", 1440, 900);
await publicShot("home-en-desktop", "en", 1440, 900);
await publicShot("home-ar-mobile", "ar", 390, 844);
await publicShot("home-en-mobile", "en", 390, 844);

// 5) language switcher interaction: AR home → click English → expect LTR flip
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const before = await page.evaluate(() => document.documentElement.dir);
  const en = page.locator("a,button", { hasText: /^English$/ }).first();
  const clickable = (await en.count()) > 0;
  if (clickable) {
    await en.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(700);
  }
  const after = await page.evaluate(() => document.documentElement.dir);
  report.languageSwitcher = { before, clicked: clickable, after };
  console.log(`✓ language switcher: dir ${before} → ${after} (clicked=${clickable})`);
  await ctx.close();
}

// 6–10) admin surfaces (reuse the saved auth state from the final workflow run)
const a = await ensureAuth(browser, "admin", { locale: "en", viewport: { width: 1440, height: 900 } });
const page = a.page;
async function adminShot(name, path, { full = true, wait = 700 } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(`✓ ${name} (${path})`);
}
await adminShot("admin-cms", "/admin/cms");
await adminShot("admin-templates", "/admin/cms/templates");
await adminShot("admin-appearance", "/admin/appearance");
await adminShot("admin-media", "/admin/files");

// CMS page editor (seeded homepage) — page builder + rich text surface
await page.goto(`${BASE}/admin/cms`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const editLink = page.locator('a[href*="/admin/cms/pages/"]').first();
await editLink.click();
await page.waitForURL(/\/admin\/cms\/pages\/(?!new)/);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/admin-cms-editor.png`, fullPage: true });
report.shots["admin-cms-editor"] = { url: page.url() };
console.log(`✓ admin-cms-editor (${page.url().slice(BASE.length)})`);

// RTL admin CMS
await a.ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
await page.goto(`${BASE}/admin/cms`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/admin-cms-ar.png`, fullPage: true });
console.log("✓ admin-cms-ar (RTL)");
await a.ctx.addCookies([{ name: "edu_locale", value: "en", url: BASE }]);

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\nreport → ${OUT}/report.json | browser ${report.browser}`);
await browser.close();
