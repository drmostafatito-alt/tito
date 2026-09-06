#!/usr/bin/env node
/**
 * W5 — Restore (D1 + R2) from a backup directory produced by scripts/backup.mjs.
 *
 * Restores:
 *   D1  → wipes the local D1 state, then replays d1.sql (schema + data +
 *         d1_migrations history) via `wrangler d1 execute --local --file`.
 *   R2  → deletes existing objects, then re-`put`s each object from the
 *         content-addressed files, reconstructing content-type from the
 *         manifest (originally sourced from D1 files.mime).
 * Then runs an integrity verification: D1 row counts vs the manifest, and R2
 * per-object sha256 vs the manifest.
 *
 * SAFETY (enforced, see scripts/backup-lib.mjs validateRestoreTarget):
 *   - Restore is destructive → requires --force.
 *   - `--remote` restore is REFUSED unless EDUCORE_ALLOW_UNSAFE_RESTORE=1 AND
 *     --force (production disaster drill only). Production restore is
 *     owner-assisted and out of scope for this rehearsal.
 *
 * USAGE
 *   node scripts/restore.mjs <backup-dir> --force
 */
import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { TABLES, MIGRATION_TABLE, R2_BUCKETS, sha256Hex, validateRestoreTarget } from "./backup-lib.mjs";

const ROOT = resolve(process.cwd());

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith("--"));
const backupDir = dirArg ? resolve(ROOT, dirArg) : null;
if (!backupDir || !existsSync(join(backupDir, "manifest.json"))) {
  console.error("✗ Usage: node scripts/restore.mjs <backup-dir> --force");
  process.exit(2);
}

const target = process.argv.includes("--remote") ? "remote" : "local";
const force = process.argv.includes("--force");
const guard = validateRestoreTarget(target, {
  allowUnsafeRestore: process.env.EDUCORE_ALLOW_UNSAFE_RESTORE === "1",
  force,
});
if (!guard.ok) {
  console.error(`✗ ${guard.reason}`);
  process.exit(2);
}
if (target === "remote") {
  console.error("✗ Remote restore is owner-assisted and not executable in this sandbox. Refusing.");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));

// ── D1 restore ───────────────────────────────────────────────────────────────
// Replay schema first, then data: the schema creates every table (and the
// d1_migrations tracker) before any INSERT runs, which avoids both (a) FK
// schema-resolution failures from the full export's interleaved order and
// (b) UNIQUE conflicts with the role_permissions seeded by migrations.
const d1Schema = join(backupDir, "d1-schema.sql");
const d1Data = join(backupDir, "d1-data.sql");
if (!existsSync(d1Schema) || !existsSync(d1Data)) {
  console.error("✗ backup is missing d1-schema.sql / d1-data.sql — cannot restore D1");
  process.exit(2);
}

console.log("· wiping local D1 state (.wrangler/state/v3/d1)…");
rmSync(join(ROOT, ".wrangler", "state", "v3", "d1"), { recursive: true, force: true });

for (const [file, label] of [[d1Schema, "schema"], [d1Data, "data"]]) {
  console.log(`· replaying d1 ${label} (${file})…`);
  const res = spawnSync(
    "node", ["scripts/nw.mjs", "wrangler", "d1", "execute", "DB", "--local", "--file", file, "-y"],
    { cwd: ROOT, stdio: "inherit" }
  );
  if (res.status !== 0) {
    console.error(`✗ wrangler d1 execute (${label}) failed`);
    process.exit(res.status ?? 1);
  }
}

// ── R2 restore ───────────────────────────────────────────────────────────────
const { getPlatformProxy } = await import("wrangler");
const proxy = await getPlatformProxy();
const env = proxy.env;

for (const bucket of R2_BUCKETS) {
  const b = env[bucket];
  const objects = manifest.scope.r2.find((x) => x.bucket === bucket)?.objects ?? [];
  // delete existing objects in this bucket
  const existing = await b.list();
  for (const o of existing.objects) await b.delete(o.key);
  // re-put from the backup
  for (const o of objects) {
    const bytes = readFileSync(join(backupDir, "r2", bucket, o.sha256));
    await b.put(o.key, bytes, o.contentType ? { httpMetadata: { contentType: o.contentType } } : undefined);
  }
  console.log(`✓ R2 ${bucket}: restored ${objects.length} object(s)`);
}

// ── integrity verification ───────────────────────────────────────────────────
const db = env.DB;
let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

console.log("\n· integrity verification…");
for (const t of [MIGRATION_TABLE, ...TABLES]) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).first();
  const expect = manifest.scope.d1.row_counts[t];
  check(`D1 ${t}`, Number(r.c) === expect, `rows=${r.c} expected=${expect}`);
}

for (const bucket of R2_BUCKETS) {
  const objects = manifest.scope.r2.find((x) => x.bucket === bucket)?.objects ?? [];
  const { objects: live } = await env[bucket].list();
  check(`R2 ${bucket} object count`, live.length === objects.length, `live=${live.length} expected=${objects.length}`);
  for (const o of objects) {
    const body = await env[bucket].get(o.key);
    const sha = body ? await sha256Hex(new Uint8Array(await body.arrayBuffer())) : null;
    check(`R2 ${bucket} sha256 ${o.key.slice(0, 40)}…`, sha === o.sha256, `got=${sha?.slice(0, 12)}… want=${o.sha256.slice(0, 12)}…`);
  }
}

await proxy.dispose();

console.log(`\n${fail === 0 ? "✓ RESTORE VERIFIED" : "✗ RESTORE FAILED"} — ${pass} checks passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
