// Integration tests run inside workerd with real local D1 (migrations applied via
// `npm run db:migrate:local` before the suite — see package.json test scripts).
/// <reference types="@cloudflare/vitest-plugin/types" />
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import {
  exchangeResetToken,
  login,
  registerUser,
  requestPasswordReset,
  resetPassword,
  validateResetToken,
} from "~server/auth/service.server";
import { passwordResetTokens, securityEvents, sessions, users } from "~server/db/schema";
import { resolveAuth } from "~server/auth/session.server";
import { clearEmailCaptures, capturedEmails } from "~server/email/provider";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

function makeRequest(opts: { ip?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { "user-agent": UA };
  if (opts.ip) headers["cf-connecting-ip"] = opts.ip;
  if (opts.cookie) headers.cookie = opts.cookie;
  return new Request("https://app.test/login", { method: "POST", headers });
}

const uniqueEmail = () => `t${crypto.randomUUID().slice(0, 8)}@test.local`;

beforeEach(async () => {
  // clean slate for the tables these tests touch (integration DB is disposable)
  const db = getDb(env);
  await db.run("DELETE FROM security_events");
  await db.run("DELETE FROM sessions");
  await db.run("DELETE FROM devices");
  await db.run("DELETE FROM password_reset_tokens");
  await db.run("DELETE FROM audit_logs");
  await db.run("DELETE FROM rate_limit_counters");
  clearEmailCaptures();
  const all = await db.select({ id: users.id, email: users.email }).from(users);
  for (const u of all) {
    if (u.email.endsWith("@test.local")) await db.delete(users).where(eq(users.id, u.id));
  }
});

describe("registration + login", () => {
  it("registers, then logs in with session + device cookies", async () => {
    const email = uniqueEmail();
    const reg = await registerUser(env, { email, fullName: "Test Student", password: "Str0ngPass!x" }, makeRequest({ ip: "1.1.1.1" }));
    expect(reg.ok).toBe(true);

    const result = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "1.1.1.1" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.cookies.map((c) => c.name);
      expect(names).toContain("__Host-edu_session");
      expect(names).toContain("__Host-edu_dk");
      expect(result.user.roleId).toBe("student");
    }
  });

  it("slides an active session and returns the refreshed expiry/cookie", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "Test Student", password: "Str0ngPass!x" }, makeRequest({ ip: "1.1.1.2" }));
    const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "1.1.1.2" }));
    expect(loggedIn.ok).toBe(true);
    if (!loggedIn.ok) return;

    const token = loggedIn.cookies.find((cookie) => cookie.name === "__Host-edu_session")!.value;
    const db = getDb(env);
    const row = (await db.select().from(sessions).limit(1))[0]!;
    const now = Date.now();
    const oldExpiry = now + 10 * 60_000;
    const oldLastSeen = now - 2 * 60_000;
    await db
      .update(sessions)
      .set({ lastSeenAt: oldLastSeen, expiresAt: oldExpiry })
      .where(eq(sessions.id, row.id));

    const resolved = await resolveAuth(
      db,
      env,
      makeRequest({ ip: "1.1.1.2", cookie: `__Host-edu_session=${token}` })
    );
    expect(resolved.auth).not.toBeNull();
    expect(resolved.refreshCookie).toContain("__Host-edu_session=");
    const refreshed = (await db.select().from(sessions).where(eq(sessions.id, row.id)).limit(1))[0]!;
    expect(refreshed.expiresAt).toBeGreaterThan(oldExpiry);
    expect(resolved.auth!.session.expiresAt).toBe(refreshed.expiresAt);
  });

  it("rejects an active session after the 180-day absolute lifetime", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "Test Student", password: "Str0ngPass!x" }, makeRequest({ ip: "1.1.1.3" }));
    const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "1.1.1.3" }));
    expect(loggedIn.ok).toBe(true);
    if (!loggedIn.ok) return;

    const token = loggedIn.cookies.find((cookie) => cookie.name === "__Host-edu_session")!.value;
    const db = getDb(env);
    const row = (await db.select().from(sessions).limit(1))[0]!;
    const now = Date.now();
    await db
      .update(sessions)
      .set({
        createdAt: now - 181 * 86_400_000,
        lastSeenAt: now - 2 * 60_000,
        expiresAt: now + 30 * 86_400_000,
      })
      .where(eq(sessions.id, row.id));

    const resolved = await resolveAuth(
      db,
      env,
      makeRequest({ ip: "1.1.1.3", cookie: `__Host-edu_session=${token}` })
    );
    expect(resolved.auth).toBeNull();
    expect(resolved.refreshCookie).toBeUndefined();
  });

  it("duplicate email is rejected", async () => {
    const email = uniqueEmail();
    const req = makeRequest({ ip: "2.2.2.2" });
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, req);
    const dup = await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, req);
    expect(dup.ok).toBe(false);
  });

  it("wrong password → uniform failure + security event, no session", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "3.3.3.3" }));
    const result = await login(env, { email, password: "wrong-pass-1" }, makeRequest({ ip: "3.3.3.3" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_credentials");

    const db = getDb(env);
    const events = await db.select().from(securityEvents).where(eq(securityEvents.type, "login_failed"));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

describe("device policy (default: 1 device)", () => {
  it("second distinct device is blocked with a clear code", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "4.4.4.4" }));

    const first = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "4.4.4.4" }));
    expect(first.ok).toBe(true);

    // same user-agent but no device cookie = a different device
    const second = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "5.5.5.5" }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("device_limit");

    const db = getDb(env);
    const blocks = await db.select().from(securityEvents).where(eq(securityEvents.type, "device_limit_block"));
    expect(blocks.length).toBe(1);
  });

  it("the SAME device (cookie replayed) logs in again freely", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "6.6.6.6" }));
    const first = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "6.6.6.6" }));
    expect(first.ok).toBe(true);

    const dk = first.ok ? first.cookies.find((c) => c.name === "__Host-edu_dk")?.value : undefined;
    expect(dk).toBeTruthy();
    const again = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "6.6.6.6", cookie: `__Host-edu_dk=${dk}` }));
    expect(again.ok).toBe(true);
  });
});

