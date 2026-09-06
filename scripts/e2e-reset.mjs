#!/usr/bin/env node
/**
 * E2E data reset (W4, Phase 8) — deterministic test environment for Playwright.
 *
 * Performs a COLD local reset so every E2E run starts from the same state:
 *   1. ensure `.dev.vars` exists (copy from example),
 *   2. wipe `.wrangler` local state,
 *   3. apply D1 migrations (`npm run db:migrate:local`),
 *   4. seed demo content (`npm run db:seed:local`),
 *   5. force the super-admin password to a KNOWN value so Playwright can log in
 *      deterministically (the seed prints a random one).
 *
 * LOCAL-DEV ONLY. Never run against preview/production. Uses synthetic seed data;
 * no production credentials, no real payment transactions.
 *
 * USAGE: node scripts/e2e-reset.mjs
 *
 * Constants (shared with tests/e2e/helpers.ts):
 *   admin    admin@educore.local  /  E2e-Admin-2026!
 *   student  student@educore.local / Student#12345   (seeded by seed.mjs)
 */
import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export const E2E_ADMIN_EMAIL = "admin@educore.local";
export const E2E_ADMIN_PASSWORD = "E2e-Admin-2026!";

const ROOT = resolve(process.cwd());

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, env: process.env });
  if (r.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(" ")} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

async function pbkdf2Hash(password, iterations = 100_000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  return `pbkdf2$sha256$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

// 1) .dev.vars
if (!existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log("· created .dev.vars from example (local dev secrets)");
}

// 2) cold local state
rmSync(".wrangler", { recursive: true, force: true });
console.log("· cold reset .wrangler");

// 3) migrations
run("npm", ["run", "db:migrate:local"]);

// 4) seed
run("npm", ["run", "db:seed:local"]);

// 5) force the super-admin password to the deterministic E2E value
const { getPlatformProxy } = await import("wrangler");
const proxy = await getPlatformProxy();
const DB = proxy.env.DB;
const now = Date.now();
const hash = await pbkdf2Hash(E2E_ADMIN_PASSWORD);
await DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE email = ?")
  .bind(hash, now, E2E_ADMIN_EMAIL)
  .run();
await proxy.dispose();

console.log(`\n✓ E2E data ready (LOCAL fixture — not a production identity):`);
console.log(`  admin    ${E2E_ADMIN_EMAIL} (password not printed; see tests/e2e/helpers.ts)`);
console.log(`  student  student@educore.local (LOCAL fixture, blocked in production readiness)`);
console.log(`  demo catalog (LMS fixtures, not site identity): physics-3s-full · electrostatics-check`);
