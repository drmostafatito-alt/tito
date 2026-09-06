/**
 * Link safety — internal relative paths or https externals ONLY.
 * No javascript:, data:, vbscript:, no protocol-relative //, no bare domains.
 */
export function safeHref(href: string): boolean {
  if (href === "") return true; // empty = no link
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
