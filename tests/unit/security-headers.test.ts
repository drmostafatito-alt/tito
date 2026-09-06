import { describe, expect, it } from "vitest";
import { applySecurityHeaders } from "~server/http/headers.server";

/**
 * Regression tests for the CSP nonce fix (W4 E2E discovered that a strict
 * `script-src 'self'` blocked React Router v7's inline hydration scripts, so
 * the whole client-side app silently failed to hydrate in production).
 *
 * These pin the exact policy shapes so the fix can never regress into either
 * direction: (a) weakening script-src to 'unsafe-inline', or (b) dropping the
 * nonce and re-breaking hydration.
 */
describe("applySecurityHeaders", () => {
  function render(isDev: boolean, nonce?: string): Headers {
    const headers = new Headers();
    applySecurityHeaders(headers, isDev, nonce);
    return headers;
  }

  it("production without a nonce stays strict (script-src 'self', no unsafe-inline)", () => {
    const csp = render(false).get("Content-Security-Policy")!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("nonce-");
  });

  it("production with a nonce whitelists exactly that nonce", () => {
    const csp = render(false, "abc123").get("Content-Security-Policy")!;
    expect(csp).toContain("script-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("unsafe-inline");
  });

  it("dev keeps 'unsafe-inline' for the Vite HMR client (no nonce needed)", () => {
    const csp = render(true).get("Content-Security-Policy")!;
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).not.toContain("nonce-");
  });

  it("never wildcards a script/default source (dev port wildcards are the only '*')", () => {
    for (const [isDev, nonce] of [
      [false, undefined],
      [false, "n1"],
      [true, undefined],
      [true, "n2"],
    ] as const) {
      const csp = render(isDev, nonce).get("Content-Security-Policy")!;
      // default-src is always strict self; script-src never accepts a wildcard
      expect(csp).toContain("default-src 'self'");
      expect(csp).not.toContain("script-src *");
      expect(csp).not.toContain("'unsafe-eval'");
      // external scripts remain 'self' — nonce only whitelists inline hydration scripts
      expect(csp).toContain("script-src 'self'");
    }
  });

  it("does not regress the other security headers", () => {
    const h = render(false, "n");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(h.get("Permissions-Policy")).toContain("camera=()");
    expect(h.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(h.get("Content-Security-Policy")).toContain("upgrade-insecure-requests");
  });
});
