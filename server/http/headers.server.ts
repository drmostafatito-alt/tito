/**
 * Security headers (SECURITY.md §5). CSP starts strict in production.
 * Dev relaxes inline restrictions because the Vite HMR client injects inline scripts.
 *
 * Structural `HeaderLike` avoids DOM-vs-workers Headers type collisions.
 */
export interface HeaderLike {
  set(name: string, value: string): void;
  /** Optional for small test doubles; the real `Headers` implementation has it. */
  has?(name: string): boolean;
}

export function applySecurityHeaders(headers: HeaderLike, isDev: boolean, nonce?: string): void {
  // React Router v7 renders inline <script> tags (hydration + streaming); in
  // production a strict `script-src 'self'` must whitelist them via a per-request
  // nonce (see server/csp.server.ts) or hydration never runs. Dev keeps
  // 'unsafe-inline' for the Vite HMR client (which injects non-nonce scripts).
  const scriptSrc = nonce
    ? `'self' 'nonce-${nonce}'`
    : `'self'${isDev ? " 'unsafe-inline'" : ""}`;
  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self'${isDev ? " 'unsafe-inline'" : ""}`,
    // i.ytimg.com serves YouTube poster images for owner-registered YouTube videos.
    `img-src 'self' data: blob: https://image.mux.com https://i.ytimg.com`,
    `media-src 'self' blob: https://stream.mux.com`,
    // WITHOUT an explicit frame-src, default-src 'self' would block the embedded
    // YouTube player entirely. Pinned to the privacy-enhanced host only — the
    // embed URL is rebuilt server-side from a validated video id, so no other
    // origin can ever be framed.
    `frame-src https://www.youtube-nocookie.com https://docs.google.com`,
    `font-src 'self'`,
    // hls.js fetches Mux manifests/segments through XHR/Fetch; media-src alone
    // covers only the native Safari path.
    `connect-src 'self' https://stream.mux.com${isDev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
    `worker-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // H7 (Phase 8): never downgrade to http. `report-to`/`report-uri` is deferred
    // until a violation-report collection endpoint exists (documented, not hidden).
    `upgrade-insecure-requests`,
  ].join("; ");

  // Resource routes can deliberately supply a stricter, content-specific policy
  // (for example `sandbox` on uploaded SVG documents). Never replace that policy
  // with the broader application-document CSP in the root middleware.
  if (!headers.has?.("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", csp);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  // Keep route-specific `no-referrer` on bearer-token and signed-file responses.
  if (!headers.has?.("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  // Fullscreen is required by the first-party lesson player and the allowlisted
  // privacy-enhanced YouTube iframe; sensitive capabilities remain disabled.
  headers.set(
    "Permissions-Policy",
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self "https://www.youtube-nocookie.com")'
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
}

/**
 * Authenticated responses must never be retained by a browser or shared cache.
 * This covers HTML, React Router data responses, JSON APIs and redirects: all
 * can contain account-specific state. Static assets normally bypass the route
 * handler; protected files already use an equally strict policy.
 */
export function applyPrivateCacheControl(headers: HeaderLike, hasSession: boolean): void {
  if (hasSession) headers.set("Cache-Control", "private, no-store");
}

const SENSITIVE_AUTH_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email-change",
]);

/** Password/auth documents and responses must never be cached or referred. */
export function applySensitiveAuthHeaders(headers: HeaderLike, pathname: string): void {
  if (!SENSITIVE_AUTH_PATHS.has(pathname)) return;
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  if (pathname === "/reset-password" || pathname === "/verify-email-change") {
    headers.set("Referrer-Policy", "no-referrer");
  }
}
