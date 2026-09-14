import { test, expect, type Page, type Locator } from "@playwright/test";
import { ADMIN_STATE, STUDENT_STATE } from "./helpers";

/**
 * Owner-controllability E2E: the CMS page builder.
 *
 * Nothing previously exercised the CMS end to end in a real browser — the
 * homepage specs only asserted that the seeded page renders. These tests close
 * that gap by driving the actual Admin editor and checking the anonymous public
 * page:
 *
 *   change text (AR + EN) -> publish -> visitor sees it
 *   hide a block   -> publish -> it disappears; show -> it returns
 *   reorder sections -> publish -> the public order changes
 *   save a page as a reusable template
 *   a student cannot reach any of it
 *
 * Every test restores what it changed, so the seeded homepage is intact for the
 * specs that run afterwards.
 */

const BLOCK_SETTINGS = /Block settings|إعدادات المكوّن/;

/** The CMS block-settings form (one per block, in document order). */
function blockForms(page: Page): Locator {
  return page.locator("form").filter({ has: page.locator('input[name="_action"][value="save-block"]') });
}

/** A block's toolbar form, addressed by blockId (+ optional move direction). */
function toolForm(page: Page, action: string, blockId: string, direction?: "up" | "down"): Locator {
  let l = page
    .locator("form")
    .filter({ has: page.locator(`input[name="_action"][value="${action}"]`) })
    .filter({ has: page.locator(`input[name="blockId"][value="${blockId}"]`) });
  if (direction) l = l.filter({ has: page.locator(`input[name="direction"][value="${direction}"]`) });
  return l.first();
}

