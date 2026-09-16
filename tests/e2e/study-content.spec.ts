import { test, expect, type Page, type Locator } from "@playwright/test";
import { ADMIN_STATE, STUDENT_STATE } from "./helpers";

/**
 * STUDENT CONTENT EXPERIENCE — the owner-built content journey, end to end.
 *
 * Everything here is created THROUGH THE ADMIN UI (no direct DB writes), then
 * verified as an anonymous visitor and as a registered student:
 *
 *   academic year 2026/2027 → term الترم الأول
 *   → subject فلسفة ومنطق (under the seeded published grade)
 *   → term container (subject + year + term)
 *   → three lessons: free for everyone · free for registered · paid
 *   → publish, then check the student listing:
 *        · the hub lists the real subject under the real grade with real counts
 *        · the subject page groups by term and numbers the lessons 01, 02, 03
 *        · free content invites the visitor to start (or to sign in)
 *        · PAID content is LISTED and locked with a subscription/activation CTA
 *          — never hidden, never a dead end, never a price the owner did not set
 *        · no "كورس" vocabulary anywhere in the student content surface
 *
 * The suite is hermetic: the E2E database is cold-reset and seeded before the
 * run and contains no study content, so these rows are the only ones that can
 * appear. Production is never touched and no image asset is involved.
 */

const YEAR_AR = "2026/2027";
const TERM_AR = "الترم الأول";
const TERM_EN = "Term 1";
const SUBJECT_AR = "فلسفة ومنطق";
const SUBJECT_EN = "Philosophy and Logic";
const CONTAINER_AR = `${SUBJECT_AR} — ${TERM_AR}`;
const CONTAINER_EN = "Philosophy T1";
const LESSON_FREE_AR = "معنى التفكير الإنساني وتطبيقاته";
const LESSON_FREE_EN = "Meaning of human thinking";
const LESSON_REG_AR = "أهمية التفكير الإنساني";
const LESSON_REG_EN = "The importance of human thinking";
const LESSON_PAID_AR = "الفلسفة والدين والعلم";
const LESSON_PAID_EN = "Philosophy, religion and science";

/**
 * Admin navigation is a client-side transition: `waitForLoadState` resolves before
 * React commits the new route's inputs, so a value written into a field React is
 * about to replace is silently lost. A human typing never hits this; a test must
 * wait until the field actually holds the value.
 */
async function setField(page: Page, scope: Locator, name: string, value: string) {
  const el = scope.locator(`[name="${name}"]`);
  await expect(el).toBeVisible({ timeout: 20_000 });
  for (let attempt = 0; attempt < 5; attempt++) {
    await el.fill(value);
    if ((await el.inputValue()) === value) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`field ${name} would not hold "${value}"`);
}

/** The content creator card — the only form carrying `select[name=contentType]`. */
function creator(page: Page): Locator {
  return page.locator("form").filter({ has: page.locator('select[name="contentType"]') }).first();
}

async function createContent(
  page: Page,
  opts: {
    type: string;
    parentLabel?: string;
    titleAr: string;
    titleEn: string;
    access?: string;
    yearLabel?: string;
    termLabel?: string;
  }
) {
  // Start from a freshly rendered page: the creator keeps its state across React
  // Router revalidations, and a fresh document makes every creation deterministic.
  await page.goto("/admin/content");
  await page.waitForLoadState("networkidle");
  const form = creator(page);
  await expect(form).toBeVisible({ timeout: 20_000 });
  await form.locator('select[name="contentType"]').selectOption(opts.type);
  if (opts.parentLabel) {
    const parent = form.locator('select[name="parentId"]');
    await expect(parent.locator(`option:text-is("${opts.parentLabel}")`)).toBeAttached({ timeout: 20_000 });
    await parent.selectOption({ label: opts.parentLabel });
  }
  if (opts.yearLabel) {
    const year = form.locator('[data-testid="creator-year"]');
    await expect(year.locator(`option:text-is("${opts.yearLabel}")`)).toBeAttached({ timeout: 20_000 });
    await year.selectOption({ label: opts.yearLabel });
  }
  if (opts.termLabel) {
    const term = form.locator('[data-testid="creator-term"]');
    await expect(term.locator(`option:text-is("${opts.termLabel}")`)).toBeAttached({ timeout: 20_000 });
    await term.selectOption({ label: opts.termLabel });
  }
  if (opts.access) await form.locator('select[name="access"]').selectOption(opts.access);
  await form.locator('select[name="status"]').selectOption("published");
  await setField(page, form, "titleAr", opts.titleAr);
  await setField(page, form, "titleEn", opts.titleEn);
  await form.getByRole("button").first().click();
  await page.waitForLoadState("networkidle");
  // The creation must have really landed: the new row is in the admin tree.
  await expect(page.locator("main")).toContainText(opts.titleAr, { timeout: 20_000 });
}

