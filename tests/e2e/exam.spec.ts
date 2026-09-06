import { test, expect } from "@playwright/test";
import { STUDENT_STATE, FIXTURES } from "./helpers";

/**
 * W4 — Exam journey: attempt → autosave → submit → result.
 * Server-authoritative throughout. The seeded exam has 2 questions (Q1 = 2-point
 * MCQ "product of the two charges"; Q2 = 1-point true/false "True"), pass 50%.
 *
 * Autosave is proven by RELOADING the attempt mid-way: the loader re-fetches the
 * server-persisted answers, so a selected choice that survives a reload proves
 * the /api/exam-attempt save actually reached D1 (not just client state).
 */

test.describe("exam attempt → autosave → submit → result", () => {
  test.use({ storageState: STUDENT_STATE });

  test("full attempt lifecycle: start → answer (autosave survives reload) → submit → result", async ({ page }) => {
    await page.goto(`/exams/${FIXTURES.examSlug}`);
    await expect(page.locator("body")).toContainText("Check: Electrostatics");

    // start the attempt (real form action)
    await page.getByRole("button", { name: /start/i }).first().click();
    await page.waitForURL(/\/attempt/, { timeout: 20_000 });

    // answer Q1 (the 2-point MCQ)
    const correctChoice = page.getByRole("button", { name: /product of the two charges/i });
    await correctChoice.click();
    await expect(correctChoice).toHaveAttribute("aria-pressed", "true");

    // give the autosave POST a moment, then reload to prove server persistence
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.locator('[data-question-id]')).toBeVisible();
    await expect(page.getByRole("button", { name: /product of the two charges/i })).toHaveAttribute("aria-pressed", "true");

    // advance to Q2 and answer the true/false question
    await page.getByRole("button", { name: /next question|السؤال التالي/i }).click();
    await expect(page.locator("body")).toContainText("The unit of electric charge is the coulomb.");
    await page.getByRole("button", { name: /^True$/i }).click();

    // submit → confirm in the modal ("Submit for good" / "تسليم نهائي")
    await page.getByRole("button", { name: /finish & submit|إنهاء وتسليم/i }).first().click();
    await page.getByRole("button", { name: /submit for good|تسليم نهائي/i }).first().click();

    // immediate results (seeded config: show=immediate, review enabled)
    await page.waitForURL(/\/results\//, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(/passed/i);
  });

  test("unknown attempt deep-link does not 500 (intro is the entry point)", async ({ page }) => {
    const res = await page.goto(`/exams/${FIXTURES.examSlug}/attempt`);
    expect(res?.status() !== 500).toBe(true);
  });
});
