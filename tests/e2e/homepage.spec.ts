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

  test("hero visual contract: empty slot renders no stand-in, owner photo is the hero", async ({ page }) => {
    // Owner brief §19 (2026-09 rebuild): the hero no longer receives ANY
    // auto-injected illustration — `public/hero-philosophy.webp` is registered
    // only as a CMS-pickable option, and `home-preset.json` ships `image: ""`.
    // The unit contract (tests/unit/cms-hero-identity.test.ts) is: empty slot
    // ⇒ no `/files/` image at all; a published owner photo ⇒ exactly ONE hero
    // `<img>` (`data-hero-visual`), served from `/files/<uuid>`.
    // These E2E assertions previously demanded an always-present hero image,
    // i.e. the retired behaviour — not a weakening: the no-stand-in rule plus
    // the always-on structure (h1, CTAs, badges) are asserted instead.
    await page.goto("/");
    const hero = page.locator("section.hero");
    await expect(hero).toBeAttached();
    const heroVisual = page.locator("[data-hero-visual]");
    if (await heroVisual.count()) {
      // When the owner HAS published a photo, it must really load and be unique.
      await expect(heroVisual).toHaveCount(1);
      const ok = await heroVisual.evaluate((el) => {
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
    } else {
      // Empty slot: no stand-in art whatsoever (no seeded illustration, no
      // placeholder files) — and the hero still carries its real content.
      const heroHtml = (await hero.innerHTML()) || "";
      expect(heroHtml).not.toContain("hero-philosophy");
      await expect(page.locator("h1").first()).toBeAttached();
    }
  });

  test("the grade entry walks into /study and never opens a second catalog", async ({ page }) => {
    // v3 restores "اختر صفّك" as the FIRST step of the journey, so it must not
    // become a second discovery surface: every card (and every chip inside it)
    // resolves to the study hub or to the grade's own published subject.
    await page.goto("/");
    const cards = page.locator('section:has(h2:text("اختر")) a');
    await expect(cards.first()).toBeVisible();
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const href = (await cards.nth(i).getAttribute("href")) ?? "";
      expect(href === "/study" || href.startsWith("/study/")).toBe(true);
    }
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
    // Asserted on strings the composition itself owns (CMS copy + identity
    // tagline), so the test follows the approved public vocabulary instead of
    // pinning one marketing sentence.
    // Pinned to a heading the approved composition actually owns in BOTH
    // locales ("كتب ومذكرات" belonged to an earlier homepage and is not in it),
    // so this stays a locale test rather than a marketing-copy test.
    const AR_COPY = "اختر صفك للبدء";
    const EN_COPY = /Choose your grade to start/i;
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("body")).toContainText(AR_COPY);
    await page.getByRole("button", { name: /english/i }).click();
    await page.waitForURL("**/*");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    const cookies = await page.context().cookies(BASE);
    expect(cookies.find((c) => c.name === "edu_locale")?.value).toBe("en");
    await expect(page.locator("body")).toContainText(EN_COPY);
    await expect(page.locator("body")).toContainText(/Philosophy & Psychology/);
    await expect(page.locator("body")).not.toContainText(AR_COPY);
    await expect(page.getByRole("button", { name: /عربي|arabic/i })).toBeVisible();
  });

  test("responsive homepage keeps hero content and nav at a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    // Hero image is owner-published (possibly none yet — see the hero contract
    // test above); the h1 + hamburger + drawer ARIA contract are unconditional.
    await expect(page.locator("section.hero")).toBeAttached();
    await expect(page.locator("h1").first()).toBeAttached();
    const menu = page.getByTestId("public-menu");
    await expect(menu).toBeAttached();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-controls", "mobile-nav");
    await expect(page.locator("nav#mobile-nav")).toBeAttached();
  });

  test("320px header keeps hamburger and login reachable (not clipped)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    const header = page.getByTestId("public-header");
    await expect(header).toBeVisible();
    const menu = page.getByTestId("public-menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box, "hamburger must have a box").toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await menu.click();
    await expect(page.locator("nav#mobile-nav")).toBeVisible();
    await expect(page.locator("nav#mobile-nav").getByRole("link", { name: /تسجيل الدخول|log in/i })).toBeVisible();
  });
});
