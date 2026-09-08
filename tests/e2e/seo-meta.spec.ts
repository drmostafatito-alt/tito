import { test, expect } from "@playwright/test";
import { ADMIN_STATE, FIXTURES } from "./helpers";

/**
 * Owner-controllability E2E: catalog/content pages must expose SEO + social
 * preview metadata derived from fields the owner edits in the Admin UI — with no
 * separate SEO form and no code deployment.
 *
 * The second test is the complete loop, driven through the real browser:
 *   Admin → Content (edit + save)  →  D1  →  public page <meta> in the browser.
 */

const COURSE = `/courses/${FIXTURES.courseSlug}`;
const PLATFORM_AR = "د/ مصطفى تيتو";

const metaContent = (page: import("@playwright/test").Page, selector: string) =>
  page.locator(`head ${selector}`).getAttribute("content");

test.describe("owner-controlled SEO / social preview", () => {
  test("course page emits ONE localized title + OG tags from the admin-edited row (ar + en, desktop + mobile)", async ({ page, browser }) => {
    // ---- Arabic (site default), desktop ----
    await page.goto(COURSE);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // Regression: root.tsx used to render a hardcoded <title> AND <Meta/>, so
    // every page emitted two <title> elements (invalid HTML, ambiguous to crawlers).
    await expect(page.locator("head title")).toHaveCount(1);

    const arTitle = await page.title();
    expect(arTitle).toContain(PLATFORM_AR);
    // the title must carry the COURSE name, not just the platform name
    expect(arTitle.replace(PLATFORM_AR, "").replace(/[—\s]/g, "").length).toBeGreaterThan(0);
    expect(await metaContent(page, 'meta[property="og:title"]')).toBe(arTitle);
    expect(await metaContent(page, 'meta[property="og:type"]')).toBe("website");
    expect(await metaContent(page, 'meta[name="robots"]')).toBe("index,follow");
    expect(await page.locator('head link[rel="canonical"]').getAttribute("href")).toContain(FIXTURES.courseSlug);
    const arDesc = await metaContent(page, 'meta[name="description"]');
    expect(arDesc && arDesc.trim().length).toBeGreaterThan(0);
    expect(await metaContent(page, 'meta[property="og:description"]')).toBe(arDesc);

    // ---- English, mobile viewport: independently controllable copy ----
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { cookie: "edu_locale=en" },
    });
    const mPage = await mobile.newPage();
    await mPage.goto(COURSE);
    await expect(mPage.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(mPage.locator("head title")).toHaveCount(1);
    const enTitle = await mPage.title();
    expect(enTitle).not.toBe(arTitle);
    expect(enTitle).toMatch(/[A-Za-z]/);
    expect(await metaContent(mPage, 'meta[name="description"]')).toMatch(/[A-Za-z]/);
    await mobile.close();
  });

  test("catalog index derives its description from an owner-editable setting", async ({ page }) => {
    await page.goto("/courses");
    await expect(page.locator("head title")).toHaveCount(1);
    expect(await page.title()).toContain(PLATFORM_AR);
    const desc = await metaContent(page, 'meta[name="description"]');
    expect(desc && desc.trim().length).toBeGreaterThan(0);
  });

  test("Admin → Content edit changes the public page's social preview (full loop)", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_STATE });
    // auth.setup pins the shared states to English; pin Arabic here so the
    // field we edit and the meta we assert are the same language.
    await ctx.addCookies([{ name: "edu_locale", value: "ar", url: "http://127.0.0.1:5173" }]);
    const admin = await ctx.newPage();

    // 1) find the seeded course in the Admin content tree
    await admin.goto("/admin/content");
    const link = admin.locator('a[href^="/admin/content/course/"]').first();
    await expect(link).toBeVisible({ timeout: 20_000 });
    const editorHref = await link.getAttribute("href");
    expect(editorHref).toMatch(/^\/admin\/content\/course\//);
    await admin.goto(editorHref!);

    // 2) change the Arabic description through the real node form and save it.
    //    Scoped to the form that owns descriptionAr — the editor page holds
    //    several forms (child creation, archive), each with its own submit.
    const form = admin.locator("form", { has: admin.locator('textarea[name="descriptionAr"]') }).first();
    await expect(form).toBeVisible({ timeout: 20_000 });
    const stamp = Date.now();
    const newDesc = `وصف محدث من لوحة التحكم ${stamp}`;
    await form.locator('textarea[name="descriptionAr"]').fill(newDesc);
    await form.getByRole("button", { name: /حفظ التعديلات|Save changes/i }).first().click();
    await admin.waitForLoadState("networkidle");

    // 3) the PUBLIC page must now carry the new value in <meta> — no deploy, no code change
    const pub = await ctx.newPage();
    await pub.goto(COURSE);
    await expect
      .poll(async () => metaContent(pub, 'meta[name="description"]'), { timeout: 15_000 })
      .toBe(newDesc);
    expect(await metaContent(pub, 'meta[property="og:description"]')).toBe(newDesc);

    await ctx.close();
  });
});
