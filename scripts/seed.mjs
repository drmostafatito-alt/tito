#!/usr/bin/env node
/**
 * LOCAL-DEV seed only. Never run against production.
 *
 * Production configuration (identity of the live site):
 *   - platform name/tagline: د/ مصطفى تيتو / Dr mostafa tito — Philosophy & Psychology
 *   - CMS homepage + menus: philosophy & psychology marketing copy
 *   - admin email: ADMIN_BOOTSTRAP_EMAIL (env / .dev.vars). The fallback
 *     admin@educore.local is a LOCAL placeholder, not a production identity.
 *
 * Demo/fixture catalog (LMS feature coverage for e2e/smoke — NOT site identity):
 *   - subject physics-3s, course physics-3s-full (with a PDF lesson item)
 *   - product physics-3s-full-access, student@educore.local
 *   Production-readiness gate rejects all of the above, and it is OPT-IN here:
 *   a normal seed installs none of it (see --with-demo). The public homepage,
 *   catalog and discovery surfaces read PUBLISHED rows, so seeding the demo
 *   catalog unconditionally surfaced physics content under this platform's
 *   philosophy & psychology identity.
 *
 * Usage: npm run db:seed:local                  (platform identity + CMS only)
 *        npm run db:seed:local -- --with-demo   (adds the e2e/smoke fixtures)
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
// wrangler >= 4.12x: root export exposes getPlatformProxy
import { getPlatformProxy } from "wrangler";

/**
 * Deterministic UUID v5-style id derived from a stable name. Fixture/catalog
 * rows use this so that a fresh LOCAL reseed yields the SAME primary keys —
 * admin deep links (content/question/product/page editors) stay valid across
 * resets instead of 404ing on freshly-rolled UUIDs. Dev/demo seed only.
 */
function detId(name) {
  const h = createHash("sha1").update("educore-seed:" + name).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // version 5
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const s = h.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// minimal .dev.vars loader
function loadDevVars() {
  const vars = {};
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) vars[m[1]] = m[2];
    }
  }
  return vars;
}

const devVars = loadDevVars();
const proxy = await getPlatformProxy();
const env = { ...proxy.env, ...devVars };
const DB = env.DB;

async function pbkdf2Hash(password, iterations = 100_000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  return `pbkdf2$sha256$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const now = Date.now();
const exec = (sql, params = []) => DB.prepare(sql).bind(...params).run();

// roles
await exec(
  `INSERT INTO roles (id, label, rank) VALUES ('student','Student',1),('teacher','Teacher',2),('admin','Admin',3),('super_admin','Super Admin',4)
   ON CONFLICT(id) DO NOTHING`
);

// default settings groups (mirrors server/settings/schema.ts defaults)
const defaults = {
  platform: { nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito", taglineAr: "الفلسفة وعلم النفس", taglineEn: "Philosophy & Psychology", maintenance: false, supportEmail: null, supportPhone: null, whatsapp: null },
  // Owner identity (content/branding integration). ONLY owner-confirmed fields
  // are set here; the Facebook page is scrape-blocked (HTTP 403), so title /
  // bio / specialty / photo / other links stay empty until the owner provides
  // them (admin → Appearance → Identity) or extends this seed. Never fabricate.
  identity: {
    ownerNameAr: "د/ مصطفى تيتو",
    ownerNameEn: "Dr mostafa tito",
    contactPhone: "01153719506",
    facebook: "https://www.facebook.com/mr.mostafa.tito.philosophy/",
    // ownerTitleAr/En, ownerPhotoFileId, logoFileId, heroImageFileId,
    // aboutImageFileId, contactEmail, contactAddressAr/En, youtube/instagram/
    // tiktok/twitter/linkedin/telegram, copyrightAr/En — intentionally empty.
  },
  locale: { default: "ar", enabled: ["ar", "en"] },
  devices: { maxPerStudent: 3, onLimit: "replace_oldest", changeLimitPer30d: 0 },
  security: { sessionDays: 30, resetTokenMinutes: 30, rateLimits: { loginPerMinute: 10, registerPerHour: 5, forgotPerHour: 5, forgotPerAccountHour: 3, resetAttemptsPer15Minutes: 10, resetEmailsPerDay: 80, emailChangePerHour: 5 } },
};
for (const [key, value] of Object.entries(defaults)) {
  const sql = key === "platform"
    ? `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    : `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`;
  await exec(sql, [key, JSON.stringify(value), now]);
}

