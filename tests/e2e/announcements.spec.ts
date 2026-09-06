import { test, expect } from "@playwright/test";
import { ADMIN_STATE, STUDENT_STATE } from "./helpers";

/**
 * W4 — Admin announcement → student notification journey (ADR-025).
 * Draft-invisible → publish → student inbox + unread badge → mark-read.
 * Dual-role with two contexts; the announcement body carries a unique token so
 * the student-side assertion is unambiguous.
 */

test("admin publishes an announcement → student sees it and marks it read", async ({ browser }) => {
  const token = `E2E-${Date.now()}`;
  const titleEn = `E2E Announcement ${token}`;

  // --- admin creates a DRAFT ---
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE });
  const admin = await adminCtx.newPage();
  await admin.goto("/admin/announcements?new=1");
  await admin.getByTestId("ann-title-en").fill(titleEn);
  await admin.getByTestId("ann-title-ar").fill(`إعلان ${token}`);
  await admin.getByTestId("ann-body-en").fill("This is an E2E announcement body.");
  await admin.getByTestId("ann-body-ar").fill("هذا نص إعلان تجريبي.");
  await admin.getByTestId("ann-save").locator("button").click();
  await admin.waitForURL(/\/admin\/announcements/, { timeout: 15_000 });

  // the draft appears in the list with a publish action
  const row = admin.getByTestId("announcement-row").filter({ hasText: titleEn });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // --- student cannot see the DRAFT ---
  const studentCtx = await browser.newContext({ storageState: STUDENT_STATE });
  const student = await studentCtx.newPage();
  await student.goto("/notifications");
  await expect(student.locator("body")).not.toContainText(titleEn);

  // --- admin publishes ---
  await row.getByRole("button", { name: /publish/i }).click();
  await expect(admin.locator("body")).toContainText(/published|تم النشر/i, { timeout: 15_000 });

  // --- student now sees it + an unread badge, then marks it read ---
  await student.goto("/notifications");
  await expect(student.locator("body")).toContainText(titleEn, { timeout: 15_000 });
  // the unread badge carries data-testid="notif-unread-<id>" (label is "New")
  await expect(student.locator('[data-testid^="notif-unread-"]').first()).toBeVisible({ timeout: 10_000 });

  // mark-read resolves the unread state (server mutation)
  await student.locator('[data-testid^="mark-read-"]').first().locator("button").click();
  await expect(student.locator('[data-testid^="notif-unread-"]')).toHaveCount(0, { timeout: 10_000 });

  await adminCtx.close();
  await studentCtx.close();
});
