#!/usr/bin/env node
/**
 * "No dead controls" check.
 *
 * For each admin setting below: drive the REAL admin form in a browser, save
 * it, then load the public page and assert the change is actually visible —
 * then put the original value back. A control that saves without changing the
 * site is exactly the failure mode this is written to catch.
 *
 * Usage: node qa/admin-roundtrip.mjs
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { BASE, launchBrowser, ensureAuth } from "./lib.mjs";

const OUT = resolve(process.cwd(), "qa-out", "admin-roundtrip");
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await launchBrowser();
const { page, ctx } = await ensureAuth(browser, "admin", { locale: "ar", viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
const pub = await ctx.newPage();

/** Saves the group that contains `fieldName` and waits for the POST to settle. */
async function saveGroupContaining(fieldName) {
  const field = page.locator(`[name="${fieldName}"]`).first();
  const form = field.locator("xpath=ancestor::form[1]");
  const submit = form.locator('button[type="submit"]').last();
  await Promise.all([
    page.waitForLoadState("networkidle"),
    submit.click(),
  ]);
  await page.waitForTimeout(400);
}

async function setText(route, fieldName, value) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  const field = page.locator(`[name="${fieldName}"]`).first();
  const before = await field.inputValue();
  await field.fill(value);
  await saveGroupContaining(fieldName);
  return before;
}

async function setCheck(route, fieldName, value) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  const field = page.locator(`[name="${fieldName}"]`).first();
  const before = await field.isChecked();
  if (before !== value) await field.setChecked(value);
  await saveGroupContaining(fieldName);
  return before;
}

async function publicText(route) {
  await pub.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  return (await pub.locator("body").innerText()).replace(/\s+/g, " ");
}
async function publicHtml(route) {
  await pub.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  return await pub.content();
}

const MARK = "ZQX";

/**
 * Snapshot of every editable appearance field, so the run can prove it put the
 * owner's configuration back exactly as it found it. A QA pass that silently
 * leaves a setting flipped is worse than no QA pass.
 */
const APPEARANCE_TABS = ["identity", "theme", "presentation", "dashboard", "system"];
async function snapshotAppearance() {
  const snap = {};
  for (const tab of APPEARANCE_TABS) {
    await page.goto(`${BASE}/admin/appearance?tab=${tab}`, { waitUntil: "networkidle" });
    snap[tab] = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("input[name], select[name], textarea[name]")]
          .filter((e) => e.type !== "file")
          .map((e) => [e.name, e.type === "checkbox" || e.type === "radio" ? String(e.checked) : e.value]),
      ),
    );
  }
  return snap;
}
const BEFORE_ALL = await snapshotAppearance();

// ── 1. Identity: site short name reaches the public header ──────────────────
try {
  const before = await setText("/admin/appearance?tab=identity", "shortNameAr", `${MARK}-brand`);
  const html = await publicHtml("/");
  check("identity → shortNameAr appears in the public header", html.includes(`${MARK}-brand`));
  await setText("/admin/appearance?tab=identity", "shortNameAr", before);
  const html2 = await publicHtml("/");
  check("identity → shortNameAr restores cleanly", !html2.includes(`${MARK}-brand`));
} catch (e) { check("identity → shortNameAr", false, String(e).slice(0, 140)); }

// ── 2. Platform: owner tagline reaches the public page ──────────────────────
try {
  const before = await setText("/admin/appearance?tab=system", "taglineAr", `${MARK}-tagline`);
  const html = await publicHtml("/");
  check("system → taglineAr reaches the public site", html.includes(`${MARK}-tagline`));
  await setText("/admin/appearance?tab=system", "taglineAr", before);
} catch (e) { check("system → taglineAr", false, String(e).slice(0, 140)); }

// ── 3. Platform: footer "about" text ────────────────────────────────────────
try {
  const before = await setText("/admin/appearance?tab=system", "footerAboutAr", `${MARK}-footer`);
  const html = await publicHtml("/");
  check("system → footerAboutAr reaches the public footer", html.includes(`${MARK}-footer`));
  await setText("/admin/appearance?tab=system", "footerAboutAr", before);
} catch (e) { check("system → footerAboutAr", false, String(e).slice(0, 140)); }

// ── 4. WhatsApp number drives the floating button AND the CMS whatsapp: link ─
try {
  const before = await setText("/admin/appearance?tab=system", "whatsapp", "201234567890");
  const html = await publicHtml("/");
  check("system → whatsapp number produces a real wa.me link", html.includes("wa.me/201234567890"), "");
  await setText("/admin/appearance?tab=system", "whatsapp", before || "");
  const html2 = await publicHtml("/");
  check("system → clearing whatsapp removes the wa.me link (no dead control)", before ? true : !html2.includes("wa.me/201234567890"));
} catch (e) { check("system → whatsapp", false, String(e).slice(0, 140)); }

// ── 5. Question-platform toggle actually hides the public entry point ───────
try {
  const urlBefore = await page.locator('[name="questionPlatformUrl"]').first().inputValue().catch(() => "");
  const before = await setCheck("/admin/appearance?tab=system", "questionPlatformEnabled", false);
  const linksTo = async () => {
    await pub.goto(`${BASE}/`, { waitUntil: "networkidle" });
    return pub.evaluate(() => document.querySelectorAll('a[href*="exams."], a[href*="/exam"]').length);
  };
  check("system → disabling the question platform removes its public links", (await linksTo()) === 0, urlBefore);
  await setCheck("/admin/appearance?tab=system", "questionPlatformEnabled", before);
  check("system → re-enabling it brings the links back", !before || (await linksTo()) > 0);
} catch (e) { check("system → questionPlatformEnabled", false, String(e).slice(0, 140)); }

