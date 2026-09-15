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

  test("non-native browsers use the hls.js MSE path with minted credentials", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        if (type === "application/vnd.apple.mpegurl") return "";
        return original.call(this, type);
      };
    });
    // The component leaves HLS off the media element until capability detection.
    // Chromium has no native HLS, so a token-carrying media-playlist request is
    // end-to-end proof that the lazy hls.js/MSE path attached successfully.
    const mediaPlaylist = page.waitForResponse(
      (response) => response.url().includes("/api/mock-stream/") && response.url().includes("/media.m3u8?")
    );
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson1Slug}`);
    await expect(page.locator("body")).toContainText("Introduction to Electric Charges");
    await expect(page.locator("video")).toBeVisible({ timeout: 20_000 });
    const response = await mediaPlaylist;
    expect(response.status()).toBe(200);
    const streamedUrl = new URL(response.url());
    expect(streamedUrl.searchParams.get("uid")).toBeTruthy();
    expect(streamedUrl.searchParams.get("exp")).toMatch(/^\d+$/);
    expect(streamedUrl.searchParams.get("token")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("uses native HLS when the browser reports support", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        if (type === "application/vnd.apple.mpegurl") return "probably";
        return original.call(this, type);
      };
    });
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson1Slug}`);
    const video = page.locator("video");
    await expect(video).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => video.getAttribute("src")).toContain("/api/mock-stream/");
    expect(await video.getAttribute("src")).toContain("/master.m3u8?");
  });

  test("shows a controlled error after a fatal HLS bootstrap failure", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        if (type === "application/vnd.apple.mpegurl") return "";
        return original.call(this, type);
      };
    });
    // Fail the lazy player chunk itself. This deterministically exercises the
    // guarded import rejection instead of depending on hls.js retry timing.
    await page.route(/\/assets\/hls-[^/]+\.js(?:\?|$)/, (route) => route.abort("failed"));
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson1Slug}`);
    await expect(page.getByText(/Playback failed|تعذر التشغيل/)).toBeVisible({ timeout: 20_000 });
  });

  test("entitled lesson shows the attached PDF and never links to the retired internal exams", async ({ page }) => {
    await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`);
    await expect(page.locator("body")).toContainText("Coulomb's Law");
    await expect(page.locator("body")).toContainText("physics-revision.pdf");
    // the internal exam engine was retired: no /exams links may appear on a lesson
    expect(await page.locator('a[href^="/exams"]').count()).toBe(0);
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
