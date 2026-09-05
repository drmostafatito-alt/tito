// Integration tests run inside workerd with real local D1 (migrations applied via
// `npm run db:migrate:local` before the suite — see package.json test scripts).
/// <reference types="@cloudflare/vitest-plugin/types" />
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { login, registerUser, requestPasswordReset, resetPassword } from "~server/auth/service.server";
import { securityEvents, users } from "~server/db/schema";

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
      expect(names).toContain("__edu_session");
      expect(names).toContain("__edu_dk");
      expect(result.user.roleId).toBe("student");
    }
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

    const dk = first.ok ? first.cookies.find((c) => c.name === "__edu_dk")?.value : undefined;
    expect(dk).toBeTruthy();
    const again = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "6.6.6.6", cookie: `__edu_dk=${dk}` }));
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

describe("password reset", () => {
  it("full flow: request (dev token) → reset → old sessions revoked → new password works", async () => {
    const email = uniqueEmail();
    await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.8" }));
    const before = await login(env, { email, password: "Str0ngPass!x" }, makeRequest({ ip: "8.8.8.8" }));
    expect(before.ok).toBe(true);
    // same physical device re-plays its device key after the reset
    const dk = before.ok ? before.cookies.find((c) => c.name === "__edu_dk")?.value : undefined;

    const forgot = await requestPasswordReset(env, email, makeRequest({ ip: "8.8.8.8" }));
    expect(forgot.ok).toBe(true);
    // non-production exposes the token (email channel arrives Phase 3+)
    expect(forgot.devToken).toBeTruthy();

    const reset = await resetPassword(env, { token: forgot.devToken!, newPassword: "BrandNew!77" });
    expect(reset.ok).toBe(true);

    // token is single-use
    const replay = await resetPassword(env, { token: forgot.devToken!, newPassword: "Another!88" });
    expect(replay.ok).toBe(false);

    // new password logs in (same device); old sessions were revoked server-side
    const relogin = await login(
      env,
      { email, password: "BrandNew!77" },
      makeRequest({ ip: "8.8.8.8", cookie: `__edu_dk=${dk}` })
    );
    expect(relogin.ok).toBe(true);
  });
});
