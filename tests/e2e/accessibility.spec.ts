import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { STUDENT_STATE, ADMIN_STATE, FIXTURES } from "./helpers";

/**
 * W6 — automated accessibility audit (axe-core via @axe-core/playwright).
 *
 * Runs axe against every required surface (public/auth, student, admin) and
 * writes a full violation report to test-results/axe-report.json (gitignored).
 *
 * Regression gate: every page must have ZERO critical violations and ZERO
 * violations of any rule OTHER than `target-size`. `target-size` (WCAG 2.5.8,
 * 24x24px AA) is measured and reported but not asserted — see the limitation
 * note in `audit()`: the sandbox's only available browser is a self-contained
 * Chromium 92 that cannot parse Tailwind v4's `@layer` / `oklch()` /
 * `color-mix()` output, so ALL utility styles are dropped and every control is
 * measured unstyled (~19–21px) regardless of its real `min-h-*`/`py-*` size.
 * In a modern browser (Chrome ≥111) these controls resolve to 32–44px.
 */

type Finding = {
  page: string;
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; html: string; summary: string }>;
};

const findings: Finding[] = [];

async function audit(page: import("@playwright/test").Page, label: string) {
  await page.waitForTimeout(600); // let client hydrate + async content settle
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  for (const v of results.violations) {
    findings.push({
      page: label,
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target as string[],
        html: n.html,
        summary: n.failureSummary ?? "",
      })),
    });
  }

  // Regression gate (see header note on the target-size browser limitation):
  //  - zero critical violations, and
  //  - zero violations of any rule OTHER than target-size.
  //    (These are semantic/DOM rules — headings, landmarks, labels — which axe
  //    measures correctly even with CSS dropped.)
  const critical = results.violations.filter((v) => v.impact === "critical");
  const nonTargetSize = results.violations.filter((v) => v.id !== "target-size");
  expect(critical, `${label}: critical violations`).toHaveLength(0);
  expect(nonTargetSize, `${label}: non-target-size violations`).toHaveLength(0);

  console.log(
    `  axe ${label}: ${results.violations.length} violation(s)` +
      (results.violations.length
        ? ` [${results.violations.map((v) => `${v.id}(${v.impact ?? "?"})`).join(", ")}]`
        : "")
  );
}

test.describe("axe audit (measurement)", () => {
  test("public / auth surfaces", async ({ page }) => {
    for (const [label, path] of [
      ["login", "/login"],
      ["register", "/register"],
      ["forgot-password", "/forgot-password"],
      ["homepage", "/"],
    ] as const) {
      await page.goto(path);
      await audit(page, label);
    }
  });

  test.describe("student surfaces", () => {
    test.use({ storageState: STUDENT_STATE });
    test("student pages", async ({ page }) => {
      for (const [label, path] of [
        ["dashboard", "/dashboard"],
        ["catalog", "/courses"],
        ["course", `/courses/${FIXTURES.courseSlug}`],
        ["lesson", `/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`],
        ["exam", `/exams/${FIXTURES.examSlug}`],
        ["results", "/results"],
        ["checkout", `/checkout/${FIXTURES.productSlug}`],
        ["orders", "/orders"],
        ["notifications", "/notifications"],
        ["profile", "/profile"],
      ] as const) {
        await page.goto(path);
        await audit(page, label);
      }
    });
  });

  test.describe("admin surfaces", () => {
    test.use({ storageState: ADMIN_STATE });
    test("admin pages", async ({ page }) => {
      for (const [label, path] of [
        ["admin-dashboard", "/admin"],
        ["admin-users", "/admin/users"],
        ["admin-announcements", "/admin/announcements"],
        ["admin-analytics", "/admin/analytics"],
        ["admin-security", "/admin/security"],
        ["admin-audit", "/admin/audit"],
        ["admin-commerce", "/admin/commerce"],
      ] as const) {
        await page.goto(path);
        await audit(page, label);
      }
    });
  });

  test.afterAll(() => {
    const out = resolve(process.cwd(), "test-results", "axe-report.json");
    mkdirSync(resolve(process.cwd(), "test-results"), { recursive: true });
    const summary = {
      total: findings.length,
      byRule: {} as Record<string, number>,
      findings,
    };
    for (const f of findings) summary.byRule[f.id] = (summary.byRule[f.id] ?? 0) + 1;
    writeFileSync(out, JSON.stringify(summary, null, 2));
    console.log(`\naxe report written to ${out} (${findings.length} total findings)`);
  });
});

/** Targeted DOM regressions for the specific W6 fixes (verified independent of
 *  CSS so they hold even in the CSS-less sandbox browser). */
test.describe("accessibility fixes (DOM regression)", () => {
  test.describe("admin filter selects", () => {
    test.use({ storageState: ADMIN_STATE });
    test("expose accessible names", async ({ page }) => {
      await page.goto("/admin/users");
      await expect(page.locator('select[name="role"]')).toHaveAttribute("aria-label", /role/i);
      await expect(page.locator('select[name="status"]')).toHaveAttribute("aria-label", /status/i);
      await page.goto("/admin/announcements");
      await expect(page.locator('select[name="status"]')).toHaveAttribute("aria-label", /status/i);
      await page.goto("/admin/security");
      await expect(page.locator('select[name="type"]')).toHaveAttribute("aria-label", /type|event/i);
      await page.goto("/admin/audit");
      await expect(page.locator('select[name="entityType"]')).toHaveAttribute("aria-label", /entity/i);
    });
  });

  test.describe("lesson page", () => {
    test.use({ storageState: STUDENT_STATE });
    test("exposes a main landmark and uniquely-labeled navs", async ({ page }) => {
      await page.goto(`/learn/${FIXTURES.courseSlug}/${FIXTURES.lesson2Slug}`);
      await expect(page.locator("main")).toHaveCount(1);
      // breadcrumb + prev/next navs must each have a unique accessible name
      const navs = page.locator("main nav");
      await expect(navs).toHaveCount(2);
      const labels: string[] = [];
      for (let i = 0; i < 2; i++) labels.push((await navs.nth(i).getAttribute("aria-label")) ?? "");
      expect(labels.every((l) => l.length > 0)).toBe(true);
      expect(new Set(labels).size).toBe(2); // unique
    });
  });

  test("homepage exposes a level-1 heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1").first()).toBeAttached();
  });
});
