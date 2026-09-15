import { expect, test } from "@playwright/test";
import { loginViaUI, registerViaUI } from "./helpers";

const CAPTURE_SECRET = "e2e-capture-gate-fake-value";

type CaptureMessage = { to: string; subject: string; html: string; text?: string };

async function capturedMessages(page: import("@playwright/test").Page, email: string): Promise<CaptureMessage[]> {
  const response = await page.request.get(`/__test/email-capture?to=${encodeURIComponent(email)}`, {
    headers: { "x-test-capture-secret": CAPTURE_SECRET },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { messages: CaptureMessage[] };
  return body.messages;
}

async function capturedResetMessages(page: import("@playwright/test").Page, email: string): Promise<CaptureMessage[]> {
  return (await capturedMessages(page, email)).filter((message) => message.html.includes("/reset-password#token="));
}

async function capturedEmailChangeMessages(page: import("@playwright/test").Page, email: string): Promise<CaptureMessage[]> {
  return (await capturedMessages(page, email)).filter((message) => message.html.includes("/verify-email-change#token="));
}

test.describe("password recovery via hermetic email capture", () => {
  test("known/unknown generic response → fragment exchange → reset → old/new login and replay protection", async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `recovery-${suffix}@test.local`;
    const unknownEmail = `unknown-${suffix}@test.local`;
    const oldPassword = "RecoveryOld!77";
    const newPassword = "RecoveryNew!88";
    await registerViaUI(page, { email, fullName: "Recovery E2E", password: oldPassword });

    await page.goto("/forgot-password");
    await page.locator('input[name="email"]').fill(unknownEmail);
    await page.locator('input[name="email"]').locator('xpath=ancestor::form').locator('button[type="submit"]').click();
    const unknownNotice = await page.locator('main [role="status"]').innerText();

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="email"]').locator('xpath=ancestor::form').locator('button[type="submit"]').click();
    const knownNotice = await page.locator('main [role="status"]').innerText();
    expect(knownNotice).toBe(unknownNotice);
    expect(await page.content()).not.toContain("#token=");

    await expect.poll(async () => (await capturedResetMessages(page, email)).length, { timeout: 10_000 }).toBe(1);
    const [message] = await capturedResetMessages(page, email);
    expect(message.to).toBe(email);
    expect(message.html).toContain('dir="rtl"');
    expect(message.html.toLowerCase()).not.toContain("educore");
    const linkMatch = /https?:\/\/[^"'<\s]+\/reset-password#token=([A-Za-z0-9_-]{43})/.exec(message.html);
    expect(linkMatch).toBeTruthy();
    const resetUrl = linkMatch![0];
    const rawToken = linkMatch![1];

    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));
    await page.goto(resetUrl);
    await page.waitForURL((url) => url.pathname === "/reset-password" && url.hash === "", { timeout: 15_000 });
    await expect(page.locator('input[name="password"]')).toBeVisible();
    expect(page.url()).not.toContain(rawToken);
    expect(requestedUrls.filter((url) => !url.startsWith("data:"))).not.toEqual(
      expect.arrayContaining([expect.stringContaining(rawToken)])
    );

    const resetCookie = (await page.context().cookies()).find((cookie) => cookie.name === "__Host-edu_reset");
    expect(resetCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

    await page.locator('input[name="password"]').fill(newPassword);
    await page.locator('input[name="passwordConfirm"]').fill(newPassword);
    await page.locator('input[name="password"]').locator('xpath=ancestor::form').locator('button[type="submit"]').click();
    await page.waitForURL(/\/login\?reset=1/, { timeout: 15_000 });
    expect((await page.context().cookies()).some((cookie) => cookie.name === "__Host-edu_reset")).toBe(false);

    // The old password no longer authenticates.
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(oldPassword);
    await page.locator('input[name="password"]').locator('xpath=ancestor::form').locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('[role="alert"]')).toBeVisible();

    // The new password authenticates on the same durable device.
    await loginViaUI(page, email, newPassword, /\/dashboard/);

    // The original email link is single-use, even after a successful login.
    await page.goto(resetUrl);
    await page.waitForURL((url) => url.pathname === "/reset-password" && url.hash === "", { timeout: 15_000 });
    await expect(page.locator('[role="alert"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
  });

  test("email change requires current password and redeems a fragment only by POST", async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const oldEmail = `email-old-${suffix}@test.local`;
    const newEmail = `email-new-${suffix}@test.local`;
    const password = "EmailChange!77";
    await registerViaUI(page, { email: oldEmail, fullName: "Email Change E2E", password });
    await page.goto("/profile");

    const form = page.locator('input[name="currentPassword"]').locator("xpath=ancestor::form");
    await form.locator('input[name="newEmail"]').fill(newEmail);
    await form.locator('input[name="currentPassword"]').fill("WrongPassword!8");
    await form.locator('button[type="submit"]').click();
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    expect(await capturedEmailChangeMessages(page, newEmail)).toHaveLength(0);

    await form.locator('input[name="newEmail"]').fill(newEmail);
    await form.locator('input[name="currentPassword"]').fill(password);
    await form.locator('button[type="submit"]').click();
    await expect(page.locator('main [role="status"]')).toBeVisible();

    await expect.poll(async () => (await capturedEmailChangeMessages(page, newEmail)).length, { timeout: 10_000 }).toBe(1);
    const [message] = await capturedEmailChangeMessages(page, newEmail);
    expect(message.html).not.toContain("/verify-email-change?token=");
    const link = /https?:\/\/[^"'<\s]+\/verify-email-change#token=([A-Za-z0-9_-]{43})/.exec(message.html);
    expect(link).toBeTruthy();
    const rawToken = link![1];

    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));
    await page.goto(link![0]);
    await page.waitForURL((url) => url.pathname === "/verify-email-change" && url.hash === "", { timeout: 15_000 });
    await expect(page.locator('main [role="status"]')).toContainText(newEmail);
    expect(requestedUrls.filter((url) => !url.startsWith("data:"))).not.toEqual(
      expect.arrayContaining([expect.stringContaining(rawToken)])
    );

    // Verification revokes every old session; the unchanged password now works
    // only with the verified address.
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await loginViaUI(page, newEmail, password, /\/dashboard/);
  });

  test("capture inbox is inaccessible without its synthetic test gate", async ({ request }) => {
    expect((await request.get("/__test/email-capture?to=x%40test.local")).status()).toBe(404);
    expect(
      (await request.get("/__test/email-capture?to=x%40test.local", { headers: { "x-test-capture-secret": "wrong" } })).status()
    ).toBe(404);
  });
});
