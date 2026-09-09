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
 *   - subject physics-3s, course physics-3s-full, exam electrostatics-check
 *   - product physics-3s-full-access, student@educore.local
 *   Production-readiness gate rejects all of the above.
 *
 * Usage: npm run db:seed:local
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
  devices: { maxPerStudent: 1, onLimit: "block", changeLimitPer30d: 2 },
  security: { sessionDays: 30, resetTokenMinutes: 60, rateLimits: { loginPerMinute: 10, registerPerHour: 5, forgotPerHour: 5 } },
};
for (const [key, value] of Object.entries(defaults)) {
  const sql = key === "platform"
    ? `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    : `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`;
  await exec(sql, [key, JSON.stringify(value), now]);
}

const themeSettings = {
  primary: "#2b2b33",
  secondary: "#17171d",
  accent: "#e14e2b",
  background: "#ffffff",
  surface: "#ffffff",
  text: "#141419",
  mutedText: "#5c5c68",
  border: "#e3e3e8",
  success: "#059669",
  warning: "#d97706",
  error: "#e11d48",
  radiusBase: 8,
  radiusButton: 8,
  radiusCard: 14,
  shadow: "sm",
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
const videoSettings = { provider: "mock", playbackTokenTtlSeconds: 45, fileUrlTtlSeconds: 120 };
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

// ---------------------------------------------------------------------------
// Phase 5 demo assessment (idempotent: exam keyed by slug, questions by stem_en)
// ---------------------------------------------------------------------------
const examConfig = {
  duration_minutes: 10,
  availability: { starts_at: null, ends_at: null },
  selection: { mode: "manual", pools: [], max_questions: null, randomize_questions: false, randomize_choices: false },
  attempts: { max: 30, cooldown_minutes: 0, manual_extra_allowed: false },
  scoring: { pass_percent: 50, partial_credit_multiselect: true, essay_points: 0 },
  results: { show: "immediate", show_answers: true, show_explanations: true, review_mode: true },
};

async function ensureQuestion(stemEn, cols, choices) {
  const found = await DB.prepare("SELECT id FROM questions WHERE stem_en = ? AND deleted_at IS NULL").bind(stemEn).first();
  if (found) return found.id;
  const id = detId("question:" + stemEn);
  await exec(
    `INSERT INTO questions (id, type, stem_ar, stem_en, explanation_ar, explanation_en, difficulty, points_default, subject_id, course_id, unit_id, lesson_id, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'published', ?, ?)`,
    [id, cols.type, cols.stemAr, stemEn, cols.explanationAr ?? null, cols.explanationEn ?? null, cols.difficulty ?? "medium", cols.points, subjectId, courseId, unitId, cols.lessonId ?? null, now, now]
  );
  for (let i = 0; i < choices.length; i++) {
    await exec(
      `INSERT INTO question_choices (id, question_id, content_ar, content_en, is_correct, sort_order, feedback) VALUES (?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), id, choices[i].ar, choices[i].en, choices[i].correct ? 1 : 0, i, null]
    );
  }
  return id;
}

const q1Id = await ensureQuestion("Coulomb force is proportional to…", {
  type: "mcq", stemAr: "قوة كولوم تتناسب طرديًا مع…", points: 2, lessonId: lesson2Id,
  explanationAr: "قانون كولوم: القوة تتناسب مع حاصل ضرب الشحنتين وعكس مربع المسافة.",
  explanationEn: "Coulomb's law: force is proportional to the product of charges over distance squared.",
}, [
  { ar: "حاصل ضرب الشحنتين", en: "the product of the two charges", correct: true },
  { ar: "مجموع الشحنتين", en: "the sum of the two charges", correct: false },
  { ar: "المسافة بين الشحنتين", en: "the distance between charges", correct: false },
]);
const q2Id = await ensureQuestion("The unit of electric charge is the coulomb.", {
  type: "true_false", stemAr: "وحدة قياس الشحنة الكهربائية هي الكولوم.", points: 1, lessonId: lesson2Id,
  explanationAr: "نعم — الكولوم هو وحدة الشحنة في النظام الدولي.",
  explanationEn: "True — the coulomb is the SI unit of charge.",
}, [
  { ar: "صواب", en: "True", correct: true },
  { ar: "خطأ", en: "False", correct: false },
]);

const existingExam = await DB.prepare("SELECT id FROM exams WHERE slug = ?").bind("electrostatics-check").first();
let demoExamId;
if (!existingExam) {
  demoExamId = detId("exam:electrostatics-check");
  await exec(
    `INSERT INTO exams (id, slug, title_ar, title_en, description_ar, description_en, course_id, lesson_id, config, status, created_at, updated_at)
     VALUES (?, 'electrostatics-check', ?, ?, ?, ?, NULL, ?, ?, 'published', ?, ?)`,
    [demoExamId, "قياس: الكهرباء الساكنة", "Check: Electrostatics", "اختبار قصير بعد درس قانون كولوم.", "A short check after the Coulomb's law lesson.", lesson2Id, JSON.stringify(examConfig), now, now]
  );
  await exec(`INSERT INTO exam_questions (exam_id, question_id, sort_order, points) VALUES (?,?,?,?)`, [demoExamId, q1Id, 0, 2]);
  await exec(`INSERT INTO exam_questions (exam_id, question_id, sort_order, points) VALUES (?,?,?,?)`, [demoExamId, q2Id, 1, 1]);
} else {
  demoExamId = existingExam.id;
}

