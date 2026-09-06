#!/usr/bin/env node
/**
 * Local seed: roles, default settings, super admin (one-time generated password),
 * demo student. Runs against the LOCAL miniflare D1 (wrangler dev state).
 * Usage: npm run db:seed:local
 */
import { existsSync, readFileSync } from "node:fs";
// wrangler >= 4.12x: root export exposes getPlatformProxy
import { getPlatformProxy } from "wrangler";

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
  platform: { nameAr: "منصة إيدوكور", nameEn: "EduCore", taglineAr: "تعلم بثقة — من مرحلة إلى مرحلة", taglineEn: "Learn with confidence", maintenance: false, supportEmail: null, supportPhone: null, whatsapp: null },
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
  await exec(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`, [
    key,
    JSON.stringify(value),
    now,
  ]);
}

// super admin
const adminEmail = (env.ADMIN_BOOTSTRAP_EMAIL || "admin@educore.local").toLowerCase();
const existingAdmin = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(adminEmail).first();
let adminPassword = "(existing — unchanged)";
if (!existingAdmin) {
  adminPassword = `Admin-${crypto.randomUUID().slice(0, 8)}!${Math.floor(Math.random() * 90 + 10)}`;
  await exec(
    `INSERT INTO users (id, email, password_hash, full_name, locale_pref, role_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'Super Admin', 'ar', 'super_admin', 'active', ?, ?)`,
    [crypto.randomUUID(), adminEmail, await pbkdf2Hash(adminPassword), now, now]
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
// Phase 2 demo content (idempotent: keyed by fixed slugs)
// ---------------------------------------------------------------------------
const videoSettings = { provider: "mock", playbackTokenTtlSeconds: 45, fileUrlTtlSeconds: 120 };
await exec(`INSERT INTO settings (key, value, updated_at) VALUES ('video', ?, ?) ON CONFLICT(key) DO NOTHING`, [
  JSON.stringify(videoSettings),
  now,
]);

async function ensureContent(table, slug, cols) {
  const found = slug ? await DB.prepare(`SELECT id FROM ${table} WHERE slug = ?`).bind(slug).first() : null;
  if (found) return found.id;
  const id = cols.id ?? crypto.randomUUID();
  await exec(
    `INSERT INTO ${table} (${Object.keys(cols).join(",")}) VALUES (${Object.keys(cols).map(() => "?").join(",")})`,
    Object.values(cols).map((v) => (v === undefined ? null : v))
  );
  return id;
}

const programId = await ensureContent("programs", "al-Thanawiya-al-3amma", {
  id: crypto.randomUUID(),
  slug: "al-Thanawiya-al-3amma",
  title_ar: "الثانوية العامة",
  title_en: "General Secondary",
  status: "published",
  sort_order: 0,
  created_at: now,
  updated_at: now,
});
const gradeId = await ensureContent("grades", "grade-3-secondary", {
  id: crypto.randomUUID(),
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
  id: crypto.randomUUID(),
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
  id: crypto.randomUUID(),
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
  id: crypto.randomUUID(),
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
  unitId = crypto.randomUUID();
  await exec(
    `INSERT INTO units (id, course_id, title_ar, title_en, status, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [unitId, courseId, "الوحدة الأولى: الكهرباء الساكنة", "Unit 1: Electrostatics", "published", 0, now, now]
  );
}
const lesson1Id = await ensureContent("lessons", "electrostatics-intro", {
  id: crypto.randomUUID(),
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
  id: crypto.randomUUID(),
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
  videoId = crypto.randomUUID();
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
const demoPdfId = crypto.randomUUID();
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
    `INSERT INTO files (id, r2_key, bucket, kind, original_filename, mime, byte_size, checksum_sha256, visibility, download_allowed, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [demoPdfId, pdfKey, "PRIVATE_FILES", "pdf", "physics-revision.pdf", "application/pdf", pdf.length, "seed-demo", "private", 1, now]
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
  const id = crypto.randomUUID();
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
  demoExamId = crypto.randomUUID();
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
  id: crypto.randomUUID(),
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

console.log("Seed complete.");
console.log(`  super admin : ${adminEmail} / ${adminPassword}`);
console.log(`  demo student: student@educore.local / Student#12345`);
console.log(`  demo course : /courses/physics-3s-full (lesson 1 free preview, lesson 2 entitled)`);
console.log(`  demo exam   : /exams/electrostatics-check (lesson 2, required exam item)`);
console.log(`  demo product: /products/physics-3s-full-access (300.00 EGP, manual rail)`);

await proxy.dispose();
