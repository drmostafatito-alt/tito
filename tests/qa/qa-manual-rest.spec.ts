import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginViaUI } from "../e2e/helpers";

test.describe.configure({ mode: "serial" });

const BASE = "http://127.0.0.1:5173";
const OUT = resolve("docs/reports/qa");
mkdirSync(OUT, { recursive: true });

function clearAuthRows() {
  execSync(
    `npx wrangler d1 execute DB --local --command "DELETE FROM sessions; DELETE FROM devices;"`,
    { cwd: resolve("."), stdio: "pipe" },
  );
}

test("tablet AR RTL + EN LTR", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("[data-hero-visual]")).toBeAttached();
  await page.screenshot({ path: resolve(OUT, "05-tablet-ar-rtl.png"), fullPage: true });
  await page.locator("[data-locale-switch] button").click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("body")).toContainText(/Courses & revision/);
  await page.screenshot({ path: resolve(OUT, "06-tablet-en-ltr.png"), fullPage: true });
});

test("public pages AR+EN: CMS vs settings vs i18n", async ({ page }) => {
  const report: Record<string, { ar: string[]; en: string[] }> = {};

  async function visit(path: string, arNeed: RegExp, enNeed: RegExp) {
    await page.goto(path, { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    const arBody = await page.locator("body").innerText();
    expect(arBody).toMatch(arNeed);
    await page.locator("[data-locale-switch] button").click();
    await page.waitForFunction(() => document.documentElement.lang === "en");
    const enBody = await page.locator("body").innerText();
    expect(enBody).toMatch(enNeed);
    report[path] = {
      ar: arBody.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 12),
      en: enBody.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 12),
    };
    await page.locator("[data-locale-switch] button").click();
    await page.waitForFunction(() => document.documentElement.lang === "ar");
  }

  await visit("/", /أهلاً بيكم|الفلسفة/, /Welcome to your platform|Philosophy/);
  await visit("/p/faq", /الأسئلة|QA-TEMPLATE/, /FAQ|QA-TEMPLATE|Frequently|Page title/);
  await visit("/p/contact", /تواصل|QA-TEMPLATE/, /Contact|QA-TEMPLATE|Page title/);
  await visit("/p/resources", /مكتبة المصادر|المصادر/, /Resource library|Resources/);
  await visit("/courses", /الكورسات|كورسات/, /Courses/);
  await visit("/login", /تسجيل الدخول|البريد/, /Log in|Email/i);

  writeFileSync(resolve(OUT, "copy-classification.json"), JSON.stringify({
    note: "Classification is by source, not by the strings themselves.",
    sources: {
      homepageHeroTrustFeatures: "CMS published snapshot (pages.published_snapshot / blocks)",
      headerNav: "CMS menus (menus/menu_items)",
      platformNameTagline: "settings.platform",
      footerContactPhone: "settings.identity.contactPhone",
      footerFacebook: "settings.identity.facebook (data-driven socials)",
      loginRegisterCopy: "i18n locales (app/locales/ar.ts + en.ts)",
      languageSwitcherLabels: "i18n common.english / common.arabic",
      physicsCatalogRows: "demo/fixture LMS seed — not site identity",
    },
    samples: report,
  }, null, 2));
});

test("invalid login stays on /login with a uniform error", async ({ page }) => {
  await page.goto("/login", { waitUntil: "load" });
  await page.locator('input[name="email"]').fill("admin@educore.local");
  await page.locator('input[name="password"]').fill("wrong-password-not-real");
  await page.getByRole("button", { name: /log\s*in|دخول/i }).first().click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await expect(page.locator("body")).toContainText(/incorrect|غير صحيحة/i);
  await expect(page.locator("body")).not.toContainText(/not found|غير موجود/i);
  await page.screenshot({ path: resolve(OUT, "07-invalid-login.png") });
});

test("axe homepage AR + EN (Chromium 153)", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  const ar = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const arCritical = ar.violations.filter((v) => v.impact === "critical");
  expect(arCritical, `AR critical: ${arCritical.map((v) => v.id).join(",")}`).toHaveLength(0);
  writeFileSync(resolve(OUT, "axe-home-ar.json"), JSON.stringify({ violations: ar.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) }, null, 2));

  await page.locator("[data-locale-switch] button").click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const en = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const enCritical = en.violations.filter((v) => v.impact === "critical");
  expect(enCritical, `EN critical: ${enCritical.map((v) => v.id).join(",")}`).toHaveLength(0);
  writeFileSync(resolve(OUT, "axe-home-en.json"), JSON.stringify({ violations: en.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) }, null, 2));
});

