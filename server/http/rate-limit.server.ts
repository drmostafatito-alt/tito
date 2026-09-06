import { sql } from "drizzle-orm";
import type { DB } from "../db/client.server";

export interface RateLimitResult {
  ok: boolean;
  count: number;
  retryAfterMs: number;
}

/**
 * Fixed-window counter in D1 (SECURITY.md §13). Atomic via UPSERT RETURNING.
 * `bucket` names the route, `id` discriminates (ip hash / email hash).
 */
export async function checkRateLimit(
  db: DB,
  bucket: string,
  id: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${bucket}:${id}`;

  // .all() (not .run()) so the RETURNING row is readable
  const rows = await db.all<{ count: number }>(
    sql`INSERT INTO rate_limit_counters (bucket, window_start, count)
        VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
        RETURNING count`
  );
  const row = rows[0] ?? { count: 1 };

  // opportunistic sweep (~2% of calls) keeps the table small without a cron
  if (Math.random() < 0.02) {
    const cutoff = now - windowMs * 10;
    await db.run(sql`DELETE FROM rate_limit_counters WHERE window_start < ${cutoff}`);
  }

  return { ok: row.count <= limit, count: row.count, retryAfterMs: windowStart + windowMs - now };
}

/**
 * Best-effort client IP. Cloudflare always sets `cf-connecting-ip` at the edge,
 * which is the ONLY source we trust for rate-limit bucketing: `x-forwarded-for`
 * is client-controlled and would let an attacker rotate buckets to bypass
 * limits, so it is deliberately NOT read (H4 — Phase 8 hardening).
 */
export function clientIpOf(request: Request): string | null {
  return request.headers.get("cf-connecting-ip") ?? null;
}

export async function sha256Hex(value: string, prefix = ""): Promise<string> {
  const data = new TextEncoder().encode(prefix + value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
