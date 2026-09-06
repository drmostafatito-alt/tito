import { test as setup } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { ADMIN_EMAIL, ADMIN_PASSWORD, STUDENT_EMAIL, STUDENT_PASSWORD, AUTH_DIR, ADMIN_STATE, STUDENT_STATE, loginViaUI } from "./helpers";

/**
 * Persist authenticated storage states (session + durable device-key cookies)
 * once, so every spec reuses ONE device per account — the platform enforces a
 * 1-device limit per user and would otherwise block repeated logins as "new
 * device". Login goes through the REAL UI (device resolution + session mint),
 * and the locale is pinned to English so content assertions are deterministic.
 */
setup("authenticate admin", async ({ page }) => {
  await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/admin/);
  await page.context().addCookies([{ name: "edu_locale", value: "en", url: "http://127.0.0.1:5173" }]);
  mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: ADMIN_STATE });
});

setup("authenticate student", async ({ page }) => {
  await loginViaUI(page, STUDENT_EMAIL, STUDENT_PASSWORD, /\/dashboard/);
  await page.context().addCookies([{ name: "edu_locale", value: "en", url: "http://127.0.0.1:5173" }]);
  mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: STUDENT_STATE });
});
