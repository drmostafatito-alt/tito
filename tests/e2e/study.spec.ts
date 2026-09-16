import { test, expect } from "@playwright/test";

/**
 * Student content experience — public /study hub.
 * Empty-first: with no published term containers the page still renders the
 * identity heading and the empty message, never invented subjects.
 */
test.describe("student learning content hub", () => {
  test("landing uses educational terminology, not courses", async ({ page }) => {
    await page.goto("/study");
    await expect(page.locator("h1").first()).toBeVisible();
    const h1 = await page.locator("h1").first().innerText();
    expect(h1).toMatch(/المحتوى التعليمي|Learning content/);
    const main = await page.locator("main").innerText();
    expect(main).not.toMatch(/\bCourses\b/);
    expect(main).not.toContain("كورسات");
    expect(main).not.toContain("Course Catalog");
  });

  test("empty-first: either real subjects or the empty state, never a placeholder card", async ({ page }) => {
    await page.goto("/study");
    const empty = page.getByTestId("study-empty");
    const grid = page.getByTestId("study-subjects");
    const emptyVisible = await empty.isVisible().catch(() => false);
    const gridVisible = await grid.isVisible().catch(() => false);
    expect(emptyVisible || gridVisible).toBe(true);
    if (emptyVisible) {
      await expect(empty).toContainText(/سيظهر المحتوى هنا|Content will appear here|لم يُنشر أي صف|No grade or subject/);
    }
  });

  test("unknown subject slug is a 404", async ({ page }) => {
    const res = await page.goto("/study/does-not-exist-xyz");
    expect(res?.status()).toBe(404);
  });
});