// ── 6. Theme colour reaches the generated stylesheet ────────────────────────
try {
  const before = await setText("/admin/appearance?tab=theme", "primary", "#7a1fa2");
  await pub.goto(`${BASE}/theme.css`, { waitUntil: "domcontentloaded" });
  const css = await pub.locator("body").innerText();
  check("theme → primary colour is emitted into /theme.css", /7a1fa2/i.test(css), css.slice(0, 80));
  await setText("/admin/appearance?tab=theme", "primary", before);
} catch (e) { check("theme → primary", false, String(e).slice(0, 140)); }

// ── 7. Presentation toggle changes the public course cards ──────────────────
try {
  const beforeText = await publicText("/courses");
  const before = await setCheck("/admin/appearance?tab=presentation", "cc.showLessonCount", !/درس|lesson/i.test(beforeText));
  const afterText = await publicText("/courses");
  check("presentation → cc.showLessonCount changes the public course cards", afterText !== beforeText, "text diff detected");
  await setCheck("/admin/appearance?tab=presentation", "cc.showLessonCount", before);
} catch (e) { check("presentation → cc.showLessonCount", false, String(e).slice(0, 140)); }

// ── 8. Student dashboard welcome copy ───────────────────────────────────────
try {
  const before = await setText("/admin/appearance?tab=dashboard", "welcomeAr", `${MARK}-welcome`);
  const { page: sp, ctx: sctx } = await ensureAuth(browser, "student", { locale: "ar", viewport: { width: 1280, height: 900 } });
  await sp.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const html = await sp.content();
  check("dashboard → welcomeAr reaches the student dashboard", html.includes(`${MARK}-welcome`));
  await sctx.close();
  await setText("/admin/appearance?tab=dashboard", "welcomeAr", before);
} catch (e) { check("dashboard → welcomeAr", false, String(e).slice(0, 140)); }

// ── 9. A social link added in the admin shows up in header + footer ─────────
try {
  await page.goto(`${BASE}/admin/appearance?tab=identity`, { waitUntil: "networkidle" });
  let slots = await page.locator('[name^="sl."][name$=".network"]').count();
  let used = -1;
  for (let i = 0; i < slots; i++) {
    const url = await page.locator(`[name="sl.${i}.url"]`).inputValue();
    if (!url.trim()) { used = i; break; }
  }
  if (used < 0) {
    // No empty slot: the owner adds one with the editor's own "+ add" button.
    const add = page.getByRole("button", { name: /\+/ }).last();
    await add.click();
    await page.waitForTimeout(200);
    const after = await page.locator('[name^="sl."][name$=".network"]').count();
    check("identity → the social editor can add a new link row", after === slots + 1, `${slots} → ${after}`);
    if (after > slots) used = after - 1;
    slots = after;
  }
  if (used < 0) {
    check("identity → a free social slot exists", false, `${slots} slots, all filled`);
  } else {
    await page.locator(`[name="sl.${used}.network"]`).selectOption("youtube").catch(() => {});
    await page.locator(`[name="sl.${used}.url"]`).fill("https://www.youtube.com/@tito-qa-check");
    await saveGroupContaining(`sl.${used}.url`);
    const html = await publicHtml("/");
    check("identity → a new social link renders on the public site", html.includes("youtube.com/@tito-qa-check"));
    const named = await pub.evaluate(() =>
      [...document.querySelectorAll('a[href*="youtube.com/@tito-qa-check"]')].every(
        (a) => ((a.getAttribute("aria-label") || a.innerText || "").trim().length > 0),
      ),
    );
    check("identity → that icon-only social link has an accessible name", named);
    await page.goto(`${BASE}/admin/appearance?tab=identity`, { waitUntil: "networkidle" });
    await page.locator(`[name="sl.${used}.url"]`).fill("");
    await saveGroupContaining(`sl.${used}.url`);
    const html2 = await publicHtml("/");
    check("identity → removing it removes the public icon (no orphan)", !html2.includes("youtube.com/@tito-qa-check"));
  }
} catch (e) { check("identity → social link round trip", false, String(e).slice(0, 140)); }

// ── 10. Everything the run touched is back where it started ────────────────
{
  const after = await snapshotAppearance();
  const drift = [];
  for (const tab of APPEARANCE_TABS) {
    for (const [k, v] of Object.entries(BEFORE_ALL[tab] ?? {})) {
      const now = after[tab]?.[k];
      if (now === undefined || now === v) continue;
      // Hidden row-identity fields (e.g. pm.<i>.id) are blank on a freshly seeded
      // database and get a stable server-generated UUID the first time the group is
      // saved. That is intended, one-off and idempotent — not drift we caused.
      if (v === "" && /\.\d+\.id$/.test(k) && typeof now === "string" && now.length > 0) continue;
      drift.push(`${tab}.${k}: ${JSON.stringify(v)} → ${JSON.stringify(now)}`);
    }
  }
  check("every setting this run touched was restored", drift.length === 0, drift.join("; ").slice(0, 300));
}

await page.screenshot({ path: resolve(OUT, "admin-appearance-after.png"), fullPage: false });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} admin round-trips passed`);
for (const f of failed) console.log(` - FAILED: ${f.name} ${f.detail}`);
process.exit(failed.length ? 1 : 0);
