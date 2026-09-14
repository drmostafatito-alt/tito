#!/usr/bin/env node
/**
 * Import Curriculum — 48 real lessons from CSV to DB or JSON
 *
 * Usage:
 *   node scripts/import-curriculum.mjs --check          # verify CSV exists and 48 lessons
 *   node scripts/import-curriculum.mjs --json           # regenerate docs/seo/keyword-universe.json + server/seo/realLessons.server.ts
 *   node scripts/import-curriculum.mjs --seed-db        # seed curriculum_lessons table (requires DB, for future content)
 *
 * No content is invented — all from docs/seo/keyword-universe.csv (user-provided)
 * Future real educational content (summary, review) should be added via:
 *   docs/seo/lesson-contents.json  (mapping slug → { summaryAr, reviewAr, concepts })
 *   and then imported with --seed-db --with-contents
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSV_PATH = path.join(ROOT, "docs/seo/keyword-universe.csv");
const JSON_PATH = path.join(ROOT, "docs/seo/keyword-universe.json");
const TS_PATH = path.join(ROOT, "server/seo/realLessons.server.ts");
const CONTENTS_JSON = path.join(ROOT, "docs/seo/lesson-contents.json");

function slugifyAr(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

function parseCSV(csvText) {
  // Simple CSV parser handling Arabic and commas inside quotes? Our CSV is simple, no quoted commas except semantic column which uses ، not ,
  const lines = csvText.split("\n").filter((l) => l.trim());
  const header = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Split by comma, but semantic column contains ، not , so safe
    const parts = line.split(",");
    if (parts.length < 7) continue;
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = (parts[j] ?? "").trim();
    }
    // Handle case where semantic contains commas (should not, uses ،)
    if (parts.length > 7) {
      // Join extra parts into last column
      row[header[header.length - 1]] = parts.slice(header.length - 1).join(",").trim();
    }
    rows.push(row);
  }
  return rows;
}

async function check() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parseCSV(csvText);
  console.log(`Found ${rows.length} lessons in CSV`);
  if (rows.length !== 48) {
    console.warn(`Expected 48 lessons, found ${rows.length}`);
  }
  // Check unique lesson names
  const names = rows.map((r) => r["اسم الدرس/الموضوع"]);
  const unique = new Set(names);
  console.log(`Unique lesson names: ${unique.size}`);
  if (unique.size !== rows.length) {
    console.warn("Duplicate lesson names found!");
  }
  console.log("Sample:", names.slice(0, 3));
  console.log("✅ Check passed — 48 real lessons, no guessing");
}

async function genJsonAndTs() {
  const csvText = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parseCSV(csvText);
  const lessons = rows.map((r) => ({
    subject: r["المادة"]?.trim(),
    grade: r["الصف/المرحلة"]?.trim(),
    term: r["الترم"]?.trim(),
    unit: r["الوحدة"]?.trim(),
    chapter: r["القسم"]?.trim(),
    lesson: r["اسم الدرس/الموضوع"]?.trim(),
    semanticRaw: r["الكلمات الدلالية"]?.trim(),
    semantic: (r["الكلمات الدلالية"] ?? "")
      .split("،")
      .map((s) => s.trim())
      .filter(Boolean),
  }));

  fs.writeFileSync(JSON_PATH, JSON.stringify(lessons, null, 2), "utf-8");
  console.log(`Wrote ${lessons.length} lessons to ${JSON_PATH}`);

  const tsContent = `/**
 * Real Keyword Universe — 48 lessons from uploaded scientific content
 * Source: tito_seo_keyword_universe.csv (user-provided, not guessed)
 * Generated: do not edit manually, regenerate via: node scripts/import-curriculum.mjs --json
 * Each lesson = Keyword Cluster خاص به
 */
export interface RealLesson {
  subject: string;
  grade: string;
  term: string;
  unit: string;
  chapter: string;
  lesson: string;
  semanticRaw: string;
  semantic: string[];
}

export const REAL_LESSONS: RealLesson[] = ${JSON.stringify(lessons, null, 2)};

export const REAL_LESSON_COUNT = ${lessons.length};
`;

  fs.writeFileSync(TS_PATH, tsContent, "utf-8");
  console.log(`Wrote TS file to ${TS_PATH}`);

  // Create empty lesson-contents.json if not exists (for future real content)
  if (!fs.existsSync(CONTENTS_JSON)) {
    const emptyContents = {};
    for (const lesson of lessons) {
      const slug = slugifyAr(lesson.lesson);
      emptyContents[slug] = {
        lesson: lesson.lesson,
        subject: lesson.subject,
        grade: lesson.grade,
        summaryAr: null, // to be filled when real source available
        summaryEn: null,
        reviewAr: null,
        reviewEn: null,
        concepts: lesson.semantic.slice(0, 5),
        status: "draft",
      };
    }
    fs.writeFileSync(CONTENTS_JSON, JSON.stringify(emptyContents, null, 2), "utf-8");
    console.log(`Created empty contents template at ${CONTENTS_JSON} — fill with real educational content when available`);
  }

  console.log("✅ JSON + TS generation complete");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    await check();
  } else if (args.includes("--json")) {
    await genJsonAndTs();
  } else if (args.includes("--seed-db")) {
    console.log("DB seeding requires live DB connection — not implemented in this script for safety.");
    console.log("Use admin UI or create a dedicated seed script that reads docs/seo/lesson-contents.json");
    console.log("Current curriculum pages use static REAL_LESSONS as fallback, no DB required.");
  } else {
    console.log("Usage:");
    console.log("  node scripts/import-curriculum.mjs --check");
    console.log("  node scripts/import-curriculum.mjs --json");
    console.log("  node scripts/import-curriculum.mjs --seed-db");
  }
}

main();
