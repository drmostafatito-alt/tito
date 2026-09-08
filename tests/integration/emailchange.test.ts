/// <reference types="@cloudflare/vitest-plugin/types" />
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { requestEmailChange, completeEmailChange } from "~server/users/emailchange.server";
import { clearEmailCaptures, capturedEmails } from "~server/email/provider";
import { auditLogs, emailChangeTokens, users } from "~server/db/schema";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const uniqueEmail = () => `e${crypto.randomUUID().slice(0, 8)}@test.local`;

function req(ip: string): Request {
  return new Request("https://app.test/profile", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
}
const ORIGIN = "https://app.test";

function tokenFrom(url: string): string {
  const m = url.match(/token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("no token in captured email url");
  return m[1];
}

async function wipe() {
  const db = getDb(env);
  for (const t of ["email_change_tokens", "password_reset_tokens", "security_events", "sessions", "devices", "audit_logs"]) {
    await db.run(`DELETE FROM ${t}`);
  }
  const all = await db.select({ id: users.id, email: users.email }).from(users);
  for (const u of all) if (u.email.endsWith("@test.local")) await db.delete(users).where(eq(users.id, u.id));
  clearEmailCaptures();
}

beforeEach(wipe);

async function reg(email: string, ip: string) {
  await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, req(ip));
  return email;
}

describe("welcome notification after registration (via transactional email)", () => {
  it("sends a branded welcome email only after the account is committed", async () => {
    const email = uniqueEmail();
    await reg(email, "12.1.1.1");
    const welcome = capturedEmails(email);
    expect(welcome.length).toBe(1);
    expect(welcome[0].html.toLowerCase()).not.toContain("educore");
    // Duplicate registration is rejected and must NOT create a second welcome.
    const dup = await registerUser(env, { email, fullName: "A B", password: "Str0ngPass!x" }, req("12.1.1.1"));
    expect(dup.ok).toBe(false);
    expect(capturedEmails(email).length).toBe(1);
  });
});

describe("profile email change + verification", () => {
  it("full flow: request → verify link email → change applied → old login fails / new login works", async () => {
    const db = getDb(env);
    const old = uniqueEmail();
    const fresh = uniqueEmail();
    await reg(old, "12.2.1.1");
    const uid = (await db.select({ id: users.id }).from(users).where(eq(users.email, old)))[0].id;

    const r = await requestEmailChange(env, db, { userId: uid }, fresh, req("12.2.1.1"), ORIGIN);
    expect(r.ok).toBe(true);
    const sent = capturedEmails(fresh);
    expect(sent.length).toBe(1);
    const token = tokenFrom(sent[0].html);

    const done = await completeEmailChange(env, db, token);
    expect(done.ok).toBe(true);
    const row = (await db.select({ email: users.email }).from(users).where(eq(users.id, uid)))[0];
    expect(row.email).toBe(fresh);

    // Auth consistency: old email no longer logs in, new email does.
    const oldLogin = await login(env, { email: old, password: "Str0ngPass!x" }, req("12.2.1.2"));
    expect(oldLogin.ok).toBe(false);
    const newLogin = await login(env, { email: fresh, password: "Str0ngPass!x" }, req("12.2.1.2"));
    expect(newLogin.ok).toBe(true);

    // Audited.
    const audited = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, "users.email_change.verified"));
    expect(audited.length).toBe(1);
  });

  it("rejects a reused token and an expired token", async () => {
    const db = getDb(env);
    const old = uniqueEmail();
    const fresh = uniqueEmail();
    await reg(old, "12.3.1.1");
    const uid = (await db.select({ id: users.id }).from(users).where(eq(users.email, old)))[0].id;
    await requestEmailChange(env, db, { userId: uid }, fresh, req("12.3.1.1"), ORIGIN);
    const token = tokenFrom(capturedEmails(fresh)[0].html);

    expect((await completeEmailChange(env, db, token)).ok).toBe(true);
    // replay is refused
    expect((await completeEmailChange(env, db, token)).ok).toBe(false);

    // expired token path
    const old2 = uniqueEmail();
    const fresh2 = uniqueEmail();
    await reg(old2, "12.3.1.2");
    const uid2 = (await db.select({ id: users.id }).from(users).where(eq(users.email, old2)))[0].id;
    await requestEmailChange(env, db, { userId: uid2 }, fresh2, req("12.3.1.2"), ORIGIN);
    const token2 = tokenFrom(capturedEmails(fresh2)[0].html);
    // token_hash column holds the HASH, not the raw token — expire by user.
    await db.update(emailChangeTokens).set({ expiresAt: Date.now() - 1000 }).where(eq(emailChangeTokens.userId, uid2));
    expect((await completeEmailChange(env, db, token2)).ok).toBe(false);
    const notChanged = (await db.select({ email: users.email }).from(users).where(eq(users.id, uid2)))[0];
    expect(notChanged.email).toBe(old2);
  });

  it("does not reveal when the new address is already owned by another account", async () => {
    const db = getDb(env);
    const owner = uniqueEmail();
    await reg(owner, "12.4.1.1");
    const a = uniqueEmail();
    await reg(a, "12.4.1.2");
    const uid = (await db.select({ id: users.id }).from(users).where(eq(users.email, a)))[0].id;

    const before = capturedEmails(owner).length; // the owner's welcome
    const r = await requestEmailChange(env, db, { userId: uid }, owner, req("12.4.1.3"), ORIGIN);
    // Generic success (no distinct error) and NO verification email was sent.
    expect(r.ok).toBe(true);
    expect(capturedEmails(owner).length).toBe(before);
  });

  it("rejects an invalid address and the current email", async () => {
    const db = getDb(env);
    const old = uniqueEmail();
    await reg(old, "12.5.1.1");
    const uid = (await db.select({ id: users.id }).from(users).where(eq(users.email, old)))[0].id;
    const bad = await requestEmailChange(env, db, { userId: uid }, "not-an-email", req("12.5.1.1"), ORIGIN);
    expect(bad.ok).toBe(false);
    const same = await requestEmailChange(env, db, { userId: uid }, old, req("12.5.1.1"), ORIGIN);
    expect(same.ok).toBe(false);
  });
});
