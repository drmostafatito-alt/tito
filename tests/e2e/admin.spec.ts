import { test, expect } from "@playwright/test";
import { ADMIN_STATE, STUDENT_EMAIL } from "./helpers";

/**
 * W4 — Admin platform journey (authorization + real data surfaces).
 * Uses the seeded super-admin storage state; every surface is read from real D1.
 */

test.describe("admin platform", () => {
  test.use({ storageState: ADMIN_STATE });

  test("dashboard renders real metrics from D1", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.locator('[data-testid^="home-metric-"]').first()).toBeVisible({ timeout: 20_000 });
    // several metric tiles render (users / learning / video / exams / commerce)
    const tiles = page.locator('[data-testid^="home-metric-"]');
    expect(await tiles.count()).toBeGreaterThan(5);
  });

  test("user management lists users and can search server-side", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.locator('[data-testid="users-total"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("admin-user-row").first()).toBeVisible();
    // search the seeded student
    await page.getByTestId("users-search").fill(STUDENT_EMAIL);
    await page.getByTestId("users-search").press("Enter");
    await expect(page.getByTestId("admin-user-row").first()).toContainText(STUDENT_EMAIL, { timeout: 15_000 });
  });

  test("analytics, security, audit, announcements, assessment, commerce surfaces all load", async ({ page }) => {
    const surfaces = [
      "/admin/analytics",
      "/admin/security",
      "/admin/audit",
      "/admin/announcements",
      "/admin/assessment",
      "/admin/commerce",
    ];
    for (const path of surfaces) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should be 200`).toBe(200);
    }
  });
});
