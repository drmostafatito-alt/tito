import { sql } from "drizzle-orm";
import type { DB } from "../db/client.server";

/**
 * Conservative application-side ceiling under Resend Free's 100-email/day
 * allowance. It covers every transactional category and reserves ten messages
 * for provider-side timing/window differences. A dedicated Resend account/key
 * is still required; this cannot account for sends by another application.
 */
export const TRANSACTIONAL_EMAILS_PER_24_HOURS = 90;
export type TransactionalEmailCategory = "password_reset" | "email_change" | "welcome";
export const CATEGORY_EMAILS_PER_24_HOURS: Record<TransactionalEmailCategory, number> = {
  // Recovery may use every remaining global slot. Lower-priority categories are
  // capped so mass registration cannot starve account recovery completely.
  password_reset: 90,
  email_change: 20,
  welcome: 20,
};
const WINDOW_MS = 86_400_000;
const BUCKET_PREFIX = "transactional-email-delivery:";

/**
 * Atomically claim one slot in an exact rolling 24-hour global + category window.
 *
 * A normal fixed-day counter can permit twice its advertised quota around the
 * boundary. Each successful claim is therefore stored at its timestamp and
 * admitted by one conditional SQLite UPSERT. D1 serializes the statement, so
 * concurrent requests cannot all pass a stale pre-count. Category rows also let
 * us reserve recovery capacity without a non-atomic claim/refund sequence.
 */
export async function claimTransactionalEmailBudget(
  db: DB,
  options: {
    now?: number;
    limit?: number;
    category?: TransactionalEmailCategory;
    categoryLimit?: number;
  } = {}
): Promise<boolean> {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? TRANSACTIONAL_EMAILS_PER_24_HOURS;
  const category = options.category ?? "password_reset";
  const categoryLimit = options.categoryLimit ?? CATEGORY_EMAILS_PER_24_HOURS[category];
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 90 ||
    !Number.isSafeInteger(categoryLimit) ||
    categoryLimit < 1 ||
    categoryLimit > 90
  ) {
    return false;
  }
  const cutoff = now - WINDOW_MS;
  const categoryBucket = `${BUCKET_PREFIX}${category}`;
  const allBuckets = `${BUCKET_PREFIX}%`;

  const rows = await db.all<{ count: number }>(sql`
    INSERT INTO rate_limit_counters (bucket, window_start, count)
    SELECT ${categoryBucket}, ${now}, 1
    WHERE (
      SELECT COALESCE(SUM(count), 0)
      FROM rate_limit_counters
      WHERE bucket LIKE ${allBuckets} AND window_start > ${cutoff}
    ) < ${limit}
    AND (
      SELECT COALESCE(SUM(count), 0)
      FROM rate_limit_counters
      WHERE bucket = ${categoryBucket} AND window_start > ${cutoff}
    ) < ${categoryLimit}
    ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
    WHERE (
      SELECT COALESCE(SUM(count), 0)
      FROM rate_limit_counters
      WHERE bucket LIKE ${allBuckets} AND window_start > ${cutoff}
    ) < ${limit}
    AND (
      SELECT COALESCE(SUM(count), 0)
      FROM rate_limit_counters
      WHERE bucket = ${categoryBucket} AND window_start > ${cutoff}
    ) < ${categoryLimit}
    RETURNING count
  `);

  // Keep a small bounded history for diagnostics while preventing unbounded
  // growth. Cleanup is not part of the admission decision and may be skipped.
  if (rows.length > 0 && Math.random() < 0.02) {
    const retentionCutoff = now - 31 * WINDOW_MS;
    await db.run(sql`
      DELETE FROM rate_limit_counters
      WHERE bucket LIKE ${allBuckets} AND window_start <= ${retentionCutoff}
    `);
  }
  return rows.length === 1;
}
