#!/usr/bin/env node
/**
 * W5 — Backup (D1 + R2) for the backup/restore rehearsal.
 *
 * Produces a self-contained backup directory (gitignored `backups/`) containing:
 *   d1.sql                     full D1 logical export (schema + data + migrations)
 *   r2/<bucket>/<sha256>       R2 object bytes, content-addressed
 *   manifest.json              inventory: tables+row counts, R2 keys+sha256+size,
 *                              git commit, source env, scope/exclusions
 *
 * SAFETY
 *   - local (default): uses wrangler's local miniflare state (.wrangler/state/v3).
 *   - remote: requires EDUCORE_ALLOW_REMOTE=1 (Cloudflare credentials). Without
 *     credentials this sandbox cannot reach remote, so remote is owner-assisted.
 *   - Never prints or stores secrets; the backup contains no .dev.vars content.
 *   - Output lives under gitignored `backups/` so it never enters Git.
 *
 * USAGE
 *   node scripts/backup.mjs                     # → backups/<timestamp>/
 *   node scripts/backup.mjs --out <dir>
 *   node scripts/backup.mjs --target remote     # owner-assisted (needs creds)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  TABLES, MIGRATION_TABLE, R2_BUCKETS, sha256Hex, timestampSlug, validateBackupTarget,
} from "./backup-lib.mjs";

const ROOT = resolve(process.cwd());

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const target = process.argv.includes("--remote") ? "remote" : "local";
const guard = validateBackupTarget(target, { allowRemote: process.env.EDUCORE_ALLOW_REMOTE === "1" });
if (!guard.ok) {
  console.error(`✗ ${guard.reason}`);
  process.exit(2);
}

if (target === "remote") {
  console.error(
    "✗ Remote backup is documented (docs/BACKUP-RESTORE.md) but not executable here: " +
      "no Cloudflare credentials are available in this sandbox. Owner-assisted."
  );
  process.exit(2);
}

const outDir = resolve(ROOT, arg("out", `backups/${timestampSlug()}`));
mkdirSync(join(outDir, "r2"), { recursive: true });

console.log(`· backup target: ${target} (local miniflare state)`);
console.log(`· output dir   : ${outDir}`);

// ── D1 export ────────────────────────────────────────────────────────────────
// Three artifacts:
//   d1.sql         full export (schema + data + migrations) — canonical record
//   d1-schema.sql  --no-data  (schema + indexes + d1_migrations table)
//   d1-data.sql    --no-schema (INSERTs only, incl. d1_migrations + role_permissions)
// Restore replays schema first, then data — the full export's interleaved
// CREATE/INSERT order otherwise trips FK schema resolution on replay
// ("no such table: main.users") and can't be replayed in one pass.
const d1Full = join(outDir, "d1.sql");
const d1Schema = join(outDir, "d1-schema.sql");
const d1Data = join(outDir, "d1-data.sql");
const exportArgs = (flag) =>
  ["scripts/nw.mjs", "wrangler", "d1", "export", "DB", "--local", ...(flag ? [flag] : []), "--output"];
for (const [file, flag] of [[d1Full, null], [d1Schema, "--no-data"], [d1Data, "--no-schema"]]) {
  const e = spawnSync("node", [...exportArgs(flag), file, "-y"], { cwd: ROOT, stdio: "inherit" });
  if (e.status !== 0) {
    console.error(`✗ wrangler d1 export ${flag ?? ""} failed`);
    process.exit(e.status ?? 1);
  }
}
console.log("✓ D1 exported → d1.sql + d1-schema.sql + d1-data.sql");

// ── local bindings (same state wrangler dev uses) ────────────────────────────
const { getPlatformProxy } = await import("wrangler");
const proxy = await getPlatformProxy();
const env = proxy.env;
const db = env.DB;

// ── D1 row-count inventory ───────────────────────────────────────────────────
const tables = {};
for (const t of [MIGRATION_TABLE, ...TABLES]) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).first();
  tables[t] = Number(r.c);
}

// ── R2 metadata from D1 (authoritative: files + videos tables) ───────────────
const mimeByKey = {};
const fileRows = (await db.prepare("SELECT r2_key, mime FROM files").all()).results;
for (const f of fileRows) mimeByKey[f.r2_key] = f.mime;
const videoRows = (await db.prepare("SELECT master_r2_key FROM videos WHERE master_r2_key IS NOT NULL").all()).results;
for (const v of videoRows) if (v.master_r2_key) mimeByKey[v.master_r2_key] = "video/mp4";

// ── R2 object backup ─────────────────────────────────────────────────────────
const r2 = {};
for (const bucket of R2_BUCKETS) {
  const b = env[bucket];
  const bucketDir = join(outDir, "r2", bucket);
  mkdirSync(bucketDir, { recursive: true });
  const { objects } = await b.list();
  const entries = [];
  for (const o of objects) {
    const body = await b.get(o.key);
    const bytes = new Uint8Array(await body.arrayBuffer());
    const sha = await sha256Hex(bytes);
    writeFileSync(join(bucketDir, sha), bytes);
    entries.push({
      key: o.key,
      sha256: sha,
      size: o.size,
      etag: o.etag,
      contentType: mimeByKey[o.key] ?? null,
    });
  }
  r2[bucket] = entries;
  console.log(`✓ R2 ${bucket}: ${entries.length} object(s) backed up`);
}

// ── manifest ─────────────────────────────────────────────────────────────────
let gitCommit = null;
try {
  gitCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" })
    .stdout.trim() || null;
} catch { /* not a git checkout — omit */ }

const manifest = {
  created_at: new Date().toISOString(),
  source: "local-miniflare",
  target,
  git_commit: gitCommit,
  scope: {
    d1: { tables: [MIGRATION_TABLE, ...TABLES], row_counts: tables },
    r2: R2_BUCKETS.map((b) => ({ bucket: b, objects: r2[b] })),
  },
  exclusions: [
    "No .dev.vars / secret values are stored.",
    "R2 httpMetadata is reconstructed from D1 files.mime (local sim does not round-trip it).",
    "Remote R2 bulk export (wrangler r2 object get --remote per key) is owner-assisted.",
  ],
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log("\n✓ Backup complete.");
console.log("  D1 tables inventoried:", Object.keys(tables).length);
console.log("  R2 objects          :", R2_BUCKETS.reduce((n, b) => n + r2[b].length, 0));
console.log("  manifest            : manifest.json");

await proxy.dispose();
