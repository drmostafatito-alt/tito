import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const BASE = "http://127.0.0.1:5173";
const OUT = resolve("docs/reports/qa");

test.describe.configure({ mode: "serial" });

test("Chromium click: AR → EN full document locale switch", async ({ page, context }) => {
  const posts: Array<{ url: string; method: string }> = [];
  const setLocaleRes: Array<{ status: number; setCookie: string; location: string; cache: string }> = [];
  page.on("request", (r) => {
    if (r.method() === "POST" || r.url().includes("set-locale")) {
      posts.push({ url: r.url(), method: r.method() });
    }
  });
  page.on("response", (r) => {
    if (r.url().includes("/set-locale")) {
      const h = r.headers();
      setLocaleRes.push({
        status: r.status(),
        setCookie: h["set-cookie"] ?? "",
        location: h.location ?? "",
        cache: h["cache-control"] ?? "",
      });
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.goto("/", { waitUntil: "load" });

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const arText = await page.locator("body").innerText();
  expect(arText).toContain("كورسات ومراجعات");
  expect(arText).toContain("الفلسفة");
  expect(arText).toContain("علم النفس");
  expect(arText).toMatch(/أهلاً بيكم/);
  expect(arText).toContain("الرئيسية");
  expect(arText).toContain("تسجيل الدخول");
  expect(arText).not.toMatch(/EduCore/i);
  await page.screenshot({ path: resolve(OUT, "lang-click-01-ar.png"), fullPage: true });

  const switcher = page.locator("[data-locale-switch] button");
  await expect(switcher).toBeVisible();
  await expect(switcher).toHaveAttribute("data-locale-next", "en");
  await switcher.click();
  await page.waitForFunction(() => document.documentElement.lang === "en", null, { timeout: 15_000 });

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const cookiesEn = await context.cookies(BASE);
  expect(cookiesEn.find((c) => c.name === "edu_locale")?.value).toBe("en");
  const enText = await page.locator("body").innerText();
  expect(enText).toContain("Courses & revision");
  expect(enText).toContain("Question banks");
  expect(enText).toContain("Online tests");
  expect(enText).toMatch(/Welcome to your platform/i);
  expect(enText).toMatch(/^Home$/m);
  expect(enText).toMatch(/Log in/i);
  expect(enText).toContain("Dr mostafa tito");
  expect(enText).not.toContain("كورسات ومراجعات");
  expect(enText).not.toContain("تسجيل الدخول");
  expect(posts.some((p) => p.method === "POST" && p.url.includes("/set-locale"))).toBe(true);
  expect(setLocaleRes.length).toBeGreaterThan(0);
  // Chromium hides Set-Cookie on the Fetch response object; the cookie jar is the proof.
  expect(cookiesEn.find((c) => c.name === "edu_locale")?.httpOnly).toBe(true);
  await page.screenshot({ path: resolve(OUT, "lang-click-02-en.png"), fullPage: true });

  await page.reload({ waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("body")).toContainText(/Courses & revision/);

  await page.getByRole("button", { name: /عربي|arabic/i }).click();
  await page.waitForFunction(() => document.documentElement.lang === "ar", null, { timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("body")).toContainText("كورسات ومراجعات");
  const cookiesAr = await context.cookies(BASE);
  expect(cookiesAr.find((c) => c.name === "edu_locale")?.value).toBe("ar");
  await page.screenshot({ path: resolve(OUT, "lang-click-03-ar-back.png"), fullPage: true });

  const fresh = await context.browser()!.newContext();
  const p2 = await fresh.newPage();
  await p2.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await p2.goto(BASE + "/", { waitUntil: "load" });
  await expect(p2.locator("html")).toHaveAttribute("lang", "ar");
  await expect(p2.locator("html")).toHaveAttribute("dir", "rtl");
  await p2.close();
  await fresh.close();
});

test("Chromium click: mobile language switcher", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  const switcher = page.locator("[data-locale-switch] button");
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.waitForFunction(() => document.documentElement.lang === "en", null, { timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("body")).toContainText(/Courses & revision/);
  await page.screenshot({ path: resolve(OUT, "lang-click-04-mobile-en.png"), fullPage: true });
});
