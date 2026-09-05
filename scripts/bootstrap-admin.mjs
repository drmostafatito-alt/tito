#!/usr/bin/env node
/**
 * Production first-admin bootstrap (Phase 3, ADR-020 empty-first policy).
 *
 * Creates ONLY the minimum system config a fresh production database needs:
 *   1. the four structural roles (student/teacher/admin/super_admin)
 *   2. one super_admin user with a generated one-time password (printed once)
 *
 * It NEVER creates content: no demo accounts besides the bootstrap admin, no
 * courses, no pages, no settings rows (settings default lazily via zod), no
 * media. This is the production replacement for `scripts/seed.mjs`, which is
 * LOCAL-DEV ONLY (it plants demo content the readiness gate must reject).
 *
 * Usage:
 *   node scripts/bootstrap-admin.mjs                  # local wrangler state (PERSIST_DIR honored)
 *   node scripts/bootstrap-admin.mjs --remote         # production D1 (wrangler d1 execute --remote)
 *
 * Env:
 *   ADMIN_BOOTSTRAP_EMAIL  (required for --remote; falls back to .dev.vars locally)
 *   AUTH_PBKDF2_ITERATIONS (default 100000 — must match the worker env)
 *   D1_NAME                (remote only; overrides wrangler.jsonc database_name)
 *
 * After bootstrapping: log in, change the password, fill Appearance → System
 * (platform identity) + Identity, then run `npm run check:production-readiness`.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const REMOTE = process.argv.includes("--remote");
const emailArg = process.argv.find((a) => a.startsWith("--email="));

// --- minimal .dev.vars loader (same approach as seed.mjs) -------------------
function loadDevVars() {
  const out = {};
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
const devVars = loadDevVars();

const adminEmail = String(
  emailArg ? emailArg.slice("--email=".length) : process.env.ADMIN_BOOTSTRAP_EMAIL || devVars.ADMIN_BOOTSTRAP_EMAIL || ""
).toLowerCase().trim();
if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
  console.error("ADMIN_BOOTSTRAP_EMAIL is required (env, .dev.vars, or --email=you@example.com).");
  process.exit(2);
}
if (REMOTE && /@(educore\.local|example\.(com|org)|localhost)/.test(adminEmail)) {
  console.error(`Refusing to bootstrap production with a development placeholder email: ${adminEmail}`);
  process.exit(2);
}

const ITERATIONS = Number(process.env.AUTH_PBKDF2_ITERATIONS || devVars.AUTH_PBKDF2_ITERATIONS || 100_000);

async function pbkdf2Hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  return `pbkdf2$sha256$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const ROLES_SQL = `INSERT OR IGNORE INTO roles (id, label, rank) VALUES
  ('student','Student',1),('teacher','Teacher',2),('admin','Admin',3),('super_admin','Super Admin',4);`;

// --- DB access ---------------------------------------------------------------
let queryOne; // (sql, params) => row | null
let runSql;   // (sql, params) => void
let dispose = async () => {};
const finish = (code) => dispose().then(() => process.exit(code));

if (REMOTE) {
  const wranglerCfg = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/\/\/[^"\n"]*/g, ""));
  const dbName = process.env.D1_NAME ?? wranglerCfg.d1_databases?.[0]?.database_name;
  if (!dbName) {
    console.error("No D1 database_name found in wrangler.jsonc (set D1_NAME env for production).");
    process.exit(2);
  }
  const exec = (sql) => {
    const res = spawnSync("npx", ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (res.status !== 0) throw new Error(`wrangler d1 execute failed: ${res.stderr?.slice(0, 400)}`);
    return JSON.parse(res.stdout)?.[0]?.results ?? [];
  };
  const lit = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  // remote mode: inline literals (wrangler d1 execute has no bound params here)
  runSql = async (sql, params = []) => {
    let i = 0;
    exec(sql.replace(/\?/g, () => lit(params[i++])));
  };
  queryOne = async (sql, params = []) => {
    let i = 0;
    const rows = exec(sql.replace(/\?/g, () => lit(params[i++])));
    return rows[0] ?? null;
  };
} else {
  const { getPlatformProxy } = await import("wrangler");
  // wrangler --persist-to X stores state under X/v3; getPlatformProxy().persist.path expects that dir.
  const persist = process.env.PERSIST_DIR ? { path: `${process.env.PERSIST_DIR.replace(/\/$/, "")}/v3` } : undefined;
  const proxy = await getPlatformProxy(persist ? { persist } : {});
  dispose = () => proxy.dispose();
  const DB = proxy.env.DB;
  queryOne = async (sql, params = []) => DB.prepare(sql).bind(...params).first();
  runSql = async (sql, params = []) => { await DB.prepare(sql).bind(...params).run(); };
}

// --- bootstrap ----------------------------------------------------------------
const roles = await queryOne("SELECT count(*) AS n FROM roles");
if (!roles) {
  console.error("Database not migrated (no roles table). Apply migrations first:");
  console.error(REMOTE ? "  npx wrangler d1 migrations apply <db> --remote" : "  npm run db:migrate:local");
  await finish(1);
}
await runSql(ROLES_SQL);

const existing = await queryOne("SELECT id, status FROM users WHERE email = ?", [adminEmail]);
if (existing) {
  console.log(`Super admin already exists: ${adminEmail} (status=${existing.status}) — password NOT changed, nothing to do.`);
  console.log("If the password is lost, use the reset-password flow or delete the row and re-run.");
  await finish(0);
}

const password = `Admin-${crypto.randomUUID().slice(0, 8)}!${Math.floor(Math.random() * 90 + 10)}`;
const now = Date.now();
await runSql(
  `INSERT INTO users (id, email, password_hash, full_name, locale_pref, role_id, status, created_at, updated_at)
   VALUES (?, ?, ?, 'Platform Owner', 'ar', 'super_admin', 'active', ?, ?)`,
  [crypto.randomUUID(), adminEmail, await pbkdf2Hash(password), now, now]
);

console.log("Bootstrap complete — minimum system config only (roles + one super admin). No content created.");
console.log(`  super admin : ${adminEmail} / ${password}`);
console.log("  ⚠ This password is printed ONCE. Log in and change it immediately (Profile → Security).");
console.log("  Next: fill Appearance → System (platform identity) and Identity, then run:");
console.log(`      npm run check:production-readiness${REMOTE ? " -- --remote" : ""}`);
await finish(0);
