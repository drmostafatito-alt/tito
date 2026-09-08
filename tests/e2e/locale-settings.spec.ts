import { test, expect, type Browser, type Page, type Locator } from "@playwright/test";
import { ADMIN_STATE } from "./helpers";

/**
 * Owner-controllability E2E: the platform's DEFAULT LANGUAGE and the languages
 * offered are owner settings (Appearance → System). Before this control existed
 * the value lived only in the `locale` settings row with no Admin UI, so
 * changing the site's language meant a code deployment.
 *
 * Full loop, real browser: change it in Admin → save → verify on the public site
 * as a brand-new visitor → verify persistence → verify the write is refused when
 * it would leave the platform in a state no visitor can be served.
 *
 * Why a plain new context is the right "new visitor": `resolveLocale` ranks
 * cookie → user localePref → platform default, and deliberately does NOT consult
 * Accept-Language (see server/settings/locale.server.ts). So a context with no
 * cookies and no session always lands on the platform default.
 */

const SYSTEM_TAB = "/admin/appearance?tab=system";

/** The settings form that actually owns the language controls. */
function languageForm(page: Page): Locator {
  return page.locator("form").filter({ has: page.getByTestId("language-settings") });
}

async function submitSystem(page: Page) {
  await languageForm(page)
    .getByRole("button", { name: /Save group|حفظ المجموعة/i })
    .click();
  await page.waitForLoadState("load");
}

async function saveSystem(page: Page) {
  await submitSystem(page);
  await expect(page.getByText(/^Saved$|^تم الحفظ$/).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * A genuinely new visitor. NOTE: inside a `test.use({ storageState })` block,
 * `browser.newContext()` still INHERITS that storage state, so an explicit empty
 * one is required — otherwise the "visitor" carries the admin session and its
 * pinned `edu_locale=en` cookie and the platform default is never exercised.
 */
async function freshVisitor(browser: Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/");
  return { page, ctx };
}

/** Put the platform back to the shipped default: Arabic, both languages offered. */
async function restoreDefaults(page: Page) {
  await page.goto(SYSTEM_TAB);
  const form = languageForm(page);
  await form.locator('input[name="localeEnabled.ar"]').check();
  await form.locator('input[name="localeEnabled.en"]').check();
  await page.getByTestId("default-locale").selectOption("ar");
  await saveSystem(page);
}

test.describe("owner-controlled platform language", () => {
  test.use({ storageState: ADMIN_STATE });

  test("changing the default language in Admin changes what a new visitor is served", async ({ browser, page }) => {
    await restoreDefaults(page);

    // baseline: shipped default is Arabic
    let visitor = await freshVisitor(browser);
    await expect(visitor.page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(visitor.page.locator("html")).toHaveAttribute("dir", "rtl");
    await visitor.ctx.close();

    try {
      // 1) the control is present in the real Admin UI
      await page.goto(SYSTEM_TAB);
      const panel = page.getByTestId("language-settings");
      await expect(panel).toBeVisible({ timeout: 20_000 });
      const select = page.getByTestId("default-locale");
      await expect(select).toBeVisible();

      // 2) switch the default to English and save through the real form
      await select.selectOption("en");
      await languageForm(page).locator('input[name="localeEnabled.ar"]').check();
      await languageForm(page).locator('input[name="localeEnabled.en"]').check();
      await saveSystem(page);

      // 3) a brand-new visitor is now served English, in LTR
      visitor = await freshVisitor(browser);
      await expect(visitor.page.locator("html")).toHaveAttribute("lang", "en");
      await expect(visitor.page.locator("html")).toHaveAttribute("dir", "ltr");

      // 4) it persists across a reload — stored, not per-request
      await visitor.page.reload();
      await expect(visitor.page.locator("html")).toHaveAttribute("dir", "ltr");
      await visitor.ctx.close();

      // 5) and the Admin UI shows the saved value back (no silent revert)
      await page.goto(SYSTEM_TAB);
      await expect(page.getByTestId("default-locale")).toHaveValue("en");
    } finally {
      await restoreDefaults(page);
      const check = await freshVisitor(browser);
      await expect(check.page.locator("html")).toHaveAttribute("dir", "rtl");
      await check.ctx.close();
    }
  });

  test("un-offering a language removes the public switcher, and offering it brings it back", async ({ browser, page }) => {
    await restoreDefaults(page);
    const switcher = "[data-locale-switch]";

    try {
      await page.goto(SYSTEM_TAB);
      await expect(languageForm(page).getByTestId("language-settings")).toBeVisible({ timeout: 20_000 });

      await languageForm(page).locator('input[name="localeEnabled.en"]').uncheck();
      await saveSystem(page);

      // With one language offered there is nothing to switch to, so the control
      // is hidden rather than rendered dead.
      await page.goto("/");
      await expect(page.locator(switcher)).toHaveCount(0);

      await page.goto(SYSTEM_TAB);
      await languageForm(page).locator('input[name="localeEnabled.en"]').check();
      await saveSystem(page);

      await page.goto("/");
      await expect(page.locator(switcher).first()).toBeVisible();

      // and a visitor whose cookie asks for English still gets it
      const enVisitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      await enVisitor.addCookies([{ name: "edu_locale", value: "en", url: "http://127.0.0.1:5173" }]);
      const enPage = await enVisitor.newPage();
      await enPage.goto("/");
      await expect(enPage.locator("html")).toHaveAttribute("dir", "ltr");
      await enVisitor.close();
    } finally {
      await restoreDefaults(page);
    }
  });

  test("an inconsistent combination is refused with a reason and the site keeps working", async ({ browser, page }) => {
    await restoreDefaults(page);

    await page.goto(SYSTEM_TAB);
    await expect(languageForm(page).getByTestId("language-settings")).toBeVisible({ timeout: 20_000 });

    // default = English while English is no longer offered
    await languageForm(page).locator('input[name="localeEnabled.en"]').uncheck();
    await page.getByTestId("default-locale").selectOption("en");
    await submitSystem(page);

    // the write is refused and the owner is told why — not handed a JSON dump
    await expect(
      page.getByText(/default language must also be offered/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // nothing was persisted: visitors still get Arabic with both languages offered
    const visitor = await freshVisitor(browser);
    await expect(visitor.page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(visitor.page.locator("[data-locale-switch]").first()).toBeVisible();
    await visitor.ctx.close();

    await page.goto(SYSTEM_TAB);
    await expect(page.getByTestId("default-locale")).toHaveValue("ar");
  });
});
