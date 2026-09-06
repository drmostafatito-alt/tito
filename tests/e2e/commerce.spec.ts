import { test, expect } from "@playwright/test";
import { ADMIN_STATE, FIXTURES, registerViaUI } from "./helpers";

/**
 * W4 — Commerce journey on the REAL manual-rail flow (no mock gateway, no real
 * money): a fresh unentitled student checks out → confirms the transfer → the
 * admin approves → the entitlement is granted and the lesson unlocks. Cross-role,
 * exercised with two browser contexts sharing the seeded admin storage state.
 */

test("manual checkout → admin approval → entitlement unlocks the lesson", async ({ browser }) => {
  const email = `buy-${Date.now()}@test.local`;
  const password = "Str0ngPass!77";

  // --- fresh student context (registration auto-logs-in; no pre-existing access) ---
  const studentCtx = await browser.newContext();
  // pin English so content assertions are deterministic (registration has no locale pref)
  await studentCtx.addCookies([{ name: "edu_locale", value: "en", url: "http://127.0.0.1:5173" }]);
  const student = await studentCtx.newPage();
  await registerViaUI(student, { email, fullName: "E2E Buyer", password });

  // entitled course is locked for this new student (course page shows no buy CTA
  // for the whole course, but the product page sells access)
  await student.goto(`/products/${FIXTURES.productSlug}`);
  await student.getByTestId("buy-cta").first().click();
  await student.waitForURL(/\/checkout\//, { timeout: 20_000 });

  // server-computed total is 300.00 EGP (30000 minors) — never a client number
  await expect(student.getByTestId("checkout-total")).toContainText(/300\.00/);
  await student.getByRole("button", { name: /create order|إنشاء طلب/i }).click();

  // order receipt (manual rail) — capture the order number from the URL
  await student.waitForURL(/\/orders\/EC-/, { timeout: 20_000 });
  const orderNumber = student.url().split("/orders/")[1].split("?")[0];
  expect(orderNumber).toMatch(/^EC-/);

  // confirm the transfer with a reference (grants NOTHING until approval)
  await student.locator('input[name="transferReference"]').fill("INSTAPAY-REF-123");
  await student.getByRole("button", { name: /submit for review|قيد المراجعة/i }).first().click();
  await expect(student.locator("body")).toContainText(/under review|قيد المراجعة/i);

  // lesson still locked before approval (paid ≠ authorized without fulfillment)
  await student.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`);
  await expect(student.locator("body")).toContainText(/requires an access grant|يتطلب صلاحية وصول/i);

  // --- admin context (seeded super admin storage state) ---
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE });
  const admin = await adminCtx.newPage();
  await admin.goto("/admin/commerce?tab=orders");
  const orderRow = admin.getByTestId("admin-order-row").filter({ hasText: orderNumber });
  await expect(orderRow).toBeVisible({ timeout: 15_000 });
  await orderRow.getByRole("link").click();
  await admin.waitForURL(/\/admin\/commerce\/orders\//, { timeout: 15_000 });

  // approve the under-review payment (amount pre-filled to the server total)
  await admin.getByRole("button", { name: /approve & grant|موافقة/i }).first().click();
  await expect(admin.locator("body")).toContainText(/approved|تمت الموافقة|grant/i, { timeout: 15_000 });

  // --- back to the student: the same resolver now grants access ---
  await student.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`);
  await expect(student.locator("body")).toContainText("Coulomb's Law");
  await expect(student.locator("body")).not.toContainText(/requires an access grant|يتطلب صلاحية وصول/i);

  await adminCtx.close();
  await studentCtx.close();
});
