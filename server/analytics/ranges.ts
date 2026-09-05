/**
 * Date-window primitives for admin analytics (P7 §4) — PURE module (no .server
 * suffix) so both server services and client components may import it.
 */

export const RANGE_KEYS = ["today", "7d", "30d", "all"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

/** URL param → range key (default 7d; unknown values never crash). */
export function parseRange(v: string | null | undefined): RangeKey {
  return RANGE_KEYS.includes(v as RangeKey) ? (v as RangeKey) : "7d";
}

/** Window start in epoch ms; 0 means "all time" (callers skip the WHERE). Pure + unit-tested. */
export function rangeSinceMs(range: RangeKey, nowMs: number): number {
  switch (range) {
    case "today":
      return nowMs - (nowMs % 86_400_000); // UTC midnight
    case "7d":
      return nowMs - 7 * 86_400_000;
    case "30d":
      return nowMs - 30 * 86_400_000;
    case "all":
      return 0;
  }
}
