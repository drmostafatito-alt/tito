/**
 * Overnight QA harness (local dev only).
 * Usage: node qa/shot.mjs <url-path> <out.png> [--who=admin|student|anon] [--w=1440] [--h=900] [--locale=ar|en] [--full]
 * Logs in through the real UI (persisted device), captures console/page errors
 * + failed requests, saves a screenshot. Exits 1 if problems found.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BASE, ROOT, ensureAuth } from "./lib.mjs";

const args = process.argv.slice(2);
const urlPath = args[0] ?? "/";
const out = args[1] ?? "qa-out/shot.png";
const who = (args.find((a) => a.startsWith("--who=")) ?? "--who=admin").split("=")[1];
const flag = (n, d) => {
  const a = args.find((x) => x === `--${n}` || x.startsWith(`--${n}=`));
  return a ? (a.includes("=") ? a.split("=")[1] : true) : d;
};
const w = Number(flag("w", 1440));
const h = Number(flag("h", 900));
const locale = flag("locale", "en");
const full = flag("full", false);

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const problems = [];

if (who === "anon") {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([{ name: "edu_locale", value: locale, url: BASE }]);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text().slice(0, 180)}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(600);
  mkdirSync(dirname(resolve(ROOT, out)), { recursive: true });
  await page.screenshot({ path: resolve(ROOT, out), fullPage: !!full });
  const meta = await page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  console.log(JSON.stringify({ url: urlPath, out, ...meta, problems }, null, 2));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
}

const { page, ctx } = await ensureAuth(browser, who, { locale, viewport: { width: w, height: h } });
await ctx.addCookies([{ name: "edu_locale", value: locale, url: BASE }]);
page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text().slice(0, 180)}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`http ${r.status()}: ${r.url()}`); });

await page.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(600);
const dir = await page.evaluate(() => document.documentElement.dir);
const lang = await page.evaluate(() => document.documentElement.lang);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

mkdirSync(dirname(resolve(ROOT, out)), { recursive: true });
await page.screenshot({ path: resolve(ROOT, out), fullPage: !!full });
const title = await page.title();
console.log(JSON.stringify({ url: urlPath, out, dir, lang, overflowX: overflow, title, problems }, null, 2));
await browser.close();
process.exit(problems.length ? 1 : 0);
