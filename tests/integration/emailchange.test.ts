/// <reference types="@cloudflare/vitest-plugin/types" />
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { requestEmailChange, completeEmailChange } from "~server/users/emailchange.server";
import { clearEmailCaptures, capturedEmails } from "~server/email/provider";
import { auditLogs, emailChangeTokens, users } from "~server/db/schema";
import {
  action as verifyEmailChangeAction,
  loader as verifyEmailChangeLoader,
} from "~/routes/public/verify-email-change";

const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const uniqueEmail = () => `e${crypto.randomUUID().slice(0, 8)}@test.local`;

function req(ip: string): Request {
  return new Request("https://app.test/profile", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
}

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

    const r = await requestEmailChange(env, db, { userId: uid }, fresh, "Str0ngPass!x", req("12.2.1.1"));
    expect(r.ok).toBe(true);
    const sent = capturedEmails(fresh);
    expect(sent.length).toBe(1);
    expect(sent[0].html).toContain("verify-email-change#token=");
    expect(sent[0].html).not.toContain("verify-email-change?token=");
    const token = tokenFrom(sent[0].html);

    // GET is read-only and its serialized loader data contains no bearer token.
    const landing = await verifyEmailChangeLoader({
      context: routeCtx,
      request: new Request("https://app.test/verify-email-change"),
      params: {},
    } as unknown as Parameters<typeof verifyEmailChangeLoader>[0]);
    expect(landing.url).toBe("https://app.test/verify-email-change");
    expect(JSON.stringify(landing)).not.toContain(token);
    await expect(
      verifyEmailChangeLoader({
        context: routeCtx,
        request: new Request(`https://app.test/verify-email-change?token=${token}`),
        params: {},
      } as unknown as Parameters<typeof verifyEmailChangeLoader>[0])
    ).rejects.toMatchObject({ status: 302 });
    expect((await db.select({ email: users.email }).from(users).where(eq(users.id, uid)))[0].email).toBe(old);

    // The fragment credential is redeemed only by the page's same-origin POST.
    const body = new FormData();
    body.set("token", token);
    const done = await verifyEmailChangeAction({
      context: routeCtx,
      request: new Request("https://app.test/verify-email-change", { method: "POST", body }),
      params: {},
    } as unknown as Parameters<typeof verifyEmailChangeAction>[0]);
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
    await requestEmailChange(env, db, { userId: uid }, fresh, "Str0ngPass!x", req("12.3.1.1"));
    const token = tokenFrom(capturedEmails(fresh)[0].html);

    expect((await completeEmailChange(env, db, token)).ok).toBe(true);
    // replay is refused
    expect((await completeEmailChange(env, db, token)).ok).toBe(false);

    // expired token path
    const old2 = uniqueEmail();
    const fresh2 = uniqueEmail();
    await reg(old2, "12.3.1.2");
    const uid2 = (await db.select({ id: users.id }).from(users).where(eq(users.email, old2)))[0].id;
    await requestEmailChange(env, db, { userId: uid2 }, fresh2, "Str0ngPass!x", req("12.3.1.2"));
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
    const r = await requestEmailChange(env, db, { userId: uid }, owner, "Str0ngPass!x", req("12.4.1.3"));
    // Generic success (no distinct error) and NO verification email was sent.
    expect(r.ok).toBe(true);
    expect(capturedEmails(owner).length).toBe(before);
  });

  it("rejects an invalid address and the current email", async () => {
    const db = getDb(env);
    const old = uniqueEmail();
    await reg(old, "12.5.1.1");
    const uid = (await db.select({ id: users.id }).from(users).where(eq(users.email, old)))[0].id;
    const bad = await requestEmailChange(env, db, { userId: uid }, "not-an-email", "Str0ngPass!x", req("12.5.1.1"));
    expect(bad.ok).toBe(false);
    const same = await requestEmailChange(env, db, { userId: uid }, old, "Str0ngPass!x", req("12.5.1.1"));
    expect(same.ok).toBe(false);

    const target = uniqueEmail();
    const wrong = await requestEmailChange(env, db, { userId: uid }, target, "WrongPass!9", req("12.5.1.1"));
    expect(wrong).toMatchObject({ ok: false, code: "wrong_password" });
    expect(capturedEmails(target)).toHaveLength(0);
    expect(await db.select().from(emailChangeTokens).where(eq(emailChangeTokens.userId, uid))).toHaveLength(0);
  });
});
