/**
 * Link safety — internal relative paths or https externals ONLY.
 * No javascript:, data:, vbscript:, no protocol-relative //, no bare domains.
 */
export function safeHref(href: string): boolean {
  if (href === "") return true; // empty = no link
  // In-page fragment (e.g. "#videos"): same-document navigation only — cannot
  // execute script, cannot leave the origin. Pattern is deliberately tiny.
  if (/^#[A-Za-z0-9_-]{1,40}$/.test(href)) return true;
  if (href.startsWith("/") && !href.startsWith("//")) {
    return /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/[\]?#]*$/.test(href) && !href.includes("\\");
  }
  if (/^https:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      return u.protocol === "https:" && Boolean(u.hostname) && !u.hostname.includes("\\");
    } catch {
      return false;
    }
  }
  return false;
}