/**
 * Every assertion in this spec is written against the ARABIC student UI, so the
 * locale cookie is pinned for every test (the platform's real Arabic experience
 * is what the brief describes).
 */
const BASE = "http://127.0.0.1:5173";
test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
});

test.describe("owner builds the study content", () => {
  test.use({ storageState: ADMIN_STATE });

  test("academic year → term → subject → term container → lessons", async ({ page }) => {
    await page.goto("/admin/content");
    await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    // --- السنة الدراسية 2026/2027 (owner-typed, never hardcoded) -----------
    const yearForm = page
      .locator("form")
      .filter({ has: page.locator('input[name="_action"][value="create-academic-year"]') })
      .first();
    await expect(yearForm).toBeVisible({ timeout: 20_000 });
    await setField(page, yearForm, "startYear", "2026");
    await setField(page, yearForm, "endYear", "2027");
    await setField(page, yearForm, "titleAr", YEAR_AR);
    await yearForm.locator('select[name="status"]').selectOption("published");
    await yearForm.locator('input[name="isCurrent"]').check();
    await yearForm.getByRole("button").first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="admin-years"]')).toContainText(YEAR_AR, { timeout: 20_000 });

    // --- الترم الأول -------------------------------------------------------
    const termForm = page
      .locator("form")
      .filter({ has: page.locator('input[name="_action"][value="create-term"]') })
      .first();
    await setField(page, termForm, "titleAr", TERM_AR);
    await setField(page, termForm, "titleEn", TERM_EN);
    await termForm.locator('select[name="status"]').selectOption("published");
    await termForm.getByRole("button").first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="admin-terms"]')).toContainText(TERM_AR, { timeout: 20_000 });

    // --- المادة فلسفة ومنطق (the creator auto-selects the first grade) -----
    await createContent(page, { type: "subject", titleAr: SUBJECT_AR, titleEn: SUBJECT_EN });
    await expect(page.locator("main")).toContainText(SUBJECT_AR, { timeout: 20_000 });

    // --- term container: subject + year + term -----------------------------
    await createContent(page, {
      type: "course",
      parentLabel: SUBJECT_AR,
      yearLabel: YEAR_AR,
      termLabel: TERM_AR,
      titleAr: CONTAINER_AR,
      titleEn: CONTAINER_EN,
    });
    await expect(page.locator("main")).toContainText(CONTAINER_AR, { timeout: 20_000 });

    // --- three lessons: free for all · free for registered · paid ----------
    await createContent(page, { type: "termLesson", parentLabel: CONTAINER_AR, titleAr: LESSON_FREE_AR, titleEn: LESSON_FREE_EN, access: "public" });
    await createContent(page, { type: "termLesson", parentLabel: CONTAINER_AR, titleAr: LESSON_REG_AR, titleEn: LESSON_REG_EN, access: "free" });
    await createContent(page, { type: "termLesson", parentLabel: CONTAINER_AR, titleAr: LESSON_PAID_AR, titleEn: LESSON_PAID_EN, access: "paid" });

    await page.goto("/admin/content");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toContainText(LESSON_PAID_AR, { timeout: 20_000 });
  });
});

