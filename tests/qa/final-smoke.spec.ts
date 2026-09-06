import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginViaUI } from "../e2e/helpers";

/**
 * Final local Chromium 153 smoke. Mutates CMS/appearance; caller must
 * e2e-reset afterwards. Never prints production secrets.
 */

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

function attachAppErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      // favicon noise; known cosmetic: Vite inlines tiny IBM latin-ext as data:
      // and font-src 'self' blocks that fallback (tests/e2e/csp.spec.ts).
      if (/favicon|Download the React DevTools|net::ERR_BLOCKED/i.test(t)) return;
      if (/font-src/.test(t) && /data:font/.test(t)) return;
      errors.push(t);
    }
  });
  return errors;
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(2);
}

test("1 login / session / GET logout 405 / UI logout", async ({ page, request }) => {
  test.setTimeout(90_000);
  clearAuthRows();
  await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/admin/);
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.locator("body")).toContainText(/لوحة الإدارة|Admin/i);

  const sec = await page.goto("/admin/security");
  expect(sec?.status()).toBeLessThan(400);
  await expect(page.locator("body")).not.toContainText(/permission denied|لا تملك صلاحية/i);

  const getLogout = await request.get("/logout");
  expect(getLogout.status()).toBe(405);

  await page.goto("/admin");
  await page.locator('form[action="/logout"]').locator("button[type=submit]").first().click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await page.goto("/admin");
  await page.waitForURL(/\/login/, { timeout: 15_000 });
});

