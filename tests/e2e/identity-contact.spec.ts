import { test, expect, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./helpers";

/**
 * Owner-controllability E2E: social links and contact details.
 *
 * These settings already existed (identity group: contactPhone/contactEmail/
 * contactAddress + the SocialHub repeater), but nothing proved the loop
 * Admin -> database -> public footer in a real browser. This pins it, including
 * the validation that keeps a non-https URL out of the site.
 */

test.use({ storageState: ADMIN_STATE });

const FB_1 = "https://www.facebook.com/mr.mostafa.tito.philosophy";
const FB_2 = "https://www.facebook.com/some-other-page";
const PHONE = "01153719506";

function identityForm(page: Page) {
  return page.locator("form").filter({ has: page.locator('input[name="contactPhone"]') }).first();
}

async function saveIdentity(page: Page) {
  const form = identityForm(page);
  await form.getByRole("button").last().click();
  await page.waitForLoadState("networkidle");
}

/** Anonymous visitor — the footer is what a prospect actually sees. */
async function openFooter(browser: import("@playwright/test").Browser) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return { page, ctx };
}

test.describe("owner-controlled social links and contact details", () => {
  test("social URL and phone reach the public footer, and can be changed or disabled", async ({ page, browser }) => {
    await page.goto("/admin/appearance?tab=identity");
    const form = identityForm(page);
    await expect(form).toBeVisible({ timeout: 20_000 });

    await form.locator('input[name="contactPhone"]').fill(PHONE);
    await form.locator('select[name="sl.0.network"]').selectOption("facebook");
    await form.locator('input[name="sl.0.url"]').fill(FB_1);
    await form.locator('input[name="sl.0.labelEn"]').fill("Facebook page");
    for (const f of ["sl.0.enabled", "sl.0.showFooter"]) {
      const cb = form.locator(`input[name="${f}"]`);
      if (!(await cb.isChecked())) await cb.check({ force: true });
    }
    await saveIdentity(page);

    // ---- the public footer reflects it ----------------------------------
    const v = await openFooter(browser);
    const footer = v.page.locator("footer");
    await expect(footer.locator(`a[href="tel:${PHONE}"]`).first()).toBeVisible({ timeout: 20_000 });
    await expect(footer.locator(`a[href="${FB_1}"]`).first()).toBeVisible({ timeout: 20_000 });
    expect(await footer.locator(`a[href="${FB_1}"]`).first().getAttribute("target")).toBe("_blank");
    await v.ctx.close();

    // ---- changing the URL replaces it, it does not accumulate ------------
    await page.goto("/admin/appearance?tab=identity");
    await identityForm(page).locator('input[name="sl.0.url"]').fill(FB_2);
    await saveIdentity(page);

    const v2 = await openFooter(browser);
    await expect(v2.page.locator(`footer a[href="${FB_2}"]`).first()).toBeVisible({ timeout: 20_000 });
    expect(await v2.page.locator(`footer a[href="${FB_1}"]`).count()).toBe(0);
    await v2.ctx.close();

    // ---- a non-https URL is refused and nothing is stored ---------------
    await page.goto("/admin/appearance?tab=identity");
    await identityForm(page).locator('input[name="sl.0.url"]').fill("javascript:alert(1)");
    await saveIdentity(page);
    // the editor must not have accepted it
    await page.goto("/admin/appearance?tab=identity");
    const stored = await identityForm(page).locator('input[name="sl.0.url"]').inputValue();
    expect(stored.startsWith("javascript:")).toBe(false);

    // ---- disabling the row removes it from the footer -------------------
    const cb = identityForm(page).locator('input[name="sl.0.enabled"]');
    if (await cb.isChecked()) await cb.uncheck({ force: true });
    await saveIdentity(page);

    const v3 = await openFooter(browser);
    await v3.page.waitForLoadState("networkidle");
    expect(await v3.page.locator(`footer a[href="${FB_2}"]`).count()).toBe(0);
    // contact phone is independent of the social rows and still present
    await expect(v3.page.locator(`footer a[href="tel:${PHONE}"]`).first()).toBeVisible({ timeout: 20_000 });
    await v3.ctx.close();
  });
});
