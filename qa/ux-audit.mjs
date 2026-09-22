/**
 * One-shot UX audit: screenshots + measurements for public/student/admin.
 * Local-dev only. Usage: node qa/ux-audit.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE, ROOT, ensureAuth } from "./lib.mjs";

const OUT = resolve(ROOT, "qa-out/ux-audit");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};

const PUBLIC_ROUTES = [
  "/",
  "/study",
  "/study/physics-3s",
  "/courses",
  "/courses/physics-3s-full",
  "/programs",
  "/programs/al-Thanawiya-al-3amma",
  "/products/physics-3s-full-access",
  "/p/resources",
  "/p/faq",
  "/p/contact",
  "/login",
  "/register",
  "/forgot-password",
];

const STUDENT_ROUTES = [
  "/dashboard",
  "/study",
  "/assignments",
  "/orders",
  "/notifications",
  "/profile",
  "/profile/security",
  "/checkout/physics-3s-full-access",
];

const ADMIN_ROUTES = [
  "/admin",
  "/admin/content",
  "/admin/users",
  "/admin/commerce",
  "/admin/cms",
  "/admin/cms/menus",
  "/admin/appearance",
  "/admin/announcements",
  "/admin/security",
];

function slug(path) {
  return path === "/" ? "root" : path.replaceAll("/", "-").replace(/^-/, "");
}

async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflowX = document.documentElement.scrollWidth - vw;
    const h1 = document.querySelector("h1");
    const interactive = [...document.querySelectorAll("a, button, input, select, textarea, [role='button']")];
    const smallTargets = interactive
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        return r.height < 40 || r.width < 40;
      })
      .slice(0, 12)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      });
    const images = [...document.images];
    const brokenImgs = images.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(0, 120));
    const rawKeys = [...document.querySelectorAll("body *")]
      .map((el) => (el.childNodes.length === 1 ? el.textContent?.trim() : ""))
      .filter((t) => t && /^[a-z]+[._][a-zA-Z.]+$/.test(t) && t.includes("."))
      .slice(0, 5);
    const sticky = [...document.querySelectorAll("header, [class*='sticky']")].map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), h: Math.round(r.height), top: Math.round(r.top) };
    });
    return {
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      title: document.title.slice(0, 80),
      h1: h1?.textContent?.trim().slice(0, 80) ?? null,
      overflowX,
      smallTargets,
      smallTargetCount: smallTargets.length,
      brokenImgs,
      rawKeys,
      stickyHeaderH: sticky[0]?.h ?? null,
      bodyTextLen: (document.body.innerText || "").length,
    };
  });
}

async function shoot(page, who, vpName, path, extra = "") {
  const problems = [];
  const onConsole = (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 180)}`);
  };
  const onPageError = (e) => problems.push(`pageerror: ${e.message.slice(0, 180)}`);
  const onReqFail = (r) => problems.push(`reqfail: ${r.url()} ${r.failure()?.errorText}`);
  const onResp = (r) => {
    if (r.status() >= 500) problems.push(`http${r.status()}: ${r.url()}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onReqFail);
  page.on("response", onResp);

  let status = "ok";
  let m = {};
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(500);
    if (extra === "menu") {
      const btn = page.getByTestId("public-menu").or(page.locator("[aria-controls='mobile-nav'], [aria-controls='student-mobile-nav'], [aria-controls='admin-mobile-nav']")).first();
      if (await btn.count()) {
        await btn.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(400);
      }
    }
    m = await measure(page);
    const file = `${who}-${vpName}-${slug(path)}${extra ? `-${extra}` : ""}.png`;
    await page.screenshot({ path: resolve(OUT, file), fullPage: extra === "full" });
    m.shot = file;
  } catch (e) {
    status = "nav-fail";
    m.error = String(e).slice(0, 250);
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("requestfailed", onReqFail);
  page.off("response", onResp);
  return { who, viewport: vpName, path, extra, status, problems, ...m };
}

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--use-gl=disabled"],
});

const results = [];

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
  const page = await ctx.newPage();
  for (const path of PUBLIC_ROUTES) {
    results.push(await shoot(page, "pub", vpName, path));
  }
  if (vpName === "mobile") {
    results.push(await shoot(page, "pub", vpName, "/", "menu"));
    results.push(await shoot(page, "pub", vpName, "/", "full"));
    results.push(await shoot(page, "pub", vpName, "/login", "full"));
    results.push(await shoot(page, "pub", vpName, "/study", "full"));
  } else {
    results.push(await shoot(page, "pub", vpName, "/", "full"));
    results.push(await shoot(page, "pub", vpName, "/study", "full"));
    results.push(await shoot(page, "pub", vpName, "/login", "full"));
  }
  await ctx.close();
}

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const { page, ctx } = await ensureAuth(browser, "student", { locale: "ar", viewport });
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
  for (const path of STUDENT_ROUTES) {
    results.push(await shoot(page, "stu", vpName, path));
  }
  if (vpName === "mobile") {
    results.push(await shoot(page, "stu", vpName, "/dashboard", "menu"));
    results.push(await shoot(page, "stu", vpName, "/dashboard", "full"));
  } else {
    results.push(await shoot(page, "stu", vpName, "/dashboard", "full"));
  }
  await ctx.close();
}

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const { page, ctx } = await ensureAuth(browser, "admin", { locale: "ar", viewport });
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
  for (const path of ADMIN_ROUTES) {
    results.push(await shoot(page, "adm", vpName, path));
  }
  if (vpName === "mobile") {
    results.push(await shoot(page, "adm", vpName, "/admin", "menu"));
    results.push(await shoot(page, "adm", vpName, "/admin", "full"));
    results.push(await shoot(page, "adm", vpName, "/admin/content", "full"));
  } else {
    results.push(await shoot(page, "adm", vpName, "/admin", "full"));
    results.push(await shoot(page, "adm", vpName, "/admin/content", "full"));
  }
  await ctx.close();
}

writeFileSync(resolve(OUT, "results.json"), JSON.stringify(results, null, 2));
const bad = results.filter(
  (r) =>
    r.status !== "ok" ||
    r.problems?.length ||
    (r.overflowX ?? 0) > 2 ||
    r.brokenImgs?.length ||
    r.rawKeys?.length ||
    !r.h1,
);
console.log(`ux-audit: ${results.length} shots, ${bad.length} with findings`);
for (const r of bad) {
  console.log(
    `\n### ${r.who} ${r.viewport} ${r.path}${r.extra ? " [" + r.extra + "]" : ""}  overflowX=${r.overflowX ?? "?"} h1=${JSON.stringify(r.h1)} small=${r.smallTargetCount ?? 0}`,
  );
  for (const p of r.problems || []) console.log(`  - ${p}`);
  if (r.brokenImgs?.length) console.log(`  - broken imgs: ${r.brokenImgs.join(" | ")}`);
  if (r.rawKeys?.length) console.log(`  - raw i18n: ${r.rawKeys.join(", ")}`);
  if (r.error) console.log(`  - ${r.error}`);
  if (!r.h1) console.log("  - missing h1");
  if ((r.overflowX ?? 0) > 2) console.log(`  - horizontal overflow ${r.overflowX}px`);
  if (r.smallTargets?.length) {
    for (const t of r.smallTargets.slice(0, 4)) console.log(`  - small target <${t.tag}> "${t.text}" ${t.w}x${t.h}`);
  }
}

await browser.close();
process.exit(0);
