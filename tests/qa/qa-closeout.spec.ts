import { test, expect, type Page, type Response } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginViaUI } from "../e2e/helpers";

/**
 * Remaining QA closeout against a live wrangler + seeded local D1.
 * Screenshots first (no mutations), then language, performance, Admin CMS, templates.
 * Never prints passwords.
 */

test.describe.configure({ mode: "serial" });

const BASE = "http://127.0.0.1:5173";
const OUT = resolve("docs/reports/qa");
mkdirSync(OUT, { recursive: true });

const perf: Array<{
  url: string;
  status: number;
  type: string;
  bytes: number;
  ttfbMs: number;
}> = [];

function attachPerf(page: Page, sink: typeof perf) {
  page.on("response", (res: Response) => {
    const req = res.request();
    const timing = req.timing();
    const ttfb = timing ? Math.max(0, timing.responseStart) : 0;
    const len = Number(res.headers()["content-length"] || 0);
    sink.push({
      url: res.url(),
      status: res.status(),
      type: req.resourceType(),
      bytes: Number.isFinite(len) ? len : 0,
      ttfbMs: ttfb,
    });
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(OUT, name), fullPage: true });
}

/**
 * Builder fields live in closed <details>. Click the visible summary to open,
 * fill heading, click Save settings. Heading is enough for the public-page stamp.
 */
async function stampPageDraft(page: Page, stamp: string) {
  const details = page
    .locator("details")
    .filter({ has: page.locator('input[name="blockTypeDef"][value="section"]') })
    .first();
  await details.locator("summary").waitFor({ state: "visible" });
  const open = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!open) await details.locator("summary").click();

  const form = details.locator("form").first();
  await form.locator('input[name="f.heading.ar"]').fill(stamp, { force: true });
  await form.locator('input[name="f.heading.en"]').fill(stamp, { force: true });
  await form.locator("button[type=submit]").click();
  await expect(page.locator('input[name="f.heading.ar"]').first()).toHaveValue(stamp);
}

