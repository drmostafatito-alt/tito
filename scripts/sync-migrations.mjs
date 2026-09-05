#!/usr/bin/env node
/**
 * Copies drizzle-kit generated SQL (drizzle/*.sql, ordered by meta journal) into
 * migrations/NNNN_name.sql so `wrangler d1 migrations apply` remains the single
 * migration runner for local + preview + production (DEPLOYMENT.md §4).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const drizzleDir = "drizzle";
const outDir = "migrations";

if (!existsSync(join(drizzleDir, "meta", "_journal.json"))) {
  console.error("No drizzle journal found — run `drizzle-kit generate` first.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const journal = JSON.parse(readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8"));
const existing = new Set(readdirSync(outDir).filter((f) => f.endsWith(".sql")));

let copied = 0;
for (const entry of journal.entries) {
  const source = join(drizzleDir, `${entry.tag}.sql`);
  if (!existsSync(source)) continue;
  // drizzle-kit tags already carry the zero-padded sequence (e.g. 0000_init)
  const target = join(outDir, `${entry.tag}.sql`);
  const content = readFileSync(source, "utf8");
  if (!existing.has(target.name) || readFileSync(target, "utf8") !== content) {
    cpSync(source, target);
    console.log(`  migrations ← ${target.split("/").pop()}`);
    copied++;
  }
}

// remove stray migration files not represented in the journal (safety)
for (const f of [...existing]) {
  const tag = f.replace(/\.sql$/, "");
  if (!journal.entries.some((e) => e.tag === tag)) {
    if (statSync(join(outDir, f)).isFile()) {
      unlinkSync(join(outDir, f));
      console.log(`  removed stray ${f}`);
    }
  }
}
console.log(copied ? `Synced ${copied} migration(s).` : "Migrations already in sync.");