describe("rate limiting", () => {
  it("login throttles per IP within the window", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "7.7.7.7" }));
    // default loginPerMinute = 10 → the 11th attempt from the same IP must throttle
    let lastCode = "";
    for (let i = 0; i < 11; i++) {
      const r = await login(env, { email, password: `wrong-${i}` }, makeRequest({ ip: "7.7.7.7" }));
      lastCode = r.ok ? "ok" : r.code;
    }
    expect(lastCode).toBe("rate_limited");
  });
});

function resetCaptures(email: string) {
  return capturedEmails(email).filter((message) => message.html.includes("/reset-password#token="));
}

function resetTokenFromCapture(email: string): string {
  const messages = resetCaptures(email);
  expect(messages).toHaveLength(1);
  const match = /\/reset-password#token=([A-Za-z0-9_-]{40,})/.exec(messages[0].html);
  expect(match, "reset email must contain a fragment-only token").toBeTruthy();
  return match![1];
}

describe("password recovery", () => {
  it("returns an identical generic response for known and unknown emails with a timing floor", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.8" }));

    const knownStart = Date.now();
    const known = await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.8" }));
    const knownMs = Date.now() - knownStart;
    const unknownStart = Date.now();
    const unknown = await requestPasswordReset(env, uniqueEmail(), makeRequest({ ip: "8.8.4.4" }));
    const unknownMs = Date.now() - unknownStart;

    expect(known).toEqual({ ok: true });
    expect(unknown).toEqual({ ok: true });
    expect(knownMs).toBeGreaterThanOrEqual(200);
    expect(unknownMs).toBeGreaterThanOrEqual(200);
    expect(resetCaptures(email)).toHaveLength(1);
    expect(JSON.stringify(known)).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });

  it("stores only a hash, invalidates the previous link, and keeps one active token", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.9" }));

    await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.9" }));
    const first = resetTokenFromCapture(email);
    clearEmailCaptures();
    await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.10" }));
    const second = resetTokenFromCapture(email);
    expect(first).not.toBe(second);

    const db = getDb(env);
    const user = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0];
    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.tokenHash === first || row.tokenHash === second)).toBe(false);
    expect(rows.filter((row) => row.usedAt === null)).toHaveLength(1);

    expect((await resetPassword(env, { token: first, newPassword: "FirstLink!55" })).ok).toBe(false);
    expect((await resetPassword(env, { token: second, newPassword: "SecondLink!66" })).ok).toBe(true);
  });

  it("rejects invalid, expired, and replayed tokens without revealing why", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.11" }));

    const invalid = await exchangeResetToken(
      env,
      "A".repeat(43),
      makeRequest({ ip: "8.8.8.12" })
    );
    expect(invalid).toEqual({ ok: false, code: "invalid_token" });

    await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.11" }));
    const token = resetTokenFromCapture(email);
    const db = getDb(env);
    await db.update(passwordResetTokens).set({ expiresAt: Date.now() - 1 });
    const expired = await exchangeResetToken(env, token, makeRequest({ ip: "8.8.8.13" }));
    expect(expired).toEqual({ ok: false, code: "invalid_token" });

    clearEmailCaptures();
    await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.14" }));
    const fresh = resetTokenFromCapture(email);
    expect(await exchangeResetToken(env, fresh, makeRequest({ ip: "8.8.8.15" }))).toEqual({ ok: true });
    expect(
      await resetPassword(
        env,
        { token: fresh, newPassword: "ConsumedLink!77" },
        makeRequest({ ip: "8.8.8.15" })
      )
    ).toEqual({ ok: true });
    const replay = await exchangeResetToken(env, fresh, makeRequest({ ip: "8.8.8.16" }));
    expect(replay).toEqual({ ok: false, code: "invalid_token" });
  });

  it("changes the password, atomically revokes sessions, and consumes the token once", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.20" }));
    const before = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.20" }));
    expect(before.ok).toBe(true);
    const dk = before.ok ? before.cookies.find((c) => c.name === "__Host-edu_dk")?.value : undefined;

    await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.20" }));
    const token = resetTokenFromCapture(email);
    expect(await exchangeResetToken(env, token, makeRequest({ ip: "8.8.8.21" }))).toEqual({ ok: true });
    expect((await validateResetToken(env, token)).valid).toBe(true);

    const completed = await resetPassword(
      env,
      { token, newPassword: "BrandNew!77" },
      makeRequest({ ip: "8.8.8.21" })
    );
    expect(completed).toEqual({ ok: true });
    expect(await validateResetToken(env, token)).toEqual({ valid: false });
    expect(
      await resetPassword(
        env,
        { token, newPassword: "AnotherPass!88" },
        makeRequest({ ip: "8.8.8.22" })
      )
    ).toEqual({ ok: false, code: "invalid_token" });

    const db = getDb(env);
    const active = await db.select().from(sessions);
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((session) => session.revokedAt !== null)).toBe(true);

    const oldLogin = await login(
      env,
      { email, password: "Str0ngPass!x" },
      makeRequest({ ip: "8.8.8.23", cookie: `__Host-edu_dk=${dk}` })
    );
    expect(oldLogin.ok).toBe(false);
    const newLogin = await login(
      env,
      { email, password: "BrandNew!77" },
      makeRequest({ ip: "8.8.8.24", cookie: `__Host-edu_dk=${dk}` })
    );
    expect(newLogin.ok).toBe(true);
  });

  it("permits exactly one concurrent completion for a reset token", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.30" }));
    await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.30" }));
    const token = resetTokenFromCapture(email);
    expect(await exchangeResetToken(env, token, makeRequest({ ip: "8.8.8.31" }))).toEqual({ ok: true });

    const [a, b] = await Promise.all([
      resetPassword(env, { token, newPassword: "RacePass!11" }, makeRequest({ ip: "8.8.8.31" })),
      resetPassword(env, { token, newPassword: "RacePass!22" }, makeRequest({ ip: "8.8.8.32" })),
    ]);
    expect([a, b].filter((result) => result.ok)).toHaveLength(1);
  });

  it("rate-limits issuance and brute-force token exchange", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.40" }));
    for (let i = 0; i < 7; i++) {
      expect(await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.40" }))).toEqual({ ok: true });
    }
    expect(resetCaptures(email).length).toBeLessThanOrEqual(5);

    let result: Awaited<ReturnType<typeof exchangeResetToken>> = { ok: false, code: "invalid_token" };
    for (let i = 0; i < 11; i++) {
      result = await exchangeResetToken(
        env,
        `${String(i).padStart(2, "0")}${"A".repeat(41)}`,
        makeRequest({ ip: "8.8.8.41" })
      );
    }
    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("invalidates a token when delivery is unavailable and never leaks provider state or secrets", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.50" }));
    const unavailableEnv = {
      ...env,
      ENVIRONMENT: "production",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: undefined,
      EMAIL_FROM: undefined,
    };
    const result = await requestPasswordReset(unavailableEnv, email, makeRequest({ ip: "8.8.8.50" }));
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain("RESEND");
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z0-9_-]{40,}/);

    const db = getDb(env);
    const rows = await db.select().from(passwordResetTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0].usedAt).not.toBeNull();
  });
});
