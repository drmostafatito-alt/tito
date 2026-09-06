#!/usr/bin/env node
/**
 * Shared helpers for the W5 backup/restore rehearsal (scripts/backup.mjs and
 * scripts/restore.mjs). Kept in its own module so the safety guards are pure
 * and unit-testable (tests/unit/backup-safety.test.ts) without invoking
 * wrangler.
 *
 * SCOPE (see docs/BACKUP-RESTORE.md):
 *  - D1  → full logical backup via `wrangler d1 export` (schema + data + the
 *          d1_migrations history), replayable on an empty database.
 *  - R2  → object-level backup via the R2 bindings (`getPlatformProxy`), with
 *          content-type reconstructed from the D1 `files`/`videos` tables
 *          (D1 is the authoritative metadata source; local miniflare does not
 *          round-trip R2 httpMetadata through getPlatformProxy).
 *
 * NOT a backup by itself: D1 export alone would miss R2 object *bytes*, and an
 * R2 listing alone would miss database rows + their FK relationships. Both
 * layers together are the complete backup.
 */

/** Every application table, in deterministic (dependency-safe) order for
 *  row-count inventories. Derived from migrations/0000…0007 — do not invent. */
export const TABLES = [
  // 0000 — identity & auth
  "roles", "users", "devices", "sessions", "password_reset_tokens",
  "rate_limit_counters", "security_events", "teacher_profiles", "settings",
  "audit_logs", "entitlements",
  // 0001 — catalog
  "programs", "grades", "subjects", "courses", "units", "lessons",
  "lesson_items", "videos", "files",
  // 0002 — CMS
  "pages", "page_versions", "blocks", "menus", "menu_items", "forms",
  "form_fields", "form_submissions", "role_permissions",
  // 0004 — progress
  "events", "lesson_progress", "video_progress", "video_watch_sessions",
  // 0005 — assessment
  "tags", "questions", "question_choices", "question_tags", "exams",
  "exam_questions", "exam_attempts", "exam_answers",
  // 0006 — commerce
  "products", "product_items", "price_plans", "orders", "order_items",
  "payments", "payment_events", "refunds", "subscriptions",
  "subscription_events", "activation_code_batches", "activation_codes",
  "activation_code_redemptions", "discount_codes", "discount_redemptions",
  // 0007 — announcements
  "announcements", "announcement_reads",
];

/** R2 buckets declared in wrangler.jsonc (bindings, not bucket_name — the local
 *  sim and getPlatformProxy expose them by binding). */
export const R2_BUCKETS = ["PUBLIC_ASSETS", "PRIVATE_FILES", "VIDEO_MASTERS"];

/** `d1_migrations` is tracked by wrangler, not in TABLES; included in exports. */
export const MIGRATION_TABLE = "d1_migrations";

export function sha256Hex(bytes) {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""));
}

export function timestampSlug(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

/** SAFETY GUARD — backup target validation (pure). */
export function validateBackupTarget(target, { allowRemote }) {
  if (target !== "local" && target !== "remote") {
    return { ok: false, reason: `unknown target "${target}" (expected "local" or "remote")` };
  }
  if (target === "remote" && !allowRemote) {
    return {
      ok: false,
      reason:
        "remote backup requires EDUCORE_ALLOW_REMOTE=1 and real Cloudflare credentials " +
        "(owner-assisted; not available in this sandbox). Refusing.",
    };
  }
  return { ok: true, reason: "" };
}

/** SAFETY GUARD — restore target validation (pure). Restore is destructive:
 *  it always requires --force, and a remote target additionally requires an
 *  explicit opt-in so a restore can never hit production by accident. */
export function validateRestoreTarget(target, { allowUnsafeRestore, force }) {
  if (target !== "local" && target !== "remote") {
    return { ok: false, reason: `unknown target "${target}" (expected "local" or "remote")` };
  }
  if (!force) {
    return { ok: false, reason: "restore is destructive — re-run with --force to confirm" };
  }
  if (target === "remote" && !allowUnsafeRestore) {
    return {
      ok: false,
      reason:
        "REFUSED: remote restore would overwrite production data. Set " +
        "EDUCORE_ALLOW_UNSAFE_RESTORE=1 AND pass --force only inside a controlled " +
        "disaster-recovery drill. Production restore is owner-assisted.",
    };
  }
  return { ok: true, reason: "" };
}