// Identity palette: Navy / White / Gold (owner brief §1). Owner-editable in
// Appearance → Theme; the stable --color-navy-* / --color-gold-* tokens used by
// the homepage + curriculum identity surfaces are not overridden by this ramp.
const themeSettings = {
  primary: "#2b518f",
  secondary: "#1f3f72",
  accent: "#c9932a",
  background: "#f7f9fc",
  surface: "#ffffff",
  text: "#0f172a",
  mutedText: "#5b6b80",
  border: "#e2e8f0",
  success: "#059669",
  warning: "#d97706",
  error: "#e11d48",
  radiusBase: 12,
  radiusButton: 16,
  radiusCard: 20,
  shadow: "md",
  density: "normal",
  fontScale: "normal",
  headingFont: "cairo",
  bodyFont: "cairo",
};
await exec(
  `INSERT INTO settings (key, value, updated_at) VALUES ('theme', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  [JSON.stringify(themeSettings), now],
);

// super admin — email from ADMIN_BOOTSTRAP_EMAIL only. The educore.local
// fallback is LOCAL DEVELOPMENT, never a production identity (bootstrap-admin
// --remote already refuses it).
const configuredEmail = String(env.ADMIN_BOOTSTRAP_EMAIL || "").toLowerCase().trim();
const isDev = String(env.ENVIRONMENT || "") === "development";
if (!configuredEmail && !isDev) {
  console.error("ADMIN_BOOTSTRAP_EMAIL is required (env or .dev.vars).");
  await proxy.dispose();
  process.exit(2);
}
const adminEmail = configuredEmail || "admin@educore.local";
const existingAdmin = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(adminEmail).first();
let adminUserId = existingAdmin?.id ?? null;
let adminPassword = "(existing — unchanged)";
if (!existingAdmin) {
  adminUserId = crypto.randomUUID();
  adminPassword = `Admin-${crypto.randomUUID().slice(0, 8)}!${Math.floor(Math.random() * 90 + 10)}`;
  await exec(
    `INSERT INTO users (id, email, password_hash, full_name, locale_pref, role_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'Super Admin', 'ar', 'super_admin', 'active', ?, ?)`,
    [adminUserId, adminEmail, await pbkdf2Hash(adminPassword), now, now]
  );
}

// demo student
const studentEmail = "student@educore.local";
const existingStudent = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(studentEmail).first();
if (!existingStudent) {
  await exec(
    `INSERT INTO users (id, email, password_hash, full_name, locale_pref, role_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'طالب تجريبي', 'ar', 'student', 'active', ?, ?)`,
    [crypto.randomUUID(), studentEmail, await pbkdf2Hash("Student#12345"), now, now]
  );
}

// ---------------------------------------------------------------------------
// Phase 2 demo/fixture catalog (idempotent: keyed by fixed slugs).
// LMS feature coverage for e2e/smoke only — NOT production identity.
// Production-readiness gate rejects these rows. Do not delete the schema.
// ---------------------------------------------------------------------------
const videoSettings = { provider: "mock", playbackTokenTtlSeconds: 3600, fileUrlTtlSeconds: 120 };
await exec(`INSERT INTO settings (key, value, updated_at) VALUES ('video', ?, ?) ON CONFLICT(key) DO NOTHING`, [
  JSON.stringify(videoSettings),
  now,
]);

async function ensureContent(table, slug, cols) {
  const found = slug ? await DB.prepare(`SELECT id FROM ${table} WHERE slug = ?`).bind(slug).first() : null;
  if (found) return found.id;
  // Resolve the id: caller-provided, else deterministic from the stable slug,
  // else random (only for rows with no stable identity).
  const id = cols.id ?? (slug ? detId(slug) : crypto.randomUUID());
  const insertCols = { id, ...cols };
  await exec(
    `INSERT INTO ${table} (${Object.keys(insertCols).join(",")}) VALUES (${Object.keys(insertCols)
      .map(() => "?")
      .join(",")})`,
    Object.values(insertCols).map((v) => (v === undefined ? null : v))
  );
  return id;
}

// ---------------------------------------------------------------------------
// Demo/fixture data is OPT-IN (`--with-demo`).
//
// The physics catalog below exists only so the e2e/smoke suites can exercise
// the LMS against real rows. It is not site identity and it is not public
// content — but the homepage's data-driven blocks (course/video/product cards)
// and the public catalog/discovery read PUBLISHED rows, so installing it by
// default made demo physics courses, videos and a 300 EGP product appear on a
// philosophy & psychology platform. A normal seed therefore installs identity,
// settings and the CMS homepage only; `scripts/e2e-reset.mjs` passes
// `--with-demo` so the browser suites keep their fixtures.
// ---------------------------------------------------------------------------
const WITH_DEMO = process.argv.includes("--with-demo");

// Fixture ids the demo commerce block below needs (same gate). Null while the
// demo catalog is not installed.
let demoSubjectId = null;
let demoCourseId = null;
if (WITH_DEMO) {
  const programId = await ensureContent("programs", "al-Thanawiya-al-3amma", {
      slug: "al-Thanawiya-al-3amma",
    title_ar: "الثانوية العامة",
    title_en: "General Secondary",
    status: "published",
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });
  const gradeId = await ensureContent("grades", "grade-3-secondary", {
      program_id: programId,
    slug: "grade-3-secondary",
    title_ar: "الصف الثالث الثانوي",
    title_en: "Grade 12 (3rd Secondary)",
    status: "published",
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });
  const subjectId = await ensureContent("subjects", "physics-3s", {
      grade_id: gradeId,
    slug: "physics-3s",
    title_ar: "الفيزياء",
    title_en: "Physics",
    status: "published",
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });
  const courseId = await ensureContent("courses", "physics-3s-full", {
      subject_id: subjectId,
    slug: "physics-3s-full",
    title_ar: "مراجعة شاملة — فيزياء الثالث الثانوي",
    title_en: "Full Revision — Physics 3rd Secondary",
    description_ar: "دورة شاملة تغطي المنهج بالكامل مع فيديوهات وملفات PDF.",
    description_en: "Complete syllabus coverage with videos and PDF files.",
    access_level: "entitled",
    status: "published",
    visibility: "featured",
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });
  const freeCourseId = await ensureContent("courses", "study-skills", {
      subject_id: subjectId,
    slug: "study-skills",
    title_ar: "مهارات الدراسة (مجاني)",
    title_en: "Study Skills (Free)",
    access_level: "authenticated",
    status: "published",
    visibility: "catalog",
    sort_order: 1,
    created_at: now,
    updated_at: now,
  });
  // units have no slug — idempotency via title lookup
  let unitId = (await DB.prepare("SELECT id FROM units WHERE course_id = ? AND title_en = ?").bind(courseId, "Unit 1: Electrostatics").first())?.id;
  if (!unitId) {
    unitId = detId("unit:electrostatics");
    await exec(
      `INSERT INTO units (id, course_id, title_ar, title_en, status, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      [unitId, courseId, "الوحدة الأولى: الكهرباء الساكنة", "Unit 1: Electrostatics", "published", 0, now, now]
    );
  }
  const lesson1Id = await ensureContent("lessons", "electrostatics-intro", {
      unit_id: unitId,
    slug: "electrostatics-intro",
    title_ar: "مقدمة الشحنات الكهربائية",
    title_en: "Introduction to Electric Charges",
    access_level: "entitled",
    free_preview: 1,
    status: "published",
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });
  const lesson2Id = await ensureContent("lessons", "coulomb-law", {
      unit_id: unitId,
    slug: "coulomb-law",
    title_ar: "قانون كولوم",
    title_en: "Coulomb's Law",
    access_level: "entitled",
    free_preview: 0,
    status: "published",
    sort_order: 1,
    created_at: now,
    updated_at: now,
  });

  // mock video + attach to lesson 1
  const existingVideo = await DB.prepare("SELECT id FROM videos WHERE metadata LIKE '%\"title\":\"Demo: Coulomb intro\"%'").first();
  let videoId;
  if (!existingVideo) {
    videoId = detId("video:coulomb-intro");
    const assetId = `mock-asset-${crypto.randomUUID()}`;
    await exec(
      `INSERT INTO videos (id, provider, provider_asset_id, playback_id, status, duration_seconds, metadata, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [videoId, "mock", assetId, `mock-pb-${assetId.slice(11, 23)}`, "ready", 120, JSON.stringify({ title: "Demo: Coulomb intro" }), now, now]
    );
  } else {
    videoId = existingVideo.id;
  }
  const existingItem = await DB.prepare("SELECT id FROM lesson_items WHERE lesson_id = ? AND video_id = ?").bind(lesson1Id, videoId).first();
  if (!existingItem) {
    await exec(`INSERT INTO lesson_items (id, lesson_id, item_type, video_id, sort_order, required, created_at) VALUES (?,?,?,?,?,?,?)`, [
      crypto.randomUUID(), lesson1Id, "video", videoId, 0, 1, now,
    ]);
  }

  // demo PDF in R2 private-files + attach to lesson 2
  const demoPdfId = detId("file:physics-revision");
  const pdfKey = `private/pdf/${demoPdfId}/physics-revision.pdf`;
  const existingPdf = await DB.prepare("SELECT id FROM files WHERE original_filename = ?").bind("physics-revision.pdf").first();
  let pdfFileId;
  if (!existingPdf) {
    // minimal valid PDF (one empty page)
    const pdf = `%PDF-1.4
  1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
  2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
  3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj
  trailer<</Root 1 0 R>>
  %%EOF`;
    await env.PRIVATE_FILES.put(pdfKey, pdf, { httpMetadata: { contentType: "application/pdf" } });
    await exec(
      `INSERT INTO files (id, r2_key, bucket, kind, original_filename, mime, byte_size, checksum_sha256, visibility, download_allowed, alt_ar, alt_en, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [demoPdfId, pdfKey, "PRIVATE_FILES", "pdf", "physics-revision.pdf", "application/pdf", pdf.length, "seed-demo", "private", 1, "", "", now, now]
    );
    pdfFileId = demoPdfId;
  } else {
    pdfFileId = existingPdf.id;
  }
  const existingPdfItem = await DB.prepare("SELECT id FROM lesson_items WHERE lesson_id = ? AND file_id = ?").bind(lesson2Id, pdfFileId).first();
  if (!existingPdfItem) {
    await exec(`INSERT INTO lesson_items (id, lesson_id, item_type, file_id, sort_order, required, created_at) VALUES (?,?,?,?,?,?,?)`, [
      crypto.randomUUID(), lesson2Id, "file", pdfFileId, 0, 1, now,
    ]);
  }
  demoSubjectId = subjectId;
  demoCourseId = courseId;
}

