import { describe, expect, it } from "vitest";
import { applySecurityHeaders, applyPrivateCacheControl, applySensitiveAuthHeaders } from "~server/http/headers.server";

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
    expect(h.get("Content-Security-Policy")).toContain("connect-src 'self' https://stream.mux.com");
    expect(h.get("Content-Security-Policy")).toContain("worker-src 'self' blob:");
  });

  it("preserves stricter route-specific CSP and referrer policies", () => {
    const headers = new Headers({
      "Content-Security-Policy": "sandbox",
      "Referrer-Policy": "no-referrer",
    });
    applySecurityHeaders(headers, false, "n");
    expect(headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("sensitive authentication response headers", () => {
  it("makes auth routes no-store and token routes no-referrer", () => {
    for (const path of ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email-change"]) {
      const headers = new Headers();
      applySensitiveAuthHeaders(headers, path);
      expect(headers.get("Cache-Control")).toContain("no-store");
      expect(headers.get("Pragma")).toBe("no-cache");
      expect(headers.get("Referrer-Policy")).toBe(
        path === "/reset-password" || path === "/verify-email-change" ? "no-referrer" : null
      );
    }
  });

  it("does not alter ordinary public responses", () => {
    const headers = new Headers();
    applySensitiveAuthHeaders(headers, "/");
    expect([...headers]).toEqual([]);
  });
});

describe("applyPrivateCacheControl (authenticated responses never cached)", () => {
  function render(hasSession: boolean, contentType: string | null): Headers {
    const headers = new Headers();
    if (contentType) headers.set("Content-Type", contentType);
    applyPrivateCacheControl(headers, hasSession);
    return headers;
  }

  it("marks authenticated HTML, data, API and redirect responses private/no-store", () => {
    for (const contentType of ["text/html; charset=utf-8", "application/json", "text/x-script", null]) {
      expect(render(true, contentType).get("Cache-Control")).toBe("private, no-store");
    }
  });

  it("does not touch responses without a session (anonymous/public pages stay cacheable-by-default)", () => {
    for (const contentType of ["text/html; charset=utf-8", "application/json", null]) {
      expect(render(false, contentType).get("Cache-Control")).toBeNull();
    }
  });
});