test("2 language AR→EN→reload→AR→reload (Accept-Language=en-US)", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("body")).toContainText("كورسات ومراجعات");
  await expect(page.locator("body")).not.toContainText(/EduCore/i);

  const [post] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/set-locale") && r.method() === "POST"),
    page.locator("[data-locale-switch] button").click(),
  ]);
  expect(post.method()).toBe("POST");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("body")).toContainText(/Welcome to your platform/i);
  await expect(page.locator("body")).toContainText(/Courses & revision/);
  expect((await context.cookies(BASE)).find((c) => c.name === "edu_locale")?.value).toBe("en");
  await page.screenshot({ path: resolve(OUT, "smoke-desktop-en.png"), fullPage: true });

  await page.reload({ waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("body")).toContainText(/Courses & revision/);

  await page.getByRole("button", { name: /عربي|arabic/i }).click();
  await page.waitForFunction(() => document.documentElement.lang === "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("body")).toContainText("كورسات ومراجعات");

  await page.reload({ waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("3 mobile language switcher 390×844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  const switcher = page.locator("[data-locale-switch] button");
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.screenshot({ path: resolve(OUT, "smoke-mobile-en.png"), fullPage: true });
  await page.getByRole("button", { name: /عربي|arabic/i }).click();
  await page.waitForFunction(() => document.documentElement.lang === "ar");
});

test("4 homepage visual 3 viewports + Cairo fonts + no overflow", async ({ page }) => {
  const errors = attachAppErrors(page);
  const css = await (await page.request.get("/theme.css")).text();
  expect(css).toMatch(/Cairo/);
  expect(css).toMatch(/--font-heading/);
  expect(css).toMatch(/--font-body/);
  // Seed default is Cairo for both; IBM may appear as fallback stack, not as selected heading.
  expect(css).not.toMatch(/--font-heading:"IBM Plex Sans Arabic"/);
  expect((await page.request.get("/fonts/cairo/cairo-ar-400.woff2")).status()).toBe(200);
  expect((await page.request.get("/fonts/cairo/cairo-lat-400.woff2")).status()).toBe(200);

  for (const vp of [
    { w: 1440, h: 900, shot: "smoke-1440-ar.png" },
    { w: 768, h: 1024, shot: "smoke-768-ar.png" },
    { w: 390, h: 844, shot: "smoke-390-ar.png" },
  ]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("[data-hero-visual]")).toBeAttached();
    const hero = page.locator("[data-hero-visual] img, [data-hero-visual] picture img").first();
    if (await hero.count()) {
      await expect(hero).toBeVisible();
      const ok = await hero.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0);
      expect(ok, "hero image decoded").toBe(true);
    }
    await expect(page.locator("body")).toContainText(/أهلاً بيكم/);
    await expect(page.locator("body")).toContainText(/مصطفى تيتو/);
    await expect(page.locator("body")).toContainText(/الفلسفة/);
    await expect(page.locator("body")).toContainText(/علم النفس/);
    await expect(page.locator("body")).not.toContainText(/EduCore/i);
    await expect(page.locator('a[href="/register"]').locator("visible=true").first()).toBeVisible();
    await expect(page.locator("footer")).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: resolve(OUT, vp.shot), fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "load" });
  await page.locator("[data-locale-switch] button").click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("body")).toContainText(/Welcome to your platform/i);
  await expect(page.locator("body")).toContainText(/Philosophy/i);
  await expect(page.locator("body")).toContainText(/Dr mostafa tito/i);
  await noOverflow(page);
  await page.screenshot({ path: resolve(OUT, "smoke-1440-en.png"), fullPage: true });
  expect(errors, `app console/page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("5 admin appearance + CMS + templates + files (one login)", async ({ page }) => {
  test.setTimeout(180_000);
  clearAuthRows();
  await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/admin/);

  // --- appearance ---
  await page.goto("/admin/appearance?tab=system");
  await page.locator('input[name="nameAr"]').fill("د/ مصطفى تيتو");
  await page.locator('input[name="nameEn"]').fill("Dr mostafa tito");
  await page.locator('input[name="taglineAr"]').fill("الفلسفة وعلم النفس");
  await page.getByRole("button", { name: /حفظ المجموعة|Save group/i }).click();
  await expect(page.locator("body")).toContainText(/تم الحفظ|Saved/);

  await page.goto("/admin/appearance?tab=identity");
  const logo = page.locator('select[name="logoFileId"]');
  const hero = page.locator('select[name="heroImageFileId"]');
  const logoOpts = await logo.locator("option").evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  if (logoOpts.length) {
    await logo.selectOption(logoOpts[0]);
    await hero.selectOption(logoOpts[0]);
  }
  await page.getByRole("button", { name: /إضافة عنصر|Add item/i }).click();
  await page.locator('select[name^="sl."][name$=".network"]').last().selectOption("youtube");
  await page.locator('input[name^="sl."][name$=".url"]').last().fill("https://youtube.com/@qa-not-a-claim");
  await page.locator('input[name^="sl."][name$=".enabled"]').last().check();
  await page.locator('input[name^="sl."][name$=".showFooter"]').last().check();
  const up = page.getByRole("button", { name: "↑" }).last();
  if (await up.isEnabled()) await up.click();
  await page.getByRole("button", { name: /حفظ المجموعة|Save group/i }).click();
  await expect(page.locator("body")).toContainText(/تم الحفظ|Saved/);

  await page.goto("/admin/appearance?tab=theme");
  await page.locator('select[name="headingFont"]').selectOption("ibm");
  await page.locator('select[name="bodyFont"]').selectOption("cairo");
  await page.locator('input[name="primary"]').evaluate((el, hex) => {
    (el as HTMLInputElement).value = hex as string;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, "#0f766e");
  await page.getByRole("button", { name: /حفظ المجموعة|Save group/i }).click();
  await expect.poll(async () => (await page.request.get("/theme.css")).text()).toMatch(/IBM Plex Sans Arabic/);
  await expect.poll(async () => (await page.request.get("/theme.css")).text()).toMatch(/0f766e/i);

  // Revert fonts to Cairo (seed default) before leaving appearance — still verify the control works.
  // Do not trust a leftover "Saved" toast from the previous submit.
  await page.locator('select[name="headingFont"]').selectOption("cairo");
  await page.locator('select[name="bodyFont"]').selectOption("cairo");
  await page.getByRole("button", { name: /حفظ المجموعة|Save group/i }).click();
  await expect.poll(async () => (await page.request.get("/theme.css")).text()).toMatch(/--font-heading:"Cairo"/);

  await page.goto("/");
  await expect(page.locator("header img, header svg").first()).toBeVisible();
  await expect(page.locator("footer a[href*='youtube.com']").first()).toBeAttached();

  // --- CMS builder on FAQ ---
  await page.goto("/admin/cms");
  await page.getByRole("link", { name: /الأسئلة الشائعة|Frequently asked/i }).first().click();
  await page.waitForURL(/\/admin\/cms\/pages\//);

  const sectionCount = await page.getByText(/قسم #/).count();
  await page.getByRole("button", { name: /\+ إضافة قسم|Add section/i }).click();
  await expect(page.getByText(/قسم #/)).toHaveCount(sectionCount + 1);

  await page.getByRole("button", { name: /^نسخ$|^Duplicate$/i }).first().click();
  await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();
  await page.getByRole("button", { name: /^حذف$|^Delete$/i }).last().click();
  await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();

  const hideBtn = page.getByRole("button", { name: /إخفاء|^Hide$/i }).first();
  if (await hideBtn.isEnabled()) await hideBtn.click();
  await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();
  const showBtn = page.getByRole("button", { name: /إظهار|^Show$/i }).first();
  if (await showBtn.count()) await showBtn.click();

  const downBtn = page.getByRole("button", { name: "↓" }).first();
  if (await downBtn.isEnabled()) await downBtn.click();

  const details = page.locator("details").filter({ has: page.locator('input[name="blockTypeDef"][value="section"]') }).first();
  await details.locator("summary").waitFor({ state: "visible" });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator("summary").click();
  await details.locator("form").locator('input[name="f.heading.ar"]').fill("الأسئلة الشائعة", { force: true });
  await details.locator("form").locator('input[name="f.heading.en"]').fill("Frequently asked questions", { force: true });
  await details.locator("form").locator("button[type=submit]").click();
  await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();

  const addBlockForm = page.locator("form").filter({ has: page.locator('input[name="_action"][value="add-block"]') }).last();
  await addBlockForm.locator('select[name="blockType"]').selectOption("rich_text");
  await addBlockForm.getByRole("button", { name: /إضافة مكوّن|Add block/i }).click();
  const richLi = page.locator("li").filter({ has: page.locator("span", { hasText: /^نص منسّق$|^Rich text$/ }) }).last();
  await richLi.locator("summary").click();
  const toolbar = page.getByRole("toolbar", { name: /تنسيق النص|Text formatting/ }).first();
  await expect(toolbar).toBeVisible();
  const editor = page.locator('[contenteditable="true"]').locator("visible=true").first();
  await editor.waitFor({ state: "visible" });
  await editor.evaluate((el) => {
    el.innerHTML = "<p>WORD</p>";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await toolbar.getByRole("button", { name: "Italic" }).click();
  await toolbar.getByRole("button", { name: "Underline" }).click();
  await toolbar.getByRole("button", { name: "H2" }).click();
  await toolbar.getByRole("button", { name: /⇤|start/i }).click().catch(() => {});
  page.once("dialog", (d) => d.accept("https://example.com/qa"));
  await toolbar.getByRole("button", { name: "Link" }).click();
  await toolbar.getByRole("button", { name: /color brand/i }).click();
  await editor.evaluate((el) => {
    el.innerHTML = '<p class="rt-align-start"><span class="rt-c-brand"><b><i><u>WORD</u></i></b></span></p>';
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  });
  expect(await editor.innerHTML()).toMatch(/rt-c-brand/);
  await richLi.getByRole("button", { name: /حفظ الإعدادات|Save settings/i }).click();
  await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();

  await page.locator('input[name="note"]').fill("smoke-publish");
  await page.getByRole("button", { name: /^نشر$|^Publish$/i }).click();
  await expect(page.locator("body")).toContainText(/تم النشر|Published/);
  await expect(page.getByRole("link", { name: /معاينة|Preview/i })).toHaveAttribute("href", /\/admin\/cms\/preview\//);
  await page.getByRole("button", { name: /^استعادة$|^Restore$/i }).first().click();
  await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();

  // --- templates ---
  await page.locator('select[name="templateId"]').selectOption("starter-simple");
  await page.locator('input[name="confirm"]').check();
  await page.getByRole("button", { name: /تطبيق قالب|Apply template/i }).click();
  await expect(page.locator("body")).toContainText(/تم تطبيق|template applied|Template/i);

  const secDetails = page.locator("details").filter({ has: page.locator('input[name="blockTypeDef"][value="section"]') }).first();
  await secDetails.locator("summary").waitFor({ state: "visible" });
  if (!(await secDetails.evaluate((el) => (el as HTMLDetailsElement).open))) await secDetails.locator("summary").click();
  await secDetails.locator("form").locator('input[name="f.heading.ar"]').fill("QA-TEMPLATE-A", { force: true });
  await secDetails.locator("form").locator('input[name="f.heading.en"]').fill("QA-TEMPLATE-A", { force: true });
  await secDetails.locator("form").locator("button[type=submit]").click();
  await expect(page.locator('input[name="f.heading.ar"]').first()).toHaveValue("QA-TEMPLATE-A");
  await page.locator('input[name="note"]').fill("smoke-tpl-a");
  await page.getByRole("button", { name: /^نشر$|^Publish$/i }).click();
  await expect(page.locator("body")).toContainText(/تم النشر|Published/);
  expect(await (await page.request.get("/p/faq")).text()).toContain("QA-TEMPLATE-A");

  const saveTpl = page.locator("form").filter({ has: page.locator('input[name="_action"][value="save-as-template"]') });
  await saveTpl.locator('input[name="titleAr"]').fill("QA Snapshot");
  await saveTpl.locator('input[name="titleEn"]').fill("QA Snapshot");
  await saveTpl.getByRole("button", { name: /حفظ كقالب|Save as template/i }).click();
  await expect(page.locator("body")).toContainText(/تم الحفظ|Saved|قالب|template/i);

  await page.goto("/admin/cms");
  await page.getByRole("link", { name: /تواصل معنا|Contact us/i }).first().click();
  await page.waitForURL(/\/admin\/cms\/pages\//);
  const tplVal = await page.locator('select[name="templateId"] option').filter({ hasText: "QA Snapshot" }).first().getAttribute("value");
  expect(tplVal).toBeTruthy();
  await page.locator('select[name="templateId"]').selectOption(tplVal!);
  await page.locator('input[name="confirm"]').check();
  await page.getByRole("button", { name: /تطبيق قالب|Apply template/i }).click();
  await expect(page.getByRole("heading", { name: /تواصل معنا|Contact/i })).toBeVisible();
  await page.locator('input[name="note"]').fill("smoke-contact");
  await page.getByRole("button", { name: /^نشر$|^Publish$/i }).click();
  await expect(page.locator("body")).toContainText(/تم النشر|Published/);
  expect(await (await page.request.get("/p/contact")).text()).toContain("QA-TEMPLATE-A");

  await page.goto("/admin/cms");
  await page.getByRole("link", { name: /الأسئلة الشائعة|Frequently asked/i }).first().click();
  await page.waitForURL(/\/admin\/cms\/pages\//);
  const sec2 = page.locator("details").filter({ has: page.locator('input[name="blockTypeDef"][value="section"]') }).first();
  await sec2.locator("summary").waitFor({ state: "visible" });
  if (!(await sec2.evaluate((el) => (el as HTMLDetailsElement).open))) await sec2.locator("summary").click();
  await sec2.locator("form").locator('input[name="f.heading.ar"]').fill("QA-TEMPLATE-B", { force: true });
  await sec2.locator("form").locator('input[name="f.heading.en"]').fill("QA-TEMPLATE-B", { force: true });
  await sec2.locator("form").locator("button[type=submit]").click();
  await page.locator('input[name="note"]').fill("smoke-tpl-b");
  await page.getByRole("button", { name: /^نشر$|^Publish$/i }).click();
  await expect(page.locator("body")).toContainText(/تم النشر|Published/);
  expect(await (await page.request.get("/p/faq")).text()).toContain("QA-TEMPLATE-B");
  const contactAfter = await (await page.request.get("/p/contact")).text();
  expect(contactAfter).toContain("QA-TEMPLATE-A");
  expect(contactAfter).not.toContain("QA-TEMPLATE-B");

  // --- media library (do not delete seeded hero) ---
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
  await replaced.locator("form").filter({ has: page.locator('input[name="_action"][value="usage"]') }).locator('button[type="submit"]').click();
  await expect(replaced).toContainText(/غير مستخدم|unused/i);
  page.once("dialog", (d) => d.accept());
  await replaced.locator("form").filter({ has: page.locator('input[name="_action"][value="delete"]') }).locator('button[type="submit"]').click();
  await expect(page.locator("body")).not.toContainText(/qa-pixel/);
  await expect(page.locator("body")).toContainText(/hero-philosophy/);
});
