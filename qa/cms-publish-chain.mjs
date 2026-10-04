#!/usr/bin/env node
/**
 * CMS edit → save (draft) → preview → publish → public.
 *
 * Proves the whole authoring chain for real, in a browser, including the part
 * that is easy to get wrong: a saved-but-unpublished change must NOT be on the
 * public site, and publishing must put it there.
 *
 * Usage: node qa/cms-publish-chain.mjs
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { BASE, launchBrowser, ensureAuth } from "./lib.mjs";

const OUT = resolve(process.cwd(), "qa-out", "cms-chain");
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const MARK = "QA-CHAIN-MARK";
const browser = await launchBrowser();
const { page, ctx } = await ensureAuth(browser, "admin", { locale: "ar", viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
const pub = await ctx.newPage();

// Locate the home page in the CMS.
await page.goto(`${BASE}/admin/cms`, { waitUntil: "networkidle" });
const editorHref = await page.$$eval('a[href^="/admin/cms/pages/"]', (as) => {
  const home = as.find((a) => /\/home\b|الرئيسية/.test(`${a.closest("li,tr,div")?.textContent ?? ""}`));
  return (home ?? as[0]).getAttribute("href");
});
check("cms: the home page is editable from /admin/cms", !!editorHref, editorHref ?? "");

/**
 * Opens the HERO block's settings panel and returns its heading field.
 * Scoped by the form's own `blockTypeDef` marker — several blocks on the page
 * expose a field called `f.heading.ar`, so `.first()` would grab the wrong one.
 */
const heroForm = () => page.locator('form:has([name="blockTypeDef"][value="hero_showcase"])').first();
async function openHeroBlock() {
  await page.goto(`${BASE}${editorHref}`, { waitUntil: "networkidle" });
  const form = heroForm();
  const field = form.locator('[name="f.heading.ar"]');
  if (!(await field.isVisible().catch(() => false))) {
    // The disclosure wraps the form, so the <summary> is a sibling of it.
    await page
      .locator('details:has(form:has([name="blockTypeDef"][value="hero_showcase"])) > summary')
      .first()
      .click();
    await page.waitForTimeout(300);
  }
  return form.locator('[name="f.heading.ar"]');
}

let original = "";
try {
  const field = await openHeroBlock();
  original = await field.inputValue();
  check("cms: hero heading field is reachable in the editor", original.length > 0, original);

  // 1 ─ save a draft change
  await field.fill(`${original} ${MARK}`);
  const form = field.locator("xpath=ancestor::form[1]");
  await Promise.all([page.waitForLoadState("networkidle"), form.locator('button[type="submit"]').last().click()]);
  await page.waitForTimeout(500);

  const reopened = await openHeroBlock();
  check("cms: the draft edit persisted in the editor", (await reopened.inputValue()).includes(MARK));

  // 2 ─ the public site must NOT show an unpublished draft
  await pub.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const publicBeforePublish = await pub.content();
  check("cms: an unpublished draft does NOT leak to the public page", !publicBeforePublish.includes(MARK));

  // 3 ─ preview must show it (that is what preview is for)
  const previewHref = editorHref.replace("/pages/", "/preview/");
  await pub.goto(`${BASE}${previewHref}`, { waitUntil: "networkidle" });
  check("cms: the admin preview shows the unpublished draft", (await pub.content()).includes(MARK));
  await pub.screenshot({ path: resolve(OUT, "preview-draft.png") });

  // 4 ─ publish
  await page.goto(`${BASE}${editorHref}`, { waitUntil: "networkidle" });
  const publish = page.getByRole("button", { name: /^نشر$|^Publish$/ }).first();
  await Promise.all([page.waitForLoadState("networkidle"), publish.click()]);
  await page.waitForTimeout(700);

  await pub.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const publishedHtml = await pub.content();
  check("cms: publishing pushes the change to the PUBLIC page", publishedHtml.includes(MARK));
  await pub.screenshot({ path: resolve(OUT, "public-published.png") });

  // 5 ─ put it back and publish again, so the site is left as found
  const restoreField = await openHeroBlock();
  await restoreField.fill(original);
  const form2 = restoreField.locator("xpath=ancestor::form[1]");
  await Promise.all([page.waitForLoadState("networkidle"), form2.locator('button[type="submit"]').last().click()]);
  await page.waitForTimeout(400);
  await page.goto(`${BASE}${editorHref}`, { waitUntil: "networkidle" });
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.getByRole("button", { name: /^نشر$|^Publish$/ }).first().click(),
  ]);
  await page.waitForTimeout(700);
  await pub.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const finalHtml = await pub.content();
  check("cms: the QA edit was reverted and re-published", !finalHtml.includes(MARK) && finalHtml.includes(original.slice(0, 12)));
} catch (e) {
  check("cms: publish chain completed", false, String(e).slice(0, 180));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} CMS chain checks passed`);
for (const f of failed) console.log(` - FAILED: ${f.name} ${f.detail}`);
process.exit(failed.length ? 1 : 0);
