import { test, expect } from "@playwright/test";
import { FIXTURES } from "./helpers";

/**
 * W4 — Catalog / course navigation journey (anonymous, no auth).
 * Fresh visitors default to Arabic; these tests pin English via the locale
 * cookie so English seed titles stay deterministic.
 */

const setEn = async (page: import("@playwright/test").Page) =>
  page.context().addCookies([{ name: "edu_locale", value: "en", url: "http://127.0.0.1:5173" }]);

test.describe("catalog & course navigation", () => {
  test("catalog lists the published demo course", async ({ page }) => {
    await setEn(page);
    await page.goto("/courses");
    await expect(page.locator("body")).toContainText("Full Revision — Physics 3rd Secondary");
  });

  test("course detail renders with a buy CTA (entitled course, anonymous)", async ({ page }) => {
    await setEn(page);
    await page.goto(`/courses/${FIXTURES.courseSlug}`);
    await expect(page.locator("body")).toContainText("Full Revision — Physics 3rd Secondary");
    await expect(page.getByTestId("course-buy-cta")).toBeVisible();
  });

  test("unknown course slug is a 404 (no existence oracle)", async ({ page }) => {
    const res = await page.goto("/courses/does-not-exist-xyz");
    expect(res?.status()).toBe(404);
  });

  test("program listing resolves from the public hierarchy", async ({ page }) => {
    await setEn(page);
    await page.goto("/programs");
    await expect(page.locator("body")).toContainText("General Secondary");
  });

  test("locked lesson link is not offered to anonymous users (entitled content hidden)", async ({ page }) => {
    // the course page only links learn pages for lessons the anon user can access
    await page.goto(`/courses/${FIXTURES.courseSlug}`);
    const learnLinks = page.locator(`a[href*="/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}"]`);
    await expect(learnLinks).toHaveCount(0);
  });

  test("anonymous user is redirected to login when opening an entitled lesson", async ({ page }) => {
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`);
    await page.waitForURL(/\/login/, { timeout: 15_000 });
  });
});