// ---------------------------------------------------------------------------
// Questions & exams: RETIRED from Tito. The internal question bank / exam engine
// was replaced by a standalone external Questions Platform (its entry URL is
// admin-controlled under Appearance -> System; no demo exam/question rows are
// seeded). Lesson 2 keeps its PDF item only.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Phase 6 demo commerce (idempotent: keyed by fixed slug). The readiness gate
// flags these rows — dev/demo only, never production.
// ---------------------------------------------------------------------------
const paymentsSettings = {
  manualEnabled: true,
  // No payment destination is seeded: bank/InstaPay details are owner data
  // entered in Appearance -> System -> Payments, never invented here. While
  // they are empty the order page falls back to "instructions are shared via
  // support" (commerce.instructionsNotConfigured).
  manualInstructionsAr: "",
  manualInstructionsEn: "",
  orderTtlMinutes: 4320,
  refundWindowDays: 14,
};
await exec(`INSERT INTO settings (key, value, updated_at) VALUES ('payments', ?, ?) ON CONFLICT(key) DO NOTHING`, [
  JSON.stringify(paymentsSettings),
  now,
]);

if (WITH_DEMO) {
  const demoProductId = await ensureContent("products", "physics-3s-full-access", {
      kind: "course",
    slug: "physics-3s-full-access",
    name_ar: "فيزياء ٣ث — وصول كامل للدورة",
    name_en: "Physics 3S — Full Course Access",
    description_ar: "افتح كل دروس دورة الفيزياء: الشرح والملفات والواجبات.",
    description_en: "Unlock every physics lesson: videos, files and assignments.",
    active: 1,
    sort_order: 0,
    created_at: now,
    updated_at: now,
  });
  const existingProductItem = await DB.prepare(
    "SELECT id FROM product_items WHERE product_id = ? AND resource_id = ?"
  ).bind(demoProductId, demoCourseId).first();
  if (!existingProductItem) {
    await exec(
      `INSERT INTO product_items (id, product_id, resource_type, resource_id, sort_order, created_at) VALUES (?,?,?,?,?,?)`,
      [crypto.randomUUID(), demoProductId, "course", demoCourseId, 0, now]
    );
  }
  const existingPricePlan = await DB.prepare("SELECT id FROM price_plans WHERE product_id = ?").bind(demoProductId).first();
  if (!existingPricePlan) {
    await exec(
      `INSERT INTO price_plans (id, product_id, currency, amount_minor, kind, active, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), demoProductId, "EGP", 30000, "one_time", 1, 0, now, now]
    );
  }

  // demo entitlement: student → subject (covers both courses' entitled content)
  const studentRow = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(studentEmail).first();
  const existingGrant = await DB.prepare(
    "SELECT id FROM entitlements WHERE student_id = ? AND resource_type = 'subject' AND resource_id = ? AND status = 'active'"
  ).bind(studentRow.id, demoSubjectId).first();
  if (!existingGrant) {
    await exec(
      `INSERT INTO entitlements (id, student_id, source_type, resource_type, resource_id, status, starts_at, granted_at, metadata)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), studentRow.id, "admin_grant", "subject", demoSubjectId, "active", now, now, JSON.stringify({ note: "seed demo grant" })]
    );
  }
}

