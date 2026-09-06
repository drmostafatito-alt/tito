import { test, expect } from "@playwright/test";
import { STUDENT_STATE, ADMIN_STATE, FIXTURES } from "./helpers";

/**
 * W7 — RTL + mobile audit regression.
 *
 * These assertions are DOM/structural and hold even in the sandbox's CSS-less
 * Chromium 92 (which cannot parse Tailwind v4 output). Visual layout metrics
 * (overflow, overlap, clipping) are NOT asserted here — see the W7 report for
 * the proven browser limitation. What we can verify deterministically:
 *   - document direction (`dir`) and language (`lang`) follow the locale
 *   - directional arrow glyphs are wrapped in `rtl:rotate-180` (RTL-flip)
 *   - LTR-only tokens (email/phone/order numbers) carry `dir="ltr"`
 *   - the admin/student mobile navigation toggle exists with correct ARIA
 *   - exam prev/next controls expose accessible names (Arabic + English)
 */

const BASE = "http://127.0.0.1:5173";
const setLocale = async (page: import("@playwright/test").Page, lang: "ar" | "en") =>
  page.context().addCookies([{ name: "edu_locale", value: lang, url: BASE }]);

test.describe("document direction (public)", () => {
  test("Arabic renders rtl", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("English renders ltr", async ({ page }) => {
    await setLocale(page, "en");
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("student surfaces (RTL)", () => {
  test.use({ storageState: STUDENT_STATE });

  test("student pages render rtl in Arabic", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("student mobile nav toggle is reachable with ARIA", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto("/dashboard");
    const toggle = page.locator('button[aria-controls="student-mobile-nav"]');
    await expect(toggle).toBeAttached();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("exam back link uses an RTL-flipped arrow", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto(`/exams/${FIXTURES.examSlug}`);
    await expect(page.locator('a[href="/exams"] span[class*="rtl:rotate-180"]').first()).toBeAttached();
  });

  test("lesson prev/next use RTL-flipped arrows", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`);
    const prevNextNav = page
      .locator('nav[aria-label]')
      .filter({ has: page.locator('a[href*="/learn/"]') })
      .first();
    await expect(prevNextNav.locator('span[class*="rtl:rotate-180"]').first()).toBeAttached();
  });

  test("exam prev/next controls are named in Arabic", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto(`/exams/${FIXTURES.examSlug}`);
    await page.getByRole("button", { name: /start|ابدأ/i }).first().click();
    await page.waitForURL(/\/attempt/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /السؤال السابق/i })).toBeAttached();
    await expect(page.getByRole("button", { name: /السؤال التالي/i })).toBeAttached();
  });
});

test.describe("admin surfaces (RTL + mobile)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("admin pages render rtl in Arabic", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto("/admin/users");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("admin mobile nav toggle is reachable with ARIA", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto("/admin");
    const toggle = page.locator('button[aria-controls="admin-mobile-nav"]');
    await expect(toggle).toBeAttached();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('nav#admin-mobile-nav')).toBeAttached();
    await expect(page.locator('nav#admin-mobile-nav a')).not.toHaveCount(0);
  });

  test("admin back links use RTL-flipped arrows", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto("/admin/appearance");
    await expect(page.locator('a[href="/admin/cms"] span[class*="rtl:rotate-180"]').first()).toBeAttached();
  });

  test("LTR-only email tokens carry dir=ltr", async ({ page }) => {
    await setLocale(page, "ar");
    await page.goto("/admin/users");
    await expect(page.locator('[dir="ltr"]', { hasText: "@" }).first()).toBeAttached();
  });
});
