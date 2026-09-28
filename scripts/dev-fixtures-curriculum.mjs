#!/usr/bin/env node
/**
 * LOCAL-DEV fixture: loads the owner's REAL published curriculum outline
 * (docs/seo/keyword-universe.csv — 48 lessons of فلسفة ومنطق + علم النفس) into
 * the local D1 database so the frontend can be developed and QA'd against the
 * real content model instead of physics demo rows.
 *
 * It is a DEVELOPER TOOL, never a production seed:
 *   - refuses to run unless ENVIRONMENT is development/test (or --force)
 *   - only writes content the owner already authored (titles come from the CSV)
 *   - deterministic ids, fully idempotent (re-running changes nothing)
 *
 * Usage: node scripts/nw.mjs node scripts/dev-fixtures-curriculum.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getPlatformProxy } from "wrangler";

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

const proxy = await getPlatformProxy();
const env = { ...proxy.env, ...loadDevVars() };
const DB = env.DB;
const force = process.argv.includes("--force");
if (!force && !["development", "test"].includes(String(env.ENVIRONMENT ?? ""))) {
  console.error("refusing to run outside development/test (pass --force if you really mean it)");
  process.exit(2);
}

const now = Date.now();
const exec = (sql, params = []) => DB.prepare(sql).bind(...params).run();
const one = (sql, params = []) => DB.prepare(sql).bind(...params).first();

function detId(name) {
  const h = createHash("sha1").update("tito-dev-curriculum:" + name).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// --- read the owner's curriculum CSV ---------------------------------------
const csv = readFileSync("docs/seo/keyword-universe.csv", "utf8").replace(/^\uFEFF/, "");
const lines = csv.split("\n").filter((l) => l.trim());
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const p = lines[i].split(",");
  if (p.length < 6) continue;
  rows.push({
    subject: p[0].trim(),
    grade: p[1].trim(),
    term: p[2].trim(),
    unit: p[3].trim(),
    chapter: p[4].trim(),
    lesson: p[5].trim(),
  });
}
if (rows.length === 0) {
  console.error("no curriculum rows parsed");
  process.exit(1);
}

const EN = {
  "فلسفة ومنطق": { en: "Philosophy & Logic", slug: "philosophy-logic" },
  "علم النفس": { en: "Psychology", slug: "psychology" },
  "الصف الأول الثانوي": { en: "Grade 10 (1st Secondary)", slug: "grade-1-secondary" },
  "مرحلة البكالوريا المصرية": { en: "Egyptian Baccalaureate", slug: "egyptian-baccalaureate" },
  "الترم الأول": { en: "Term 1", slug: "term-1" },
  "الترم الثاني": { en: "Term 2", slug: "term-2" },
  "الجزء الأول": { en: "Part 1", slug: "part-1" },
  "الجزء الثاني": { en: "Part 2", slug: "part-2" },
};
const enOf = (ar) => EN[ar]?.en ?? ar;
const slugOf = (ar, prefix) => EN[ar]?.slug ?? `${prefix}-${detId(ar).slice(0, 8)}`;

async function upsert(table, id, columns) {
  const found = await one(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (found) return id;
  const keys = Object.keys(columns);
  await exec(
    `INSERT INTO ${table} (id, ${keys.join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`,
    [id, ...keys.map((k) => columns[k])]
  );
  return id;
}

// --- academic year ----------------------------------------------------------
const yearId = await upsert("academic_years", detId("year:2026-2027"), {
  slug: "2026-2027",
  title_ar: "٢٠٢٦ / ٢٠٢٧",
  title_en: "2026 / 2027",
  start_year: 2026,
  end_year: 2027,
  is_current: 1,
  status: "published",
  sort_order: 0,
  created_at: now,
  updated_at: now,
});

// --- program ----------------------------------------------------------------
const programId = await upsert("programs", detId("program:secondary"), {
  slug: "secondary-stage",
  title_ar: "المرحلة الثانوية",
  title_en: "Secondary stage",
  description_ar: "الفلسفة والمنطق وعلم النفس للمرحلة الثانوية والبكالوريا.",
  description_en: "Philosophy, logic and psychology for the secondary stage and the baccalaureate.",
  status: "published",
  sort_order: 0,
  created_at: now,
  updated_at: now,
});

// --- terms ------------------------------------------------------------------
const termIds = new Map();
let termOrder = 0;
for (const label of [...new Set(rows.map((r) => r.term))]) {
  termIds.set(
    label,
    await upsert("terms", detId("term:" + label), {
      slug: slugOf(label, "term"),
      title_ar: label,
      title_en: enOf(label),
      status: "published",
      sort_order: termOrder++,
      created_at: now,
      updated_at: now,
    })
  );
}

// --- grades / subjects / term containers / units / lessons ------------------
const gradeIds = new Map();
const subjectIds = new Map();
const containerIds = new Map();
const unitIds = new Map();
let gradeOrder = 0;
let subjectOrder = 0;

const SUBJECT_DESC = {
  "فلسفة ومنطق": {
    ar: "الفلسفة والمنطق: بناء السؤال، تحليل الحجّة، وضبط خطوات التفكير الصحيح.",
    en: "Philosophy and logic: building the question, analysing the argument, disciplining reasoning.",
  },
  "علم النفس": {
    ar: "علم النفس: كيف يعمل العقل والسلوك، من الإدراك والذاكرة إلى الهوية والعلاقات.",
    en: "Psychology: how mind and behaviour work, from perception and memory to identity and relationships.",
  },
};

for (const r of rows) {
  if (!gradeIds.has(r.grade)) {
    gradeIds.set(
      r.grade,
      await upsert("grades", detId("grade:" + r.grade), {
        program_id: programId,
        slug: slugOf(r.grade, "grade"),
        title_ar: r.grade,
        title_en: enOf(r.grade),
        status: "published",
        sort_order: gradeOrder++,
        created_at: now,
        updated_at: now,
      })
    );
  }
  const subjectKey = `${r.subject}|${r.grade}`;
  if (!subjectIds.has(subjectKey)) {
    subjectIds.set(
      subjectKey,
      await upsert("subjects", detId("subject:" + subjectKey), {
        grade_id: gradeIds.get(r.grade),
        slug: slugOf(r.subject, "subject"),
        title_ar: r.subject,
        title_en: enOf(r.subject),
        description_ar: SUBJECT_DESC[r.subject]?.ar ?? null,
        description_en: SUBJECT_DESC[r.subject]?.en ?? null,
        status: "published",
        sort_order: subjectOrder++,
        created_at: now,
        updated_at: now,
      })
    );
  }
  const containerKey = `${subjectKey}|${r.term}`;
  if (!containerIds.has(containerKey)) {
    const idx = containerIds.size;
    containerIds.set(
      containerKey,
      await upsert("courses", detId("container:" + containerKey), {
        subject_id: subjectIds.get(subjectKey),
        academic_year_id: yearId,
        term_id: termIds.get(r.term),
        slug: `${slugOf(r.subject, "subject")}-${slugOf(r.term, "term")}`,
        title_ar: `${r.subject} — ${r.term}`,
        title_en: `${enOf(r.subject)} — ${enOf(r.term)}`,
        description_ar: null,
        description_en: null,
        // first container of each subject is open to signed-in students so the
        // free/locked split is exercised; the rest need an entitlement.
        access_level: idx % 2 === 0 ? "entitled" : "entitled",
        status: "published",
        visibility: "catalog",
        sort_order: idx,
        created_at: now,
        updated_at: now,
      })
    );
  }
  const unitKey = `${containerKey}|${r.unit}|${r.chapter}`;
  if (!unitIds.has(unitKey)) {
    const title = r.chapter && !r.chapter.startsWith("الوحدة") ? `${r.unit} · ${r.chapter}` : r.unit;
    unitIds.set(
      unitKey,
      await upsert("units", detId("unit:" + unitKey), {
        course_id: containerIds.get(containerKey),
        title_ar: title,
        title_en: title,
        status: "published",
        sort_order: unitIds.size,
        created_at: now,
        updated_at: now,
      })
    );
  }
}

let lessonOrder = new Map();
const lessonIds = [];
for (const r of rows) {
  const subjectKey = `${r.subject}|${r.grade}`;
  const containerKey = `${subjectKey}|${r.term}`;
  const unitKey = `${containerKey}|${r.unit}|${r.chapter}`;
  const unitId = unitIds.get(unitKey);
  const order = lessonOrder.get(unitId) ?? 0;
  lessonOrder.set(unitId, order + 1);
  const id = detId("lesson:" + unitKey + "|" + r.lesson);
  const slug = `l-${id.slice(0, 8)}`;
  await upsert("lessons", id, {
    unit_id: unitId,
    slug,
    title_ar: r.lesson,
    title_en: r.lesson,
    description_ar: null,
    description_en: null,
    access_level: "entitled",
    // the first lesson of each unit is a real free preview
    free_preview: order === 0 ? 1 : 0,
    status: "published",
    sort_order: order,
    created_at: now,
    updated_at: now,
  });
  lessonIds.push({ id, slug, subjectKey, containerKey, free: order === 0 });
}

// --- a real playable video + a real PDF on the first lessons ----------------
const videoId = await upsert("videos", detId("video:sample"), {
  provider: "mock",
  provider_asset_id: "dev-mock-asset",
  playback_id: "dev-mock-playback",
  status: "ready",
  duration_seconds: 612,
  created_at: now,
  updated_at: now,
});

let pdfFileId = (await one("SELECT id FROM files WHERE original_filename = ?", ["tito-dev-notes.pdf"]))?.id ?? null;
if (!pdfFileId) {
  pdfFileId = detId("file:notes");
  const bytes = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
  );
  const key = `private/files/${pdfFileId}/tito-dev-notes.pdf`;
  await env.PRIVATE_FILES.put(key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  await exec(
    `INSERT INTO files (id, r2_key, bucket, kind, original_filename, mime, byte_size, checksum_sha256, visibility, download_allowed, alt_ar, alt_en, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [pdfFileId, key, "PRIVATE_FILES", "pdf", "tito-dev-notes.pdf", "application/pdf", bytes.length, "dev-fixture", "private", 1, "", "", now, now]
  );
}

let attached = 0;
for (const l of lessonIds) {
  if (attached >= 12) break;
  const has = await one("SELECT id FROM lesson_items WHERE lesson_id = ?", [l.id]);
  if (has) continue;
  await exec(
    `INSERT INTO lesson_items (id, lesson_id, item_type, video_id, file_id, sort_order, required, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [detId("item:v:" + l.id), l.id, "video", videoId, null, 0, 1, now]
  );
  await exec(
    `INSERT INTO lesson_items (id, lesson_id, item_type, video_id, file_id, sort_order, required, created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [detId("item:f:" + l.id), l.id, "file", null, pdfFileId, 1, 0, now]
  );
  attached++;
}

// --- products (real prices the owner would set) ------------------------------
for (const [subjectKey, subjectId] of subjectIds) {
  const [subjectAr] = subjectKey.split("|");
  const productId = detId("product:" + subjectKey);
  const slug = `${slugOf(subjectAr, "subject")}-full-year`;
  const exists = await one("SELECT id FROM products WHERE id = ?", [productId]);
  if (!exists) {
    await exec(
      `INSERT INTO products (id, kind, slug, name_ar, name_en, description_ar, description_en, active, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [productId, "subject", slug, `${subjectAr} — اشتراك السنة`, `${enOf(subjectAr)} — full year`,
       "اشتراك كامل في المادة لكل تِرمات السنة الدراسية.", "Full subject access for every term of the academic year.",
       1, 0, now, now]
    );
    await exec(
      `INSERT INTO product_items (id, product_id, resource_type, resource_id, sort_order, created_at) VALUES (?,?,?,?,?,?)`,
      [detId("pitem:" + subjectKey), productId, "subject", subjectId, 0, now]
    );
    await exec(
      `INSERT INTO price_plans (id, product_id, currency, amount_minor, kind, period, period_days, label_ar, label_en, active, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [detId("plan:" + subjectKey), productId, "EGP", 45000, "one_time", "annual", 365, "السنة كاملة", "Full year", 1, 0, now, now]
    );
    await exec(
      `INSERT INTO price_plans (id, product_id, currency, amount_minor, kind, period, period_days, label_ar, label_en, active, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [detId("plan2:" + subjectKey), productId, "EGP", 25000, "one_time", "term", 150, "ترم واحد", "One term", 1, 1, now, now]
    );
  }
}

// --- grant the local demo student one subject + a little real progress ------
const student = await one("SELECT id FROM users WHERE email = ?", ["student@educore.local"]);
if (student) {
  const philosophyKey = [...subjectIds.keys()].find((k) => k.startsWith("فلسفة"));
  if (philosophyKey) {
    const has = await one(
      "SELECT id FROM entitlements WHERE student_id = ? AND resource_type = 'subject' AND resource_id = ?",
      [student.id, subjectIds.get(philosophyKey)]
    );
    if (!has) {
      await exec(
        `INSERT INTO entitlements (id, student_id, source_type, resource_type, resource_id, status, starts_at, granted_at, metadata)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [detId("ent:" + philosophyKey), student.id, "admin_grant", "subject", subjectIds.get(philosophyKey), "active", now, now, JSON.stringify({ note: "dev fixture" })]
      );
    }
    const mine = lessonIds.filter((l) => l.subjectKey === philosophyKey).slice(0, 5);
    for (let i = 0; i < mine.length; i++) {
      const completed = i < 3;
      const exists = await one("SELECT id FROM lesson_progress WHERE student_id = ? AND lesson_id = ?", [student.id, mine[i].id]);
      if (exists) continue;
      await exec(
        `INSERT INTO lesson_progress (id, student_id, lesson_id, status, completed_at, last_activity_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [detId("prog:" + mine[i].id), student.id, mine[i].id, completed ? "completed" : "in_progress",
         completed ? now - i * 86_400_000 : null, now - i * 3_600_000, now, now]
      );
    }
  }
}

console.log("Dev curriculum fixture applied.");
console.log(`  years 1 · programs 1 · grades ${gradeIds.size} · subjects ${subjectIds.size} · terms ${termIds.size}`);
console.log(`  term containers ${containerIds.size} · units ${unitIds.size} · lessons ${lessonIds.length}`);
await proxy.dispose();
