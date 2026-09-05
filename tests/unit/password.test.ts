import { describe, expect, it } from "vitest";
import { hashPassword, isCommonPassword, verifyPassword } from "~server/auth/password.server";

// fast iterations for tests; format keeps them swappable (production default 100k)
const ITER = 60_000;

describe("password hashing", () => {
  it("round-trips a valid password", async () => {
    const stored = await hashPassword("CorrectHorse!9", undefined, ITER);
    expect(isValidFormat(stored)).toBe(true);
    const env = { AUTH_PBKDF2_ITERATIONS: String(ITER) } as Env;
    const result = await verifyPassword("CorrectHorse!9", stored, env);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("CorrectHorse!9", undefined, ITER);
    const result = await verifyPassword("wrong-password", stored);
    expect(result.valid).toBe(false);
  });

  it("flags needsRehash when stored iterations are below the configured default", async () => {
    const env = { AUTH_PBKDF2_ITERATIONS: String(ITER + 40_000) } as Env;
    const stored = await hashPassword("CorrectHorse!9", undefined, ITER);
    const result = await verifyPassword("CorrectHorse!9", stored, env);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it("produces a unique salt per hash (no rainbow reuse)", async () => {
    const a = await hashPassword("same-password", undefined, ITER);
    const b = await hashPassword("same-password", undefined, ITER);
    expect(a).not.toEqual(b);
  });

  it("garbage stored hashes fail closed", async () => {
    const result = await verifyPassword("x", "not-a-valid-hash");
    expect(result.valid).toBe(false);
  });

  it("common-password screen catches trivial choices", () => {
    expect(isCommonPassword("password")).toBe(true);
    expect(isCommonPassword("PASSWORD")).toBe(true);
    expect(isCommonPassword("uncommon-pass-9182")).toBe(false);
  });
});

function isValidFormat(stored: string): boolean {
  const parts = stored.split("$");
  return parts.length === 5 && parts[0] === "pbkdf2" && parts[1] === "sha256" && Number.isFinite(Number(parts[2]));
}
