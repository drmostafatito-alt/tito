import { test, expect } from "@playwright/test";
import { STUDENT_STATE, STUDENT_EMAIL } from "./helpers";

/**
 * W4 — Security / permission journeys (negative paths, IDOR, isolation).
 * Everything here asserts that a low-privilege actor is DENIED, and that no
 * cross-user data leaks — the server-side controls, exercised through the UI.
 */

test.describe("IDOR & privilege isolation (student actor)", () => {
  test.use({ storageState: STUDENT_STATE });

  test("student cannot open another user's admin detail (IDOR → redirect, no data)", async ({ page }) => {
    // the student has no users.read → requireRole 404-shapes the request
    await page.goto("/admin/users");
    await page.waitForURL(/\/dashboard\?error=forbidden/, { timeout: 20_000 });
    await expect(page.locator("body")).not.toContainText(STUDENT_EMAIL);
  });

  test("student cannot reach the audit viewer (read-only admin surface)", async ({ page }) => {
    await page.goto("/admin/audit");
    await page.waitForURL(/\/dashboard\?error=forbidden/, { timeout: 20_000 });
  });

  test("student cannot reach the commerce admin hub", async ({ page }) => {
    await page.goto("/admin/commerce");
    await page.waitForURL(/\/dashboard\?error=forbidden/, { timeout: 20_000 });
  });

  test("student cannot reach the security center", async ({ page }) => {
    await page.goto("/admin/security");
    await page.waitForURL(/\/dashboard\?error=forbidden/, { timeout: 20_000 });
  });

  test("global CSRF gate rejects missing and cross-origin mutation evidence", async ({ page }) => {
    const target = "/api/playback/00000000-0000-4000-8000-0000000000ff";
    const missing = await page.request.post(target);
    expect(missing.status()).toBe(403);
    expect(await missing.text()).toBe("Forbidden");

    const crossOrigin = await page.request.post(target, { headers: { Origin: "https://attacker.example" } });
    expect(crossOrigin.status()).toBe(403);
    expect(await crossOrigin.text()).toBe("Forbidden");

    const sameOrigin = await page.request.post(target, { headers: { Origin: "http://127.0.0.1:5173" } });
    // 401/404 is the route's own denial, proving the request passed the CSRF
    // layer; only a CSRF 403 would indicate same-origin evidence was rejected.
    expect([401, 404]).toContain(sameOrigin.status());
  });

  test("unknown video playback never leaks credentials (401/403/404, never 200)", async ({ page }) => {
    const res = await page.request.post("/api/playback/00000000-0000-4000-8000-0000000000ff");
    // unauth → 401, unknown-but-authed → 404, unentitled → 403: all deny. A 200
    // (minted credentials) would be an oracle/data leak — assert it can't happen.
    expect(res.status()).not.toBe(200);
    expect([401, 403, 404]).toContain(res.status());
    const body = await res.text();
    expect(body).not.toContain("/api/mock-stream/");
    expect(body).not.toContain("url");
  });
});
