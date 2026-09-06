import { test, expect, type Page } from "@playwright/test";
import { ADMIN_STATE, STUDENT_STATE, FIXTURES } from "./helpers";

/**
 * W4 — CSP nonce regression (E2E level).
 *
 * A strict `script-src 'self'` was blocking React Router v7's inline hydration
 * scripts, so the client app silently never hydrated in production (no console
 * "error" for the *absence* of a script — only the visible symptom of dead
 * interactions). The fix whitelists those inline scripts with a per-request
 * nonce (server/csp.server.ts) instead of weakening the policy.
 *
 * This spec walks every major surface and asserts that no `script-src` or
 * `style-src` violation is emitted — those are the ones that break interactivity
 * and layout. (The `@fontsource` build inlines a small `data:` fallback font
 * alongside the real `/assets/…woff2` files; `font-src 'self'` blocks that
 * fallback only — a known, cosmetic, non-blocking exception asserted below.)
 */

const JOURNEYS: { name: string; state?: string; path: string; extra?: (p: Page) => Promise<void> }[] = [
  { name: "student dashboard", state: STUDENT_STATE, path: "/dashboard" },
  {
    name: "lesson + video",
    state: STUDENT_STATE,
    path: `/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson1Slug}`,
    extra: async (p) => {
      // wait for the player to mint credentials + mount <video> (exercises client JS)
      await expect(p.locator("video")).toBeVisible({ timeout: 20_000 });
    },
  },
  { name: "exam intro", state: STUDENT_STATE, path: `/exams/${FIXTURES.examSlug}` },
  { name: "checkout", state: STUDENT_STATE, path: `/checkout/${FIXTURES.productSlug}` },
  { name: "admin dashboard", state: ADMIN_STATE, path: "/admin" },
];

for (const j of JOURNEYS) {
  test(`no script/style CSP violations on ${j.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: j.state });
    const page = await ctx.newPage();

    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
    });

    await page.goto(j.path, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    if (j.extra) await j.extra(page);

    // functional breakers: script + style violations are hard failures
    const functional = violations.filter((v) => /script-src|style-src|default-src|worker-src|connect-src/.test(v));
    expect(functional, `CSP violations on ${j.name}:\n${functional.join("\n")}`).toEqual([]);

    // font-src data: fallback is a KNOWN cosmetic exception (real fonts load from /assets)
    const nonFont = violations.filter((v) => !/font-src/.test(v));
    expect(nonFont, `unexpected CSP violations on ${j.name}:\n${nonFont.join("\n")}`).toEqual([]);

    await ctx.close();
  });
}
