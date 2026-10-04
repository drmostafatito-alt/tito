/**
 * QA §18 — Media / R2 chain, exercised in a real browser.
 *
 * Proves the whole media pipeline end to end rather than by reading code:
 *   admin uploads an image  → it lands in R2 and is listed in the library
 *   → it is served over /files/:id with the right bytes and content type
 *   → a PRIVATE upload is NOT readable anonymously (authorisation holds)
 *   → the identity "owner photo" picker can select it without typing an id
 *   → saving pushes it onto the PUBLIC site (header + /about + /study) with a
 *     real alt text
 *   → everything this run created is removed and the original photo restored,
 *     so no QA record is left behind.
 *
 * Local dev only. Usage:  E2E_CHROMIUM_PATH=/tmp/chromium node qa/media-chain.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE, ROOT, ensureAuth, launchBrowser } from "./lib.mjs";

const OUT = resolve(ROOT, "qa-out/media-chain");
mkdirSync(OUT, { recursive: true });

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** A tiny but genuine 2x2 PNG (not a placeholder service, no network needed). */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DwnwEJMKFyaS8" +
    "AAP//Hg0CycVAUwAAAAAASUVORK5CYII=",
  "base64",
);
const stamp = Date.now();
const PUBLIC_NAME = `qa-media-public-${stamp}.png`;
const PRIVATE_NAME = `qa-media-private-${stamp}.png`;

const browser = await launchBrowser();
const { page, ctx } = await ensureAuth(browser, "admin", { locale: "ar", viewport: { width: 1280, height: 900 } });
const anon = await browser.newContext();
const createdIds = [];
let originalPhotoId = "";

/**
 * Upload through the real /admin/files form (same R2 + validation + audit
 * path). The form auto-submits as soon as a file is chosen, so the visibility
 * select has to be set BEFORE the file input — exactly like a real admin
 * picking "private" and then browsing for the file.
 */
