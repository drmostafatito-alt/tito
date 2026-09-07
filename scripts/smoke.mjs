#!/usr/bin/env node
/**
 * Phase 2 HTTP runtime smoke tests (TEST-PLAN §2 "P2" + §6 execution log).
 * Runs against a LIVE worker (`npm run dev` → wrangler dev) with local D1/R2
 * migrated + seeded (`npm run db:migrate:local && npm run db:seed:local`).
 *
 * Usage:
 *   SMOKE_ADMIN_PASSWORD='<seed output>' node scripts/smoke.mjs [baseUrl]
 *
 * Env:
 *   SMOKE_BASE_URL           default http://127.0.0.1:5173
 *   SMOKE_ADMIN_EMAIL        default admin@educore.local
 *   SMOKE_ADMIN_PASSWORD     required (printed by the seed script)
 *   SMOKE_STUDENT_EMAIL      default student@educore.local
 *   SMOKE_STUDENT_PASSWORD   default Student#12345
 *   SMOKE_JAR_DIR            default /tmp/educore-smoke-jars
 *
 * Cookie jars (incl. the durable device key `dk`) PERSIST between runs, like a
 * real browser profile: the device-concurrency policy (max 1 device/student,
 * onLimit=block — ADR-005) would otherwise block every re-run as a "new
 * device". Delete SMOKE_JAR_DIR (or reset .wrangler state) for a cold run.
 *
 * NOTE: exercises the login rate limiter at the END (by design) — the IP is
 * blocked for the remainder of the fixed 1-minute window after a green run.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:5173";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@educore.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const STUDENT_EMAIL = process.env.SMOKE_STUDENT_EMAIL ?? "student@educore.local";
const STUDENT_PASSWORD = process.env.SMOKE_STUDENT_PASSWORD ?? "Student#12345";
const JAR_DIR = process.env.SMOKE_JAR_DIR ?? "/tmp/educore-smoke-jars";

if (!ADMIN_PASSWORD) {
  console.error("SMOKE_ADMIN_PASSWORD is required (see `npm run db:seed:local` output).");
  process.exit(2);
}
mkdirSync(JAR_DIR, { recursive: true });

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Minimal cookie-jar fetch client with on-disk persistence (device key reuse). */
function makeClient(role) {
  const jarPath = join(JAR_DIR, `${role}.json`);
  let saved = {};
  try { saved = JSON.parse(readFileSync(jarPath, "utf8")) ?? {}; } catch { /* cold run */ }
  const jar = new Map(Object.entries(saved));
  const persist = () => writeFileSync(jarPath, JSON.stringify(Object.fromEntries(jar)));
  persist();
  return {
    jar,
    async req(method, path, { body, headers = {}, redirect = "manual", form } = {}) {
      if (path == null) throw new Error(`smoke bug: null path (role=${role}, method=${method})`);
      const url = `${BASE}${path}`;
      const h = { ...headers };
      if (jar.size) h.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      let payload = body;
      if (form) {
        payload = new URLSearchParams(form).toString();
        h["content-type"] = "application/x-www-form-urlencoded";
      }
      const res = await fetch(url, { method, headers: h, body: payload, redirect });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(";");
        const eq = pair.indexOf("=");
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const maxAge0 = /Max-Age=0/i.test(sc);
        if (maxAge0 || value === "") jar.delete(name);
        else jar.set(name, value);
      }
      persist();
      const text = await res.text();
      return { status: res.status, headers: res.headers, location: res.headers.get("location"), text };
    },
    get(path, opts) { return this.req("GET", path, opts); },
    post(path, opts) { return this.req("POST", path, opts); },
  };
}

const SECURITY_HEADERS = [
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "x-frame-options",
];

function hasSecurityHeaders(res) {
  return SECURITY_HEADERS.every((h) => res.headers.get(h));
}

function decodeEntities(s) {
  return s.replaceAll("&amp;", "&");
}

/**
 * React SSR inserts `<!-- -->` separators between adjacent static/dynamic text
 * nodes (e.g. `/<!-- -->coulomb-law</span>`). Normalize so needles can match
 * the RENDERED list markup. Note: loader data is also embedded as turbo-stream
 * JSON whose value order is NOT the array order — needles must therefore
 * target rendered markup (slug spans end with `</span>`; JSON never does).
 */
function norm(s) {
  return s.replaceAll("<!-- -->", "");
}

/** Extract a signed /files/ URL (perm=view|download) from lesson/admin HTML. */
function extractSignedFileUrl(html, perm) {
  const m = html.match(new RegExp(`/files/[0-9a-f-]{36}\\?perm=${perm}[^"'\\\\ ]*`));
  if (!m) return null;
  const url = decodeEntities(m[0]);
  return /exp=\d+/.test(url) && /sig=[0-9a-f]{64}/.test(url) ? url : null;
}

function extractFileId(html) {
  const m = html.match(/\/files\/([0-9a-f-]{36})\?perm=/);
  return m ? m[1] : null;
}

function extractVideoId(html) {
  const m = html.match(/videoId\\?",\\?"([0-9a-f-]{36})/);
  return m ? m[1] : null;
}

/** Nearest preceding node-editor link for a needle occurring in the admin tree. */
function extractIdNear(rawHtml, linkRe, needle) {
  const html = norm(rawHtml);
  const at = html.indexOf(needle);
  if (at === -1) return null;
  const before = html.slice(0, at);
  const re = new RegExp(linkRe, "g");
  let last = null;
  for (const m of before.matchAll(re)) last = m[1];
  return last;
}

/** First id AFTER a needle (hidden inputs inside a row render after the row label). */
function extractIdAfter(rawHtml, re, needle) {
  const html = norm(rawHtml);
  const at = html.indexOf(needle);
  if (at === -1) return null;
  const m = html.slice(at).match(new RegExp(re));
  return m ? m[1] : null;
}

function blockIdsOf(rawHtml) {
  return [...norm(rawHtml).matchAll(/name="blockId" value="([0-9a-f-]{36})"/g)].map((m) => m[1]);
}

function extractNodeIdNear(rawHtml, type, needle) {
  const html = norm(rawHtml);
  const at = html.indexOf(needle);
  if (at === -1) return null;
  const before = html.slice(0, at);
  const re = new RegExp(`/admin/content/${type}/([0-9a-f-]{36})`, "g");
  let last = null;
  for (const m of before.matchAll(re)) last = m[1];
  return last;
}

/** Position of a rendered slug span in the (normalized) list markup. */
function slugPos(html, slug) {
  return norm(html).indexOf(`/${slug}</span>`);
}

/** Why did a login POST fail? (localized error copy → stable codes) */
function loginFailureKind(html) {
  // needles match auth.errors.rate_limitedTitle/Body in app/locales (ar/en)
  if (html.includes("محدود مؤقتًا") || html.includes("rate limited")) return "rate_limited";
  if (html.includes("Device limit") || html.includes("الحد الأقصى للأجهزة") || html.includes("device")) return "device_limit?";
  if (html.includes("غير صحيحة") || html.includes("Incorrect email")) return "invalid_credentials";
  return "unknown";
}

