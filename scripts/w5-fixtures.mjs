#!/usr/bin/env node
/**
 * W5 rehearsal fixtures — deterministic synthetic data used ONLY to prove the
 * backup/restore round-trip. Inserts markers across the major domains so the
 * restore verification can assert beyond the base seed:
 *   - a synthetic student (users)
 *   - a synthetic announcement (announcements)
 *   - a synthetic exam attempt + answers (exam_attempts / exam_answers)
 *   - a synthetic order + payment (orders / payments)
 *   - a synthetic lesson progress row (lesson_progress)
 *   - a synthetic R2 object in PUBLIC_ASSETS (a tiny PNG)
 *
 * Idempotent: keyed by deterministic slugs/emails. LOCAL-DEV ONLY (never
 * production) — same guard class as scripts/seed.mjs.
 *
 * USAGE: node scripts/w5-fixtures.mjs
 */
import { getPlatformProxy } from "wrangler";

const proxy = await getPlatformProxy();
const env = proxy.env;
const db = env.DB;
const now = Date.now();

const STUDENT_EMAIL = "w5-synthetic-student@test.local";
const STUDENT_FULLNAME = "W5 Synthetic Student";
const ANNOUNCE_TITLE = "W5 synthetic announcement";
const ORDER_NUMBER = "EC-W5-SYNTH-001";
const R2_KEY = "public/image/w5-synthetic/w5-pixel.png";

const exec = (sql, params = []) => db.prepare(sql).bind(...params).run();

// roles must exist (seed provides them); ensure student role present
await exec(`INSERT OR IGNORE INTO roles (id, label, rank) VALUES ('student','Student',1)`);

// 1) synthetic student
let studentId = (await db.prepare("SELECT id FROM users WHERE email = ?").bind(STUDENT_EMAIL).first())?.id;
if (!studentId) {
  studentId = crypto.randomUUID();
  await exec(
    `INSERT INTO users (id, email, password_hash, full_name, locale_pref, role_id, status, created_at, updated_at)
     VALUES (?, ?, 'w5-fake-hash', ?, 'en', 'student', 'active', ?, ?)`,
    [studentId, STUDENT_EMAIL, STUDENT_FULLNAME, now, now]
  );
}

// 2) synthetic announcement (published)
const annId = (await db.prepare("SELECT id FROM announcements WHERE title_en = ?").bind(ANNOUNCE_TITLE).first())?.id;
if (!annId) {
  await exec(
    `INSERT INTO announcements (id, title_ar, title_en, body_ar, body_en, audience, status, publish_at, published_at, created_at, updated_at)
     VALUES (?, 'إعلان W5', ?, '', 'W5 synthetic announcement body', 'all', 'published', ?, ?, ?, ?)`,
    [crypto.randomUUID(), ANNOUNCE_TITLE, now, now, now, now]
  );
}

// 3) synthetic lesson progress (use the seeded demo lesson via its slug)
const lesson = (await db.prepare("SELECT id FROM lessons WHERE slug = ?").bind("electrostatics-intro").first())
  ?? (await db.prepare("SELECT id FROM lessons LIMIT 1").first());
if (lesson) {
  await exec(
    `INSERT OR IGNORE INTO lesson_progress (id, student_id, lesson_id, status, completed_at, last_activity_at, created_at, updated_at)
     VALUES (?, ?, ?, 'in_progress', NULL, ?, ?, ?)`,
    [crypto.randomUUID(), studentId, lesson.id, now, now, now]
  );
}

// 4) synthetic exam attempt + answer (use the seeded demo exam via its slug)
const exam = (await db.prepare("SELECT id FROM exams WHERE slug = ?").bind("electrostatics-check").first())
  ?? (await db.prepare("SELECT id FROM exams LIMIT 1").first());
if (exam) {
  const attemptId = crypto.randomUUID();
  await exec(
    `INSERT OR IGNORE INTO exam_attempts (id, exam_id, student_id, attempt_number, status, started_at, deadline_at, submitted_at, time_used_seconds, score, max_score, passed, grading_status, random_seed, metadata)
     VALUES (?, ?, ?, 1, 'submitted', ?, ?, ?, 60, 3, 3, 1, 'auto', 0, '{"w5":"synthetic"}')`,
    [attemptId, exam.id, studentId, now, now + 60_000, now]
  );
  const q = (await db.prepare("SELECT question_id FROM exam_questions WHERE exam_id = ? LIMIT 1").bind(exam.id).first());
  if (q) {
    await exec(
      `INSERT OR IGNORE INTO exam_answers (id, attempt_id, question_id, choice_ids, points_earned, is_correct, version, updated_at)
       VALUES (?, ?, ?, NULL, 1, 1, 1, ?)`,
      [crypto.randomUUID(), attemptId, q.question_id, now]
    );
  }
}

// 5) synthetic order + payment (test data; readiness gate flags non-EC-prefixed? no — EC- prefix is the real pattern; this is local-only)
const orderId = (await db.prepare("SELECT id FROM orders WHERE order_number = ?").bind(ORDER_NUMBER).first())?.id;
if (!orderId) {
  const oid = crypto.randomUUID();
  await exec(
    `INSERT INTO orders (id, order_number, student_id, status, currency, subtotal_minor, discount_minor, total_minor, source, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 'EGP', 0, 0, 0, 'test', ?, ?)`,
    [oid, ORDER_NUMBER, studentId, now, now]
  );
  await exec(
    `INSERT INTO payments (id, order_id, provider, method, amount_minor, currency, status, reference, created_at, updated_at)
     VALUES (?, ?, 'manual', 'test', 0, 'EGP', 'pending', 'W5-SYNTH', ?, ?)`,
    [crypto.randomUUID(), oid, now, now]
  );
}

// 6) synthetic R2 object in PUBLIC_ASSETS (a 1×1 PNG) + a files row
const existingFile = await db.prepare("SELECT id FROM files WHERE r2_key = ?").bind(R2_KEY).first();
if (!existingFile) {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff030000060005579bf41f0000000049454e44ae426082",
    "hex"
  );
  await env.PUBLIC_ASSETS.put(R2_KEY, png, { httpMetadata: { contentType: "image/png" } });
  await exec(
    `INSERT INTO files (id, r2_key, bucket, kind, original_filename, mime, byte_size, checksum_sha256, visibility, download_allowed, created_at)
     VALUES (?, ?, 'PUBLIC_ASSETS', 'image', 'w5-pixel.png', 'image/png', ?, 'w5-synthetic', 'public', 0, ?)`,
    [crypto.randomUUID(), R2_KEY, png.length, now]
  );
}

console.log("✓ W5 synthetic fixtures installed:");
console.log(`  student      : ${STUDENT_EMAIL}`);
console.log(`  announcement : ${ANNOUNCE_TITLE}`);
console.log(`  order        : ${ORDER_NUMBER}`);
console.log(`  r2 object    : ${R2_KEY}`);

await proxy.dispose();