// ---------------------------------------------------------------------------
// CMS homepage + navigation (idempotent: keyed by fixed slugs / menu location).
// The platform is الفلسفة وعلم النفس (philosophy & psychology) — NO physics
// content/terms/icons/claims anywhere. Every string/image/link/stat below is
// CMS-editable; unverified numbers are NOT invented (trust bar shows platform
// offerings instead of fabricated counts). Empty image/video fields stay empty
// (empty-first: no placeholder assets, no fake demo videos).
// ---------------------------------------------------------------------------
const L = (ar, en) => ({ ar, en });
const cmsNow = Date.now();
const cmsId = () => crypto.randomUUID();

// Composable helpers mirroring the published-snapshot shape (registry-validated
// at render time via zodForBlock; see app/cms/registry.ts).
const component = (type, props) => ({ id: cmsId(), type, props, visible: true });
const section = (props, ...children) => ({ id: cmsId(), type: "section", props, visible: true, children });
const sectionProps = (over = {}) => ({
  heading: L("", ""), subheading: L("", ""), bg: "default", padding: "md",
  container: "normal", columns: "1", gap: "md", align: "start", hideMobile: false,
  ...over,
});

async function seedCmsPage({ slug, titleAr, titleEn, sections, note = "Initial seed", replace = false }) {
  const found = await DB.prepare("SELECT id FROM pages WHERE slug = ?").bind(slug).first();
  if (found && !replace) return found.id;
  if (found && replace) {
    await exec(`DELETE FROM blocks WHERE page_id = ?`, [found.id]);
    await exec(`DELETE FROM page_versions WHERE page_id = ?`, [found.id]);
    await exec(`DELETE FROM pages WHERE id = ?`, [found.id]);
  }
  const pageId = detId("page:" + slug);
  const snapshot = { v: 1, page: { slug, titleAr, titleEn, seo: {} }, sections };
  await exec(
    `INSERT INTO pages (id, slug, title_ar, title_en, status, seo, published_snapshot, published_at, sort_order, created_by, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [pageId, slug, titleAr, titleEn, "published", "{}", JSON.stringify(snapshot), cmsNow, 0, adminUserId, cmsNow, cmsNow, null]
  );
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const sectionId = sec.id;
    await exec(
      `INSERT INTO blocks (id, page_id, parent_id, type, props, sort_order, visible, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [sectionId, pageId, null, "section", JSON.stringify(sec.props), si, sec.visible === false ? 0 : 1, cmsNow, cmsNow]
    );
    for (let ci = 0; ci < sec.children.length; ci++) {
      const ch = sec.children[ci];
      await exec(
        `INSERT INTO blocks (id, page_id, parent_id, type, props, sort_order, visible, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        [ch.id, pageId, sectionId, ch.type, JSON.stringify(ch.props), ci, ch.visible === false ? 0 : 1, cmsNow, cmsNow]
      );
    }
  }
  await exec(
    `INSERT INTO page_versions (id, page_id, version_no, snapshot, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)`,
    [cmsId(), pageId, 1, JSON.stringify(snapshot), note, adminUserId, cmsNow]
  );
  return pageId;
}

async function seedSimplePage({ slug, titleAr, titleEn, headingAr, headingEn, textAr, textEn }) {
  return seedCmsPage({
    slug, titleAr, titleEn,
    sections: [
      section(
        sectionProps({ heading: L(headingAr, headingEn), padding: "lg", container: "narrow" }),
        component("text", { content: L(textAr, textEn), size: "lead", align: "start" })
      ),
    ],
    note: "CMS homepage scaffold",
  });
}

// --- hero visual (abstract philosophy + psychology; CMS-replaceable) --------
const heroFilename = "hero-philosophy.webp";
const heroPath = "public/hero-philosophy.webp";
let heroFileId = (await DB.prepare("SELECT id FROM files WHERE original_filename = ?").bind(heroFilename).first())?.id ?? null;
if (!heroFileId && existsSync(heroPath)) {
  heroFileId = detId("file:hero-philosophy");
  const buf = readFileSync(heroPath);
  const key = `public/images/${heroFileId}/${heroFilename}`;
  await env.PUBLIC_ASSETS.put(key, buf, { httpMetadata: { contentType: "image/webp" } });
  await exec(
    `INSERT INTO files (id, r2_key, bucket, kind, original_filename, mime, byte_size, checksum_sha256, visibility, download_allowed, alt_ar, alt_en, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [heroFileId, key, "PUBLIC_ASSETS", "image", heroFilename, "image/webp", buf.length, "seed-hero-philosophy", "public", 0, "تكوين بصري للفلسفة وعلم النفس", "Abstract philosophy and psychology visual", cmsNow, cmsNow]
  );
}

// --- homepage composition ---------------------------------------------------
// The recommended layout lives in ONE place: server/cms/home-preset.json. The
// same file backs the admin action "apply recommended homepage layout"
// (server/cms/home-preset.server.ts), so a fresh install and an existing
// database converge on the identical, fully CMS-editable composition.
// Content-bearing sections (courses, videos, books, grades, exams) render REAL
// published rows only and collapse while their tables are empty — the preset
// itself contains copy and links, never invented content or numbers.
const homePreset = JSON.parse(readFileSync("server/cms/home-preset.json", "utf8"));
// PUBLIC REBUILD (owner brief §19): the hero no longer receives any
// auto-injected illustration. `public/hero-philosophy.webp` stays registered in
// `files` so the owner can STILL choose it in the CMS image picker, but a fresh
// homepage renders the platform's own CSS identity plate (light wash + masked
// engraving + the owner's name/photo from Settings → Identity). The old
// "violet fallback art" was the single loudest symptom of the previous design.
// Nothing is injected here anymore: `homePreset.sections[0]` keeps `image: ""`.
void heroFileId;

await seedCmsPage({
  slug: homePreset.page.slug,
  titleAr: homePreset.page.titleAr,
  titleEn: homePreset.page.titleEn,
  sections: homePreset.sections,
  note: "Recommended homepage layout (home-preset.json)",
  replace: true,
});

// Minimal CMS subpages so the header navigation resolves (all editable).
await seedSimplePage({
  slug: "resources", titleAr: "مكتبة المصادر", titleEn: "Resource library",
  headingAr: "مكتبة المصادر", headingEn: "Resource library",
  textAr: "ستجد هنا المذكرات والملخصات والملفات المتاحة ضمن المحتوى التعليمي.",
  textEn: "You'll find the notes, summaries and files available within the learning content here.",
});
await seedSimplePage({
  slug: "faq", titleAr: "الأسئلة الشائعة", titleEn: "Frequently asked questions",
  headingAr: "الأسئلة الشائعة", headingEn: "Frequently asked questions",
  textAr: "ستُضاف الأسئلة الشائعة هنا قريباً.",
  textEn: "Frequently asked questions will be added here soon.",
});
await seedSimplePage({
  slug: "contact", titleAr: "تواصل معنا", titleEn: "Contact us",
  headingAr: "تواصل معنا", headingEn: "Contact us",
  textAr: "يمكنك التواصل معنا من خلال معلومات التواصل الموضحة في أسفل الصفحة.",
  textEn: "You can reach us using the contact details shown in the page footer.",
});

// --- header navigation (existing menu builder location) ----------------------
let headerMenuId = (await DB.prepare("SELECT id FROM menus WHERE location = 'header'").first())?.id;
if (!headerMenuId) {
  headerMenuId = detId("menu:header");
  await exec(`INSERT INTO menus (id, location, updated_at) VALUES (?, 'header', ?)`, [headerMenuId, cmsNow]);
}
const existingNav = await DB.prepare("SELECT count(*) AS n FROM menu_items WHERE menu_id = ?").bind(headerMenuId).first();
if (!existingNav?.n) {
  const navItems = [
    ["الرئيسية", "Home", "/"],
    ["المحتوى التعليمي", "Learning", "/study"],
    ["عن المنصة", "About", "/about"],
    ["مكتبة المصادر", "Resources", "/p/resources"],
    ["الأسئلة الشائعة", "FAQ", "/p/faq"],
    ["تواصل معنا", "Contact", "/p/contact"],
  ];
  for (let i = 0; i < navItems.length; i++) {
    await exec(
      `INSERT INTO menu_items (id, menu_id, parent_id, label_ar, label_en, href, external, icon, sort_order, visible, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [cmsId(), headerMenuId, null, navItems[i][0], navItems[i][1], navItems[i][2], 0, null, i, 1, cmsNow, cmsNow]
    );
  }
} else {
  // Identity correction only: the previous default labeled the student entry
  // "الكورسات". Leave any owner-customized item alone.
  await exec(
    `UPDATE menu_items SET label_ar = ?, label_en = ?, href = ?, updated_at = ?
     WHERE menu_id = ? AND href = '/courses' AND label_ar = 'الكورسات'`,
    ["المحتوى التعليمي", "Learning", "/study", cmsNow, headerMenuId],
  );
}

console.log("Seed complete.");
console.log(`  super admin email : ${adminEmail} (source: ADMIN_BOOTSTRAP_EMAIL; local placeholder if unset in development)`);
console.log("  password          : not printed — change via Profile → Security or the reset flow");
console.log("  demo student      : student@educore.local (LOCAL fixture, blocked in production readiness)");
console.log("  demo catalog      : physics-3s-full (LMS fixture, not site identity)");
console.log("  production identity: د/ مصطفى تيتو / Philosophy & Psychology (CMS homepage)");

await proxy.dispose();
