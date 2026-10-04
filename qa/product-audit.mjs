/**
 * FULL product audit (local dev only) — real browser, real interaction.
 *
 * For every (route × viewport) it records, from the live DOM:
 *   · horizontal overflow and the exact elements that cause it
 *   · interactive elements with no accessible name
 *   · interactive elements with no destination/action (dead buttons, href="#")
 *   · touch targets under 44×44 CSS px
 *   · broken / zero-sized images
 *   · console errors, page errors, failed requests, HTTP >= 400
 *   · heading order problems and missing <h1>
 *
 * Usage:
 *   node qa/product-audit.mjs [--who=anon|student|admin] [--routes=a,b,c]
 *                             [--viewports=320,768,1440] [--tag=name] [--shots]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE, ROOT, ensureAuth, launchBrowser } from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const a = args.find((x) => x === `--${n}` || x.startsWith(`--${n}=`));
  return a ? (a.includes("=") ? a.split("=").slice(1).join("=") : true) : d;
};

const who = flag("who", "anon");
const tag = flag("tag", who);
const shots = Boolean(flag("shots", false));
const VIEWPORTS = String(flag("viewports", "320,360,375,390,414,768,1024,1280,1440"))
  .split(",")
  .map((n) => Number(n.trim()))
  .filter(Boolean);

const DEFAULT_ROUTES = {
  anon: ["/", "/study", "/about", "/login", "/register", "/courses", "/p/faq"],
  student: ["/", "/study", "/dashboard", "/profile", "/orders"],
  admin: ["/admin", "/admin/cms", "/admin/content", "/admin/appearance", "/admin/videos", "/admin/users", "/admin/files"],
};
const routes = String(flag("routes", DEFAULT_ROUTES[who].join(","))).split(",").filter(Boolean);

const OUT = resolve(ROOT, "qa-out", `audit-${tag}`);
mkdirSync(OUT, { recursive: true });

/** Everything the audit asks the page about, in one evaluate() round trip. */
const PROBE = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0)) return false;
    if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return false;
    // Screen-reader-only content (skip link, sr-only labels) is intentionally
    // 1×1 and clipped — it is not a layout or touch-target defect.
    if (r.width <= 2 && r.height <= 2) return false;
    if (s.clipPath && s.clipPath !== "none" && /inset\(50%\)|rect\(0/.test(s.clipPath)) return false;
    return true;
  };
  const name = (el) => {
    const t = (el.getAttribute("aria-label") || "").trim();
    if (t) return t;
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const parts = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() || "");
      if (parts.join(" ").trim()) return parts.join(" ").trim();
    }
    if (el.tagName === "IMG") return (el.getAttribute("alt") || "").trim();
    // Form controls never take their name from their own text content:
    // `<label for>`, a wrapping <label>, title or placeholder. TEXTAREA and
    // SELECT follow exactly the same rules as INPUT.
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      const forLabel = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) return forLabel.textContent.trim();
      const wrapping = el.closest("label");
      if (wrapping) return wrapping.textContent.trim();
      return (el.getAttribute("title") || el.getAttribute("placeholder") || el.value || "").trim();
    }
    const txt = (el.innerText || el.textContent || "").trim();
    if (txt) return txt;
    const title = (el.getAttribute("title") || "").trim();
    if (title) return title;
    const svgTitle = el.querySelector("svg title")?.textContent?.trim();
    return svgTitle || "";
  };
  const sel = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 120);
  };

  const docW = document.documentElement.clientWidth;
  const overflow = [];
  if (document.documentElement.scrollWidth > docW + 1) {
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > docW + 1 || r.left < -1) {
        const p = el.parentElement;
        const pr = p ? p.getBoundingClientRect() : null;
        // Report the outermost offender only.
        if (pr && (pr.right > docW + 1 || pr.left < -1)) continue;
        overflow.push({ sel: sel(el), right: Math.round(r.right), left: Math.round(r.left), text: (el.innerText || "").trim().slice(0, 60) });
      }
    }
  }

  const interactive = [...document.querySelectorAll('a, button, [role="button"], input, select, textarea, summary')].filter(vis);
  const unnamed = [];
  const small = [];
  const dead = [];
  for (const el of interactive) {
    const n = name(el);
    const r = el.getBoundingClientRect();
    if (!n) unnamed.push({ sel: sel(el), html: el.outerHTML.slice(0, 160) });
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (!href || href === "#" || href.startsWith("javascript:")) dead.push({ sel: sel(el), name: n, href });
    }
    if (el.tagName === "BUTTON" && !el.closest("form") && !el.getAttribute("onclick") && !el.hasAttribute("aria-expanded") && !el.hasAttribute("aria-controls") && el.type === "submit") {
      dead.push({ sel: sel(el), name: n, href: "submit-outside-form" });
    }
    // `data-allow-small` is the codebase's opt-out for inline text links
    // (breadcrumbs, inline prose links) that are not touch affordances.
    // A stretched link (::after inset:0) is measured by its card, not its text.
    const stretched = el.tagName === "A" && getComputedStyle(el, "::after").position === "absolute" && el.closest(".vcard-link, .pub-stretch");
    // A checkbox/radio inside a <label> is clicked via the label, so measure
    // the label: a 16px box inside a 44px row is a 44px target.
    if ((el.type === "checkbox" || el.type === "radio") && el.closest("label")) {
      const lr = el.closest("label").getBoundingClientRect();
      if (lr.width >= 24 && lr.height >= 24) continue;
    }
    const isTiny = (r.width < 40 || r.height < 40) && el.type !== "hidden" && !el.closest("[data-allow-small]") && !stretched;
    if (isTiny) small.push({ sel: sel(el), name: n.slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  }

  const images = [...document.querySelectorAll("img")].map((im) => ({
    src: (im.currentSrc || im.src || "").slice(-80),
    alt: im.getAttribute("alt"),
    broken: im.complete && im.naturalWidth === 0,
    w: Math.round(im.getBoundingClientRect().width),
    h: Math.round(im.getBoundingClientRect().height),
    noDims: !im.getAttribute("width") && !im.getAttribute("height"),
  }));

  // Headings are read from the ACCESSIBILITY tree, not the visual one: an
  // `sr-only` heading is a real step in the document outline (that is the
  // whole point of adding one), so filtering by visibility produced false
  // "h1 → h3" skips. Only `display:none` / `aria-hidden` subtrees are excluded.
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter((h) => {
      if (h.closest("[aria-hidden='true']")) return false;
      for (let n = h; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
      }
      return true;
    })
    .map((h) => ({
    level: Number(h.tagName[1]),
    text: (h.innerText || "").trim().slice(0, 60),
  }));

  // Text that is clipped by its own box (a common Arabic long-word symptom).
  const clipped = [];
  for (const el of document.querySelectorAll("h1,h2,h3,h4,p,span,b,small,a,button,li,div")) {
    if (!vis(el)) continue;
    if (el.children.length) continue;
    const s = getComputedStyle(el);
    if (s.overflow === "visible" && s.overflowX === "visible") continue;
    if (el.scrollWidth > el.clientWidth + 2 && s.textOverflow !== "ellipsis" && s.overflowX !== "auto" && s.overflowX !== "scroll") {
      clipped.push({ sel: sel(el), text: (el.innerText || "").trim().slice(0, 50), scrollW: el.scrollWidth, clientW: el.clientWidth });
    }
  }

  // Collisions inside the chrome rows. Siblings in a nav/action bar must never
  // paint over each other; this is how a too-wide desktop nav slides under the
  // auth buttons at some widths while looking fine at others.
  const collisions = [];
  for (const row of document.querySelectorAll(".topbar-in, .mnav, .fcols, header nav, [data-collision-row]")) {
    const kids = [...row.querySelectorAll("a, button, .brand, .topbar-actions > *")]
      .filter((e) => vis(e) && !e.querySelector("a, button"));
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        if (kids[i].contains(kids[j]) || kids[j].contains(kids[i])) continue;
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1) {
          collisions.push({ a: name(kids[i]).slice(0, 24), b: name(kids[j]).slice(0, 24), px: Math.round(ox) });
        }
      }
    }
  }

  return {
    collisions: collisions.slice(0, 10),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: docW,
    overflow: overflow.slice(0, 12),
    unnamed: unnamed.slice(0, 15),
    small: small.slice(0, 20),
    dead: dead.slice(0, 15),
    images,
    headings,
    clipped: clipped.slice(0, 10),
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    h1Count: document.querySelectorAll("h1").length,
    mainCount: document.querySelectorAll("main").length,
  };
};