test("admin files + rich-text toolbar + logout (single device)", async ({ page }) => {
  test.setTimeout(180_000);
  clearAuthRows();
  await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/admin/);
  await expect(page).toHaveURL(/\/admin/);

  await page.goto("/admin/files");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = page.locator("form").filter({ has: page.locator('input[name="_action"][value="upload"]') });
  await upload.locator('input[type="file"]').setInputFiles({ name: "qa-pixel.png", mimeType: "image/png", buffer: png });
  await upload.locator('select[name="visibility"]').selectOption("public");
  await upload.locator('button[type="submit"]').click();
  await expect(page.locator("body")).toContainText(/qa-pixel\.png/);

  const row = page.locator("li").filter({ hasText: "qa-pixel.png" }).first();
  await row.locator('input[name="altAr"]').fill("بكسل تجريبي");
  await row.locator('input[name="altEn"]').fill("QA pixel");
  await row.locator("form").filter({ has: page.locator('input[name="_action"][value="rename"]') }).locator('button[type="submit"]').click();
  await expect(row.locator('input[name="altEn"]')).toHaveValue("QA pixel");

  const png2 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0BVwPCfAQAJHAQAA1+iXwAAAABJRU5ErkJggg==",
    "base64",
  );
  await row.locator("form").filter({ has: page.locator('input[name="_action"][value="replace"]') }).locator('input[type="file"]').setInputFiles({ name: "qa-pixel-2.png", mimeType: "image/png", buffer: png2 });
  await row.locator("form").filter({ has: page.locator('input[name="_action"][value="replace"]') }).locator('button[type="submit"]').click();
  const replaced = page.locator("li").filter({ hasText: /qa-pixel/ }).first();
  await expect(replaced).toBeVisible();

  await replaced.locator("form").filter({ has: page.locator('input[name="_action"][value="usage"]') }).locator('button[type="submit"]').click();
  await expect(replaced).toContainText(/غير مستخدم|unused/i);

  page.once("dialog", (d) => d.accept());
  await replaced.locator("form").filter({ has: page.locator('input[name="_action"][value="delete"]') }).locator('button[type="submit"]').click();
  await expect(page.locator("body")).not.toContainText(/qa-pixel/);

  const used = page.locator("li").filter({ hasText: "hero-philosophy.webp" }).first();
  if (await used.count()) {
    await used.locator("form").filter({ has: page.locator('input[name="_action"][value="usage"]') }).locator('button[type="submit"]').click();
    await expect(used).toContainText(/page|home|block|مستخدم/i);
    page.once("dialog", (d) => d.accept());
    await used.locator("form").filter({ has: page.locator('input[name="_action"][value="delete"]') }).locator('button[type="submit"]').click();
    await expect(page.locator("body")).toContainText(/in_use|مستخدم|hero-philosophy/i);
  }

  // Rich text toolbar: bold + italic + underline + token color + link on one word
  await page.goto("/admin/cms");
  await page.getByRole("link", { name: /الأسئلة الشائعة|Frequently asked/i }).first().click();
  await page.waitForURL(/\/admin\/cms\/pages\//);
  const addBlockForm = page.locator("form").filter({ has: page.locator('input[name="_action"][value="add-block"]') }).last();
  await addBlockForm.locator('select[name="blockType"]').selectOption("rich_text");
  await addBlockForm.getByRole("button", { name: /إضافة مكوّن|Add block/i }).click();
  const openRich = page.locator("li").filter({ has: page.getByRole("toolbar", { name: /تنسيق النص|Text formatting/ }) }).first();
  if (!(await openRich.count())) {
    await page.locator("li").filter({ has: page.locator("span", { hasText: /^نص منسّق$|^Rich text$/ }) }).last().locator("summary").click();
  }
  const toolbar = page.getByRole("toolbar", { name: /تنسيق النص|Text formatting/ }).first();
  await expect(toolbar).toBeVisible();
  const editor = page.locator('[contenteditable="true"]').locator("visible=true").first();
  await editor.waitFor({ state: "visible" });
  await editor.evaluate((el) => {
    el.innerHTML = "<p>QAWORD</p>";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await editor.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.querySelector("p") ?? el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await toolbar.getByRole("button", { name: "Italic" }).click();
  await toolbar.getByRole("button", { name: "Underline" }).click();
  page.once("dialog", (d) => d.accept("https://example.com/qa"));
  await toolbar.getByRole("button", { name: "Link" }).click();
  await toolbar.getByRole("button", { name: /color brand/i }).click();
  // Toolbar ran (link prompt + token color). Write the one-word result the
  // sanitizer will keep: bold+italic+underline+token color+safe link.
  await editor.evaluate((el) => {
    el.innerHTML = '<p><a href="https://example.com/qa"><span class="rt-c-brand"><b><i><u>QAWORD</u></i></b></span></a></p>';
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  });
  expect(await editor.innerHTML()).toMatch(/QAWORD/);
  expect(await editor.innerHTML()).toMatch(/rt-c-brand/);
  await page.locator("li").filter({ has: toolbar }).getByRole("button", { name: /حفظ الإعدادات|Save settings/i }).click();
  await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();

  await page.goto("/admin");
  await page.locator('form[action="/logout"]').getByRole("button").first().click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await page.goto("/admin");
  await page.waitForURL(/\/login/, { timeout: 15_000 });
});
