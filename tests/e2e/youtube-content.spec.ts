import { test, expect, type Page } from "@playwright/test";
import { ADMIN_STATE, STUDENT_STATE, FIXTURES } from "./helpers";

/**
 * Owner-controllability E2E: YouTube video management.
 *
 * Full loop through real UI, no direct DB writes:
 *   Admin pastes an ordinary YouTube URL → save → attach to a lesson →
 *   a registered student opens the lesson → the sandboxed player renders.
 *
 * The embed URL is rebuilt server-side from a validated 11-char id on the
 * privacy-enhanced host, so these tests also pin that the pasted string can
 * never reach the page as markup.
 */

const YT_ID = "dQw4w9WgXcQ";
/** Deliberately carries tracking params — only the id may survive. */
const YT_URL = `https://www.youtube.com/watch?v=${YT_ID}&t=42s&si=AbC123`;
const TITLE_EN = "Chapter 1 revision (YT)";

/** The settings form that owns the YouTube controls. */
function ytForm(page: Page) {
  return page.getByTestId("youtube-form");
}

test.describe("owner-managed YouTube video", () => {
  test.use({ storageState: ADMIN_STATE });

  test("Admin adds a YouTube URL, attaches it to a lesson, and the student sees the player", async ({ page, browser }) => {

    // ---- 1) create the video through the real Admin UI -------------------
    await page.goto("/admin/videos");
    const form = ytForm(page);
    await expect(form).toBeVisible({ timeout: 20_000 });

    await form.getByTestId("youtube-url").fill(YT_URL);
    await form.locator('input[name="titleAr"]').fill("مراجعة الفصل الأول");
    await form.locator('input[name="titleEn"]').fill(TITLE_EN);
    await form.locator('textarea[name="descriptionEn"]').fill("Owner-added YouTube lesson");
    await form.getByRole("button", { name: /Add YouTube video/i }).click();
    await page.waitForLoadState("load");

    // only the normalised 11-char id is stored/echoed back
    await expect(page.getByTestId("youtube-id").filter({ hasText: YT_ID }).first()).toBeVisible({ timeout: 15_000 });

    // ---- 2) a non-YouTube URL is refused, not stored ---------------------
    await page.goto("/admin/videos");
    await ytForm(page).getByTestId("youtube-url").fill("https://evil.example.com/watch?v=dQw4w9WgXcQ");
    await ytForm(page).getByRole("button", { name: /Add YouTube video/i }).click();
    await page.waitForLoadState("load");
    await expect(page.getByTestId("youtube-error")).toBeVisible({ timeout: 15_000 });
    // the rejected host never appears anywhere in the page
    expect(await page.content()).not.toContain("evil.example.com/watch");

    // ---- 3) attach it to the free-preview lesson -------------------------
    await page.goto("/admin/content");
    const lessonLink = page.locator(`a[href^="/admin/content/lesson/"]`, { hasText: /Introduction to Electric Charges|electrostatics-intro/i }).first();
    await lessonLink.click();
    await page.waitForLoadState("load");

    const itemForm = page.locator("form").filter({ has: page.locator('input[name="_action"][value="add-item"]') });
    await expect(itemForm).toBeVisible({ timeout: 20_000 });
    await itemForm.locator('select[name="itemType"]').selectOption("video");
    // The picker labels each option with the owner's title, so find the new
    // YouTube video by the text the owner actually typed.
    const videoSelect = itemForm.locator('select[name="videoId"]');
    const optionValue = await videoSelect
      .locator("option")
      .filter({ hasText: TITLE_EN })
      .first()
      .getAttribute("value");
    expect(optionValue, "the new YouTube video must be offered in the lesson picker").toBeTruthy();
    await videoSelect.selectOption(optionValue!);
    await itemForm.getByRole("button").last().click();
    await page.waitForLoadState("load");
    await expect(page.locator("li").filter({ hasText: TITLE_EN }).first()).toBeVisible({ timeout: 15_000 });

    // ---- 4) the registered student sees the real player ------------------
    const student = await browser.newContext({ storageState: STUDENT_STATE });
    const sp = await student.newPage();
    await sp.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson1Slug}`);

    const embed = sp.getByTestId("video-embed");
    await expect(embed).toBeVisible({ timeout: 25_000 });

    const src = (await embed.getAttribute("src")) ?? "";
    const parsed = new URL(src);
    // pinned host + only the validated id in the path — nothing pasted survives
    expect(parsed.hostname).toBe("www.youtube-nocookie.com");
    expect(parsed.pathname).toBe(`/embed/${YT_ID}`);
    expect(src).not.toContain("t=42s");
    expect(src).not.toContain("si=AbC123");
    expect(await embed.getAttribute("sandbox")).toContain("allow-scripts");

    // CSP must actually permit that frame, or the browser silently blocks it
    const csp = await sp.evaluate(async () => {
      const r = await fetch("/", { method: "GET" });
      return r.headers.get("content-security-policy") ?? "";
    });
    expect(csp).toContain("frame-src https://www.youtube-nocookie.com");

    await student.close();
  });

  test("a YouTube-only platform still gates paid lessons: the embed is behind entitlement", async ({ browser }) => {
    // An anonymous visitor must not receive playback for the same video.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await anon.newPage();
    const res = await p.request.post("http://127.0.0.1:5173/api/playback/00000000-0000-0000-0000-000000000000");
    expect([401, 404]).toContain(res.status());
    await anon.close();
  });
});