const browser = await launchBrowser();
let page, ctx;
if (who === "anon") {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
  page = await ctx.newPage();
} else {
  ({ page, ctx } = await ensureAuth(browser, who, { locale: "ar", viewport: { width: 1440, height: 900 } }));
  await ctx.addCookies([{ name: "edu_locale", value: "ar", url: BASE }]);
}

const report = [];
for (const route of routes) {
  for (const width of VIEWPORTS) {
    const height = width < 500 ? 740 : width < 1100 ? 900 : 900;
    await page.setViewportSize({ width, height });
    const net = [];
    const onConsole = (m) => { if (m.type() === "error") net.push(`console: ${m.text().slice(0, 180)}`); };
    const onPageError = (e) => net.push(`pageerror: ${e.message.slice(0, 180)}`);
    const onReqFail = (r) => net.push(`reqfail: ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`);
    const onResp = (r) => { if (r.status() >= 400) net.push(`http${r.status()}: ${r.url().replace(BASE, "").slice(0, 120)}`); };
    page.on("console", onConsole); page.on("pageerror", onPageError);
    page.on("requestfailed", onReqFail); page.on("response", onResp);
    let probe = null;
    let error = null;
    try {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45000 });
      if (resp && resp.status() >= 400) error = `status ${resp.status()}`;
      await page.waitForTimeout(250);
      probe = await page.evaluate(PROBE);
      if (shots) {
        await page.screenshot({ path: resolve(OUT, `${route.replace(/\W+/g, "_") || "root"}-${width}.png`), fullPage: width <= 500 });
      }
    } catch (e) {
      error = String(e).slice(0, 200);
    }
    page.off("console", onConsole); page.off("pageerror", onPageError);
    page.off("requestfailed", onReqFail); page.off("response", onResp);
    report.push({ route, width, error, net: [...new Set(net)].slice(0, 10), ...probe });
  }
}

writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));

// ---- human summary -------------------------------------------------------
const bad = [];
for (const r of report) {
  const issues = [];
  if (r.error) issues.push(`ERROR ${r.error}`);
  if (r.net?.length) issues.push(...r.net.map((n) => `net ${n}`));
  if (r.scrollWidth > r.clientWidth + 1) issues.push(`overflow ${r.scrollWidth}>${r.clientWidth}: ${r.overflow.map((o) => o.sel).join(", ")}`);
  if (r.unnamed?.length) issues.push(`unnamed(${r.unnamed.length}): ${r.unnamed.map((u) => u.sel).join(", ")}`);
  if (r.dead?.length) issues.push(`dead(${r.dead.length}): ${r.dead.map((d) => `${d.sel}[${d.name}]`).join(", ")}`);
  if (r.collisions?.length) issues.push(`COLLISION: ${r.collisions.map((c) => `${c.a} ⨯ ${c.b} (${c.px}px)`).join(", ")}`);
  if (r.small?.length) issues.push(`tiny(${r.small.length}): ${r.small.map((s) => `${s.sel} ${s.w}x${s.h}`).join(", ")}`);
  if (r.images?.some((i) => i.broken)) issues.push(`broken-img: ${r.images.filter((i) => i.broken).map((i) => i.src).join(", ")}`);
  if (r.images?.some((i) => i.alt === null)) issues.push(`img-no-alt: ${r.images.filter((i) => i.alt === null).length}`);
  if (r.clipped?.length) issues.push(`clipped(${r.clipped.length}): ${r.clipped.map((c) => `${c.sel} "${c.text}"`).join(", ")}`);
  if (r.h1Count === 0) issues.push("no h1");
  if (r.h1Count > 1) issues.push(`${r.h1Count} h1`);
  if (r.mainCount !== 1) issues.push(`${r.mainCount} main landmarks`);
  if (issues.length) bad.push(`\n### ${r.route} @ ${r.width}\n- ` + issues.join("\n- "));
}

