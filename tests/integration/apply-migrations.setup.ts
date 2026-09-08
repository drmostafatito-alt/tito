/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { MIGRATIONS } from "./migrations.generated";

/**
 * Applies embedded migrations idempotently to the test-pool D1 (isolated storage),
 * tracked in wrangler's own d1_migrations table, then seeds reference data.
 */
export async function setup(): Promise<void> {
  const db = env.DB;

  await db
    .prepare(`CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY, applied_at INTEGER)`)
    .run();

  const applied = await db.prepare(`SELECT name FROM d1_migrations`).all<{ name: string }>();
  const done = new Set(applied.results.map((r) => r.name));

  for (const migration of MIGRATIONS) {
    if (done.has(migration.name)) continue;
    const statements = migration.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await db.prepare(statement).run();
    }
    await db
      .prepare(`INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)`)
      .bind(migration.name, Date.now())
      .run();
  }

  // reference data (mirrors scripts/seed.mjs)
  await db
    .prepare(
      `INSERT INTO roles (id, label, rank) VALUES ('student','Student',1),('teacher','Teacher',2),('admin','Admin',3),('super_admin','Super Admin',4)
       ON CONFLICT(id) DO NOTHING`
    )
    .run();
  const groups: [string, unknown][] = [
    ["platform", { nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito", taglineAr: "الفلسفة وعلم النفس", taglineEn: "Philosophy & Psychology", maintenance: false, supportEmail: null, supportPhone: null, whatsapp: null }],
    ["locale", { default: "ar", enabled: ["ar", "en"] }],
    ["devices", { maxPerStudent: 1, onLimit: "block", changeLimitPer30d: 2 }],
    ["security", { sessionDays: 30, resetTokenMinutes: 60, rateLimits: { loginPerMinute: 10, registerPerHour: 5, forgotPerHour: 5 } }],
  ];
  for (const [key, value] of groups) {
    await db
      .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`)
      .bind(key, JSON.stringify(value), Date.now())
      .run();
  }
}

void setup();