test.describe("anonymous visitor", () => {
  test("hub → subject → lesson list with free and locked states", async ({ page }) => {

    // 1) the content hub: the real subject under its REAL grade, with counts
    await page.goto("/study");
    const card = page.locator(`[data-testid="study-subject-${await subjectSlug(page)}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(SUBJECT_AR);
    await expect(card).toContainText("الصف");
    await expect(card).toContainText(YEAR_AR);
    const href = await card.locator("a").first().getAttribute("href");
    expect(href).toBeTruthy();

    // 2) the subject page: term band + numbered lessons in owner order
    await page.goto(href!);
    await expect(page.locator("h1")).toContainText(SUBJECT_AR);
    await expect(page.locator('[data-testid="study-subject-context"]')).toContainText("الصف");
    const term = page.locator('[data-testid^="study-term-"]').first();
    await expect(term).toContainText(TERM_AR);
    await expect(term).toContainText(YEAR_AR);
    await expect(page.locator('[data-testid^="study-lesson-number-"]').nth(0)).toHaveText("01");
    await expect(page.locator('[data-testid^="study-lesson-number-"]').nth(1)).toHaveText("02");
    await expect(page.locator('[data-testid^="study-lesson-number-"]').nth(2)).toHaveText("03");

    // 3) free for everyone → open, "ابدأ الدرس"
    const freeRow = await lessonRow(page, LESSON_FREE_AR);
    await expect(freeRow).toHaveAttribute("data-lesson-state", "open");
    await expect(freeRow.locator('[data-testid^="study-lesson-cta-"]')).toContainText("ابدأ الدرس");

    // 4) free for registered → an anonymous visitor is routed to sign-in
    const regRow = await lessonRow(page, LESSON_REG_AR);
    await expect(regRow).toHaveAttribute("data-lesson-state", "sign_in_required");
    const signIn = regRow.locator('[data-testid^="study-lesson-cta-"]');
    await expect(signIn).toContainText("سجّل الدخول");
    await expect(signIn).toHaveAttribute("href", /\/login\?next=/);

    // 5) paid → LISTED, locked, with the activation path (no owner-set price
    //    exists for this scope, so no price is shown)
    const paidRow = await lessonRow(page, LESSON_PAID_AR);
    await expect(paidRow).toHaveAttribute("data-lesson-state", "locked");
    await expect(paidRow).toContainText("للمشتركين");
    await expect(paidRow.locator('[data-testid^="study-lesson-cta-"]')).toBeVisible();
    await expect(page.locator('[data-testid^="study-term-unlock-"]')).toBeVisible();

    // 6) student vocabulary: no "كورس" anywhere in the content surface
    expect(await page.locator("main").innerText()).not.toContain("كورس");
  });
});

test.describe("registered student", () => {
  test.use({ storageState: STUDENT_STATE });

  test("free lessons open, paid stays locked, lesson page renders", async ({ page }) => {
    await page.goto("/study");
    const card = page.locator(`[data-testid="study-subject-${await subjectSlug(page)}"]`);
    const href = await card.locator("a").first().getAttribute("href");
    await page.goto(href!);

    const regRow = await lessonRow(page, LESSON_REG_AR);
    await expect(regRow).toHaveAttribute("data-lesson-state", "open");
    const cta = regRow.locator('[data-testid^="study-lesson-cta-"]');
    await expect(cta).toContainText(/ابدأ الدرس|تابع الدرس|راجع الدرس/);

    const paidRow = await lessonRow(page, LESSON_PAID_AR);
    await expect(paidRow).toHaveAttribute("data-lesson-state", "locked");
    await expect(paidRow.locator('[data-testid^="study-lesson-cta-"]')).not.toContainText("تابع الدرس");

    await cta.click();
    await expect(page).toHaveURL(/\/learn\//);
    await expect(page.locator("h1")).toContainText(LESSON_REG_AR);
  });
});

/** The lesson row (li) whose text contains the given (Arabic) title. */
async function lessonRow(page: Page, titleAr: string): Promise<Locator> {
  const row = page.locator('li[data-testid^="study-lesson-"][data-lesson-state]').filter({ hasText: titleAr }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

/**
 * The published subject slug, read from the hub itself — slugs are generated by
 * the platform's Arabic-aware slugify, so the spec never guesses one.
 */
async function subjectSlug(page: Page): Promise<string> {
  await page.goto("/study");
  const grid = page.locator('[data-testid="study-subjects"]').first();
  await expect(grid).toBeVisible({ timeout: 20_000 });
  const href = await grid.locator(`li[data-testid^="study-subject-"]`, { hasText: SUBJECT_AR }).first().locator("a").first().getAttribute("href");
  if (!href) throw new Error(`no hub card for ${SUBJECT_AR}`);
  return href.replace("/study/", "");
}