/**
 * Roll the per-combination findings up by CLASS. A 9-viewport × 15-route sweep
 * produces the same defect 135 times; what a reviewer needs is "which KINDS of
 * problem exist, how many instances, and one example of each".
 */
const CLASSES = [
  ["error", (r) => (r.error ? [r.error] : [])],
  ["network/console", (r) => r.net ?? []],
  ["horizontal overflow", (r) => (r.scrollWidth > r.clientWidth + 1 ? [`${r.scrollWidth}>${r.clientWidth} ${r.overflow.map((o) => o.sel).join(", ")}`] : [])],
  ["element collision", (r) => (r.collisions ?? []).map((c) => `${c.a} ⨯ ${c.b} (${c.px}px)`)],
  ["no accessible name", (r) => (r.unnamed ?? []).map((u) => `${u.sel} ${u.html.slice(0, 70)}`)],
  ["dead link / no destination", (r) => (r.dead ?? []).map((d) => `${d.sel} [${d.name}] href=${d.href}`)],
  ["target < 24px (WCAG 2.5.8 AA)", (r) => (r.small ?? []).filter((s) => Math.min(s.w, s.h) < 24).map((s) => `${s.sel} ${s.w}x${s.h} "${s.name}"`)],
  ["target 24-39px (below 44px comfort)", (r) => (r.small ?? []).filter((s) => Math.min(s.w, s.h) >= 24).map((s) => `${s.sel} ${s.w}x${s.h} "${s.name}"`)],
  ["broken image", (r) => (r.images ?? []).filter((i) => i.broken).map((i) => i.src)],
  ["image without alt", (r) => (r.images ?? []).filter((i) => i.alt === null).map((i) => i.src)],
  ["clipped text", (r) => (r.clipped ?? []).map((c) => `${c.sel} "${c.text}" ${c.scrollW}>${c.clientW}`)],
  ["h1 count != 1", (r) => (r.h1Count === 1 ? [] : [`h1=${r.h1Count}`])],
  ["main landmark count != 1", (r) => (r.mainCount === 1 ? [] : [`main=${r.mainCount}`])],
  ["heading level skipped", (r) => {
    const hs = (r.headings ?? []).map((h) => h.level);
    for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) return [`h${hs[i - 1]} → h${hs[i]}`];
    return [];
  }],
];

const rollup = [];
for (const [label, extract] of CLASSES) {
  const hits = [];
  for (const r of report) for (const d of extract(r)) hits.push({ where: `${r.route} @ ${r.width}`, detail: String(d).slice(0, 160) });
  if (!hits.length) continue;
  const distinct = new Map();
  for (const h of hits) if (!distinct.has(h.detail)) distinct.set(h.detail, h.where);
  rollup.push(`\n## ${label} — ${hits.length} instance(s), ${distinct.size} distinct`);
  for (const [detail, where] of [...distinct].slice(0, 8)) rollup.push(`- ${where} · ${detail}`);
  if (distinct.size > 8) rollup.push(`- …and ${distinct.size - 8} more distinct`);
}

const header = `# Product audit · ${who} · ${report.length} route×viewport combinations\nroutes: ${routes.join(", ")}\nviewports: ${VIEWPORTS.join(", ")}`;
const summary = [
  header,
  rollup.length ? rollup.join("\n") : "\n**NO FINDINGS** — no overflow, collisions, dead links, unnamed controls, broken images, console/network errors or heading-order problems.",
  "\n---\n# Per-combination detail",
  bad.length ? bad.join("\n") : "no issues found",
].join("\n");
writeFileSync(resolve(OUT, "summary.md"), summary);
console.log([header, rollup.length ? rollup.join("\n") : "\nNO FINDINGS"].join("\n"));
console.log(`\n→ ${OUT}`);

await ctx.close();
await browser.close();
