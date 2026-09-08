import { test, expect, type Browser } from "@playwright/test";
import { STUDENT_STATE } from "./helpers";

/**
 * Owner/locale-controllability E2E for copy that used to be hardcoded inside
 * components. Proves the strings now come from the dictionaries and follow the
 * visitor's language in a real browser — including that internal roadmap
 * wording ("Phase 1"/"Phase 3") no longer reaches students.
 */

async function asStudent(browser: Browser, locale: "ar" | "en") {
  const ctx = await browser.newContext({ storageState: STUDENT_STATE });
  await ctx.addCookies([{ name: "edu_locale", value: locale, url: "http://127.0.0.1:5173" }]);
  const page = await ctx.newPage();
  return { page, ctx };
}

test.describe("user-facing copy comes from the dictionaries", () => {
  test("student dashboard role label follows the visitor's language", async ({ browser }) => {
    const en = await asStudent(browser, "en");
    await en.page.goto("/dashboard");
    await en.page.waitForLoadState("networkidle");
    // Assert the role LINE specifically. The seeded student's display name is
    // Arabic ("طالب تجريبي"), so a bare substring check would match the name
    // rather than the translated role label.
    await expect(en.page.locator("main")).toContainText(/Role:\s*Student/i, { timeout: 20_000 });
    await expect(en.page.locator("main")).not.toContainText(/Role:\s*طالب/);
    await en.ctx.close();

    const ar = await asStudent(browser, "ar");
    await ar.page.goto("/dashboard");
    await ar.page.waitForLoadState("networkidle");
    await expect(ar.page.locator("main")).toContainText(/الدور:\s*طالب/, { timeout: 20_000 });
    await expect(ar.page.locator("main")).not.toContainText(/الدور:\s*Student/);
    await ar.ctx.close();
  });

  test("student security notice is translated and free of internal roadmap wording", async ({ browser }) => {
    const en = await asStudent(browser, "en");
    await en.page.goto("/profile/security");
    await en.page.waitForLoadState("networkidle");
    const body = en.page.locator("main");
    await expect(body).toContainText("Device management (revoke or replace) is handled by the administration", {
      timeout: 20_000,
    });
    // the old inline copy leaked "Phase 1"/"Phase 3" to students
    const enText = (await body.innerText());
    expect(enText).not.toMatch(/Phase\s*[13]/);
    await en.ctx.close();

    const ar = await asStudent(browser, "ar");
    await ar.page.goto("/profile/security");
    await ar.page.waitForLoadState("networkidle");
    const arBody = ar.page.locator("main");
    await expect(arBody).toContainText("تتم عبر الإدارة", { timeout: 20_000 });
    expect(await arBody.innerText()).not.toContain("المرحلة");
    await ar.ctx.close();
  });
});