const run = async () => {
  console.log(`Smoke target: ${BASE}`);
  console.log(`Jar dir:      ${JAR_DIR}`);

  // ------------------------------------------------------------------
  console.log("\n[1] Public pages + security headers");
  const anon = makeClient("anon");
  const home = await anon.get("/");
  check("GET / → 200", home.status === 200, `got ${home.status}`);
  check("home renders RTL Arabic shell from D1 settings", home.text.includes('dir="rtl"') && home.text.includes("مصطفى تيتو"));
  check("home carries all 6 security headers", hasSecurityHeaders(home));
  check("CSP is strict (no unsafe-inline in production build)", !(home.headers.get("content-security-policy") ?? "").includes("unsafe-inline"));

  const courses = await anon.get("/courses");
  check("GET /courses → 200", courses.status === 200, `got ${courses.status}`);
  check("catalog lists published course", courses.text.includes("physics-3s-full"));
  check("catalog lists free authenticated course", courses.text.includes("study-skills"));

  const coursePage = await anon.get("/courses/physics-3s-full");
  check("GET /courses/:slug → 200", coursePage.status === 200, `got ${coursePage.status}`);
  check("security headers on course page", hasSecurityHeaders(coursePage));

  const unknownCourse = await anon.get("/courses/does-not-exist");
  check("unknown course slug → 404", unknownCourse.status === 404, `got ${unknownCourse.status}`);

  // ------------------------------------------------------------------
  console.log("\n[2] Anonymous denial (protected content) + method guards");
  const anonLesson = await anon.get("/learn/physics-3s-full/coulomb-law");
  check(
    "anon → entitled lesson redirects to /login?next=…",
    anonLesson.status === 302 && (anonLesson.location ?? "").startsWith("/login?next=%2Flearn"),
    `${anonLesson.status} ${anonLesson.location}`
  );

  // videoId is needed by several sections — resolve it once from the DB-backed
  // lesson page of an entitled session later; fall back to the seeded id shape.
  const seededVideoIdFallback = null;

  const logoutGet = await anon.get("/logout");
  check("GET /logout → 405 (POST-only mutation)", logoutGet.status === 405, `got ${logoutGet.status}`);

  // CSRF: cross-origin mutation blocked. NOTE: under `wrangler dev`, workerd's
  // DNS-rebinding protection answers a mismatched Origin with 400 BEFORE the
  // app middleware runs; the app's own middleware answers 403 (verified via
  // sec-fetch-site below, which workerd passes through). Blocked either way.
  const csrf = await anon.post("/login", {
    form: { email: STUDENT_EMAIL, password: "x" },
    headers: { origin: "https://evil.example" },
  });
  check("cross-origin POST (evil Origin) → blocked (400 workerd / 403 middleware)", csrf.status === 400 || csrf.status === 403, `got ${csrf.status}`);
  const csrfFetchSite = await anon.post("/login", {
    form: { email: STUDENT_EMAIL, password: "x" },
    headers: { "sec-fetch-site": "cross-site" },
  });
  check("cross-site sec-fetch-site POST → 403 (app middleware)", csrfFetchSite.status === 403, `got ${csrfFetchSite.status}`);

  // ------------------------------------------------------------------
  console.log("\n[3] Student login + session behavior");
  const student = makeClient("student");
  const login = await student.post("/login", { form: { email: STUDENT_EMAIL, password: STUDENT_PASSWORD } });
  const loginOk = login.status === 302 && login.location === "/dashboard";
  check("student login → 302 /dashboard", loginOk, loginOk ? "" : `got ${login.status} ${login.location ?? ""} (${loginFailureKind(login.text)})`);
  const wrongLogin = await makeClient("wrongpw").post("/login", { form: { email: STUDENT_EMAIL, password: "wrong-password-x" } });
  const wrongCookies = wrongLogin.headers.getSetCookie?.() ?? [];
  check("wrong password → 200 form re-render, no session cookie", wrongLogin.status === 200 && !wrongCookies.some((c) => c.startsWith("__edu_session=")), `status=${wrongLogin.status}`);
  check("session cookie present after login", student.jar.has("__edu_session"));
  const dash = await student.get("/dashboard");
  check("student GET /dashboard → 200", dash.status === 200, `got ${dash.status}`);

  // RBAC regression: student → admin area
  const studentAdmin = await student.get("/admin");
  check(
    "student GET /admin → 404-shaped redirect (?error=forbidden)",
    studentAdmin.status === 302 && (studentAdmin.location ?? "").includes("error=forbidden"),
    `${studentAdmin.status} ${studentAdmin.location}`
  );
  const studentAdminFiles = await student.get("/admin/files");
  check("student GET /admin/files → redirect (server-enforced RBAC)", studentAdminFiles.status === 302 && (studentAdminFiles.location ?? "").includes("error=forbidden"), `got ${studentAdminFiles.status}`);

  // ------------------------------------------------------------------
  console.log("\n[4] Lesson access per access_level (free preview vs entitled)");
  const lesson1 = await student.get("/learn/physics-3s-full/electrostatics-intro");
  check("entitled student → free-preview lesson → 200", lesson1.status === 200, `got ${lesson1.status}`);
  const videoId = extractVideoId(lesson1.text) ?? seededVideoIdFallback;
  check("lesson page embeds the attached video id", Boolean(videoId), "videoId not found");
  const anonPlayback = await anon.post(`/api/playback/${videoId ?? "00000000-0000-4000-8000-000000000000"}`);
  check("anon → POST /api/playback/:id → 401", anonPlayback.status === 401, `got ${anonPlayback.status}`);

  const lesson2 = await student.get("/learn/physics-3s-full/coulomb-law");
  check("entitled student (subject grant) → entitled lesson → 200", lesson2.status === 200, `got ${lesson2.status}`);
  const viewUrl = lesson2.status === 200 ? extractSignedFileUrl(lesson2.text, "view") : null;
  const downloadUrl = lesson2.status === 200 ? extractSignedFileUrl(lesson2.text, "download") : null;
  const fileId = lesson2.status === 200 ? extractFileId(lesson2.text) : null;
  check("lesson HTML contains server-minted signed view URL", Boolean(viewUrl), "no signed view URL");
  check("lesson HTML contains signed download URL (download_allowed=1)", Boolean(downloadUrl), "no signed download URL");
  check("signed URLs embed exp + HMAC sig", Boolean(viewUrl));

  // ------------------------------------------------------------------
  console.log("\n[5] Private R2 file protection (signed URLs, view vs download)");
  if (viewUrl && downloadUrl && fileId) {
    const fileView = await student.get(viewUrl);
    check("signed view URL → 200", fileView.status === 200, `got ${fileView.status}`);
    check("file body is the PDF (starts %PDF)", fileView.text.startsWith("%PDF"));
    check("view disposition is inline", (fileView.headers.get("content-disposition") ?? "").startsWith("inline"), String(fileView.headers.get("content-disposition")));
    check("private file is no-store", (fileView.headers.get("cache-control") ?? "").includes("no-store"));
    check("nosniff on file response", fileView.headers.get("x-content-type-options") === "nosniff");

    const fileDownload = await student.get(downloadUrl);
    check("signed download URL → 200", fileDownload.status === 200, `got ${fileDownload.status}`);
    check("download disposition is attachment", (fileDownload.headers.get("content-disposition") ?? "").startsWith("attachment"), String(fileDownload.headers.get("content-disposition")));

    const unsigned = await student.get(`/files/${fileId}`);
    check("private file WITHOUT signature → 404 (no existence leak)", unsigned.status === 404, `got ${unsigned.status}`);
    const tamperedSig = await student.get(viewUrl.replace(/sig=[0-9a-f]{64}/, `sig=${"0".repeat(64)}`));
    check("tampered signature → 404", tamperedSig.status === 404, `got ${tamperedSig.status}`);
    const tamperedId = await student.get(viewUrl.replace(/\/files\/[0-9a-f-]{36}/, `/files/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`));
    check("signature not transferable to another file id → 404", tamperedId.status === 404, `got ${tamperedId.status}`);
    const viewAsDownload = await student.get(viewUrl.replace("perm=view", "perm=download").replace(/sig=[0-9a-f]{64}/, `sig=${"0".repeat(64)}`));
    check("view sig replayed as perm=download → 404 (perm covered by HMAC)", viewAsDownload.status === 404, `got ${viewAsDownload.status}`);
    const expired = await student.get(viewUrl.replace(/exp=\d+/, `exp=${Date.now() - 60_000}`));
    check("past exp with original sig → 404 (expiry enforced)", expired.status === 404, `got ${expired.status}`);
    const guessedPath = await student.get("/files/private/pdf/anything");
    check("guessed object path → 404 (only /files/:id exists)", guessedPath.status === 404, `got ${guessedPath.status}`);
    const rangeRes = await student.get(viewUrl, { headers: { range: "bytes=0-9" } });
    check("Range request → 206 partial", rangeRes.status === 206, `got ${rangeRes.status}`);
  } else {
    check("section 5 prerequisites (signed URLs present)", false, "skipped — no signed URLs");
  }

  // ------------------------------------------------------------------
  console.log("\n[6] Mock video playback (entitlement-gated credential minting)");
  if (videoId) {
    const playback = await student.post(`/api/playback/${videoId}`);
    check("entitled student → POST /api/playback → 200", playback.status === 200, `got ${playback.status}`);
    let pb = {};
    try { pb = JSON.parse(playback.text); } catch { /* asserted below */ }
    check("playback JSON is provider-neutral {type,url,expiresAt}", pb.type === "hls" && typeof pb.url === "string" && typeof pb.expiresAt === "number");
    check("playback URL points at the mock stream (no vendor leak)", (pb.url ?? "").startsWith(`/api/mock-stream/${videoId}/master.m3u8?`));
    check("playback token TTL ≤ 60s", pb.expiresAt > Date.now() && pb.expiresAt <= Date.now() + 60_000);
    check("playback response is no-store", (playback.headers.get("cache-control") ?? "").includes("no-store"));
    check("no mux/provider secrets in playback response", !/MUX_|mux\.com|signing/i.test(playback.text));

    const stream = await student.get(pb.url);
    check("mock stream with valid token → 200 HLS playlist", stream.status === 200 && stream.text.startsWith("#EXTM3U"), `got ${stream.status}`);
    check("stream response is no-store", (stream.headers.get("cache-control") ?? "").includes("no-store"));
    const forged = await student.get(pb.url.replace(/token=[0-9a-f]{64}/, `token=${"0".repeat(64)}`));
    check("forged stream token → 404", forged.status === 404, `got ${forged.status}`);
    const noToken = await student.get(`/api/mock-stream/${videoId}/master.m3u8`);
    check("stream without token → 404", noToken.status === 404, `got ${noToken.status}`);
    const poster = await student.get(pb.posterUrl ?? pb.url.replace("master.m3u8", "poster.svg"));
    check("poster/thumbnail endpoint → 200 SVG", poster.status === 200 && poster.text.includes("<svg"), `got ${poster.status}`);
    const playbackGet = await student.get(`/api/playback/${videoId}`);
    check("GET /api/playback (client bug) → redirect, never credentials", playbackGet.status === 302, `got ${playbackGet.status}`);
    const playbackUnknown = await student.post("/api/playback/00000000-0000-4000-8000-0000000000ff");
    check("playback for unknown video id → 404", playbackUnknown.status === 404, `got ${playbackUnknown.status}`);
  } else {
    check("section 6 prerequisites (videoId present)", false, "skipped — no videoId");
  }

  // ------------------------------------------------------------------
  console.log("\n[7] New student WITHOUT entitlement → protected content denied");
  const student2Email = "smoke-student@educore.local";
  const student2Pass = "Sm0ke!Student-2026";
  const student2 = makeClient("student2");
  let s2 = await student2.post("/login", { form: { email: student2Email, password: student2Pass } });
  if (s2.status !== 302) {
    const reg = await student2.post("/register", {
      form: { email: student2Email, fullName: "Smoke Student", password: student2Pass, passwordConfirm: student2Pass },
    });
    if (reg.status !== 302 && reg.text.includes("مستخدمًا") ) {
      // email taken (leftover from a previous DB) but this jar can't log in
      check("smoke student usable (login or register)", false, `login=${s2.status} register=conflict — reset DB state or clear ${JAR_DIR}`);
    } else {
      check("register new student via HTTP → 302", reg.status === 302, `${reg.status} ${reg.location ?? ""}`);
    }
  } else {
    check("smoke student re-login (jar reuse) → 302", true);
  }
  const s2Lesson2 = await student2.get("/learn/physics-3s-full/coulomb-law");
  check("unentitled student → entitled lesson renders locked (200)", s2Lesson2.status === 200, `got ${s2Lesson2.status}`);
  check("locked page shows access-required copy", s2Lesson2.text.includes("يتطلب صلاحية وصول") || s2Lesson2.text.includes("requires an access grant"));
  check("locked page contains NO signed file URLs", !/\/files\/[0-9a-f-]{36}\?perm=[a-z]+&(?:amp;)?exp=/.test(s2Lesson2.text));
  const s2Lesson1 = await student2.get("/learn/physics-3s-full/electrostatics-intro");
  check("unentitled student → free_preview lesson allowed", s2Lesson1.status === 200 && (!videoId || extractVideoId(s2Lesson1.text) === videoId), `got ${s2Lesson1.status}`);
  const s2FreePlayback = videoId ? await student2.post(`/api/playback/${videoId}`) : null;
  check("free-preview lesson video → logged-in student playback 200 (resolver free_preview)", s2FreePlayback ? s2FreePlayback.status === 200 : false, s2FreePlayback ? `got ${s2FreePlayback.status}` : "no videoId");
  const s2Admin = await student2.get("/admin");
  check("student2 GET /admin → forbidden redirect", s2Admin.status === 302 && (s2Admin.location ?? "").includes("error=forbidden"), `${s2Admin.status}`);

  // ------------------------------------------------------------------
  console.log("\n[8] Admin session + content CRUD over HTTP");
  const admin = makeClient("admin");
  const adminLogin = await admin.post("/login", { form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  const adminOk = adminLogin.status === 302 && adminLogin.location === "/admin";
  check("admin login → 302 /admin", adminOk, adminOk ? "" : `got ${adminLogin.status} ${adminLogin.location ?? ""} (${loginFailureKind(adminLogin.text)})`);
  if (!adminOk) {
    console.log("\nAdmin login failed — aborting admin sections (check SMOKE_ADMIN_PASSWORD / device jar).");
    summary();
    return;
  }
  const adminHome = await admin.get("/admin");
  check("admin GET /admin → 200", adminHome.status === 200, `got ${adminHome.status}`);
  const adminContent = await admin.get("/admin/content");
  check("admin content tree → 200 with seeded program", adminContent.status === 200 && adminContent.text.includes("al-Thanawiya-al-3amma"), `got ${adminContent.status}`);

  const stamp = Date.now().toString(36);
  const progTitleEn = `Smoke Program ${stamp}`;
  const progSlug = `smoke-program-${stamp}`;
  const gradeASlug = `smoke-grade-a-${stamp}`;
  const gradeBSlug = `smoke-grade-b-${stamp}`;
  const createProg = await admin.post("/admin/content", {
    form: { _action: "create-program", titleAr: "برنامج الاختبار", titleEn: progTitleEn, status: "published" },
  });
  check("admin create program → 200", createProg.status === 200, `got ${createProg.status}`);
  const tree2 = await admin.get("/admin/content");
  check("created program appears in tree with generated slug", slugPos(tree2.text, progSlug) !== -1, `slug span not found`);
  const programId = extractNodeIdNear(tree2.text, "program", `/${progSlug}</span>`);
  check("program editor link resolvable from tree", Boolean(programId), `programId=${programId}`);

  let gradeAId = null;
  let gradeBId = null;
  if (programId) {
    const progPage = await admin.get(`/admin/content/program/${programId}`);
    check("program node editor → 200", progPage.status === 200, `got ${progPage.status}`);

    for (const g of ["A", "B"]) {
      const r = await admin.post(`/admin/content/program/${programId}`, {
        form: { _action: "create-grade", parentId: programId, titleAr: `صف ${g}`, titleEn: `Smoke Grade ${g} ${stamp}`, status: "published" },
      });
      check(`create child grade ${g} → 200`, r.status === 200, `got ${r.status}`);
    }
    const progPage2 = await admin.get(`/admin/content/program/${programId}`);
    gradeAId = extractNodeIdNear(progPage2.text, "grade", `/${gradeASlug}</span>`);
    gradeBId = extractNodeIdNear(progPage2.text, "grade", `/${gradeBSlug}</span>`);
    check("both grades rendered in editor child list", Boolean(gradeAId && gradeBId), `A=${gradeAId} B=${gradeBId}`);
    check("initial order: A before B (createdAt tiebreak)", slugPos(progPage2.text, gradeASlug) < slugPos(progPage2.text, gradeBSlug));

    if (gradeBId) {
      const moved = await admin.post(`/admin/content/grade/${gradeBId}`, { form: { _action: "move-up" } });
      check("move grade B up → 200", moved.status === 200, `got ${moved.status}`);
      const progPage3 = await admin.get(`/admin/content/program/${programId}`);
      check("ordering applied: B now before A", slugPos(progPage3.text, gradeBSlug) < slugPos(progPage3.text, gradeASlug));
      const boundary = await admin.post(`/admin/content/grade/${gradeBId}`, { form: { _action: "move-up" } });
      const progPage4 = await admin.get(`/admin/content/program/${programId}`);
      check("boundary move-up (already first) is a clean no-op", boundary.status === 200 && slugPos(progPage4.text, gradeBSlug) < slugPos(progPage4.text, gradeASlug));
    }

    const renamed = await admin.post(`/admin/content/program/${programId}`, { form: { _action: "save", titleEn: `${progTitleEn} RENAMED` } });
    const progPage5 = await admin.get(`/admin/content/program/${programId}`);
    check("save (rename) applied", renamed.status === 200 && progPage5.text.includes("RENAMED"), `got ${renamed.status}`);

    const unpublished = await admin.post(`/admin/content/program/${programId}`, { form: { _action: "save", status: "draft" } });
    check("unpublish (status→draft) → 200", unpublished.status === 200, `got ${unpublished.status}`);
    const archived = await admin.post(`/admin/content/program/${programId}`, { form: { _action: "archive" } });
    check("archive → 200", archived.status === 200, `got ${archived.status}`);
  }

  const coursesAfter = await anon.get("/courses");
  check("public catalog unchanged by draft/archived smoke content", !coursesAfter.text.includes(progTitleEn));

  // ------------------------------------------------------------------
  console.log("\n[9] Admin file upload → private signed access over HTTP");
  const pdfBytes = `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF smoke-${Date.now()}`;
  const fd = new FormData();
  fd.append("_action", "upload");
  fd.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "smoke-upload.pdf");
  fd.append("visibility", "private");
  fd.append("downloadAllowed", "on");
  const upload = await admin.post("/admin/files", { body: fd });
  check("admin upload private PDF → 200", upload.status === 200, `got ${upload.status}`);
  const filesPage = await admin.get("/admin/files");
  check("uploaded file listed in admin files", filesPage.text.includes("smoke-upload.pdf"));
  const uploadedMatch = filesPage.text.match(/href="(\/files\/[0-9a-f-]{36}\?perm=view[^"]*)"[^>]*>\s*smoke-upload\.pdf/);
  const uploadedUrl = uploadedMatch ? decodeEntities(uploadedMatch[1]) : null;
  check("admin listing mints a signed view URL for the private upload", Boolean(uploadedUrl), "signed URL not found");
  if (uploadedUrl) {
    const uploadedGet = await admin.get(uploadedUrl);
    check("uploaded private file streams via signed URL → 200 %PDF", uploadedGet.status === 200 && uploadedGet.text.startsWith("%PDF"), `got ${uploadedGet.status}`);
    const unsignedUploaded = await anon.get(uploadedUrl.replace(/\?.*$/, ""));
    check("uploaded private file WITHOUT query sig (anon) → 404", unsignedUploaded.status === 404, `got ${unsignedUploaded.status}`);
  }

  // ------------------------------------------------------------------
  console.log("\n[10] Admin video registration + protected playback denial + grant");
  const regMock = await admin.post("/admin/videos", { form: { _action: "register-mock", title: `Smoke Video ${stamp}`, duration: "45" } });
  check("admin register mock video → 200", regMock.status === 200, `got ${regMock.status}`);
  const videosPage = await admin.get("/admin/videos");
  check("registered video listed", videosPage.text.includes(`Smoke Video ${stamp}`));

  const lesson2Id = extractNodeIdNear(adminContent.text, "lesson", "/coulomb-law</span>");
  check("coulomb-law lesson id resolvable from admin tree", Boolean(lesson2Id), "lesson not found");
  let attachedVideoId = null;
  if (lesson2Id) {
    const lessonEditor = await admin.get(`/admin/content/lesson/${lesson2Id}`);
    const opt = norm(lessonEditor.text).match(new RegExp(`<option value="([0-9a-f-]{36})">Smoke Video ${stamp} \\(ready\\)</option>`));
    attachedVideoId = opt ? opt[1] : null;
    check("new video offered in the lesson add-item picker", Boolean(attachedVideoId), "option not found");
    if (attachedVideoId) {
      const attach = await admin.post(`/admin/content/lesson/${lesson2Id}`, {
        form: { _action: "add-item", itemType: "video", videoId: attachedVideoId, fileId: "", required: "on" },
      });
      check("attach video to entitled lesson → 200", attach.status === 200, `got ${attach.status}`);
      const dangling = await admin.post(`/admin/content/lesson/${lesson2Id}`, {
        form: { _action: "add-item", itemType: "video", videoId: `${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`, fileId: "", required: "on" },
      });
      check("attach with DANGLING video id → rejected, not stored", dangling.status === 200 && !dangling.text.includes(`${"0".repeat(8)}-0000-4000-8000`), `got ${dangling.status}`);
      const s2Denied = await student2.post(`/api/playback/${attachedVideoId}`);
      check("UNENTITLED student → protected video playback → 403 (server-side denial)", s2Denied.status === 403, `got ${s2Denied.status}`);
    }
  }

  const subjectId = extractNodeIdNear(adminContent.text, "subject", "/physics-3s</span>");
  check("subject id resolvable from admin tree", Boolean(subjectId), "subject not found");
  if (subjectId) {
    const grant = await admin.post("/admin/entitlements", {
      form: { _action: "grant", email: student2Email, resourceType: "subject", resourceId: subjectId, days: "30", note: "smoke grant" },
    });
    check("admin grants subject entitlement → 200", grant.status === 200, `got ${grant.status}`);
    const entPage = await admin.get("/admin/entitlements");
    check("grant listed on entitlements page", entPage.text.includes(student2Email));

    const s2Lesson2After = await student2.get("/learn/physics-3s-full/coulomb-law");
    const s2ViewUrl = extractSignedFileUrl(s2Lesson2After.text, "view");
    check("AFTER grant: student now gets signed file URLs (server-side flip)", Boolean(s2ViewUrl), "still locked");
    if (s2ViewUrl) {
      const s2File = await student2.get(s2ViewUrl);
      check("AFTER grant: signed URL streams the private PDF → 200", s2File.status === 200 && s2File.text.startsWith("%PDF"), `got ${s2File.status}`);
    }
    if (videoId) {
      const s2PlaybackAfter = await student2.post(`/api/playback/${videoId}`);
      check("AFTER grant: seeded-video playback → 200", s2PlaybackAfter.status === 200, `got ${s2PlaybackAfter.status}`);
    }
    if (attachedVideoId) {
      const s2ProtectedAfter = await student2.post(`/api/playback/${attachedVideoId}`);
      check("AFTER grant: previously-DENIED protected video → 200", s2ProtectedAfter.status === 200, `got ${s2ProtectedAfter.status}`);
    }
  }

  // ------------------------------------------------------------------
  console.log("\n[11] Session revocation (logout)");
  const s2Logout = await student2.post("/logout");
  check("student2 logout → 302 /login", s2Logout.status === 302 && s2Logout.location === "/login", `${s2Logout.status} ${s2Logout.location}`);
  check("logout clears the session cookie", !student2.jar.has("__edu_session"));
  const s2AfterLogout = await student2.get("/dashboard");
  check("revoked session → /dashboard redirects to login", s2AfterLogout.status === 302 && (s2AfterLogout.location ?? "").startsWith("/login"), `got ${s2AfterLogout.status}`);
  if (videoId) {
    const s2PlaybackAfterLogout = await student2.post(`/api/playback/${videoId}`);
    check("revoked session → playback API → 401", s2PlaybackAfterLogout.status === 401, `got ${s2PlaybackAfterLogout.status}`);
  }

  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  console.log("\n[12] CMS: theme/favicon, page builder, publish, preview, menus, forms (Phase 3)");
  const cmsStamp = Date.now().toString(36);
  const cmsSlug = `smoke-cms-${cmsStamp}`;
  const builder = (id) => `/admin/cms/pages/${id}`;

  const themeCss = await anon.get("/theme.css");
  check(
    "GET /theme.css → 200 CSS with admin design tokens",
    themeCss.status === 200 && themeCss.text.includes("--color-brand-500") && (themeCss.headers.get("content-type") ?? "").includes("text/css"),
    `got ${themeCss.status}`
  );
  const faviconRes = await anon.get("/favicon.ico");
  check("GET /favicon.ico (unset) → 204 empty-first", faviconRes.status === 204, `got ${faviconRes.status}`);

  const createPage = await admin.post("/admin/cms", { form: { _action: "create", titleAr: "صفحة الدخان", titleEn: `Smoke CMS ${cmsStamp}`, slug: cmsSlug } });
  check("admin create CMS page → 200", createPage.status === 200, `got ${createPage.status}`);
  const pagesList = await admin.get("/admin/cms");
  const cmsPageId = extractIdNear(pagesList.text, "/admin/cms/pages/([0-9a-f-]{36})", `/p/${cmsSlug}`);
  check("created page listed with builder link", Boolean(cmsPageId), `pageId=${cmsPageId}`);

  const draftPublic = await anon.get(`/p/${cmsSlug}`);
  check("draft page NOT public before publish → 404", draftPublic.status === 404, `got ${draftPublic.status}`);

  const addSection = await admin.post(builder(cmsPageId), { form: { _action: "add-section" } });
  const cmsSectionId = blockIdsOf(addSection.text)[0] ?? null;
  check("builder: section added, id resolvable from markup", addSection.status === 200 && Boolean(cmsSectionId), `got ${addSection.status}`);

  await admin.post(builder(cmsPageId), { form: {
    _action: "save-block", blockId: cmsSectionId, blockTypeDef: "section",
    "f.heading.ar": "عنوان الدخان", "f.heading.en": `Smoke Heading ${cmsStamp}`,
    "f.subheading.ar": "", "f.subheading.en": "",
    "f.bg": "default", "f.bgImage": "", "f.padding": "md", "f.container": "normal",
    "f.columns": "1", "f.gap": "md", "f.align": "start",
  } });

  const addText = await admin.post(builder(cmsPageId), { form: { _action: "add-block", parentId: cmsSectionId, blockType: "text" } });
  const cmsTextId = blockIdsOf(addText.text).filter((id) => id !== cmsSectionId).at(-1) ?? null;
  check("builder: text block added", addText.status === 200 && Boolean(cmsTextId));

  await admin.post(builder(cmsPageId), { form: {
    _action: "save-block", blockId: cmsTextId, blockTypeDef: "text",
    "f.content.ar": `نص الدخان ${cmsStamp}`, "f.content.en": `SMOKE-CMS-TEXT-${cmsStamp}`,
    "f.size": "body", "f.align": "start",
  } });

  const publish1 = await admin.post(builder(cmsPageId), { form: { _action: "publish", note: "smoke publish" } });
  check("builder: publish → 200", publish1.status === 200, `got ${publish1.status}`);

  const livePage = await anon.get(`/p/${cmsSlug}`);
  check(
    "published page renders publicly (section heading + text block)",
    livePage.status === 200 && norm(livePage.text).includes("عنوان الدخان") && norm(livePage.text).includes(`نص الدخان ${cmsStamp}`),
    `got ${livePage.status}`
  );

  const previewAdmin = await admin.get(`/admin/cms/preview/${cmsPageId}`);
  check("draft preview renders for admin", previewAdmin.status === 200 && previewAdmin.text.includes("معاينة"), `got ${previewAdmin.status}`);
  const previewAnon = await anon.get(`/admin/cms/preview/${cmsPageId}`);
  check("preview denied for anonymous → login redirect", previewAnon.status === 302 && (previewAnon.location ?? "").startsWith("/login"), `got ${previewAnon.status}`);

  const menuAdd = await admin.post("/admin/cms/menus", { form: { _action: "add", location: "header", labelAr: "دخان", labelEn: `SmokeNav ${cmsStamp}`, href: `/p/${cmsSlug}`, icon: "", parentId: "" } });
  check("header menu item added", menuAdd.status === 200, `got ${menuAdd.status}`);
  const homeWithMenu = await anon.get("/");
  check("header menu link visible to anonymous visitors", homeWithMenu.text.includes(`/p/${cmsSlug}`), "href missing in public chrome");

  const createForm = await admin.post("/admin/cms/forms", { form: { _action: "create", titleAr: "نموذج الدخان", titleEn: `Smoke Form ${cmsStamp}`, actionType: "contact" } });
  check("form created", createForm.status === 200, `got ${createForm.status}`);
  const formsList = await admin.get("/admin/cms/forms");
  const formId = extractIdNear(formsList.text, "/admin/cms/forms\\?form=([0-9a-f-]{36})", `smoke-form-${cmsStamp}`);
  check("form id resolvable from list", Boolean(formId), `formId=${formId}`);
  const formSlug = `smoke-form-${cmsStamp}`;

  await admin.post("/admin/cms/forms", { form: {
    _action: "update-form", formId, titleAr: "نموذج الدخان", titleEn: `Smoke Form ${cmsStamp}`,
    actionType: "contact", status: "active",
    successAr: "تم الإرسال بنجاح", successEn: "Submitted", failureAr: "فشل الإرسال", failureEn: "Failed",
    consentAr: "", consentEn: "",
  } });
  await admin.post("/admin/cms/forms", { form: {
    _action: "add-field", formId, name: "email", type: "email",
    labelAr: "البريد", labelEn: "Email", required: "on",
    placeholderAr: "", placeholderEn: "", helpAr: "", helpEn: "", defaultValue: "",
  } });

  const addFormBlock = await admin.post(builder(cmsPageId), { form: { _action: "add-block", parentId: cmsSectionId, blockType: "form_block" } });
  const formBlockId = blockIdsOf(addFormBlock.text).filter((id) => id !== cmsSectionId && id !== cmsTextId).at(-1) ?? null;
  check("builder: form block added", addFormBlock.status === 200 && Boolean(formBlockId));
  await admin.post(builder(cmsPageId), { form: {
    _action: "save-block", blockId: formBlockId, blockTypeDef: "form_block",
    "f.formId": formId, "f.heading.ar": "", "f.heading.en": "",
  } });
  await admin.post(builder(cmsPageId), { form: { _action: "publish", note: "smoke publish 2" } });

  const pageWithForm = await anon.get(`/p/${cmsSlug}`);
  check(
    "form block renders on public page (posts to page action)",
    pageWithForm.status === 200 && pageWithForm.text.includes(formSlug),
    `got ${pageWithForm.status}; slug missing`
  );

  const badSubmit = await anon.post(`/p/${cmsSlug}`, { form: { _cmsForm: formSlug, email: "not-an-email" } });
  check("invalid form submission → failure message in place (no redirect)", badSubmit.status === 200 && norm(badSubmit.text).includes("فشل الإرسال"), `got ${badSubmit.status}`);
  const goodSubmit = await anon.post(`/p/${cmsSlug}`, { form: { _cmsForm: formSlug, email: `smoke-${cmsStamp}@example.com` } });
  check("valid form submission → success message", goodSubmit.status === 200 && norm(goodSubmit.text).includes("تم الإرسال بنجاح"), `got ${goodSubmit.status}`);

  // system settings tab: platform identity + video policy editable with ZERO code deploy
  const sysPage = await admin.get("/admin/appearance?tab=system");
  const sysHtml = norm(sysPage.text);
  check("system tab renders for super admin (platform fields + provider policy)", sysPage.status === 200 && sysHtml.includes('name="nameAr"') && sysHtml.includes('name="provider"'), `got ${sysPage.status}`);
  const newPlatformName = `SmokePlatform-${cmsStamp}`;
  const sysSave = await admin.post("/admin/appearance?tab=system", { form: {
    _action: "save-system",
    nameAr: newPlatformName, nameEn: newPlatformName,
    taglineAr: "", taglineEn: "",
    supportEmail: "", supportPhone: "", whatsapp: "",
    provider: "mock", playbackTokenTtl: "45", fileTtl: "120",
  } });
  check("system settings saved (platform + video groups)", sysSave.status === 200, `got ${sysSave.status}`);
  const homeAfterSys = await anon.get("/");
  check("platform name change visible to anonymous visitors (zero-deploy branding)", norm(homeAfterSys.text).includes(newPlatformName), "new platform name not found on /");

  // Restore production platform identity so the database stays clean
  await admin.post("/admin/appearance?tab=system", { form: {
    _action: "save-system",
    nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito",
    taglineAr: "منصة الفلسفة وعلم النفس للثانوية العامة", taglineEn: "Philosophy & Psychology for Secondary Stage",
    supportEmail: "", supportPhone: "", whatsapp: "",
    provider: "mock", playbackTokenTtl: "45", fileTtl: "120",
  } });

  // ------------------------------------------------------------------
  console.log("\n[14] Phase 4 student journey: catalog hierarchy, progress, resume, completion, profile");
  // NOTE: the student jar is still authenticated (§11 only logged out student2).

  // --- catalog hierarchy: Program → Subject → Course (published-only pages) ---
  const programs = await anon.get("/programs");
  check("GET /programs → 200 + seeded program linked", programs.status === 200 && programs.text.includes("/programs/al-Thanawiya-al-3amma"), `got ${programs.status}`);
  const programPage = await anon.get("/programs/al-Thanawiya-al-3amma");
  check("program page → 200 + links its published subject", programPage.status === 200 && programPage.text.includes("/subjects/physics-3s"), `got ${programPage.status}`);
  const subjectPage = await anon.get("/subjects/physics-3s");
  check("subject page → 200 + links its published course", subjectPage.status === 200 && subjectPage.text.includes("/courses/physics-3s-full"), `got ${subjectPage.status}`);
  const unknownProgram = await anon.get("/programs/does-not-exist");
  check("unknown program slug → 404", unknownProgram.status === 404, `got ${unknownProgram.status}`);
  const unknownSubject = await anon.get("/subjects/does-not-exist");
  check("unknown subject slug → 404", unknownSubject.status === 404, `got ${unknownSubject.status}`);

  // --- course detail: entitlement-aware lesson list + unit navigation ---
  const courseEntitled = await student.get("/courses/physics-3s-full");
  check("entitled student → course page 200 with learn links", courseEntitled.status === 200 && courseEntitled.text.includes("/learn/physics-3s-full/coulomb-law"), `got ${courseEntitled.status}`);
  const unitMatch = courseEntitled.text.match(/\/courses\/physics-3s-full\/units\/([0-9a-f-]{36})/);
  check("course page exposes unit links", Boolean(unitMatch), "no unit link found");
  if (unitMatch) {
    const unitPage = await student.get(`/courses/physics-3s-full/units/${unitMatch[1]}`);
    check("unit page → 200 + lesson links", unitPage.status === 200 && unitPage.text.includes("/learn/physics-3s-full/electrostatics-intro"), `got ${unitPage.status}`);
  }
  const courseAnon = await anon.get("/courses/physics-3s-full");
  check(
    "anon → entitled lesson is LOCKED on the course page (no learn link)",
    courseAnon.status === 200 && !courseAnon.text.includes("/learn/physics-3s-full/coulomb-law"),
    `got ${courseAnon.status}`
  );
  // free_preview is a LOGGED-IN affordance by design (resolver: anon → deny, unit-tested)
  check("anon → free-preview lesson also locked (login required)", !courseAnon.text.includes("/learn/physics-3s-full/electrostatics-intro"));
  check("anon → course page invites login", norm(courseAnon.text).includes("سجّل الدخول") || courseAnon.text.includes("/login"));

  // --- beacons: auth + entitlement gates ---
  const beaconBody = (obj) => ({ body: JSON.stringify(obj), headers: { "content-type": "application/json" } });
  const anonBeacon = await anon.post("/beacons/progress", beaconBody({ videoId: videoId ?? "00000000-0000-4000-8000-000000000000", positionSeconds: 10 }));
  check("anon beacon → 401", anonBeacon.status === 401, `got ${anonBeacon.status}`);
  const beaconGet = await anon.get("/beacons/progress");
  check("GET /beacons/progress → 405 (POST-only)", beaconGet.status === 405, `got ${beaconGet.status}`);

  const s14 = makeClient("s14");
  const s14Email = `s14-${Date.now()}@smoke.local`;
  const s14Pass = "Sm0ke!S14-2026";
  const s14Reg = await s14.post("/register", { form: { email: s14Email, fullName: "Smoke S14", password: s14Pass, passwordConfirm: s14Pass } });
  check("journey: fresh student registered → 302", s14Reg.status === 302, `${s14Reg.status} ${s14Reg.location ?? ""}`);

  const l1 = await student.get("/learn/physics-3s-full/electrostatics-intro");
  const journeyLessonId = (l1.text.match(/data-lesson-id="([0-9a-f-]{36})"/) ?? [])[1] ?? null;
  check("learn page exposes lesson id (data attribute)", Boolean(journeyLessonId), "data-lesson-id not found");
  const l2Page = await student.get("/learn/physics-3s-full/coulomb-law");
  const entitledLessonId = (l2Page.text.match(/data-lesson-id="([0-9a-f-]{36})"/) ?? [])[1] ?? null;
  check("entitled lesson page exposes its lesson id", Boolean(entitledLessonId), "data-lesson-id not found on lesson 2");

  if (entitledLessonId) {
    const s14Beacon = await s14.post("/beacons/progress", beaconBody({ videoId: videoId ?? "00000000-0000-4000-8000-000000000000", lessonId: entitledLessonId, positionSeconds: 10 }));
    check("unentitled student beacon with lesson context → 403 (server-side check)", s14Beacon.status === 403, `got ${s14Beacon.status}`);
  }

  if (videoId && journeyLessonId) {

    // --- heartbeat → resume: server stores position, next mint returns resumeAt ---
    const hb = await student.post("/beacons/progress", beaconBody({ videoId, lessonId: journeyLessonId, positionSeconds: 30, watchedSeconds: 30 }));
    let hbJson = {};
    try { hbJson = JSON.parse(hb.text); } catch { /* asserted below */ }
    check("entitled heartbeat beacon → 200 {completed:false}", hb.status === 200 && hbJson.completed === false, `got ${hb.status} ${hb.text.slice(0, 80)}`);

    const mint2 = await student.post(`/api/playback/${videoId}`);
    let pb2 = {};
    try { pb2 = JSON.parse(mint2.text); } catch { /* asserted below */ }
    check("re-mint after heartbeat → resumeAt=30 (server-side resume)", mint2.status === 200 && pb2.resumeAt === 30, `got ${mint2.status} resumeAt=${pb2.resumeAt}`);

    // --- threshold completion is SERVER-decided (90% of the seeded 120s video = 108s) ---
    const below = await student.post("/beacons/progress", beaconBody({ videoId, lessonId: journeyLessonId, positionSeconds: 107 }));
    let belowJson = {};
    try { belowJson = JSON.parse(below.text); } catch { /* asserted below */ }
    check("beacon below threshold → not completed", below.status === 200 && belowJson.completed === false, `got ${below.status}`);
    const ended = await student.post("/beacons/progress", beaconBody({ videoId, lessonId: journeyLessonId, positionSeconds: 115, kind: "ended", watchedSeconds: 115 }));
    let endedJson = {};
    try { endedJson = JSON.parse(ended.text); } catch { /* asserted below */ }
    check(
      "ended beacon past threshold → video + lesson auto-completed",
      ended.status === 200 && endedJson.completed === true && endedJson.lessonCompleted === true,
      `got ${ended.status} ${ended.text.slice(0, 120)}`
    );

    const l1After = await student.get("/learn/physics-3s-full/electrostatics-intro");
    check("completed lesson page shows the completed badge", norm(l1After.text).includes(">مكتمل<"), "badge not found");

    const mint3 = await student.post(`/api/playback/${videoId}`);
    let pb3 = {};
    try { pb3 = JSON.parse(mint3.text); } catch { /* asserted below */ }
    check("completed video → resumeAt=0 (no stale resume)", mint3.status === 200 && pb3.resumeAt === 0, `resumeAt=${pb3.resumeAt}`);
  } else {
    check("section 14 prerequisites (videoId + lessonId present)", false, "skipped — missing ids");
  }

  // --- manual mark-complete (lesson 2, entitled) via the lesson action ---
  const toggle2 = await student.post("/learn/physics-3s-full/coulomb-law", { form: { _action: "toggle-complete", completed: "1" } });
  check("mark-complete action → 200 + completed state", toggle2.status === 200 && norm(toggle2.text).includes(">مكتمل<"), `got ${toggle2.status}`);
  const toggle2Bad = await student.post("/learn/physics-3s-full/coulomb-law", { form: { _action: "something-else" } });
  check("unknown lesson action → 400", toggle2Bad.status === 400, `got ${toggle2Bad.status}`);
  const s14Toggle = await s14.post("/learn/physics-3s-full/coulomb-law", { form: { _action: "toggle-complete", completed: "1" } });
  check("unentitled student mark-complete → 403 (action re-checks entitlement)", s14Toggle.status === 403, `got ${s14Toggle.status}`);

  // --- dashboard reflects REAL progress ---
  const dash14 = await student.get("/dashboard");
  const dash14Html = norm(dash14.text);
  check("dashboard → 200", dash14.status === 200, `got ${dash14.status}`);
  check("dashboard shows continue-learning module", dash14Html.includes("استكمل التعلم"), "continue module missing");
  check("dashboard shows stats module", dash14Html.includes("تقدمك"), "stats module missing");
  check("dashboard continue links a completed lesson", dash14.text.includes("/learn/physics-3s-full/coulomb-law"), "no lesson link");
  check("dashboard shows 100% course progress (2/2 lessons completed)", dash14Html.includes("100%"), "100% missing");

  // --- student profile page ---
  const profilePage = await student.get("/profile");
  check("GET /profile → 200 + shows account email", profilePage.status === 200 && profilePage.text.includes(STUDENT_EMAIL), `got ${profilePage.status}`);
  const profileSave = await student.post("/profile", { form: { fullName: "طالب الدخان", phone: "+201000000000", localePref: "ar" } });
  check("profile save → 200 + saved alert", profileSave.status === 200 && norm(profileSave.text).includes("تم حفظ الملف الشخصي"), `got ${profileSave.status}`);
  const profileBad = await student.post("/profile", { form: { fullName: "x", phone: "not-a-phone!!", localePref: "ar" } });
  check("profile invalid input → 200 with error alert (no crash)", profileBad.status === 200, `got ${profileBad.status}`);
  const dashAfterProfile = await student.get("/dashboard");
  check("new name visible in the student shell after save", norm(dashAfterProfile.text).includes("طالب الدخان"), "name not updated");
  check("student layout ships the mobile nav panel", dashAfterProfile.text.includes("student-mobile-nav"), "mobile nav missing");

  // restore the name so re-runs stay deterministic
  await student.post("/profile", { form: { fullName: "طالب تجريبي", phone: "", localePref: "ar" } });

  // ------------------------------------------------------------------
  console.log("\n[15] Phase 5 assessment journey: exam discovery → start → autosave → refresh → submit → grade → results → locked");
  const EXAM_SLUG = "electrostatics-check";

  // discovery + authorization gates
  const anonExams = await anon.get("/exams");
  check("anon GET /exams → redirect to login", anonExams.status === 302 && (anonExams.location ?? "").startsWith("/login"), `${anonExams.status} ${anonExams.location}`);
  const examsList = await student.get("/exams");
  check("student GET /exams → 200 + seeded exam listed", examsList.status === 200 && examsList.text.includes(`/exams/${EXAM_SLUG}`), `got ${examsList.status}`);
  const s14Intro = await s14.get(`/exams/${EXAM_SLUG}`);
  check("UNENTITLED student → exam intro 403 (server-side entitlement)", s14Intro.status === 403, `got ${s14Intro.status}`);
  const studentAssessmentAdmin = await student.get("/admin/assessment");
  check("student GET /admin/assessment → forbidden redirect (RBAC)", studentAssessmentAdmin.status === 302 && (studentAssessmentAdmin.location ?? "").includes("error=forbidden"), `${studentAssessmentAdmin.status}`);

  // lesson integration: the exam item on lesson 2 links the real exam
  const lessonWithExam = await student.get("/learn/physics-3s-full/coulomb-law");
  check("lesson page renders the real exam link (Phase-4 placeholder replaced)", lessonWithExam.status === 200 && lessonWithExam.text.includes(`/exams/${EXAM_SLUG}`), `got ${lessonWithExam.status}`);

  // intro page: policy summary + start
  const intro = await student.get(`/exams/${EXAM_SLUG}`);
  const introHtml = norm(intro.text);
  check("exam intro → 200 + start button + duration policy", intro.status === 200 && introHtml.includes("ابدأ الامتحان") && introHtml.includes("المدة: 10 دقيقة"), `got ${intro.status}`);
  const startRes = await student.post(`/exams/${EXAM_SLUG}`, { form: { _action: "start" } });
  check("POST start → 302 to the attempt page", startRes.status === 302 && startRes.location === `/exams/${EXAM_SLUG}/attempt`, `${startRes.status} ${startRes.location ?? ""}`);

  // attempt page: server-driven countdown, sanitized payload, data hooks
  const attemptPage = await student.get(`/exams/${EXAM_SLUG}/attempt`);
  const attemptId = (attemptPage.text.match(/data-attempt-id="([0-9a-f-]{36})"/) ?? [])[1] ?? null;
  const questionId = (attemptPage.text.match(/data-question-id="([0-9a-f-]{36})"/) ?? [])[1] ?? null;
  const choiceIds = [...attemptPage.text.matchAll(/data-choice-id="([0-9a-f-]{36})"/g)].map((m) => m[1]);
  check("attempt page → 200 with attempt/question/choice hooks", attemptPage.status === 200 && Boolean(attemptId) && Boolean(questionId) && choiceIds.length >= 2, `got ${attemptPage.status} hooks=${Boolean(attemptId)}/${Boolean(questionId)}/${choiceIds.length}`);
  check("attempt page shows a server-computed countdown (~10 min)", /(10:00|09:[0-5][0-9])/.test(attemptPage.text), "countdown missing");
  check("attempt payload is sanitized (no isCorrect / explanation / feedback)", !attemptPage.text.includes("isCorrect") && !attemptPage.text.includes("explanation") && !attemptPage.text.includes("feedback"), "answer-key material found in attempt HTML");
  check("attempt page renders the seeded question stem", norm(attemptPage.text).includes("قوة كولوم تتناسب"), "stem missing");

  if (attemptId && questionId && choiceIds.length >= 2) {
    // autosave (server-side truth) + duplicate-retry safety
    const save1 = await student.post("/api/exam-attempt", { form: { _action: "save", attemptId, questionId, choiceIds: choiceIds[0] } });
    let save1Json = {};
    try { save1Json = JSON.parse(save1.text); } catch { /* asserted below */ }
    check("autosave POST → {ok, version:1}", save1.status === 200 && save1Json.ok === true && save1Json.version === 1, `got ${save1.status} ${save1.text.slice(0, 80)}`);
    const save2 = await student.post("/api/exam-attempt", { form: { _action: "save", attemptId, questionId, choiceIds: choiceIds[0] } });
    let save2Json = {};
    try { save2Json = JSON.parse(save2.text); } catch { /* asserted below */ }
    check("duplicate save (retry) → version:2, no duplicate row", save2.status === 200 && save2Json.ok === true && save2Json.version === 2, `got ${save2.status}`);

    // "refresh" → server restores the saved answer
    const refreshed = await student.get(`/exams/${EXAM_SLUG}/attempt`);
    check("refresh → saved answer restored from the server", refreshed.status === 200 && refreshed.text.includes(choiceIds[0]), "saved choice id missing after refresh");

    // IDOR: grant s14 entitlement, then prove cross-student isolation by ownership (404)
    const adminContent = await admin.get("/admin/content");
    const subjId = extractNodeIdNear(adminContent.text, "subject", "physics-3s");
    check("admin content tree exposes the subject id", Boolean(subjId), "subject id not found");
    if (subjId) {
      const grantRes = await admin.post("/admin/entitlements", { form: { _action: "grant", email: s14Email, resourceType: "subject", resourceId: subjId, days: "30", note: "smoke §15 IDOR" } });
      check("admin grants s14 the subject (setup for IDOR check)", grantRes.status === 200, `got ${grantRes.status}`);
      const bResult = await s14.get(`/results/${attemptId}`);
      check("ENTITLED student B → student A's attempt result = 404 (ownership, not entitlement)", bResult.status === 404, `got ${bResult.status}`);
      const bSave = await s14.post("/api/exam-attempt", { form: { _action: "save", attemptId, questionId, choiceIds: choiceIds[1] } });
      check("student B save on student A's attempt → 404 JSON", bSave.status === 404, `got ${bSave.status}`);
    }
    const randomResult = await student.get(`/results/${crypto.randomUUID()}`);
    check("unknown attempt id → 404", randomResult.status === 404, `got ${randomResult.status}`);

    // submit → server grading → results
    const submit1 = await student.post("/api/exam-attempt", { form: { _action: "submit", attemptId } });
    let submit1Json = {};
    try { submit1Json = JSON.parse(submit1.text); } catch { /* asserted below */ }
    check("submit → {ok, redirect:/results/:id}", submit1.status === 200 && submit1Json.ok === true && submit1Json.redirect === `/results/${attemptId}`, `got ${submit1.status} ${submit1.text.slice(0, 80)}`);

    const submit2 = await student.post("/api/exam-attempt", { form: { _action: "submit", attemptId } });
    let submit2Json = {};
    try { submit2Json = JSON.parse(submit2.text); } catch { /* asserted below */ }
    check("DOUBLE submit → same stored result (idempotent, no second grading)", submit2.status === 200 && submit2Json.ok === true && submit2Json.redirect === `/results/${attemptId}`, `got ${submit2.status}`);

    const resultPage = await student.get(`/results/${attemptId}`);
    const resultHtml = norm(resultPage.text);
    check("results page → 200 + score 2/3 + 66.7% + passed badge", resultPage.status === 200 && resultHtml.includes("66.7%") && resultHtml.includes("ناجح"), `got ${resultPage.status}`);
    check("results page shows the review (show_answers policy on)", resultHtml.includes("مراجعة الإجابات"), "review missing");

    const saveAfter = await student.post("/api/exam-attempt", { form: { _action: "save", attemptId, questionId, choiceIds: choiceIds[1] } });
    let saveAfterJson = {};
    try { saveAfterJson = JSON.parse(saveAfter.text); } catch { /* asserted below */ }
    check("save after submit → rejected {error:'closed'} (attempt immutable)", saveAfter.status === 200 && saveAfterJson.error === "closed", `got ${saveAfter.status} ${saveAfter.text.slice(0, 80)}`);

    const attemptAfter = await student.get(`/exams/${EXAM_SLUG}/attempt`);
    check("attempt page after submit → 302 back to intro (attempt not reusable)", attemptAfter.status === 302 && attemptAfter.location === `/exams/${EXAM_SLUG}`, `${attemptAfter.status} ${attemptAfter.location ?? ""}`);

    const introAfter = await student.get(`/exams/${EXAM_SLUG}`);
    const introAfterHtml = norm(introAfter.text);
    check("intro shows graded attempt history (محاولة + مُصححة)", introAfterHtml.includes("محاولة 1") && introAfterHtml.includes("مُصححة"), "history missing");

    // consume attempt 2 so re-runs never leave a live attempt behind
    const start2 = await student.post(`/exams/${EXAM_SLUG}`, { form: { _action: "start" } });
    check("second attempt allowed (attempts.max=30 seed) → 302", start2.status === 302 && start2.location === `/exams/${EXAM_SLUG}/attempt`, `${start2.status}`);
    const attempt2Page = await student.get(`/exams/${EXAM_SLUG}/attempt`);
    const attempt2Id = (attempt2Page.text.match(/data-attempt-id="([0-9a-f-]{36})"/) ?? [])[1] ?? null;
    check("attempt 2 has a NEW attempt id", Boolean(attempt2Id) && attempt2Id !== attemptId, "attempt id reuse detected");
    if (attempt2Id) {
      await student.post("/api/exam-attempt", { form: { _action: "submit", attemptId: attempt2Id } });
    }
  } else {
    check("section 15 prerequisites (attempt hooks present)", false, "skipped — missing ids");
  }

  // results index + admin assessment surfaces
  const resultsIndex = await student.get("/results");
  check("GET /results → 200 + lists the exam attempt", resultsIndex.status === 200 && norm(resultsIndex.text).includes("قياس: الكهرباء الساكنة"), `got ${resultsIndex.status}`);
  const adminAssessment = await admin.get("/admin/assessment");
  check("admin assessment hub → 200 + question bank row", adminAssessment.status === 200 && norm(adminAssessment.text).includes("قوة كولوم تتناسب"), `got ${adminAssessment.status}`);
  const adminExamsTab = await admin.get("/admin/assessment?tab=exams");
  check("admin exams tab → 200 + seeded exam + attempts counter", adminExamsTab.status === 200 && norm(adminExamsTab.text).includes("قياس: الكهرباء الساكنة"), `got ${adminExamsTab.status}`);

  // ------------------------------------------------------------------
  console.log("\n[16] Phase 6 commerce: product → checkout → order → manual verification → entitlement → unlock; rejection path; activation codes; webhook guards");
  const runId = Date.now().toString(36);
  const smokeProductSlug = `smoke-physics-${runId}`;
  const hub = await admin.get("/admin/commerce?tab=products");
  check("admin commerce hub → 200", hub.status === 200, `got ${hub.status}`);
  const courseOpt = norm(hub.text).match(/value="([0-9a-f-]{36})"[^>]*>[^<]*\(physics-3s-full\)/);
  check("hub offers the seeded course as a product target", Boolean(courseOpt), "course option not found in hub HTML");

  let smokeProductId = null;
  let smokePlanId = null;
  if (courseOpt) {
    const created = await admin.post("/admin/commerce", {
      form: { _action: "create_product", kind: "course", nameAr: "فيزياء smoke", nameEn: `Smoke Physics ${runId}`, slug: smokeProductSlug, resourceId: courseOpt[1], active: "on" },
    });
    smokeProductId = extractIdNear(created.text, `/admin/commerce/products/([0-9a-f-]{36})`, `>${smokeProductSlug}</span>`);
    check("create product via admin hub (RBAC + audit path)", created.status === 200 && Boolean(smokeProductId), `status=${created.status} id=${smokeProductId}`);
  }
  if (smokeProductId) {
    const planRes = await admin.post(`/admin/commerce/products/${smokeProductId}`, {
      form: { _action: "create_plan", amountMinor: "25000", currency: "EGP", planKind: "one_time", period: "", periodDays: "", fixedEndsAt: "", labelAr: "", labelEn: "", compareAtMinor: "", promoPriceMinor: "", promoStartsAt: "", promoEndsAt: "", planActive: "on" },
    });
    smokePlanId = extractIdAfter(planRes.text, `name="planId" value="([0-9a-f-]{36})"`, "250.00");
    check("create active price plan (25000 minor = 250.00 EGP)", planRes.status === 200 && Boolean(smokePlanId), `status=${planRes.status} plan=${smokePlanId}`);
  }

  // buyer: fresh student with no entitlements (device jar persists like a browser profile)
  const buyerEmail = "smoke-buyer@educore.local";
  const buyerPass = "Sm0ke!Buyer-2026";
  const buyer = makeClient("buyer");
  let buyerIn = await buyer.post("/login", { form: { email: buyerEmail, password: buyerPass } });
  if (buyerIn.status !== 302) {
    buyerIn = await buyer.post("/register", { form: { email: buyerEmail, fullName: "Smoke Buyer", password: buyerPass, passwordConfirm: buyerPass } });
  }
  check("buyer session established (login or register)", buyerIn.status === 302, `got ${buyerIn.status} (${loginFailureKind(buyerIn.text)})`);

  if (smokePlanId) {
    const buyerAdminProbe = await buyer.get("/admin/commerce");
    check("student → /admin/commerce forbidden redirect (server-enforced RBAC)", buyerAdminProbe.status === 302 && (buyerAdminProbe.location ?? "").includes("error=forbidden"), `got ${buyerAdminProbe.status}`);

    const lockedCourse = await buyer.get("/courses/physics-3s-full");
    check("locked course page shows the buy CTA with the cheapest server-read price", norm(lockedCourse.text).includes(`/products/${smokeProductSlug}`) && lockedCourse.text.includes("250.00"), "CTA/price missing");

    const productPage = await buyer.get(`/products/${smokeProductSlug}`);
    check("public product page → 200 + server-priced plan", productPage.status === 200 && productPage.text.includes("250.00") && productPage.text.includes("EGP"), `got ${productPage.status}`);

    // checkout — client sends garbage amounts; the server must ignore all of it
    const checkout = await buyer.post(`/checkout/${smokeProductSlug}`, {
      form: { _action: "create_order", pricePlanId: smokePlanId, amountMinor: "1", totalMinor: "1", currency: "USD", price: "0.01" },
    });
    const orderNumber = (checkout.location ?? "").startsWith("/orders/") ? (checkout.location ?? "").slice("/orders/".length) : null;
    check("checkout → 302 /orders/EC-…", checkout.status === 302 && /^EC-/.test(orderNumber ?? ""), `got ${checkout.status} ${checkout.location ?? ""}`);

    if (orderNumber) {
      const orderPage = await buyer.get(`/orders/${orderNumber}`);
      check("order shows the SERVER total (250.00 EGP) — tamper fields ignored", orderPage.text.includes("250.00") && orderPage.text.includes("EGP") && !orderPage.text.includes("0.01") && !orderPage.text.includes("USD"), "totals wrong");
      check("order page shows the manual payment reference (= order number)", norm(orderPage.text).includes(orderNumber));
      const preAccess = await buyer.get("/learn/physics-3s-full/coulomb-law");
      check("pending order grants NO access (order ≠ payment ≠ authorization)", preAccess.text.includes("يتطلب صلاحية وصول"));

      const confirmRes = await buyer.post(`/orders/${orderNumber}`, { form: { _action: "confirm_payment", transferReference: `SMOKE-TX-${runId}`, note: "" } });
      check("submit transfer reference → 200", confirmRes.status === 200, `got ${confirmRes.status}`);
      const underReview = await buyer.get(`/orders/${orderNumber}`);
      check("payment moves to under_review", underReview.text.includes("قيد المراجعة"));
      const stillLocked = await buyer.get("/learn/physics-3s-full/coulomb-law");
      check("submitted reference grants NO access (verification pending)", stillLocked.text.includes("يتطلب صلاحية وصول"));
      await buyer.post(`/orders/${orderNumber}`, { form: { _action: "confirm_payment", transferReference: "SMOKE-TX-DUP", note: "" } });
      const afterDup = await buyer.get(`/orders/${orderNumber}`);
      check("duplicate confirm rejected — still a single under_review attempt", afterDup.text.includes("قيد المراجعة"));

      const payQueue = await admin.get("/admin/commerce?tab=payments");
      const paymentId = extractIdAfter(payQueue.text, `name="paymentId" value="([0-9a-f-]{36})"`, orderNumber);
      check("admin payments queue lists the order + evidence reference", Boolean(paymentId) && norm(payQueue.text).includes(`SMOKE-TX-${runId}`), `paymentId=${paymentId}`);

      if (paymentId) {
        const mismatch = await admin.post("/admin/commerce?tab=payments", { form: { _action: "approve_payment", paymentId, receivedAmount: "24999" } });
        const mismatchLocked = await buyer.get("/learn/physics-3s-full/coulomb-law");
        check("wrong amount → amount_mismatch, nothing granted", mismatch.text.includes("يجب أن يساوي المبلغ المستلم") && mismatchLocked.text.includes("يتطلب صلاحية وصول"));

        const approve = await admin.post("/admin/commerce?tab=payments", { form: { _action: "approve_payment", paymentId, receivedAmount: "25000" } });
        check("admin approve (exact amount) → saved", approve.text.includes("تم الحفظ"), `status=${approve.status}`);
        const approve2 = await admin.post("/admin/commerce?tab=payments", { form: { _action: "approve_payment", paymentId, receivedAmount: "25000" } });
        check("replayed approve → alreadyProcessed, no duplicate grants", approve2.text.includes("عولج من قبل"));

        const unlocked = await buyer.get("/learn/physics-3s-full/coulomb-law");
        check("verified payment → entitlement → SAME resolver unlocks the lesson", unlocked.status === 200 && !unlocked.text.includes("يتطلب صلاحية وصول"), `got ${unlocked.status}`);
        const courseAfter = await buyer.get("/courses/physics-3s-full");
        check("course page unlocked (buy CTA gone)", !courseAfter.text.includes("course-buy-cta"));
        const myOrders = await buyer.get("/orders");
        check("my-orders lists the paid order", norm(myOrders.text).includes(orderNumber));
      }
    }

    // ── failure path: rejected payment → no entitlement → still locked ──
    // NOTE: a FRESH student — §10 grants student2 a subject entitlement, so student2 is already unlocked by now.
    const rejEmail = "smoke-reject@educore.local";
    const rejPass = "Sm0ke!Reject-2026";
    const rejectee = makeClient("rejectee");
    let rejIn = await rejectee.post("/login", { form: { email: rejEmail, password: rejPass } });
    if (rejIn.status !== 302) {
      rejIn = await rejectee.post("/register", { form: { email: rejEmail, fullName: "Smoke Reject", password: rejPass, passwordConfirm: rejPass } });
    }
    check("rejection-path student session established", rejIn.status === 302, `got ${rejIn.status} (${loginFailureKind(rejIn.text)})`);
    const rejLockedBefore = await rejectee.get("/learn/physics-3s-full/coulomb-law");
    check("rejection-path student starts locked", rejLockedBefore.text.includes("يتطلب صلاحية وصول"));
    const checkout2 = await rejectee.post(`/checkout/${smokeProductSlug}`, { form: { _action: "create_order", pricePlanId: smokePlanId } });
    const order2 = (checkout2.location ?? "").startsWith("/orders/") ? (checkout2.location ?? "").slice("/orders/".length) : null;
    check("rejection-path student checkout → order created", Boolean(order2), `got ${checkout2.status} ${checkout2.location ?? ""}`);
    if (order2) {
      await rejectee.post(`/orders/${order2}`, { form: { _action: "confirm_payment", transferReference: "SMOKE-BAD-TX", note: "" } });
      const queue2 = await admin.get("/admin/commerce?tab=payments");
      const payment2 = extractIdAfter(queue2.text, `name="paymentId" value="([0-9a-f-]{36})"`, order2);
      const rejected = await admin.post("/admin/commerce?tab=payments", { form: { _action: "reject_payment", paymentId: payment2 ?? "", reason: "reference not found in bank statement" } });
      check("admin rejects the manual payment", rejected.status === 200 && Boolean(payment2), `status=${rejected.status}`);
      const s2Locked = await rejectee.get("/learn/physics-3s-full/coulomb-law");
      check("rejected payment → NO entitlement, lesson still locked", s2Locked.text.includes("يتطلب صلاحية وصول"));

      // student cannot self-approve (RBAC on the admin action)
      const selfApprove = await rejectee.post("/admin/commerce", { form: { _action: "approve_payment", paymentId: payment2 ?? "", receivedAmount: "25000" } });
      const s2StillLocked = await rejectee.get("/learn/physics-3s-full/coulomb-law");
      check("student self-approval blocked (redirect, no grant)", selfApprove.status === 302 && s2StillLocked.text.includes("يتطلب صلاحية وصول"), `got ${selfApprove.status}`);

      // ── activation codes: generate (plaintext once) → redeem → unlock; replay rejected ──
      const genRes = await admin.post("/admin/commerce?tab=codes", {
        form: { _action: "generate_codes", name: `Smoke batch ${runId}`, count: "2", maxUses: "1", productId: smokeProductId ?? "", resourceId: "", durationDays: "", expiresAt: "", note: "smoke" },
      });
      const codes = [...genRes.text.matchAll(/EDU-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}/g)].map((m) => m[0]);
      check("activation batch generated; plaintext codes shown once", codes.length >= 2, `found ${codes.length}`);
      if (codes.length >= 2) {
        const redeem = await rejectee.post("/activate", { form: { _action: "redeem", code: codes[0] } });
        check("valid code redemption → success", redeem.text.includes('data-testid="redeem-success"'), `status=${redeem.status}`);
        const s2Unlocked = await rejectee.get("/learn/physics-3s-full/coulomb-law");
        check("redeemed code → entitlement → lesson unlocked", !s2Unlocked.text.includes("يتطلب صلاحية وصول"));
        const replay = await rejectee.post("/activate", { form: { _action: "redeem", code: codes[0] } });
        check("same code twice → already_redeemed (no double grant)", replay.text.includes("لقد فعّلت هذا الكود من قبل"));
        const junk = await rejectee.post("/activate", { form: { _action: "redeem", code: "EDU-2222-3333-4444" } });
        check("fabricated code → invalid", junk.text.includes('data-testid="redeem-error"'));
      }
    }
  }

  // webhook endpoint guards (mock provider is TEST-ONLY; forged events must bounce)
  const whGet = await anon.get("/webhooks/payments/mock");
  check("webhook route: GET → 405", whGet.status === 405, `got ${whGet.status}`);
  const whPost = await anon.post("/webhooks/payments/mock", {
    body: JSON.stringify({ provider_event_id: `smoke_${runId}`, type: "payment.paid", reference: "does-not-exist", amount_minor: 1 }),
    headers: { "content-type": "application/json", "x-mock-signature": "00".repeat(32) },
  });
  check("forged webhook signature → 400 rejected (no fulfillment)", whPost.status === 400, `got ${whPost.status}`);

  // ------------------------------------------------------------------
  console.log("\n[17] Phase 7 admin platform: real dashboard metrics, users, announcements, analytics, security, audit");
  const p7Run = Date.now().toString(36);

  // ── dashboard: real aggregated metrics + server-side date windows ──
  const p7Home = await admin.get("/admin?range=all");
  check("dashboard renders with range=all", p7Home.status === 200, `got ${p7Home.status}`);
  const p7HomeText = norm(p7Home.text);
  const p7Metric = (id) => {
    const m = p7HomeText.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`));
    return m ? m[1].trim() : null;
  };
  const usersMetric = Number((p7Metric("home-metric-users-total") ?? "0").replace(/[^0-9]/g, ""));
  check("users metric is real data (>= 1)", usersMetric >= 1, `got ${p7Metric("home-metric-users-total")}`);
  check("students metric present", p7Metric("home-metric-students") != null);
  check("commerce revenue metric present (integer minor units, formatted)", (p7Metric("home-metric-gross") ?? "").length > 0);
  check("video watch-time metric present", (p7Metric("home-metric-watch-time") ?? "").length > 0);
  check("exam metrics present (attempts + pass rate)", p7Metric("home-metric-attempts") != null && p7Metric("home-metric-pass-rate") != null);
  const p7HomeToday = await admin.get("/admin?range=today");
  check("range switch re-renders server-side (today)", p7HomeToday.status === 200 && norm(p7HomeToday.text).includes('data-testid="range-switcher"'));

  // ── users: search / detail / promote / escalation guards / suspend / reactivate / IDOR ──
  // NOTE: reuses the §14 student (s14) — §17 must not consume register (5/h) or
  // login (10/min) budget; those limits belong to §13 and to the earlier journeys.
  const usersList = await admin.get(`/admin/users?q=${encodeURIComponent(s14Email)}`);
  const s14Id = (usersList.text.match(/href="\/admin\/users\/([0-9a-f-]{36})"/) ?? [])[1] ?? null;
  check("users search finds the §14 student server-side", usersList.status === 200 && Boolean(s14Id), `found=${s14Id}`);

  if (s14Id) {
    const p7Detail = await admin.get(`/admin/users/${s14Id}`);
    check("user detail renders profile + aggregates", p7Detail.status === 200 && norm(p7Detail.text).includes(s14Email));
    check("user detail leaks no password material", !p7Detail.text.includes("$2b$") && !p7Detail.text.includes("password_hash") && !p7Detail.text.includes("passwordHash"));

    // super admin promotes s14 → admin (rank 3) for the low-privilege matrix
    const promote = await admin.post(`/admin/users/${s14Id}`, { form: { _action: "set-role", roleId: "admin" } });
    check("super admin promotes user to admin (audited)", promote.status === 200 && norm(promote.text).includes("user-action-done"), `got ${promote.status}`);

    const s14Users = await s14.get("/admin/users");
    check("rank-3 admin CAN view users (seeded users.read)", s14Users.status === 200, `got ${s14Users.status}`);
    const s14Analytics = await s14.get("/admin/analytics?range=7d");
    check("rank-3 admin CAN view analytics", s14Analytics.status === 200, `got ${s14Analytics.status}`);

    const esc1 = await s14.post(`/admin/users/${s14Id}`, { form: { _action: "set-role", roleId: "super_admin" } });
    check("rank-3 self-escalation to super_admin denied by server", norm(esc1.text).includes("user-action-error"), `status=${esc1.status}`);
    const detailAsS14 = await s14.get(`/admin/users/${s14Id}`);
    check("escalation changed nothing (still not super admin)", !detailAsS14.text.includes("مشرف عام"));
    const esc2 = await s14.post(`/admin/users/${s14Id}`, { form: { _action: "force-logout" } });
    check("rank-3 self force-logout denied", norm(esc2.text).includes("user-action-error"));
    const esc3 = await s14.post(`/admin/users/${s14Id}`, { form: { _action: "set-status", status: "suspended" } });
    check("rank-3 cannot suspend own account", norm(esc3.text).includes("user-action-error"));

    // suspend (by super admin) → live session dies immediately
    const p7Susp = await admin.post(`/admin/users/${s14Id}`, { form: { _action: "set-status", status: "suspended" } });
    check("admin suspends user (audited action accepted)", p7Susp.status === 200 && norm(p7Susp.text).includes("user-action-done"), `got ${p7Susp.status}`);
    const s14Dead = await s14.get("/admin/users");
    check("suspended user's session dies immediately (redirect)", s14Dead.status === 302, `got ${s14Dead.status}`);
    const statusBadge = (html, id) => {
      const m = html.match(new RegExp(`user-status-${id}"[\\s\\S]{0,220}?</span>`));
      return m ? m[0] : "";
    };
    const afterSusp = await admin.get(`/admin/users?q=${encodeURIComponent(s14Email)}`);
    check("users list shows suspended status on THIS user's badge", statusBadge(afterSusp.text, s14Id).includes("موقوف"));

    // reactivate → list shows active; revoked session STAYS revoked (re-login would be required)
    const react = await admin.post(`/admin/users/${s14Id}`, { form: { _action: "set-status", status: "active" } });
    check("admin reactivates user", react.status === 200 && norm(react.text).includes("user-action-done"));
    const afterReact = await admin.get(`/admin/users?q=${encodeURIComponent(s14Email)}`);
    check("users list shows active status again on THIS user's badge", statusBadge(afterReact.text, s14Id).includes("نشط"));
    const s14StillDead = await s14.get("/admin/users");
    check("revoked session stays revoked after reactivation", s14StillDead.status === 302, `got ${s14StillDead.status}`);

    // demote back to student (leave no elevated smoke accounts behind)
    const demote = await admin.post(`/admin/users/${s14Id}`, { form: { _action: "set-role", roleId: "student" } });
    check("super admin demotes back to student (cleanup)", demote.status === 200 && norm(demote.text).includes("user-action-done"));

    const idor = await student.get(`/admin/users/${s14Id}`);
    check("student → admin user detail denied (redirect, no data)", idor.status === 302, `got ${idor.status}`);
  }

  // ── announcements: draft invisible → publish → student inbox → mark read → audit ──
  const annTitle = `Smoke P7 ${p7Run}`;
  const createAnn = await admin.post("/admin/announcements", { form: { _action: "create", titleAr: `إعلان ${annTitle}`, titleEn: annTitle, bodyAr: "نص الدخان", bodyEn: "smoke body", audience: "students" } });
  check("announcement created as draft", createAnn.status === 200 && norm(createAnn.text).includes("ann-done"), `got ${createAnn.status}`);
  const annList = await admin.get("/admin/announcements");
  const annId = (annList.text.match(/ann-publish-([0-9a-f-]{36})/) ?? [])[1] ?? null;
  check("draft listed with publish control", Boolean(annId));

  const notifBefore = await student.get("/notifications");
  check("student notification center renders", notifBefore.status === 200);
  check("DRAFT announcement invisible to students", !notifBefore.text.includes(p7Run));

  if (annId) {
    const pub = await admin.post("/admin/announcements", { form: { _action: "publish", id: annId } });
    check("announcement published", pub.status === 200 && norm(pub.text).includes("ann-done"));
    const notifAfter = await student.get("/notifications");
    check("published announcement visible to targeted student", notifAfter.text.includes(p7Run));
    check("unread badge shown", norm(notifAfter.text).includes(`notif-unread-${annId}`));
    check("nav unread count shown in student layout", norm(notifAfter.text).includes("nav-unread-badge"));

    const mark = await student.post("/notifications", { form: { _action: "mark-read", id: annId } });
    check("mark-read accepted", mark.status === 200);
    const notifRead = await student.get("/notifications");
    check("read state persisted (unread badge gone)", !norm(notifRead.text).includes(`notif-unread-${annId}`));

    const auditPub = await admin.get("/admin/audit?q=announcements.publish");
    check("audit viewer shows announcements.publish trail", auditPub.status === 200 && auditPub.text.includes("announcements.publish") && norm(auditPub.text).includes("audit-row"));

    const studentCreate = await student.post("/admin/announcements", { form: { _action: "create", titleAr: "x", titleEn: "x", bodyAr: "", bodyEn: "", audience: "all" } });
    check("student → announcements admin action denied (redirect)", studentCreate.status === 302, `got ${studentCreate.status}`);
  }

  // ── analytics / security / assessment / commerce / audit surfaces ──
  const analytics = await admin.get("/admin/analytics?range=30d");
  check("analytics page renders with date window", analytics.status === 200 && norm(analytics.text).includes("range-switcher"));
  const security = await admin.get("/admin/security");
  check("security center lists security events", security.status === 200 && norm(security.text).includes("security-event-row"));
  const sessionsTab = await admin.get("/admin/security?tab=sessions");
  check("security center lists active sessions", sessionsTab.status === 200 && norm(sessionsTab.text).includes("session-row"));
  const assessHub = await admin.get("/admin/assessment");
  check("assessment admin hub reachable (platform visibility)", assessHub.status === 200);
  const ordersTab = await admin.get("/admin/commerce?tab=orders");
  check("commerce orders view reachable with §16 rows", ordersTab.status === 200 && norm(ordersTab.text).includes("admin-order-row"));
  const auditAll = await admin.get("/admin/audit");
  check("audit viewer reachable with entries", auditAll.status === 200 && norm(auditAll.text).includes("audit-row"));

  // ── student denied EVERY admin surface (UI visibility ≠ authorization) ──
  let deniedAll = true;
  for (const path of ["/admin", "/admin/users", "/admin/analytics", "/admin/audit", "/admin/security", "/admin/announcements"]) {
    const r = await student.get(path);
    if (r.status !== 302) { deniedAll = false; check(`student denied ${path}`, false, `got ${r.status}`); }
  }
  check("student denied all admin surfaces (302, no data)", deniedAll);

  // ------------------------------------------------------------------
  console.log("\n[13] Rate limiting (runs LAST by design — burns the 1-min login window)");
  const rlClient = makeClient("ratelimit");
  let blocked = false;
  for (let i = 0; i < 14; i++) {
    const r = await rlClient.post("/login", { form: { email: `rl-${i}@smoke.local`, password: "wrong" } });
    if (loginFailureKind(r.text) === "rate_limited") { blocked = true; break; }
  }
  check("login rate limiter blocks after ≤ 10 attempts/min/IP", blocked);
  const rlValid = await rlClient.post("/login", { form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check("while IP-limited, even VALID credentials are refused (no bypass)", rlValid.status !== 302, `got ${rlValid.status}`);

  summary();
};

function summary() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`SMOKE RESULT: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("All runtime smoke checks green.");
}

run().catch((err) => {
  console.error("smoke run crashed:", err);
  process.exit(2);
});
