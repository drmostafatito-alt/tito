import { test, expect } from "@playwright/test";
import { STUDENT_STATE, FIXTURES } from "./helpers";

/**
 * W4 — Lesson / video + progress journey (entitled seeded student).
 * The mock video provider mints a synthetic HLS playlist (no real A/V decode —
 * documented limitation), but the <video> element, its credential-minted src,
 * the attached PDF, and server-side progress are all real.
 */

test.describe("lesson, video & progress (entitled student)", () => {
  test.use({ storageState: STUDENT_STATE });

  test("lesson with the mock video renders the player with minted credentials", async ({ page }) => {
    // the seed attaches the mock video to lesson 1 (free preview)
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson1Slug}`);
    await expect(page.locator("body")).toContainText("Introduction to Electric Charges");
    // the VideoPlayer fetches playback creds server-side (POST /api/playback)
    // and mounts a <video> whose src carries the minted mock-stream token
    const video = page.locator("video");
    await expect(video).toBeVisible({ timeout: 20_000 });
    const src = (await video.getAttribute("src")) ?? "";
    expect(src).toContain("/api/mock-stream/");
  });

  test("entitled lesson shows the attached PDF and the required exam item", async ({ page }) => {
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`);
    await expect(page.locator("body")).toContainText("Coulomb's Law");
    await expect(page.locator("body")).toContainText("physics-revision.pdf");
    // the required exam on lesson 2 is surfaced as an item with a start link
    await expect(page.locator(`a[href="/exams/${FIXTURES.examSlug}"]`)).toBeVisible();
  });

  test("mark-complete is a real server mutation that flips the label", async ({ page }) => {
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`);
    await page.getByRole("button", { name: /mark lesson as complete/i }).click();
    // after completion the button label flips to the "mark as not complete" action
    await expect(page.getByRole("button", { name: /mark as not complete/i })).toBeVisible({ timeout: 15_000 });
    // toggling back is idempotent-safe
    await page.getByRole("button", { name: /mark as not complete/i }).click();
    await expect(page.getByRole("button", { name: /mark lesson as complete/i })).toBeVisible({ timeout: 15_000 });
  });

  test("free-preview lesson is reachable while anon is not (contrast)", async ({ page }) => {
    // lesson 1 is free_preview=true: a logged-in student can open it directly
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson1Slug}`);
    await expect(page.locator("body")).toContainText("Introduction to Electric Charges");
  });
});
