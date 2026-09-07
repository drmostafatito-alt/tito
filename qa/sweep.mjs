/**
 * Admin/public route sweep (local dev only).
 * Logs in once (persisted device), visits each route, records: console errors,
 * page errors, failed requests, HTTP>=500, horizontal overflow, dir/lang,
 * broken images, h1 presence. Dumps JSON + screenshots.
 *
 * Usage: node qa/sweep.mjs <routes.json> [--locale=ar] [--w=1440] [--h=900] [--tag=name] [--who=admin] [--clicks]
 * routes.json: [{ "path": "/admin", "clicks"?: [{"sel":"...","wait":300}] }]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE, ROOT, ensureAuth } from "./lib.mjs";

const args = process.argv.slice(2);
const specFile = args[0];
const flag = (n, d) => {
  const a = args.find((x) => x === `--${n}` || x.startsWith(`--${n}=`));
  return a ? (a.includes("=") ? a.split("=")[1] : true) : d;
};
const locale = flag("locale", "en");
const w = Number(flag("w", 1440));
const h = Number(flag("h", 900));
const who = flag("who", "admin");
const tag = flag("tag", `${who}-${locale}-${w}x${h}`);
const spec = JSON.parse(readFileSync(resolve(ROOT, specFile), "utf8"));

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const { page, ctx } = await ensureAuth(browser, who, { locale, viewport: { width: w, height: h } });
await ctx.addCookies([{ name: "edu_locale", value: locale, url: BASE }]);

const results = [];
for (const item of spec) {
  const problems = [];
  const onConsole = (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`); };
  const onPageError = (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`);
  const onReqFail = (r) => problems.push(`reqfail: ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`);
  const onResp = (r) => { if (r.status() >= 400 && !r.url().includes("/admin")) problems.push(`http${r.status()}: ${r.url().replace(BASE, "").slice(0, 120)}`); };
  page.on("console", onConsole); page.on("pageerror", onPageError); page.on("requestfailed", onReqFail); page.on("response", onResp);

  let status = "ok";
  try {
    await page.goto(`${BASE}${item.path}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(500);
    if (item.clicks) {
      for (const c of item.clicks) {
        try {
          await page.locator(c.sel).first().click({ timeout: 6000 });
          await page.waitForTimeout(c.wait ?? 500);
        } catch (e) {
          problems.push(`click-fail: ${c.sel} — ${String(e).slice(0, 100)}`);
        }
      }
    }
    const landed = page.url();
    if (!landed.startsWith(BASE) || (landed.replace(BASE, "").startsWith("/login") && !item.path.startsWith("/login"))) {
      problems.push(`auth-lost: landed on ${landed.replace(BASE, "")}`);
    }
    const m = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.title.slice(0, 80),
      h1: document.querySelector("h1")?.textContent?.trim().slice(0, 100) ?? null,
      brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(0, 110)),
      rawKeys: [...document.querySelectorAll("body *")].map((el) => el.childNodes.length === 1 && el.textContent?.trim()).filter((t) => t && /^[a-z]+[._][a-zA-Z.]+$/.test(t) && t.includes("_")).slice(0, 3),
    }));
    results.push({ path: item.path, status, ...m, problems });
  } catch (e) {
    status = "nav-fail";
    results.push({ path: item.path, status, error: String(e).slice(0, 250), problems });
  }
  page.off("console", onConsole); page.off("pageerror", onPageError); page.off("requestfailed", onReqFail); page.off("response", onResp);

  const slug = item.path === "/" ? "root" : item.path.replaceAll("/", "-").replace(/^-/, "");
  await page.screenshot({ path: `qa-out/sweep/${tag}/${slug}.png`, fullPage: false }).catch(() => {});
}

mkdirSync("qa-out", { recursive: true });
writeFileSync(`qa-out/sweep-${tag}.json`, JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.status !== "ok" || r.problems.length || r.overflowX > 0 || r.brokenImgs?.length || r.rawKeys?.length);
console.log(`sweep ${tag}: ${results.length} routes, ${bad.length} with findings`);
for (const r of bad) {
  console.log(`\n### ${r.path} [${r.status}] overflowX=${r.overflowX ?? "?"} dir=${r.dir} h1=${JSON.stringify(r.h1)}`);
  for (const p of r.problems) console.log(`  - ${p}`);
  if (r.brokenImgs?.length) console.log(`  - broken imgs: ${r.brokenImgs.join(" | ")}`);
  if (r.rawKeys?.length) console.log(`  - raw i18n keys: ${r.rawKeys.join(", ")}`);
  if (r.error) console.log(`  - ${r.error}`);
}
await browser.close();
process.exit(0);