async function uploadViaLibrary(name, visibility) {
  await page.goto(`${BASE}/admin/files`, { waitUntil: "networkidle" });
  const form = page.locator("#media-upload-form");
  await form.locator('select[name="visibility"]').selectOption(visibility);
  await form.locator('input[type="file"][name="file"]').setInputFiles({
    name,
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.waitForLoadState("networkidle");
  // The card for this file carries its id in the sibling rename/delete forms.
  const row = page.locator(`form:has(input[name="name"][value="${name}"])`).first();
  await row.waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  return row.locator('input[name="id"]').first().inputValue().catch(() => "");
}

/** Delete a library entry through the admin UI (details panel + confirm). */
async function deleteFromLibrary(id) {
  await page.goto(`${BASE}/admin/files`, { waitUntil: "networkidle" });
  const form = page.locator(`form:has(input[value="delete"]):has(input[name="id"][value="${id}"])`).first();
  if (!(await form.count())) return;
  await page.locator(`details:has(input[name="id"][value="${id}"])`).first().evaluate((d) => { d.open = true; });
  page.once("dialog", (d) => d.accept());
  await form.locator('button[type="submit"]').first().click();
  await page.waitForLoadState("networkidle");
}

try {
  // ── 0. Purge anything an earlier interrupted run left behind ────────────
  await page.goto(`${BASE}/admin/files`, { waitUntil: "networkidle" });
  for (const stale of await page.locator('input[name="name"][value^="qa-media-"]').all()) {
    const id = await stale.evaluate((el) => el.form?.querySelector('input[name="id"]')?.value ?? "");
    if (id) await deleteFromLibrary(id);
  }

  // ── 1. Public upload lands in the library ───────────────────────────────
  const publicId = await uploadViaLibrary(PUBLIC_NAME, "public");
  if (publicId) createdIds.push(publicId);
  check("media: an admin can upload an image from /admin/files", Boolean(publicId), publicId);
  check(
    "media: the uploaded file is listed in the library",
    (await page.locator(`text=${PUBLIC_NAME}`).count()) > 0,
  );

  // ── 2. It is really served from R2 over /files/:id ──────────────────────
  if (publicId) {
    const res = await ctx.request.get(`${BASE}/files/${publicId}`);
    const body = await res.body();
    check("media: /files/:id serves the stored object", res.status() === 200, `status ${res.status()}`);
    check(
      "media: the served bytes are the bytes that were uploaded",
      body.equals(PNG),
      `${body.length} bytes`,
    );
    check(
      "media: it is served as an image",
      /image\/png/.test(res.headers()["content-type"] ?? ""),
      res.headers()["content-type"] ?? "(none)",
    );
  }

  // ── 3. A private upload must NOT be anonymously readable ────────────────
  const privateId = await uploadViaLibrary(PRIVATE_NAME, "private");
  if (privateId) createdIds.push(privateId);
  check("media: a private upload is accepted", Boolean(privateId), privateId);
  if (privateId) {
    const res = await anon.request.get(`${BASE}/files/${privateId}`);
    check(
      "security: a private file is NOT readable by an anonymous visitor",
      res.status() >= 400,
      `status ${res.status()}`,
    );
  }

  // ── 4. The owner-photo picker selects it without typing an id ───────────
  await page.goto(`${BASE}/admin/appearance?tab=identity`, { waitUntil: "networkidle" });
  originalPhotoId = await page.locator('input[name="ownerPhotoFileId"]').inputValue();
  const picker = page.locator('div:has(> input[name="ownerPhotoFileId"])').first();
  await picker.getByRole("button", { name: /library|المكتبة|اختر/i }).first().click();
  const option = picker.locator(`role=listbox >> li:has(img[src="/files/${publicId}"]) button`).first();
  await option.click();
  const picked = await page.locator('input[name="ownerPhotoFileId"]').inputValue();
  check("admin: the owner photo is chosen from a visual library, not by id", picked === publicId, picked);

  // ── 5. Saving pushes it to the PUBLIC site ──────────────────────────────
  await page
    .locator('form:has(input[name="ownerPhotoFileId"]) button[type="submit"]')
    .first()
    .click();
  await page.waitForLoadState("networkidle");
  check(
    "admin: the owner photo selection is persisted",
    (await page.locator('input[name="ownerPhotoFileId"]').inputValue()) === publicId,
  );

  for (const route of ["/", "/about", "/study"]) {
    const p = await anon.newPage();
    await p.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    const img = p.locator(`img[src*="${publicId}"]`).first();
    const shown = (await img.count()) > 0;
    const alt = shown ? await img.getAttribute("alt") : null;
    check(`public: the new owner photo reaches ${route}`, shown);
    check(`a11y: that photo carries a real alt text on ${route}`, Boolean(alt && alt.trim().length > 2), alt ?? "(none)");
    await p.close();
  }

  await page.screenshot({ path: resolve(OUT, "owner-photo-selected.png"), fullPage: false });
} catch (e) {
  check("media chain", false, String(e).slice(0, 200));
} finally {
  // ── 6. Restore: put the original photo back, delete every QA upload ─────
  try {
    // The picker is a controlled React field, so restore it the way an admin
    // would: remove the image, or re-select the original from the library.
    await page.goto(`${BASE}/admin/appearance?tab=identity`, { waitUntil: "networkidle" });
    const pick = page.locator('div:has(> input[name="ownerPhotoFileId"])').first();
    if (originalPhotoId) {
      await pick.getByRole("button", { name: /library|المكتبة|اختر/i }).first().click();
      await pick.locator(`role=listbox >> li:has(img[src="/files/${originalPhotoId}"]) button`).first().click();
    } else {
      await pick.getByRole("button", { name: /remove|إزالة|حذف/i }).first().click();
    }
    await page.locator('form:has(input[name="ownerPhotoFileId"]) button[type="submit"]').first().click();
    await page.waitForLoadState("networkidle");
    const back = await page.locator('input[name="ownerPhotoFileId"]').inputValue();
    check("cleanup: the original owner photo is restored", back === originalPhotoId, `${back || "(empty)"}`);

    for (const id of createdIds) await deleteFromLibrary(id);
    await page.goto(`${BASE}/admin/files`, { waitUntil: "networkidle" });
    const leftovers = await page.locator(`input[name="name"][value^="qa-media-"]`).count();
    check("cleanup: no QA media record is left behind", leftovers === 0, `${leftovers} left`);
  } catch (e) {
    check("cleanup", false, String(e).slice(0, 200));
  }
  await anon.close();
  await ctx.close();
  await browser.close();
}

const total = pass + failures.length;
writeFileSync(resolve(OUT, "result.json"), JSON.stringify({ pass, total, failures }, null, 2));
console.log(`\n${pass}/${total} media chain checks passed`);
for (const f of failures) console.log(` - FAILED: ${f}`);
process.exit(failures.length ? 1 : 0);
