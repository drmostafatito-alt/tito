#!/usr/bin/env node
/**
 * Pre-deploy production safety check (Phase 3, owner brief §PRODUCTION CONTENT).
 * FAILS (exit 1) when the target database contains anything that must never
 * reach production: demo/seed/smoke accounts, seed or smoke content, mock
 * video provider, placeholder media, unreplaced template branding, missing
 * owner identity, lorem-ipsum in published CMS snapshots, unapplied
 * migrations, missing CMS permission grants, or no active super admin.
 *
 * Production starts CONTENT-EMPTY except minimum system config — this script
 * is the enforcement gate (DEPLOYMENT.md §pre-deploy).
 *
 * Usage:
 *   node scripts/check-production-readiness.mjs            # local wrangler state
 *   node scripts/check-production-readiness.mjs --remote   # production D1 (wrangler remote)
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REMOTE = process.argv.includes("--remote");

let query; // (sql) => Promise<row | null>
let queryAll; // (sql) => Promise<rows[]>

if (REMOTE) {
  const wranglerCfg = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/\/\/[^\n"]*/g, ""));
  const dbName = process.env.D1_NAME ?? wranglerCfg.d1_databases?.[0]?.database_name;
  if (!dbName) {
    console.error("No D1 database_name found in wrangler.jsonc (set D1_NAME env for production).");
    process.exit(2);
  }
  const run = (sql) => {
    const res = spawnSync("npx", ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (res.status !== 0) throw new Error(`wrangler d1 execute failed: ${res.stderr?.slice(0, 400)}`);
    const parsed = JSON.parse(res.stdout);
    return parsed?.[0]?.results ?? [];
  };
  queryAll = async (sql) => run(sql);
  query = async (sql) => (await queryAll(sql))[0] ?? null;
} else {
  const { getPlatformProxy } = await import("wrangler");
  // wrangler --persist-to X stores state under X/v3; getPlatformProxy().persist.path expects that dir.
  const persist = process.env.PERSIST_DIR ? { path: `${process.env.PERSIST_DIR.replace(/\/$/, "")}/v3` } : undefined;
  const proxy = await getPlatformProxy(persist ? { persist } : {});
  const DB = proxy.env.DB;
  queryAll = async (sql) => {
    const res = await DB.prepare(sql).all();
    return res.results ?? [];
  };
  query = async (sql) => (await queryAll(sql))[0] ?? null;
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

async function settingsValue(key) {
  const row = await query(`SELECT value FROM settings WHERE key = '${key}'`);
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

async function count(sql) {
  const row = await query(sql);
  return Number(row?.n ?? 0);
}

// 1) demo/seed/smoke accounts + test credentials
const badUsers = await count(
  `SELECT COUNT(*) n FROM users WHERE email LIKE '%@educore.local' OR email LIKE 'smoke-%'
     OR full_name IN ('Super Admin', 'طالب تجريبي')`
);
check("no demo/seed/smoke accounts", badUsers === 0, `${badUsers} found`);

// 2) seed + smoke content rows
const seedSlugs = {
  programs: ["al-Thanawiya-al-3amma"],
  grades: ["grade-3-secondary"],
  subjects: ["physics-3s"],
  courses: ["physics-3s-full", "study-skills"],
  lessons: ["electrostatics-intro", "coulomb-law"],
};
let badContent = 0;
for (const [table, slugs] of Object.entries(seedSlugs)) {
  const list = slugs.map((s) => `'${s}'`).join(",");
  badContent += await count(`SELECT COUNT(*) n FROM ${table} WHERE slug IN (${list}) OR slug LIKE 'smoke-%'`);
}
const smokePrograms = await count(`SELECT COUNT(*) n FROM programs WHERE title_en LIKE 'Smoke Program%'`);
badContent += smokePrograms;
const cmsSmoke = await count(
  `SELECT COUNT(*) n FROM pages WHERE slug LIKE 'smoke-%' OR title_en LIKE 'Smoke %'`
) + await count(
  `SELECT COUNT(*) n FROM forms WHERE slug LIKE 'smoke-%' OR title_en LIKE 'Smoke %'`
) + await count(
  `SELECT COUNT(*) n FROM menu_items WHERE href LIKE '%smoke-%' OR label_en LIKE 'Smoke%'`
);
badContent += cmsSmoke;
// Phase 5: seeded demo exam + question bank rows must never reach production
badContent += await count(
  `SELECT COUNT(*) n FROM exams WHERE slug = 'electrostatics-check' OR slug LIKE 'smoke-%' OR title_en LIKE 'Smoke %'`
) + await count(
  `SELECT COUNT(*) n FROM questions WHERE stem_en IN ('Coulomb force is proportional to…', 'The unit of electric charge is the coulomb.') OR stem_en LIKE 'Smoke %'`
) + await count(
  `SELECT COUNT(*) n FROM tags WHERE slug LIKE 'smoke-%'`
);
// Phase 6: demo commerce catalog rows (seeded product / smoke products)
badContent += await count(
  `SELECT COUNT(*) n FROM products WHERE slug = 'physics-3s-full-access' OR slug LIKE 'smoke-%' OR name_en LIKE 'Smoke %'`
);
check("no seed/smoke content rows (incl. CMS + assessment + commerce catalog)", badContent === 0, `${badContent} found`);

// 2b) commerce transactional hygiene: the mock gateway and demo-account orders must never exist in production
const mockPayments = await count(`SELECT COUNT(*) n FROM payments WHERE provider = 'mock'`);
const demoOrders = await count(
  `SELECT COUNT(*) n FROM orders o JOIN users u ON u.id = o.student_id
    WHERE u.email LIKE '%@educore.local' OR u.email LIKE 'smoke-%' OR u.email LIKE '%@test.local'`
);
const demoBatches = await count(
  `SELECT COUNT(*) n FROM activation_code_batches WHERE name LIKE 'Smoke%' OR name LIKE '%smoke%' OR note LIKE '%smoke%'`
);
check(
  "no mock-gateway payments / demo-account orders / smoke code batches",
  mockPayments === 0 && demoOrders === 0 && demoBatches === 0,
  `mockPayments=${mockPayments} demoOrders=${demoOrders} demoBatches=${demoBatches}`
);

// 3) mock video provider / mock-data references in settings
const video = await settingsValue("video");
check("video provider is not mock", (video?.provider ?? "mock") !== "mock", `provider=${video?.provider ?? "(unset→mock)"}`);

// 4) placeholder media
const badFiles = await count(
  `SELECT COUNT(*) n FROM files WHERE lower(original_filename) LIKE 'placeholder%'
     OR lower(original_filename) LIKE 'demo%' OR lower(original_filename) LIKE 'sample%'
     OR lower(original_filename) LIKE 'smoke%' OR lower(original_filename) LIKE 'lorem%'`
);
check("no placeholder/demo media files", badFiles === 0, `${badFiles} found`);

// 5) template branding must be replaced
const platform = await settingsValue("platform");
const templateName = !platform || platform.nameEn === "EduCore" || platform.nameAr === "منصة إيدوكور";
check("platform identity configured (not template default)", !templateName, templateName ? "name still template default/unset" : "");

// 6) owner identity required (owner-centric platform)
const identity = await settingsValue("identity");
const ownerMissing = !identity || (!(identity.ownerNameAr ?? "").trim() && !(identity.ownerNameEn ?? "").trim());
check("owner identity configured", !ownerMissing, ownerMissing ? "identity.ownerName empty/unset" : "");

// 7) lorem-ipsum in published CMS snapshots
const loremPages = await count(
  `SELECT COUNT(*) n FROM pages WHERE status = 'published' AND lower(published_snapshot) LIKE '%lorem ipsum%'`
);
check("no lorem-ipsum in published pages", loremPages === 0, `${loremPages} page(s)`);

// 8) migrations applied (schema + permission seed)
const migrations = await count(`SELECT COUNT(*) n FROM d1_migrations`);
const expectedMigrations = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries.length;
check("all migrations applied", migrations >= expectedMigrations, `${migrations}/${expectedMigrations}`);

// 9) CMS permission grants seeded for admin role
const perms = await count(`SELECT COUNT(*) n FROM role_permissions WHERE role_id = 'admin'`);
check("admin CMS + assessment + commerce permissions seeded", perms >= 22, `${perms}/22`);

// 10) administrable: at least one active super_admin
const supers = await count(
  `SELECT COUNT(*) n FROM users WHERE role_id = 'super_admin' AND status = 'active' AND deleted_at IS NULL`
);
check("at least one active super admin", supers >= 1, `${supers} found`);

// report
const failed = results.filter((r) => !r.ok);
console.log(`\nProduction readiness (${REMOTE ? "REMOTE" : "local"}):`);
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
if (failed.length) {
  console.error(`\n✗ ${failed.length} check(s) failed — DO NOT deploy/launch until resolved.`);
  process.exit(1);
}
console.log("\n✓ production readiness checks passed.");
process.exit(0);
