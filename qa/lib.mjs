/**
 * Shared QA helpers (local dev only): persistent auth state per account so
 * repeated Playwright contexts reuse ONE device (the platform's device policy
 * blocks new-device logins after the change limit — same approach as
 * tests/e2e/auth.setup.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
export const CREDS = {
  admin: { email: "admin@educore.local", password: "E2e-Admin-2026!" },
  student: { email: "student@educore.local", password: "Student#12345" },
};
export const ROOT = resolve(import.meta.dirname, "..");
const AUTH_DIR = resolve(ROOT, "qa-out/.auth");

export function authPath(who) {
  return resolve(AUTH_DIR, `${who}.json`);
}

/** Try loading a persisted storage state (cookies incl. durable device key). */
export function loadAuth(who) {
  const p = authPath(who);
  if (!existsSync(p)) return null;
  try {
    const st = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(st.cookies) && st.cookies.length ? st : null;
  } catch {
    return null;
  }
}

export async function saveAuth(context, who) {
  mkdirSync(AUTH_DIR, { recursive: true });
  const state = await context.storageState();
  if (!state.cookies?.length) throw new Error("saveAuth: no cookies captured — login did not happen?");
  writeFileSync(authPath(who), JSON.stringify(state));
}

/**
 * Ensure an authenticated context. Returns { page, ctx } — creates the context
 * with the saved state when present; otherwise performs a UI login and saves.
 */
export async function ensureAuth(browser, who, { locale = "en", viewport }) {
  const creds = CREDS[who];
  if (!creds) throw new Error(`unknown account: ${who}`);
  const saved = loadAuth(who);
  const ctx = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    storageState: saved ?? undefined,
  });
  if (!saved) {
    await ctx.addCookies([{ name: "edu_locale", value: locale, url: BASE }]);
  }
  const page = await ctx.newPage();
  if (!saved) {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.getByLabel(/email|البريد/i, { exact: false }).first().fill(creds.email);
    await page.getByLabel(/password|كلمة المرور/i, { exact: false }).first().fill(creds.password);
    await page.getByRole("button", { name: /sign in|تسجيل الدخول|log in|دخول/i }).first().click();
    await page.waitForURL(who === "admin" ? /admin/ : /dashboard/, { timeout: 20000 });
    await ctx.addCookies([{ name: "edu_locale", value: locale, url: BASE }]);
    await saveAuth(ctx, who);
  }
  return { page, ctx };
}
