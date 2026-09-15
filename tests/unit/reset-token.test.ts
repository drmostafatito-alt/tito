import { describe, expect, it } from "vitest";
import { hashToken, newOpaqueToken } from "~server/auth/session.server";
import { isResetTokenShape, RESET_COOKIE_MAX_AGE_SECONDS } from "~server/auth/reset-cookie.server";

/**
 * Password-recovery token primitives (TEST-PLAN §password recovery / unit tier).
 *
 * Generation and hashing are asserted here in isolation; issuance, expiry,
 * single-use and atomic completion are covered end-to-end in
 * tests/integration/auth.test.ts and tests/e2e/password-recovery.spec.ts.
 */

const env = { SESSION_PEPPER: "unit-test-pepper-0123456789abcdef" } as unknown as Env;
const otherPepper = { SESSION_PEPPER: "another-unit-pepper-0123456789ab" } as unknown as Env;

describe("reset token generation", () => {
  it("produces a 256-bit unpadded base64url token (43 chars) accepted by the cookie guard", () => {
    for (let i = 0; i < 25; i++) {
      const token = newOpaqueToken();
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token).not.toContain("=");
      expect(isResetTokenShape(token)).toBe(true);
    }
  });

  it("never repeats a token (CSPRNG, not a counter or a seeded PRNG)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(newOpaqueToken());
    expect(seen.size).toBe(500);
  });

  it("carries full byte entropy — the character distribution is not degenerate", () => {
    // A 32-byte CSPRNG token uses ~64 symbols; a broken generator (e.g. one
    // produced from a small pool or a repeated byte) collapses this count.
    const distinct = new Set<string>();
    for (let i = 0; i < 40; i++) for (const ch of newOpaqueToken()) distinct.add(ch);
    expect(distinct.size).toBeGreaterThan(40);
  });
});

describe("reset token hashing", () => {
  it("is deterministic for the same token and pepper", async () => {
    const token = newOpaqueToken();
    expect(await hashToken(token, env)).toBe(await hashToken(token, env));
  });

  it("returns a 64-char hex digest that is not the token itself", async () => {
    const token = newOpaqueToken();
    const hash = await hashToken(token, env);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
  });

  it("binds the pepper: same token, different pepper → different digest", async () => {
    const token = newOpaqueToken();
    expect(await hashToken(token, env)).not.toBe(await hashToken(token, otherPepper));
  });

  it("separates distinct tokens (no collision-prone encoding)", async () => {
    const a = await hashToken(newOpaqueToken(), env);
    const b = await hashToken(newOpaqueToken(), env);
    expect(a).not.toBe(b);
  });

  it("stays within a short-lived cookie window", () => {
    expect(RESET_COOKIE_MAX_AGE_SECONDS).toBeGreaterThan(0);
    expect(RESET_COOKIE_MAX_AGE_SECONDS).toBeLessThanOrEqual(15 * 60);
  });
});
