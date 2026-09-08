import { test, expect, type Page, type BrowserContext, type Browser } from "@playwright/test";
import { ADMIN_STATE, STUDENT_STATE, FIXTURES } from "./helpers";

/**
 * Owner-controllability E2E: the floating WhatsApp button.
 *
 * Full loop for every case — Admin setting -> database -> homepage -> real
 * browser. Also pins the two things that make this feature safe to ship:
 *   1. it exists on the PUBLIC HOMEPAGE ONLY (never on courses, lessons, exams,
 *      the student dashboard or Admin, where a fixed overlay would cover video
 *      controls, questions or submit buttons);
 *   2. it gets out of the way of important content via IntersectionObserver,
 *      and comes back when the overlap ends.
 *
 * Geometry note: the assertions here read DOM state (`data-dodging`,
 * `aria-hidden`, `href`), not painted boxes — the E2E Chromium is old enough
 * that Tailwind v4 utility classes do not apply, so visual measurement is not
 * dependable. The button's reserved corner is therefore computed from the same
 * constants the component uses.
 */

// Owner actions below run as the seeded super admin.
test.use({ storageState: ADMIN_STATE });

const PHONE = "201153719506";
const PHONE_2 = "201000000000";
const MESSAGE = "مرحبا، أريد الاشتراك";

/** Mirrors fabZone() in the component: 56px button, 16px inset, 12px slack. */
const FAB_SIZE = 56;
const FAB_INSET = 16;
const FAB_PAD = 12;

/** The System tab form that owns the platform settings. */
function systemForm(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.locator('input[name="whatsappFloating"]') })
    .first();
}

async function setWhatsApp(page: Page, opts: { phone: string; enabled: boolean; message?: string }) {
  await page.goto("/admin/appearance?tab=system");
  const form = systemForm(page);
  await expect(form).toBeVisible({ timeout: 20_000 });
  await form.locator('input[name="whatsapp"]').fill(opts.phone);
  await form.locator('input[name="whatsappMessage"]').fill(opts.message ?? "");
  const box = form.locator('input[name="whatsappFloating"]');
  if (opts.enabled) {
    if (!(await box.isChecked())) await box.check({ force: true });
  } else if (await box.isChecked()) {
    await box.uncheck({ force: true });
  }
  await form.getByRole("button").last().click();
  await page.waitForLoadState("networkidle");
}

/** A visitor with no session; the homepage is what an anonymous prospect sees. */
async function visit(browser: Browser, locale: "ar" | "en", viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport });
  await ctx.addCookies([{ name: "edu_locale", value: locale, url: "http://127.0.0.1:5173" }]);
  const page = await ctx.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return { page, ctx };
}

