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
  if (html.includes("محاولات كثيرة") || html.includes("Too many attempts")) return "rate_limited";
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
  check("home renders RTL Arabic shell from D1 settings", home.text.includes('dir="rtl"') && home.text.includes("منصة إيدوكور"));
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
  console.log("\n[12] Rate limiting (runs LAST by design — burns the 1-min login window)");
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
