import { test, expect, type Page, type Locator } from "@playwright/test";
import { ADMIN_STATE, STUDENT_STATE } from "./helpers";

/**
 * Owner-controllability E2E: FREE CONTENT + external Google Form quiz.
 *
 * The "could I run this platform tomorrow?" journey, driven entirely through the
 * Admin UI and verified as a registered student — no direct DB writes anywhere:
 *
 *   create a free course (Arabic + English) -> unit -> lesson
 *   -> attach a YouTube video and a Google Form quiz
 *   -> publish -> student finds it in the catalog and both items render.
 *
 * Free content deliberately uses the EXISTING content model (a course with
 * accessLevel=authenticated) rather than a parallel "free" hierarchy, so there is
 * one place where content lives and one set of Admin controls for it.
 */

const YT_ID = "aBcDeFgHiJk";
const FORM_ID = "1FAIpQLSdFreeContentQuiz0123456789";
const YT_URL = `https://youtu.be/${YT_ID}`;
const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?usp=sf_link`;

const COURSE_AR = "القسم المجاني";
const COURSE_EN = "Free Content";
const LESSON_AR = "درس مجاني";
const LESSON_EN = "Free lesson";

/** The "create child" card on a content node page. */
function childForm(page: Page): Locator {
  return page.locator("form").filter({ has: page.locator('input[name="parentId"]') }).first();
}

/**
 * Set a form field and CONFIRM it stuck.
 *
 * Admin navigation between content nodes is a client-side transition, so
 * `waitForLoadState("load")` resolves before React has committed the new route's
 * inputs; a value written into a node React is about to replace is silently lost.
 * A human typing never hits this, but a test must wait for the field to be stable.
 */
async function setField(page: Page, scope: Locator, name: string, value: string) {
  const el = scope.locator(`[name="${name}"]`);
  await expect(el).toBeVisible({ timeout: 15_000 });
  const isSelect = await el.evaluate((n) => n.tagName === "SELECT");
  for (let attempt = 0; attempt < 5; attempt++) {
    if (isSelect) await el.selectOption(value);
    else await el.fill(value);
    if ((await el.inputValue()) === value) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`field ${name} would not hold "${value}"`);
}

/** Wait for a content node page to be fully committed before touching its forms. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main h1, main h2").first()).toBeVisible({ timeout: 15_000 });
}

/** settle() + assert the "create child" form is actually there and editable. */
async function settleWithChildForm(page: Page) {
  await settle(page);
  await expect(childForm(page).locator('input[name="titleAr"]')).toBeVisible({ timeout: 15_000 });
}

test.describe("owner-built free content with an external quiz", () => {
  test.use({ storageState: ADMIN_STATE });

  test("create free course -> lesson -> YouTube + Google Form -> student sees both", async ({ page, browser }) => {
    // ---- 1) create the free course under the seeded Physics subject -------
    await page.goto("/admin/content");
    const subjectLink = page.locator('a[href^="/admin/content/subject/"]', { hasText: /Physics|الفيزياء/i }).first();
    await expect(subjectLink).toBeVisible({ timeout: 20_000 });
    await subjectLink.click();
    await settleWithChildForm(page);

    const cf = childForm(page);
    await setField(page, cf, "titleAr", COURSE_AR);
    await setField(page, cf, "titleEn", COURSE_EN);
    await setField(page, cf, "status", "published");
    // "authenticated" = any registered student may take it without buying access
    await setField(page, cf, "accessLevel", "authenticated");
    await cf.getByRole("button").last().click();
    await settle(page);

    // ---- 2) open the new course, create a unit ---------------------------
    await page.goto("/admin/content");
    const courseLink = page.locator('a[href^="/admin/content/course/"]', { hasText: new RegExp(COURSE_EN) }).first();
    await expect(courseLink).toBeVisible({ timeout: 20_000 });
    await courseLink.click();
    await settleWithChildForm(page);

    const uf = childForm(page);
    await setField(page, uf, "titleAr", "الوحدة الأولى");
    await setField(page, uf, "titleEn", "Unit one");
    await setField(page, uf, "status", "published");
    await uf.getByRole("button").last().click();
    await settle(page);

    // ---- 3) create a lesson inside the unit ------------------------------
    const unitLink = page.locator('a[href^="/admin/content/unit/"]', { hasText: /Unit one/ }).first();
    await expect(unitLink).toBeVisible({ timeout: 20_000 });
    await unitLink.click();
    await settleWithChildForm(page);

    const lf = childForm(page);
    await setField(page, lf, "titleAr", LESSON_AR);
    await setField(page, lf, "titleEn", LESSON_EN);
    await setField(page, lf, "status", "published");
    await setField(page, lf, "accessLevel", "authenticated");
    await lf.getByRole("button").last().click();
    await settle(page);

    const lessonLink = page.locator('a[href^="/admin/content/lesson/"]', { hasText: new RegExp(LESSON_EN) }).first();
    await expect(lessonLink).toBeVisible({ timeout: 20_000 });
    await lessonLink.click();
    await settle(page);

    // ---- 4) register a YouTube video, then attach it ---------------------
    await page.goto("/admin/videos");
    const yt = page.getByTestId("youtube-form");
    await expect(yt).toBeVisible({ timeout: 20_000 });
    await yt.getByTestId("youtube-url").fill(YT_URL);
    await yt.locator('input[name="titleEn"]').fill("Free intro video");
    await yt.getByRole("button", { name: /Add YouTube video/i }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("youtube-id").first()).toHaveText(YT_ID, { timeout: 15_000 });

    await page.goto("/admin/content");
    await page.locator('a[href^="/admin/content/lesson/"]', { hasText: new RegExp(LESSON_EN) }).first().click();
    await settle(page);

    const itemForm = page.locator("form").filter({ has: page.locator('input[name="_action"][value="add-item"]') });
    await expect(itemForm).toBeVisible({ timeout: 20_000 });
    await itemForm.getByTestId("item-type").selectOption("video");
    const videoId = await itemForm.locator('select[name="videoId"] option').filter({ hasText: "Free intro video" }).first().getAttribute("value");
    expect(videoId, "the YouTube video must be offered in the lesson picker").toBeTruthy();
    await itemForm.locator('select[name="videoId"]').selectOption(videoId!);
    await itemForm.getByRole("button").last().click();
    await settle(page);

    // ---- 5) attach the Google Form quiz ----------------------------------
    await itemForm.getByTestId("item-type").selectOption("link");
    await itemForm.getByTestId("link-url").fill(FORM_URL);
    await itemForm.locator('input[name="titleAr"]').fill("اختبار القسم المجاني");
    await itemForm.locator('input[name="titleEn"]').fill("Free content quiz");
    await itemForm.getByRole("button").last().click();
    await settle(page);
    await expect(page.locator("li").filter({ hasText: "Free content quiz" }).first()).toBeVisible({ timeout: 15_000 });

    // an invalid Google Forms URL must be refused, not stored
    await itemForm.getByTestId("item-type").selectOption("link");
    await itemForm.getByTestId("link-url").fill("https://docs.google.com/spreadsheets/d/1abc/edit");
    await itemForm.getByRole("button").last().click();
    await settle(page);
    await expect(page.getByTestId("link-error")).toBeVisible({ timeout: 15_000 });

    // ---- 6) the registered student experiences it ------------------------
    const student = await browser.newContext({ storageState: STUDENT_STATE });
    const sp = await student.newPage();

    await sp.goto("/courses");
    const catalogCard = sp.locator('a[href^="/courses/"]', { hasText: new RegExp(COURSE_EN) }).first();
    await expect(catalogCard).toBeVisible({ timeout: 20_000 });
    await catalogCard.click();
    await sp.waitForLoadState("networkidle");

    const learn = sp.locator('a[href^="/learn/"]', { hasText: new RegExp(LESSON_EN) }).first();
    await expect(learn).toBeVisible({ timeout: 20_000 });
    await learn.click();
    await sp.waitForLoadState("networkidle");

    // the YouTube player renders, pinned to the privacy-enhanced host
    const embed = sp.getByTestId("video-embed");
    await expect(embed).toBeVisible({ timeout: 25_000 });
    const ytUrl = new URL((await embed.getAttribute("src"))!);
    expect(ytUrl.hostname).toBe("www.youtube-nocookie.com");
    expect(ytUrl.pathname).toBe(`/embed/${YT_ID}`);

    // the Google Form renders, pinned to docs.google.com with ?embedded=true
    const quiz = sp.getByTestId("external-quiz").locator("iframe");
    await expect(quiz).toBeVisible({ timeout: 20_000 });
    const quizUrl = new URL((await quiz.getAttribute("src"))!);
    expect(quizUrl.hostname).toBe("docs.google.com");
    expect(quizUrl.searchParams.get("embedded")).toBe("true");
    expect(quizUrl.pathname).toContain(FORM_ID);
    expect(quizUrl.searchParams.get("usp"), "tracking params must be stripped").toBeNull();

    // and there is always an explicit external-open path
    const open = sp.getByTestId("external-quiz-open");
    await expect(open).toBeVisible();
    expect(new URL((await open.getAttribute("href"))!).searchParams.get("embedded")).toBeNull();

    await student.close();
  });
});
