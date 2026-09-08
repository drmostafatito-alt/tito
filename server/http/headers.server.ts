/**
 * Security headers (SECURITY.md §5). CSP starts strict in production.
 * Dev relaxes inline restrictions because the Vite HMR client injects inline scripts.
 *
 * Structural `HeaderLike` avoids DOM-vs-workers Headers type collisions.
 */
export interface HeaderLike {
  set(name: string, value: string): void;
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
    `connect-src 'self'${isDev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
    `worker-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // H7 (Phase 8): never downgrade to http. `report-to`/`report-uri` is deferred
    // until a violation-report collection endpoint exists (documented, not hidden).
    `upgrade-insecure-requests`,
  ].join("; ");

  headers.set("Content-Security-Policy", csp);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
}

/**
 * H8 (Phase 8): authenticated HTML must never be retained by a browser or
 * shared cache. App-rendered documents are user-specific (header CTA, private
 * data), so when a session cookie is present we mark them `private, no-store`.
 * Static assets and /files responses are served outside this handler (the
 * Workers assets binding and the /files route set their own Cache-Control), so
 * only app-rendered responses are affected.
 */
export function applyPrivateCacheControl(
  headers: HeaderLike,
  hasSession: boolean,
  contentType: string | null,
): void {
  if (hasSession && contentType?.includes("text/html")) {
    headers.set("Cache-Control", "private, no-store");
  }
}