// lesson item: REQUIRED exam on lesson 2 (graded submission completes the lesson)
const existingExamItem = await DB.prepare("SELECT id FROM lesson_items WHERE lesson_id = ? AND exam_id = ?").bind(lesson2Id, demoExamId).first();
if (!existingExamItem) {
  await exec(`INSERT INTO lesson_items (id, lesson_id, item_type, exam_id, sort_order, required, created_at) VALUES (?,?,?,?,?,?,?)`, [
    crypto.randomUUID(), lesson2Id, "exam", demoExamId, 1, 1, now,
  ]);
}

// ---------------------------------------------------------------------------
// Phase 6 demo commerce (idempotent: keyed by fixed slug). The readiness gate
// flags these rows — dev/demo only, never production.
// ---------------------------------------------------------------------------
const paymentsSettings = {
  manualEnabled: true,
  manualInstructionsAr: "حوالة إنستاباي إلى 01000000000 — اكتب رقم الطلب في البيان",
  manualInstructionsEn: "Instapay transfer to 01000000000 — write the order number as the reference",
  orderTtlMinutes: 4320,
  refundWindowDays: 14,
};
await exec(`INSERT INTO settings (key, value, updated_at) VALUES ('payments', ?, ?) ON CONFLICT(key) DO NOTHING`, [
  JSON.stringify(paymentsSettings),
  now,
]);

