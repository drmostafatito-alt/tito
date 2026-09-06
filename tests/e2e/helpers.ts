import { expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const AUTH_DIR = resolve(__dirname, ".auth");
export const STUDENT_STATE = resolve(AUTH_DIR, "student.json");
export const ADMIN_STATE = resolve(AUTH_DIR, "admin.json");

export const ADMIN_EMAIL = "admin@educore.local";
export const ADMIN_PASSWORD = "E2e-Admin-2026!";
export const STUDENT_EMAIL = "student@educore.local";
export const STUDENT_PASSWORD = "Student#12345";

/** Seed-fixture slugs (deterministic, from scripts/seed.mjs). */
export const FIXTURES = {
  courseSlug: "physics-3s-full",
  freeCourseSlug: "study-skills",
  lesson1Slug: "electrostatics-intro", // free preview; holds the MOCK VIDEO
  lesson2Slug: "coulomb-law", // entitled; holds the PDF + required exam
  examSlug: "electrostatics-check",
  productSlug: "physics-3s-full-access",
};

/**
 * Log in through the real UI form (exercises the full auth path: device
 * resolution + session + CSRF middleware) and wait for the role's landing page.
 */
export async function loginViaUI(page: Page, email: string, password: string, expectUrl: RegExp) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /log\s*in|دخول/i }).first().click();
  await page.waitForURL(expectUrl, { timeout: 20_000 });
}

/** Register a fresh disposable student (unique email) through the UI.
 *  Registration auto-logs-in (register.tsx calls login() on success) and lands
 *  on the student dashboard — there is NO intermediate login step. */
export async function registerViaUI(page: Page, opts: { email: string; fullName?: string; password?: string }) {
  const password = opts.password ?? "Str0ngPass!77";
  await page.goto("/register");
  await page.locator('input[name="fullName"]').fill(opts.fullName ?? "E2E Student");
  await page.locator('input[name="email"]').fill(opts.email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="passwordConfirm"]').fill(password);
  await page.getByRole("button", { name: /create account|حساب|إنشاء/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

/** Minimal freshness check: the page rendered an <html> shell in the expected direction. */
export async function expectRendered(page: Page, dir: "rtl" | "ltr" = "rtl") {
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
}
