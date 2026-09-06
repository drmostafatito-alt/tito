import { test, expect } from "@playwright/test";
import { STUDENT_STATE, STUDENT_EMAIL, registerViaUI } from "./helpers";

/**
 * W4 — Authentication journey (happy paths + authorization/negative paths).
 * Budget note: registration is rate-limited (5/hour/IP) and login (10/min/IP)
 * against a shared local IP — this spec registers ONE disposable student and
 * otherwise reuses persisted storage states (no extra logins).
 */

test.describe("authentication", () => {
  test("anonymous user sees the login page and can reach it from the shell", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", /rtl|ltr/);
  });

  test("wrong password is rejected with a uniform error (no account oracle)", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(STUDENT_EMAIL);
    await page.locator('input[name="password"]').fill("definitely-wrong-password");
    await page.getByRole("button", { name: /log\s*in|دخول/i }).first().click();
    // stays on /login and shows a generic error — never "email not found"
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator("body")).toContainText(/incorrect|غير صحيحة/i);
    await expect(page.locator("body")).not.toContainText(/not found|غير موجود/i);
  });

  test("a logged-out visitor is redirected away from the student dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
  });

  test("registration creates an account and auto-logs-in to the dashboard", async ({ page }) => {
    const email = `e2e-${Date.now()}@test.local`;
    await registerViaUI(page, { email, fullName: "E2E Registrant" });
    // register.tsx calls login() on success → lands directly on /dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator("body")).toContainText(/dashboard|لوحة/i);
  });
});

test.describe("authorization (negative paths)", () => {
  test.use({ storageState: STUDENT_STATE });

  test("student cannot reach the admin dashboard (server-side redirect)", async ({ page }) => {
    await page.goto("/admin");
    // requireRole throws a 404-shaped redirect for insufficient rank
    await page.waitForURL(/\/dashboard\?error=forbidden/, { timeout: 20_000 });
  });

  test("student cannot reach admin user management", async ({ page }) => {
    await page.goto("/admin/users");
    await page.waitForURL(/\/dashboard\?error=forbidden/, { timeout: 20_000 });
  });
});
