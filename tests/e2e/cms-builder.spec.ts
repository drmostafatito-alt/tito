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

test.describe("CMS page builder (owner -> public)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("changing a heading in Admin reaches the public homepage in both languages", async ({ page, browser }) => {
    await openHomeEditor(page);
    const target = await firstBlockWithHeading(page);
    const hero = blockForms(page).nth(target.index);
    const arField = hero.locator('input[name="f.heading.ar"]');
    const enField = hero.locator('input[name="f.heading.en"]');

    // remember the seeded copy so this test leaves no trace
    const originalAr = target.value;
    const originalEn = target.en;

    const stamp = Date.now().toString().slice(-6);
    const newAr = `عنوان التجربة ${stamp}`;
    const newEn = `Builder probe heading ${stamp}`;

    try {
      await arField.fill(newAr);
      await enField.fill(newEn);
      await hero.locator("button").last().click();
      await page.waitForLoadState("networkidle");
      await publish(page);

      // Arabic is the platform default, so an anonymous visitor sees the AR copy
      const ar = await visitor(browser);
      await expect(ar.page.locator("body")).toContainText(newAr, { timeout: 20_000 });
      expect(await ar.page.locator("html").getAttribute("lang")).toBe("ar");
      await ar.ctx.close();

      // and the English copy is independently controlled
      const en = await visitor(browser, "en");
      await expect(en.page.locator("body")).toContainText(newEn, { timeout: 20_000 });
      expect(await en.page.locator("html").getAttribute("lang")).toBe("en");
      await en.ctx.close();
    } finally {
      await openHomeEditor(page);
      await expandBlock(page, target.index);
      const h = blockForms(page).nth(target.index);
      await h.locator('input[name="f.heading.ar"]').fill(originalAr);
      await h.locator('input[name="f.heading.en"]').fill(originalEn);
      await h.locator("button").last().click();
      await page.waitForLoadState("networkidle");
      await publish(page);
    }
  });

  test("hiding a block removes it from the public page, showing it brings it back", async ({ page, browser }) => {
    await openHomeEditor(page);
    const target = await firstBlockWithHeading(page);
    const marker = target.value;
    const blockId = target.id;

    // it is live before we touch anything
    let v = await visitor(browser);
    await expect(v.page.locator("body")).toContainText(marker, { timeout: 20_000 });
    await v.ctx.close();

    try {
      await toolForm(page, "toggle-block", blockId).locator("button").click();
      await page.waitForLoadState("networkidle");
      await publish(page);

      v = await visitor(browser);
      await expect(v.page.locator("body")).not.toContainText(marker, { timeout: 20_000 });
      await v.ctx.close();
    } finally {
      await openHomeEditor(page);
      await toolForm(page, "toggle-block", blockId).locator("button").click();
      await page.waitForLoadState("networkidle");
      await publish(page);
    }

    v = await visitor(browser);
    await expect(v.page.locator("body")).toContainText(marker, { timeout: 20_000 });
    await v.ctx.close();
  });

  test("reordering sections changes the public rendering order", async ({ page, browser }) => {
    await openHomeEditor(page);

    // Top-level sections are the blocks whose settings form carries f.bg — the
    // section wrapper. Their headings are what a visitor reads in order.
    const forms = blockForms(page);
    const count = await forms.count();
    const sections: Array<{ id: string; heading: string }> = [];
    for (let i = 0; i < count && sections.length < 2; i++) {
      const f = forms.nth(i);
      if (await f.locator('select[name="f.bg"]').count()) {
        const heading = (await f.locator('input[name="f.heading.ar"]').first().inputValue()).trim();
        const id = await f.locator('input[name="blockId"]').first().inputValue();
        if (heading) sections.push({ id, heading });
      }
    }
    expect(sections.length, "need two top-level sections with headings to prove ordering").toBe(2);

    const read = await visitor(browser);
    const bodyBefore = await read.page.locator("body").innerText();
    await read.ctx.close();
    const before = bodyBefore.indexOf(sections[0].heading) < bodyBefore.indexOf(sections[1].heading);

    try {
      await toolForm(page, "move-block", sections[0].id, "down").locator("button").click();
      await page.waitForLoadState("networkidle");
      await publish(page);

      const after = await visitor(browser);
      const bodyAfter = await after.page.locator("body").innerText();
      await after.ctx.close();
      const nowFirst = bodyAfter.indexOf(sections[0].heading) < bodyAfter.indexOf(sections[1].heading);
      expect(nowFirst, "the public section order must flip").toBe(!before);
    } finally {
      await openHomeEditor(page);
      await toolForm(page, "move-block", sections[0].id, "up").locator("button").click();
      await page.waitForLoadState("networkidle");
      await publish(page);
    }

    const restored = await visitor(browser);
    const bodyRestored = await restored.page.locator("body").innerText();
    await restored.ctx.close();
    expect(bodyRestored.indexOf(sections[0].heading) < bodyRestored.indexOf(sections[1].heading)).toBe(before);
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
