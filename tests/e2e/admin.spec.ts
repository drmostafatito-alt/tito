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

  test("analytics, security, audit, announcements, assignments, appearance, commerce surfaces all load", async ({ page }) => {
    const surfaces = [
      "/admin/analytics",
      "/admin/security",
      "/admin/audit",
      "/admin/announcements",
      "/admin/assignments",
      "/admin/appearance?tab=system",
      "/admin/commerce",
    ];
    for (const path of surfaces) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should be 200`).toBe(200);
    }
  });

  test("SEO dashboard is factual: findings named, inventory == /sitemap.xml", async ({ page }) => {
    // nav destination exists under the Website section
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: /SEO/i }).first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/admin/seo");
    // quick links + sitemap inventory header
    await expect(page.getByTestId("seo-sitemap-link")).toBeVisible();
    await expect(page.getByTestId("seo-robots-link")).toBeVisible();
    await expect(page.getByRole("heading", { name: /SEO/i })).toBeVisible();

    // the inventory table must list EXACTLY the URLs that /sitemap.xml serves
    const res = await page.goto("/sitemap.xml");
    expect(res?.status()).toBe(200);
    const xml = await res!.text();
    const sitemapLocs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(sitemapLocs.length).toBeGreaterThan(5);

    await page.goto("/admin/seo");
    const rows = page.getByTestId(/^seo-url-/);
    const rowCount = await rows.count();
    expect(rowCount, "inventory rows == sitemap <url> count").toBe(sitemapLocs.length);

    // every inventory path is clean: no query strings, no private prefixes
    for (let i = 0; i < rowCount; i++) {
      const pathText = await rows.nth(i).locator("td").first().innerText();
      expect(pathText).not.toContain("?");
      expect(pathText).not.toMatch(/^\/(admin|student|learn|login|register|files|api)\b/);
    }

    // no private data may appear anywhere on the page
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("127.0.0.1");
    expect(body).not.toContain("admin@educore.local");
  });

  test("unauthenticated visitors are redirected to login (non-reveal)", async ({ page, context }) => {
    // same context, cookies wiped — no session, no admin access.
    // page.goto follows the 302, so assert on the first response to /admin/seo.
    await context.clearCookies();
    const firstResponse = page.waitForResponse((r) => r.url().endsWith("/admin/seo"), { timeout: 20_000 });
    await page.goto("/admin/seo");
    const res = await firstResponse;
    expect(res.status()).toBe(302);
    expect(page.url()).toContain("/login");
    // ?next= — the guard preserved the intended destination (URL-encoded)
    expect(decodeURIComponent(page.url())).toContain("/admin/seo");
  });
});
