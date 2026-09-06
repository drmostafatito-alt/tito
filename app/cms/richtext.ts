/**
 * Allowlisted rich-text classes. Token colors only — never arbitrary CSS values.
 * Applied by the admin toolbar; re-checked by the server sanitizer.
 */
export const RT_COLOR_CLASSES = ["rt-c-brand", "rt-c-accent", "rt-c-success", "rt-c-warning", "rt-c-error", "rt-c-ink"] as const;
export const RT_ALIGN_CLASSES = ["rt-align-start", "rt-align-center", "rt-align-end"] as const;
export const RT_WEIGHT_CLASSES = ["rt-w-bold"] as const;

const ALLOWED = new Set<string>([...RT_COLOR_CLASSES, ...RT_ALIGN_CLASSES, ...RT_WEIGHT_CLASSES]);

export function isAllowedRtClass(token: string): boolean {
  return ALLOWED.has(token);
}

/** Filter a class attribute down to the allowlist (empty → drop). */
export function filterRtClassAttr(value: string): string {
  return value
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(isAllowedRtClass)
    .join(" ");
}
