import { test, expect } from "@playwright/test";

/**
 * Homepage visual + locale regressions.
 *
 * DOM/structural assertions that hold even in the sandbox Chromium 92 which
 * cannot parse Tailwind v4 output (see rtl-mobile.spec.ts). Visual pixel
 * metrics are NOT asserted here.
 */

const BASE = "http://127.0.0.1:5173";

test.describe("homepage public chrome", () => {
  test("fresh visitor is Arabic RTL even with en-US Accept-Language", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("does not show EduCore branding", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/EduCore/i);
    expect(body).not.toContain("إيدوكور");
  });

  test("hero visual exists and loads", async ({ page }) => {
    await page.goto("/");
    const img = page.locator("[data-hero-visual]");
    await expect(img).toBeAttached();
    const ok = await img.evaluate((el) => {
      const image = el as HTMLImageElement;
      if (!image.complete) {
        return new Promise<boolean>((resolve) => {
          image.addEventListener("load", () => resolve(image.naturalWidth > 0));
          image.addEventListener("error", () => resolve(false));
        });
      }
      return image.naturalWidth > 0;
    });
    expect(ok).toBe(true);
  });

  test("hero heading and philosophy/psychology identity are visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1").first()).toBeAttached();
    await expect(page.locator("body")).toContainText(/الفلسفة|Philosophy/);
    await expect(page.locator("body")).toContainText(/علم النفس|Psychology/);
    await expect(page.locator("body")).toContainText(/مصطفى تيتو|mostafa tito/i);
  });

  test("login and register CTAs are present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /تسجيل الدخول|log in/i }).first()).toBeAttached();
    await expect(page.getByRole("link", { name: /إنشاء حساب|create account/i }).first()).toBeAttached();
  });

  test("locale switcher writes the cookie on localhost HTTP and flips dir", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await page.getByRole("button", { name: /english/i }).click();
    await page.waitForURL("**/*");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    const cookies = await page.context().cookies(BASE);
    expect(cookies.find((c) => c.name === "edu_locale")?.value).toBe("en");
  });

  test("responsive homepage keeps hero visual and nav at a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator("[data-hero-visual]")).toBeAttached();
    await expect(page.locator("h1").first()).toBeAttached();
    const menu = page.locator('button[aria-controls="mobile-nav"]');
    await expect(menu).toBeAttached();
    await menu.click();
    await expect(page.locator("nav#mobile-nav")).toBeAttached();
  });
});
