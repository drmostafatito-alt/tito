/**
 * Local-dev screenshot helper for the frontend rebuild.
 * Usage: node qa/snap.mjs <path> <out.png> [--w=1440] [--h=900] [--locale=ar] [--full] [--who=anon|student|admin]
 * Reports console errors, page errors, failed requests and horizontal overflow.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const ROOT = resolve(import.meta.dirname, "..");
const CREDS = {
  admin: { email: "admin@educore.local", password: "E2e-Admin-2026!" },
  student: { email: "student@educore.local", password: "Student#12345" },
};

const args = process.argv.slice(2);
const urlPath = args[0] ?? "/";
const out = args[1] ?? "qa-out/shot.png";
const flag = (n, d) => {
  const a = args.find((x) => x === `--${n}` || x.startsWith(`--${n}=`));
  return a ? (a.includes("=") ? a.split("=")[1] : true) : d;
};
const w = Number(flag("w", 1440));
const h = Number(flag("h", 900));
const locale = flag("locale", "ar");
const full = !!flag("full", false);
const who = flag("who", "anon");

const packaged = resolve(ROOT, ".e2e/browser/chromium");
const libdir = resolve(tmpdir(), "al2023", "lib");
const launch = existsSync(packaged)
  ? {
      executablePath: packaged,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-software-rasterizer", "--use-gl=disabled", "--disable-dev-shm-usage", "--font-render-hinting=none"],
      env: { ...process.env, LD_LIBRARY_PATH: [libdir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") },
    }
  : { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] };

const browser = await chromium.launch(launch);
const problems = [];
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "edu_locale", value: locale, url: BASE }]);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text().slice(0, 240)}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`http ${r.status()}: ${r.url()}`); });

if (who !== "anon") {
  const creds = CREDS[who];
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(creds.email);
  await page.locator('input[name="password"]').fill(creds.password);
  await Promise.all([page.waitForLoadState("networkidle"), page.locator('button[type="submit"]').first().click()]);
}

await page.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(500);
mkdirSync(dirname(resolve(ROOT, out)), { recursive: true });
await page.screenshot({ path: resolve(ROOT, out), fullPage: full });
const meta = await page.evaluate(() => ({
  dir: document.documentElement.dir,
  lang: document.documentElement.lang,
  title: document.title,
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  h1: [...document.querySelectorAll("h1")].map((e) => e.textContent?.trim().slice(0, 80)),
}));
console.log(JSON.stringify({ url: urlPath, out, ...meta, problems }, null, 2));
await browser.close();