const demoProductId = await ensureContent("products", "physics-3s-full-access", {
    kind: "course",
  slug: "physics-3s-full-access",
  name_ar: "فيزياء ٣ث — وصول كامل للدورة",
  name_en: "Physics 3S — Full Course Access",
  description_ar: "افتح كل دروس دورة الفيزياء: الشرح والملفات والامتحانات.",
  description_en: "Unlock every physics lesson: videos, files and exams.",
  active: 1,
  sort_order: 0,
  created_at: now,
  updated_at: now,
});
const existingProductItem = await DB.prepare(
  "SELECT id FROM product_items WHERE product_id = ? AND resource_id = ?"
).bind(demoProductId, courseId).first();
if (!existingProductItem) {
  await exec(
    `INSERT INTO product_items (id, product_id, resource_type, resource_id, sort_order, created_at) VALUES (?,?,?,?,?,?)`,
    [crypto.randomUUID(), demoProductId, "course", courseId, 0, now]
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
).bind(studentRow.id, subjectId).first();
if (!existingGrant) {
  await exec(
    `INSERT INTO entitlements (id, student_id, source_type, resource_type, resource_id, status, starts_at, granted_at, metadata)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), studentRow.id, "admin_grant", "subject", subjectId, "active", now, now, JSON.stringify({ note: "seed demo grant" })]
  );
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

// --- homepage sections -----------------------------------------------------
const heroSection = section(
  sectionProps({ bg: "default", padding: "none", container: "full" }),
  component("hero_showcase", {
    eyebrow: L("الفلسفة وعلم النفس", "Philosophy & Psychology"),
    heading: L("أهلاً بيكم في منصتكم!", "Welcome to your platform!"),
    subtitle: L(
      "<p>مع <strong>د/ مصطفى تيتو</strong> — منصة متكاملة لدراسة الفلسفة وعلم النفس: محاضرات، ملخصات، بنوك أسئلة واختبارات في مكان واحد.</p>",
      "<p>With <strong>Dr mostafa tito</strong> — a complete platform for studying philosophy and psychology: lectures, notes, question banks and tests in one place.</p>"
    ),
    ctas: [
      { label: L("إنشاء حساب", "Create account"), href: "/register", target: "_self", variant: "primary", icon: "" },
      { label: L("تسجيل الدخول", "Log in"), href: "/login", target: "_self", variant: "secondary", icon: "" },
    ],
    videoLabel: L("", ""),
    videoId: "",
    image: heroFileId ?? "",
    imageAlt: L("تكوين بصري تجريدي للفلسفة وعلم النفس", "Abstract philosophy and psychology visual"),
    badges: [
      { icon: "book-open", title: L("كورسات الفلسفة", "Philosophy courses"), text: L("شرح ومراجعة", "Lessons & revision"), position: "bottom-start" },
      { icon: "brain", title: L("كورسات علم النفس", "Psychology courses"), text: L("شرح ومراجعة", "Lessons & revision"), position: "top-end" },
      { icon: "lightbulb", title: L("بنوك أسئلة", "Question banks"), text: L("تدريب وتقييم", "Practice & assessment"), position: "top-start" },
    ],
  })
);

// Trust bar: platform offerings (NOT fabricated counts — owner fills verified
// numbers later). value/label/icon/link are all CMS-editable and sortable.
const statsSection = section(
  sectionProps({ padding: "md", container: "wide" }),
  component("statistics", {
    style: "bar",
    items: [
      { value: L("الفلسفة", "Philosophy"), label: L("كورسات ومراجعات", "Courses & revision"), icon: "book-open", href: "/courses" },
      { value: L("علم النفس", "Psychology"), label: L("كورسات ومراجعات", "Courses & revision"), icon: "brain", href: "/courses" },
      { value: L("بنوك أسئلة", "Question banks"), label: L("تدريبات", "Practice"), icon: "list", href: "/exams" },
      { value: L("اختبارات إلكترونية", "Online tests"), label: L("تقييم ومتابعة", "Assessment"), icon: "chart", href: "/exams" },
    ],
  })
);

const featuresSection = section(
  sectionProps({
    heading: L("ماذا ستجد في المنصة؟", "What will you find on the platform?"),
    subheading: L("كل ما تحتاجه لتحقيق التفوق في الفلسفة وعلم النفس في مكان واحد.", "Everything you need to excel in philosophy and psychology, in one place."),
    bg: "default", padding: "lg", align: "center", container: "wide",
  }),
  component("feature_cards", {
    items: [
      { icon: "play-circle", title: L("محاضرات ودروس", "Lectures & lessons"), text: L("شروحات منظمة لكل دروس الفلسفة وعلم النفس.", "Organized lessons in philosophy and psychology."), ctaLabel: L("تصفح الكورسات", "Browse courses"), href: "/courses", tint: "error" },
      { icon: "file-text", title: L("ملخصات ومذكرات", "Notes & summaries"), text: L("ملفات منظمة تساعدك على المراجعة السريعة.", "Organized files for quick revision."), ctaLabel: L("مكتبة المصادر", "Resource library"), href: "/p/resources", tint: "success" },
      { icon: "layers", title: L("بنوك أسئلة", "Question banks"), text: L("تدرّب على الأسئلة المصنفة حسب كل وحدة ودرس.", "Practice questions grouped by unit and lesson."), ctaLabel: L("الاختبارات", "Exams"), href: "/exams", tint: "warning" },
      { icon: "check-circle", title: L("اختبارات وتقييمات", "Tests & assessments"), text: L("قيّم مستواك بتصحيح فوري داخل المنصة.", "Check your level with instant in-platform grading."), ctaLabel: L("الاختبارات", "Exams"), href: "/exams", tint: "brand" },
      { icon: "chart", title: L("متابعة التقدم", "Progress tracking"), text: L("تابع مستواك وتعرف على نقاط القوة والضعف.", "Track your level and see where to focus next."), ctaLabel: L("لوحة الطالب", "Dashboard"), href: "/dashboard", tint: "muted" },
    ],
  })
);

const ctaSection = section(
  sectionProps({ heading: L("ابدأ التعلم اليوم", "Start learning today"), subheading: L("أنشئ حسابك وابدأ رحلتك في الفلسفة وعلم النفس.", "Create your account and start your journey in philosophy and psychology."), padding: "xl", align: "center" }),
  component("buttons", {
    items: [
      { label: L("إنشاء حساب", "Create account"), href: "/register", target: "_self", variant: "primary", icon: "" },
      { label: L("استكشف الكورسات", "Browse courses"), href: "/courses", target: "_self", variant: "secondary", icon: "" },
    ],
    align: "center",
    stackMobile: true,
  })
);

await seedCmsPage({
  slug: "home",
  titleAr: "الرئيسية",
  titleEn: "Home",
  sections: [heroSection, statsSection, featuresSection, ctaSection],
  note: "Homepage visual redesign (philosophy & psychology)",
  replace: true,
});

// Minimal CMS subpages so the header navigation resolves (all editable).
await seedSimplePage({
  slug: "resources", titleAr: "مكتبة المصادر", titleEn: "Resource library",
  headingAr: "مكتبة المصادر", headingEn: "Resource library",
  textAr: "ستجد هنا المذكرات والملخصات والملفات المتاحة ضمن الكورسات.",
  textEn: "You'll find the notes, summaries and files available within the courses here.",
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
    ["الكورسات", "Courses", "/courses"],
    ["الاختبارات", "Exams", "/exams"],
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
}

console.log("Seed complete.");
console.log(`  super admin email : ${adminEmail} (source: ADMIN_BOOTSTRAP_EMAIL; local placeholder if unset in development)`);
console.log("  password          : not printed — change via Profile → Security or the reset flow");
console.log("  demo student      : student@educore.local (LOCAL fixture, blocked in production readiness)");
console.log("  demo catalog      : physics-3s-full / electrostatics-check (LMS fixtures, not site identity)");
console.log("  production identity: د/ مصطفى تيتو / Philosophy & Psychology (CMS homepage)");

await proxy.dispose();
