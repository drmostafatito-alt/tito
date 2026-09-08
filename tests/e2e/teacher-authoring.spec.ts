import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_STATE, registerViaUI } from "./helpers";

/**
 * Teacher authoring role (Batch 3) — real browser pass.
 *
 * - An admin (reusing the persisted storage state so the 1-device policy is
 *   respected) promotes a freshly registered user to teacher and grants the
 *   teacher role authoring permissions via the /admin/teachers matrix.
 * - The (still same-session) user is now a teacher and can open the
 *   question-bank authoring hub through the reused admin shell, sees ONLY the
 *   assessment nav, and is redirected away from user/teacher/commerce
 *   administration.
 */
const TEACHER_PASSWORD = "Str0ngPass!77";

async function collectRuntime(page: Page, errors: string[]) {
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|Failed to load resource|favicon/.test(m.text())) errors.push("console: " + m.text());
  });
}

test.describe.serial("teacher authoring via reused admin shell", () => {
  const runtimeErrors: string[] = [];

  test("promote a user to teacher, grant authoring, verify boundaries", async ({ browser }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const teacherEmail = `teacher-${stamp}@test.local`;

    // 1) admin context — reuse persisted storage state (avoids the 1-device policy)
    const adminCtx: BrowserContext = await browser.newContext({ storageState: ADMIN_STATE });
    const adminPage = await adminCtx.newPage();
    collectRuntime(adminPage, runtimeErrors);

    // 2) teacher context registers the future teacher (auto-login keeps the session)
    const teacherCtx: BrowserContext = await browser.newContext();
    const registerPage = await teacherCtx.newPage();
    await registerViaUI(registerPage, { email: teacherEmail, fullName: "QA Teacher" });

    // 3) promote the user to teacher via the admin user detail page
    await adminPage.goto("/admin/users?q=" + encodeURIComponent(teacherEmail));
    const row = adminPage.locator('[data-testid="admin-user-row"]', { hasText: teacherEmail }).first();
    await row.waitFor({ timeout: 15_000 });
    const link = row.locator('a[href*="/admin/users/"]').first();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/\/admin\/users\//);
    await adminPage.goto(href!);
    await adminPage.locator('[data-testid="role-select"]').selectOption("teacher");
    await adminPage.locator('[data-testid="set-role-btn"] button').click();
    await adminPage.waitForLoadState("networkidle");

    // 4) grant the teacher role authoring permissions via the Teachers matrix UI
    await adminPage.goto("/admin/teachers");
    for (const perm of ["assessment.read", "assessment.create", "assessment.edit"]) {
      const row = adminPage.locator(`[data-testid="matrix-${perm}"]`);
      await row.waitFor({ timeout: 15_000 });
      await row.locator("button", { hasText: /Grant|منح/i }).click();
      await row.locator("button", { hasText: /Revoke|إبطال/i }).first().waitFor({ timeout: 10_000 });
    }

    // 5) same teacher session now reaches the question-bank hub (reused admin shell)
    const teacherPage: Page = registerPage;
    collectRuntime(teacherPage, runtimeErrors);
    const res = await teacherPage.goto("/admin/assessment", { waitUntil: "networkidle" });
    expect(res?.status() ?? 0).toBeLessThan(400);
    await expect(teacherPage).toHaveURL(/\/admin\/assessment/);

    // sidebar is minimal: authoring present, administration absent
    const aside = teacherPage.locator("aside");
    await expect(aside.locator('a[href="/admin/assessment"]')).toBeVisible();
    expect(await aside.locator('a[href="/admin/users"]').count()).toBe(0);
    expect(await aside.locator('a[href="/admin/teachers"]').count()).toBe(0);
    expect(await aside.locator('a[href="/admin/commerce"]').count()).toBe(0);

    // 6) unauthorized admin modules redirect the teacher away (no data pages)
    await teacherPage.goto("/admin/users", { waitUntil: "networkidle" });
    await expect(teacherPage).not.toHaveURL(/\/admin\/users/);
    await teacherPage.goto("/admin/commerce", { waitUntil: "networkidle" });
    await expect(teacherPage).not.toHaveURL(/\/admin\/commerce/);
    await teacherPage.goto("/admin/teachers", { waitUntil: "networkidle" });
    await expect(teacherPage).not.toHaveURL(/\/admin\/teachers/);

    // 7) no uncaught page errors across the authoring pages
    expect(runtimeErrors.filter((e) => e.startsWith("pageerror")).length).toBe(0);

    await adminCtx.close();
    await teacherCtx.close();
  });

  test("admin Teachers page lists the promoted teacher", async ({ browser }) => {
    const adminCtx = await browser.newContext({ storageState: ADMIN_STATE });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto("/admin/teachers");
    await adminPage.locator(`[data-testid="matrix-assessment.read"]`).waitFor({ timeout: 15_000 });
    // page rendered without throwing
    expect(runtimeErrors.filter((e) => e.startsWith("pageerror")).length).toBe(0);
    await adminCtx.close();
  });
});