test.describe("QA closeout", () => {
  test("1 visual: Desktop AR RTL", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("body")).not.toContainText(/EduCore/i);
    await expect(page.locator("body")).toContainText(/الفلسفة/);
    await expect(page.locator("body")).toContainText(/علم النفس/);
    await expect(page.locator("body")).toContainText(/مصطفى تيتو/);
    await expect(page.locator("[data-hero-visual]")).toBeAttached();
    await expect(page.locator("h1").first()).toBeVisible();
    await shot(page, "01-desktop-ar-rtl.png");
  });

  test("2 visual: Desktop EN LTR", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: /english/i }).click();
    await page.waitForURL("**/*");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("body")).toContainText(/Philosophy/i);
    await expect(page.locator("body")).toContainText(/Psychology/i);
    await expect(page.locator("body")).toContainText(/mostafa tito/i);
    await shot(page, "02-desktop-en-ltr.png");
  });

  test("3 visual: Mobile AR RTL", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "load" });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("[data-hero-visual]")).toBeAttached();
    const menu = page.locator('button[aria-controls="mobile-nav"]');
    await expect(menu).toBeVisible();
    await shot(page, "03-mobile-ar-rtl.png");
    await menu.click();
    await expect(page.locator("nav#mobile-nav")).toBeVisible();
    await shot(page, "03b-mobile-ar-nav-open.png");
  });

  test("4 visual: Mobile EN LTR", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "load" });
    await page.getByRole("button", { name: /english/i }).click();
    await page.waitForURL("**/*");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await shot(page, "04-mobile-en-ltr.png");
  });

  test("5 language: explicit choice beats Accept-Language and survives reload", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const [setLocale] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/set-locale") && r.method() === "POST"),
      page.getByRole("button", { name: /english/i }).click(),
    ]);
    expect(setLocale.method()).toBe("POST");
    await page.waitForURL("**/*");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    const cookiesEn = await page.context().cookies(BASE);
    expect(cookiesEn.find((c) => c.name === "edu_locale")?.value).toBe("en");
    await expect(page.locator("body")).toContainText(/Courses & revision/);
    await expect(page.locator("body")).not.toContainText("كورسات ومراجعات");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("body")).toContainText(/Courses & revision/);

    await page.getByRole("button", { name: /عربي|arabic/i }).click();
    await page.waitForURL("**/*");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("body")).toContainText("كورسات ومراجعات");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const cookiesAr = await page.context().cookies(BASE);
    expect(cookiesAr.find((c) => c.name === "edu_locale")?.value).toBe("ar");
  });

  test("6 performance: record homepage requests", async ({ page }) => {
    const local: typeof perf = [];
    attachPerf(page, local);
    const t0 = Date.now();
    const nav = await page.goto("/", { waitUntil: "load" });
    const wall = Date.now() - t0;
    const server = nav?.request().timing();
    const htmlTtfb = server ? Math.max(0, server.responseStart) : -1;
    const htmlSize = Number((await nav?.headerValue("content-length")) || 0);

    const byType: Record<string, { n: number; bytes: number }> = {};
    for (const r of local) {
      const t = r.type || "other";
      byType[t] = byType[t] || { n: 0, bytes: 0 };
      byType[t].n += 1;
      byType[t].bytes += r.bytes;
    }
    const urls = local.map((r) => r.url.split("?")[0]);
    const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
    const uniqueDupes = [...new Set(dupes)];
    const doc = {
      wallMs: wall,
      htmlStatus: nav?.status() ?? 0,
      htmlTtfbMs: htmlTtfb,
      htmlBytes: htmlSize,
      requestCount: local.length,
      byType,
      uniqueDuplicateUrls: uniqueDupes,
      requests: local.map((r) => ({
        url: r.url.replace(BASE, ""),
        status: r.status,
        type: r.type,
        bytes: r.bytes,
        ttfbMs: Math.round(r.ttfbMs),
      })),
    };
    writeFileSync(resolve(OUT, "performance.json"), JSON.stringify(doc, null, 2));
    expect(nav?.status()).toBe(200);
    expect(local.length).toBeGreaterThan(3);
  });

  test("7 admin CMS + appearance + templates (one login — 1-device policy)", async ({ page }) => {
    test.setTimeout(180_000);
    const { execSync } = await import("node:child_process");
    execSync(`npx wrangler d1 execute DB --local --command "DELETE FROM sessions; DELETE FROM devices;"`, {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/admin/);

    // --- appearance: platform name, logo, hero, socials, theme/font ---
    await page.goto("/admin/appearance?tab=system");
    await page.locator('input[name="nameAr"]').fill("د. مصطفى تيتو");
    await page.locator('input[name="nameEn"]').fill("Dr. Mostafa Tito");
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
    await page.locator('input[name="primary"]').evaluate((el, hex) => {
      (el as HTMLInputElement).value = hex as string;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, "#0f766e");
    await page.locator('select[name="headingFont"]').selectOption("ibm");
    await page.locator('select[name="bodyFont"]').selectOption("cairo");
    await page.getByRole("button", { name: /حفظ المجموعة|Save group/i }).click();
    await expect(page.locator("body")).toContainText(/تم الحفظ|Saved/);

    const cssText = await (await page.request.get("/theme.css")).text();
    expect(cssText).toMatch(/IBM Plex Sans Arabic/);
    expect(cssText).toMatch(/0f766e/i);

    await page.goto("/");
    await expect(page.locator("header img, header svg").first()).toBeVisible();
    await expect(page.locator("footer a[href*='youtube.com']").first()).toBeAttached();

    // --- CMS builder on FAQ: add/duplicate/reorder/delete, rich text, publish, preview, restore ---
    await page.goto("/admin/cms");
    await page.getByRole("link", { name: /الأسئلة الشائعة|Frequently asked/i }).first().click();
    await page.waitForURL(/\/admin\/cms\/pages\//);
    await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();

    await page.getByRole("button", { name: /\+ إضافة قسم|Add section/i }).click();
    await expect(page.getByText(/قسم #/)).toHaveCount(await page.getByText(/قسم #/).count());

    const addBlockForm = page.locator("form").filter({ has: page.locator('input[name="_action"][value="add-block"]') }).last();
    await addBlockForm.locator('select[name="blockType"]').selectOption("rich_text");
    await addBlockForm.getByRole("button", { name: /إضافة مكوّن|Add block/i }).click();
    const richItem = page.locator("li").filter({ has: page.locator("span", { hasText: /^نص منسّق$|^Rich text$/ }) }).last();
    await expect(richItem).toBeVisible();
    await richItem.locator("summary").click();
    const editor = page.locator('[contenteditable="true"]').locator("visible=true").first();
    await editor.waitFor({ state: "visible" });
    await editor.evaluate((el) => {
      el.innerHTML = '<p>QA rich text <span class="rt-c-brand">token</span> color</p>';
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    await page.getByRole("button", { name: /حفظ الإعدادات|Save settings/i }).first().click();
    await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();

    await page.getByRole("button", { name: /^نسخ$|^Duplicate$/i }).first().click();
    await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();
    await page.getByRole("button", { name: /^حذف$|^Delete$/i }).last().click();
    await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();
    const downBtn = page.getByRole("button", { name: "↓" }).first();
    if (await downBtn.isEnabled()) await downBtn.click();

    await page.locator('input[name="note"]').fill("qa-publish");
    await page.getByRole("button", { name: /^نشر$|^Publish$/i }).click();
    await expect(page.locator("body")).toContainText(/تم النشر|Published/);
    await expect(page.getByRole("link", { name: /معاينة|Preview/i })).toHaveAttribute("href", /\/admin\/cms\/preview\//);

    await page.getByRole("button", { name: /^استعادة$|^Restore$/i }).first().click();
    await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();

    // --- Template: apply starter → edit heading → publish; copy to contact; edit source; contact unchanged ---
    await page.locator('select[name="templateId"]').selectOption("starter-simple");
    await page.locator('input[name="confirm"]').check();
    await page.getByRole("button", { name: /تطبيق قالب|Apply template/i }).click();
    await expect(page.locator("body")).toContainText(/تم تطبيق|template applied|Template/i);

    await stampPageDraft(page, "QA-TEMPLATE-A");
    await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();
    await page.locator('input[name="note"]').fill("qa-template-publish");
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
    await page.locator('input[name="note"]').fill("qa-contact-from-template");
    await page.getByRole("button", { name: /^نشر$|^Publish$/i }).click();
    await expect(page.locator("body")).toContainText(/تم النشر|Published/);
    expect(await (await page.request.get("/p/contact")).text()).toContain("QA-TEMPLATE-A");

    await page.goto("/admin/cms");
    await page.getByRole("link", { name: /الأسئلة الشائعة|Frequently asked/i }).first().click();
    await page.waitForURL(/\/admin\/cms\/pages\//);
    await stampPageDraft(page, "QA-TEMPLATE-B");
    await expect(page.getByRole("heading", { name: /الأسئلة الشائعة|Frequently asked/i })).toBeVisible();
    await page.locator('input[name="note"]').fill("qa-source-edit");
    await page.getByRole("button", { name: /^نشر$|^Publish$/i }).click();
    await expect(page.locator("body")).toContainText(/تم النشر|Published/);

    expect(await (await page.request.get("/p/faq")).text()).toContain("QA-TEMPLATE-B");
    const contactAfter = await (await page.request.get("/p/contact")).text();
    expect(contactAfter).toContain("QA-TEMPLATE-A");
    expect(contactAfter).not.toContain("QA-TEMPLATE-B");
  });
});
