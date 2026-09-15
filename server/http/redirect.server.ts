/** Return a normalized same-origin path, or the supplied safe fallback. */
export function safeLocalRedirect(value: unknown, fallback = "/"): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 2_000 || !raw.startsWith("/")) return fallback;

  // Backslashes are normalized to slashes by special-scheme URL parsers and can
  // turn `/\\evil.example` into a network-path redirect. Reject literal and
  // encoded forms before URL normalization.
  if (raw.startsWith("//") || /\\|%5c/i.test(raw) || /^\/%2f/i.test(raw)) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;

  const base = new URL("https://local.invalid/");
  try {
    const parsed = new URL(raw, base);
    if (parsed.origin !== base.origin || parsed.username || parsed.password) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