test.describe("floating WhatsApp button", () => {
  test("owner enables it, then the homepage shows it and nothing else does", async ({ page, browser }) => {
    await page.context().addCookies([{ name: "edu_locale", value: "en", url: "http://127.0.0.1:5173" }]);
    await setWhatsApp(page, { phone: PHONE, enabled: true, message: MESSAGE });

    // ---- homepage, Arabic (platform default), desktop --------------------
    const ar = await visit(browser, "ar");
    const fab = ar.page.getByTestId("whatsapp-fab");
    await expect(fab).toBeVisible({ timeout: 20_000 });
    expect(await fab.getAttribute("data-dodging")).toBe("false");

    const href = (await fab.getAttribute("href"))!;
    expect(href.startsWith(`https://wa.me/${PHONE}?text=`)).toBe(true);
    expect(new URL(href).searchParams.get("text")).toBe(MESSAGE);
    expect(await fab.getAttribute("target")).toBe("_blank");
    expect(await fab.getAttribute("rel")).toContain("noopener");
    // Arabic accessible label
    expect(await fab.getAttribute("aria-label")).toContain("واتساب");
    await ar.ctx.close();

    // ---- homepage, English + mobile viewport ----------------------------
    const en = await visit(browser, "en", { width: 390, height: 844 });
    const enFab = en.page.getByTestId("whatsapp-fab");
    await expect(enFab).toBeVisible({ timeout: 20_000 });
    expect(await enFab.getAttribute("aria-label")).toMatch(/WhatsApp/i);
    await en.ctx.close();

    // ---- homepage ONLY ----------------------------------------------------
    const anon = await visit(browser, "en");
    const student = await browser.newContext({ storageState: STUDENT_STATE });
    const admin = await browser.newContext({ storageState: ADMIN_STATE });

    const mustNotHave: { ctx: BrowserContext; path: string }[] = [
      { ctx: anon.ctx, path: "/courses" },
      { ctx: anon.ctx, path: `/courses/${FIXTURES.courseSlug}` },
      { ctx: anon.ctx, path: "/exams" },
      { ctx: anon.ctx, path: "/p/contact" },
      { ctx: anon.ctx, path: "/login" },
      { ctx: student, path: "/dashboard" },
      { ctx: student, path: `/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson1Slug}` },
      { ctx: admin, path: "/admin" },
      { ctx: admin, path: "/admin/cms" },
    ];
    for (const { ctx, path } of mustNotHave) {
      const p2 = await ctx.newPage();
      await p2.goto(path);
      await p2.waitForLoadState("networkidle");
      expect(await p2.getByTestId("whatsapp-fab").count(), `FAB must not appear on ${path}`).toBe(0);
      await p2.close();
    }
    await anon.ctx.close();
    await student.close();
    await admin.close();

    // ---- changing the number changes the link ----------------------------
    await setWhatsApp(page, { phone: PHONE_2, enabled: true, message: "" });
    const after = await visit(browser, "en");
    expect(await after.page.getByTestId("whatsapp-fab").getAttribute("href")).toBe(
      `https://wa.me/${PHONE_2}`
    );
    await after.ctx.close();

    // ---- disabled -> no button ------------------------------------------
    await setWhatsApp(page, { phone: PHONE_2, enabled: false });
    const off = await visit(browser, "en");
    expect(await off.page.getByTestId("whatsapp-fab").count()).toBe(0);
    await off.ctx.close();

    // ---- enabled but no number -> no button ------------------------------
    await setWhatsApp(page, { phone: "", enabled: true });
    const noNumber = await visit(browser, "en");
    expect(await noNumber.page.getByTestId("whatsapp-fab").count()).toBe(0);
    await noNumber.ctx.close();
  });

  test("the button gets out of the way of important content and returns", async ({ page, browser }) => {
    await page.context().addCookies([{ name: "edu_locale", value: "en", url: "http://127.0.0.1:5173" }]);
    await setWhatsApp(page, { phone: PHONE, enabled: true });

    // The owner adds a real form to the homepage through the CMS builder. A form
    // is exactly the kind of content the button must never sit on top of.
    await page.goto("/admin/cms/forms");
    const newForm = page.locator("form").filter({ has: page.locator('input[name="titleEn"]') }).first();
    await expect(newForm).toBeVisible({ timeout: 20_000 });
    await newForm.locator('input[name="titleAr"]').fill("نموذج التواصل");
    await newForm.locator('input[name="titleEn"]').fill("Homepage enquiry form");
    await newForm.getByRole("button").last().click();
    await page.waitForLoadState("networkidle");

    await page.goto("/admin/cms");
    await page.locator('a[href^="/admin/cms/pages/"]', { hasText: /^Home$|الرئيسية/ }).first().click();
    await page.waitForLoadState("networkidle");

    const addBlock = page.locator('form:has(input[name="_action"][value="add-block"])').last();
    await expect(addBlock).toBeVisible({ timeout: 20_000 });
    await addBlock.locator('select[name="blockType"]').selectOption("form_block");
    await addBlock.getByRole("button").click();
    await page.waitForLoadState("networkidle");

    // Only the form_block exposes an f.formId picker, so this targets it exactly.
    const target = page.locator('form:has(select[name="f.formId"])').last();
    await target.evaluate((f) => {
      let d = f.closest("details");
      while (d) {
        d.open = true;
        d = d.parentElement ? d.parentElement.closest("details") : null;
      }
    });
    const formSelect = target.locator('select[name="f.formId"]');
    await expect(formSelect).toBeVisible({ timeout: 15_000 });
    const optValue = await formSelect
      .locator("option")
      .filter({ hasText: "Homepage enquiry form" })
      .first()
      .getAttribute("value");
    expect(optValue, "the new form must be selectable in the block").toBeTruthy();
    await formSelect.selectOption(optValue!);
    await target.locator("button").last().click();
    await page.waitForLoadState("networkidle");

    await page.locator('form:has(input[name="_action"][value="publish"]) button').first().click();
    await page.waitForLoadState("networkidle");

    // ---- now verify the collision behaviour as a visitor -----------------
    const v = await visit(browser, "en");
    const fab = v.page.getByTestId("whatsapp-fab");
    await expect(fab).toBeVisible({ timeout: 20_000 });
    await expect(fab).toHaveAttribute("data-dodging", "false");

    const formOnPage = v.page.locator("main form").last();
    await expect(formOnPage).toBeVisible({ timeout: 20_000 });
    await formOnPage.scrollIntoViewIfNeeded();

    const vh = await v.page.evaluate(() => window.innerHeight);
    // Land the form inside the corner the button reserves (bottom band, full
    // width is already covered because the form spans the content column).
    const wantedTop = vh - (FAB_INSET + FAB_SIZE / 2);
    let lastTop = Number.NaN;
    for (let i = 0; i < 10; i++) {
      const tb = (await formOnPage.boundingBox())!;
      const delta = tb.y - wantedTop;
      if (Math.abs(delta) < 3) break;
      if (tb.y === lastTop) break; // scroll clamped at a page edge
      lastTop = tb.y;
      await v.page.mouse.wheel(0, delta);
      await v.page.waitForTimeout(120);
    }

    await expect(fab).toHaveAttribute("data-dodging", "true", { timeout: 10_000 });
    // while dodging it is not interactive and is hidden from assistive tech
    expect(await fab.getAttribute("aria-hidden")).toBe("true");
    expect(await fab.getAttribute("tabindex")).toBe("-1");

    // scroll away by more than a screen: the form leaves the reserved corner
    await v.page.mouse.wheel(0, -(vh + 200));
    await v.page.waitForTimeout(200);
    await expect(fab).toHaveAttribute("data-dodging", "false", { timeout: 10_000 });
    expect(await fab.getAttribute("aria-hidden")).toBeNull();
    await v.ctx.close();

    // ---- clean up so later specs see the seeded homepage -----------------
    await page.goto("/admin/cms");
    await page.locator('a[href^="/admin/cms/pages/"]', { hasText: /^Home$|الرئيسية/ }).first().click();
    await page.waitForLoadState("networkidle");
    await page
      .locator("form")
      .filter({ has: page.locator('input[name="_action"][value="delete-block"]') })
      .last()
      .locator("button")
      .click();
    await page.waitForLoadState("networkidle");
    await page.locator('form:has(input[name="_action"][value="publish"]) button').first().click();
    await page.waitForLoadState("networkidle");

    await setWhatsApp(page, { phone: "", enabled: false });
  });
});