async function openHomeEditor(page: Page) {
  await page.goto("/admin/cms");
  await page.locator('a[href^="/admin/cms/pages/"]', { hasText: /^Home$|الرئيسية/ }).first().click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("summary").filter({ hasText: BLOCK_SETTINGS }).first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Block settings live in a collapsed <details>. Set `open` directly rather than
 * clicking the <summary>: a click can be undone by a client-side revalidation
 * re-rendering the uncontrolled <details> shut before the assertion runs.
 */
async function expandBlock(page: Page, index: number) {
  // Address the <details> through the form itself: save-block forms exist for
  // BOTH section wrappers and their child blocks, while only children get a
  // "Block settings" <summary>, so summary index != form index.
  await blockForms(page).nth(index).evaluate((form) => {
    const d = form.closest("details");
    if (d) d.open = true;
  });
  await expect(blockForms(page).nth(index).locator("input[name^='f.']").first()).toBeVisible({ timeout: 15_000 });
}

/**
 * The first block whose Arabic heading is actually set. Seeded section wrappers
 * often have an empty heading (the section is a layout container), so the first
 * block in the document is not necessarily one whose text a visitor can read.
 */
async function firstBlockWithHeading(page: Page) {
  const forms = blockForms(page);
  const n = await forms.count();
  for (let i = 0; i < n; i++) {
    const ar = forms.nth(i).locator('input[name="f.heading.ar"]').first();
    if (!(await ar.count())) continue;
    await expandBlock(page, i);
    const value = (await ar.inputValue()).trim();
    if (value) {
      return {
        index: i,
        value,
        en: (await forms.nth(i).locator('input[name="f.heading.en"]').first().inputValue()).trim(),
        id: await forms.nth(i).locator('input[name="blockId"]').first().inputValue(),
      };
    }
  }
  throw new Error("no block on the homepage has an Arabic heading");
}

/**
 * Fill a block's fields, save, and PROVE the draft took them before the test
 * publishes. Two real-world hazards are absorbed here:
 *   - typing before React hydration finishes (the hydrated value clobbers the
 *     input), and
 *   - a publish that races the save POST.
 * Both would otherwise surface as an unrelated-looking flake in the visitor
 * assertions further down the test.
 */
async function saveBlockAndVerifyDraft(
  page: Page,
  index: number,
  fields: Array<{ name: string; value: string }>
) {
  await expandBlock(page, index);
  const form = blockForms(page).nth(index);
  for (const f of fields) {
    const input = form.locator(`input[name="${f.name}"]`);
    await input.fill(f.value);
    await expect(input).toHaveValue(f.value);
  }
  await form.locator("button").last().click();
  await page.waitForLoadState("networkidle");

  // Reload the builder: the value must have been SAVED (not just typed).
  await openHomeEditor(page);
  await expandBlock(page, index);
  for (const f of fields) {
    await expect(blockForms(page).nth(index).locator(`input[name="${f.name}"]`)).toHaveValue(f.value, { timeout: 10_000 });
  }
}

async function publish(page: Page) {
  await page.locator('form:has(input[name="_action"][value="publish"]) button').first().click();
  await page.waitForLoadState("networkidle");
}

/** A visitor with no session and no locale cookie: served the platform default. */
async function visitor(browser: import("@playwright/test").Browser, locale?: "ar" | "en") {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  if (locale) await ctx.addCookies([{ name: "edu_locale", value: locale, url: "http://127.0.0.1:5173" }]);
  const p = await ctx.newPage();
  await p.goto("/");
  await p.waitForLoadState("networkidle");
  return { page: p, ctx };
}

/**
 * Position of a section heading inside the public <main>, addressed by heading
 * TEXT so chrome (nav labels, card CTAs) can never be mistaken for the section.
 * Returns -1 when the heading is not rendered at all.
 */
async function headingIndex(page: import("@playwright/test").Page, heading: string): Promise<number> {
  return await page.evaluate((h) => {
    const headings = Array.from(document.querySelectorAll("main h2, main h3"));
    const texts = headings.map((el) => (el.textContent ?? "").trim());
    const hit = texts.findIndex((x) => x === h);
    if (hit >= 0) return hit;
    return texts.findIndex((x) => x.includes(h));
  }, heading);
}

test.describe("CMS page builder (owner -> public)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("changing a heading in Admin reaches the public homepage in both languages", async ({ page, browser }) => {
    await openHomeEditor(page);
    const target = await firstBlockWithHeading(page);
    const hero = blockForms(page).nth(target.index);
    void hero; // kept as documentation of the target block form

    // remember the seeded copy so this test leaves no trace
    const originalAr = target.value;
    const originalEn = target.en;

    const stamp = Date.now().toString().slice(-6);
    const newAr = `عنوان التجربة ${stamp}`;
    const newEn = `Builder probe heading ${stamp}`;

    try {
      await saveBlockAndVerifyDraft(page, target.index, [
        { name: "f.heading.ar", value: newAr },
        { name: "f.heading.en", value: newEn },
      ]);
      await publish(page);

      // Arabic is the platform default, so an anonymous visitor sees the AR copy
      const ar = await visitor(browser);
      // Scope to <main>: the header/footer legitimately repeat nav labels, so a
      // whole-body check can match chrome instead of the section we changed.
      await expect(ar.page.locator("main")).toContainText(newAr, { timeout: 20_000 });
      expect(await ar.page.locator("html").getAttribute("lang")).toBe("ar");
      await ar.ctx.close();

      // and the English copy is independently controlled
      const en = await visitor(browser, "en");
      await expect(en.page.locator("main")).toContainText(newEn, { timeout: 20_000 });
      expect(await en.page.locator("html").getAttribute("lang")).toBe("en");
      await en.ctx.close();
    } finally {
      await saveBlockAndVerifyDraft(page, target.index, [
        { name: "f.heading.ar", value: originalAr },
        { name: "f.heading.en", value: originalEn },
      ]);
      await publish(page);

      // The restore must be LIVE, not just saved: a draft-only restore would
      // silently leak the probe heading into the specs that run after this one.
      const restored = await visitor(browser);
      await expect(restored.page.locator("main")).toContainText(originalAr, { timeout: 20_000 });
      await restored.ctx.close();
    }
  });

  test("hiding a block removes it from the public page, showing it brings it back", async ({ page, browser }) => {
    await openHomeEditor(page);
    const target = await firstBlockWithHeading(page);
    const marker = target.value;
    const blockId = target.id;

    // it is live before we touch anything
    let v = await visitor(browser);
    await expect(v.page.locator("main")).toContainText(marker, { timeout: 20_000 });
    await v.ctx.close();

    try {
      await toolForm(page, "toggle-block", blockId).locator("button").click();
      await page.waitForLoadState("networkidle");
      await publish(page);

      v = await visitor(browser);
      await expect(v.page.locator("main")).not.toContainText(marker, { timeout: 20_000 });
      await v.ctx.close();
    } finally {
      await openHomeEditor(page);
      await toolForm(page, "toggle-block", blockId).locator("button").click();
      await page.waitForLoadState("networkidle");
      await publish(page);
    }

    v = await visitor(browser);
    await expect(v.page.locator("main")).toContainText(marker, { timeout: 20_000 });
    await v.ctx.close();
  });

  test("reordering sections changes the public rendering order", async ({ page, browser }) => {
    // Pick the pair to probe from the PUBLIC page (the headings a visitor
    // reads, in document order) and then locate the matching section inside the
    // builder by its Arabic heading. Deriving both ends from the same source
    // keeps the test independent of builder DOM order, of chrome text that
    // repeats a section title (nav labels / card CTAs), and of which sections
    // happen to have content in the seeded fixtures.
    const read = await visitor(browser);
    const publicHeadings = await read.page.evaluate(() =>
      Array.from(document.querySelectorAll("main h2")).map((el) => (el.textContent ?? "").trim()).filter(Boolean)
    );
    await read.ctx.close();
    const unique = publicHeadings.filter((h) => publicHeadings.indexOf(h) === publicHeadings.lastIndexOf(h));
    expect(unique.length, "need two distinct section headings to prove ordering").toBeGreaterThanOrEqual(2);
    const [firstHeading, secondHeading] = unique;

    await openHomeEditor(page);
    const forms = blockForms(page);
    const count = await forms.count();
    let sectionId = "";
    for (let i = 0; i < count; i++) {
      const f = forms.nth(i);
      if (!(await f.locator('select[name="f.bg"]').count())) continue; // section wrappers only
      const heading = (await f.locator('input[name="f.heading.ar"]').first().inputValue()).trim();
      if (heading === firstHeading) {
        sectionId = await f.locator('input[name="blockId"]').first().inputValue();
        break;
      }
    }
    expect(sectionId, `no builder section carries the heading "${firstHeading}"`).not.toBe("");

    let before = true; // by construction: firstHeading precedes secondHeading in <main>
    try {
      await toolForm(page, "move-block", sectionId, "down").locator("button").click();
      await page.waitForLoadState("networkidle");
      await publish(page);

      const after = await visitor(browser);
      const idxAfterA = await headingIndex(after.page, firstHeading);
      const idxAfterB = await headingIndex(after.page, secondHeading);
      await after.ctx.close();
      expect(idxAfterA, "moved section heading must still be rendered").toBeGreaterThanOrEqual(0);
      expect(idxAfterB, "the section it swapped with must still be rendered").toBeGreaterThanOrEqual(0);
      expect(idxAfterA < idxAfterB, "the public section order must flip").toBe(!before);
    } finally {
      await openHomeEditor(page);
      await toolForm(page, "move-block", sectionId, "up").locator("button").click();
      await page.waitForLoadState("networkidle");
      await publish(page);
    }

    const restored = await visitor(browser);
    const idxRestoredA = await headingIndex(restored.page, firstHeading);
    const idxRestoredB = await headingIndex(restored.page, secondHeading);
    await restored.ctx.close();
    expect(idxRestoredA < idxRestoredB, "the restore must put the original order back").toBe(before);
  });

  test("a page can be saved as a reusable template", async ({ page }) => {
    await openHomeEditor(page);
    const stamp = Date.now().toString().slice(-6);
    const name = `E2E template ${stamp}`;
    const tplForm = page.locator('form:has(input[name="_action"][value="save-as-template"])');
    await expect(tplForm).toBeVisible({ timeout: 20_000 });
    await tplForm.locator('input[name="titleAr"]').fill(`قالب التجربة ${stamp}`);
    await tplForm.locator('input[name="titleEn"]').fill(name);
    await tplForm.getByRole("button", { name: /Save as template|حفظ كقالب/i }).click();
    await page.waitForLoadState("networkidle");

    await page.goto("/admin/cms/templates");
    await expect(page.locator("body")).toContainText(name, { timeout: 20_000 });
  });

  test("a student cannot reach the CMS or publish anything", async ({ browser }) => {
    const student = await browser.newContext({ storageState: STUDENT_STATE });
    const sp = await student.newPage();
    for (const path of ["/admin/cms", "/admin/cms/templates", "/admin/cms/menus"]) {
      await sp.goto(path);
      await sp.waitForLoadState("networkidle");
      expect(sp.url(), `${path} must not render the editor`).not.toContain("/admin/cms");
    }
    await student.close();
  });
});
