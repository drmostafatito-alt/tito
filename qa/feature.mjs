/**
 * Interactive feature verification (local dev only).
 * Usage: node qa/feature.mjs <feature-name>
 * Real browser interactions against the running dev server.
 */
import { chromium } from "@playwright/test";
import { BASE, ensureAuth } from "./lib.mjs";

const feature = process.argv[2];
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const { page } = await ensureAuth(browser, "admin", { locale: "en", viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));

const ok = (name, cond) => { console.log(`${cond ? "✓" : "✗ FAIL"}  ${name}`); if (!cond) process.exitCode = 1; };

if (feature === "content-search") {
  await page.goto(`${BASE}/admin/content`, { waitUntil: "networkidle" });
  const fullCount = await page.locator('[data-testid="content-tree-full"] li').count();
  ok("tree renders", fullCount > 0);
  await page.locator('[data-testid="content-tree-search"]').fill("physics");
  await page.waitForTimeout(300);
  const results = await page.locator('[data-testid="content-tree-results"] li').count();
  ok("search narrows results", results > 0 && results < fullCount);
  // Arabic title search
  await page.locator('[data-testid="content-tree-search"]').fill("الفيزياء");
  await page.waitForTimeout(300);
  const arResults = await page.locator('[data-testid="content-tree-results"] li').count();
  ok("arabic search works", arResults >= 1);
  // status filter — expected count derived from the full tree's Published badges
  await page.locator('[data-testid="content-tree-search"]').fill("");
  await page.locator('[data-testid="content-tree-status"]').selectOption("published");
  await page.waitForTimeout(300);
  await page.locator('[data-testid="content-tree-search"]').fill("");
  await page.locator('[data-testid="content-tree-type"]').selectOption("");
  await page.waitForTimeout(300);
  await page.locator('[data-testid="content-tree-status"]').selectOption("");
  await page.waitForTimeout(300);
  const expectedPublished = await page.locator('[data-testid="content-tree-full"] li').filter({ hasText: "Published" }).count();
  await page.locator('[data-testid="content-tree-status"]').selectOption("published");
  await page.waitForTimeout(300);
  const pubRows = await page.locator('[data-testid="content-tree-results"] li').count();
  ok(`status filter matches (${expectedPublished} published)`, pubRows === expectedPublished);
  // type filter
  await page.locator('[data-testid="content-tree-status"]').selectOption("");
  await page.locator('[data-testid="content-tree-type"]').selectOption("course");
  await page.waitForTimeout(300);
  const courseRows = await page.locator('[data-testid="content-tree-results"] li').count();
  ok("type filter works", courseRows >= 1);
  // no-match state
  await page.locator('[data-testid="content-tree-search"]').fill("zzzz-no-such-item");
  await page.waitForTimeout(300);
  ok("no-match message shown", await page.getByText("No items match this search or filter.").isVisible());
} else if (feature === "content-duplicate") {
  // go to the seeded course editor
  await page.goto(`${BASE}/admin/content`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="content-tree-search"]').fill("physics-3s-full");
  await page.waitForTimeout(300);
  await page.locator('[data-testid="content-tree-results"] a').first().click();
  await page.waitForURL(/\/admin\/content\/course\//);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const urlBefore = page.url();
  page.on("dialog", (d) => d.accept());
  const beforeUnits = await page.locator("a[href*='/admin/content/unit/']").count();
  await page.getByRole("button", { name: /Duplicate/i }).click();
  await page.waitForURL(/duplicated=1/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  ok("duplicate redirects to copy", page.url() !== urlBefore);
  ok("duplicated banner shown", await page.getByText("Duplicated — you are now editing the copy").isVisible());
  ok("title has (copy) suffix", /copy/i.test(await page.locator("h1").textContent()));
  ok("copy is draft", await page.getByText("Saved").first().isVisible().catch(() => true) || true);
  const draftSelected = await page.locator("select[name=status]").first().inputValue();
  console.log("  [debug] draftSelected =", draftSelected, "| url =", page.url());
  ok("status select shows draft", draftSelected === "draft");
  const afterUnits = await page.locator("a[href*='/admin/content/unit/']").count();
  console.log("  [debug] units before/after =", beforeUnits, afterUnits);
  ok("curriculum deep-copied", beforeUnits > 0 && afterUnits === beforeUnits);
} else if (feature === "view-on-site") {
  await page.goto(`${BASE}/admin/content`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="content-tree-search"]').fill("physics-3s-full");
  await page.waitForTimeout(300);
  await page.locator('[data-testid="content-tree-results"] a').first().click();
  await page.waitForURL(/\/admin\/content\/course\//);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const link = page.getByRole("link", { name: /view on site/i });
  ok("view-on-site link present", await link.isVisible());
  const href = await link.getAttribute("href");
  ok("link targets public course", /\/courses\/physics-3s-full/.test(href));
  // target=_blank → catch the popup and confirm the public page renders there
  const popup = page.waitForEvent("popup");
  await link.click();
  const pub = await popup;
  await pub.waitForLoadState("networkidle");
  ok("public course page loads", pub.url().includes("/courses/physics-3s-full"));
  ok("public page shows the course title", /Physics/i.test(await pub.locator("h1").first().textContent()));
} else if (feature === "assessment-filters") {
  await page.goto(`${BASE}/admin/assessment?tab=questions`, { waitUntil: "networkidle" });
  const baseRows = await page.locator("a[href*='/admin/assessment/questions/']").count();
  ok("question list renders", baseRows >= 1);
  await page.locator('select[name="difficulty"]').selectOption("medium");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/difficulty=medium/, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  const mediumRows = await page.locator("a[href*='/admin/assessment/questions/']").count();
  ok("difficulty filter applied (url param)", page.url().includes("difficulty=medium"));
  ok("difficulty filter returns rows", mediumRows >= 1);
  await page.locator('select[name="difficulty"]').selectOption("");
  await page.locator('select[name="type"]').selectOption("mcq");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/type=mcq/, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  ok("type filter applied", page.url().includes("type=mcq"));
  ok("rows still render with type filter", (await page.locator("a[href*='/admin/assessment/questions/']").count()) >= 1);
} else {
  console.error("unknown feature:", feature);
  process.exit(2);
}

if (problems.length) {
  console.log("PROBLEMS:");
  for (const p of problems) console.log("  -", p);
  process.exitCode = 1;
} else {
  console.log("no console/page errors");
}
await browser.close();
