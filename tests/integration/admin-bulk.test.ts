/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { auditLogs, sessions, users } from "~server/db/schema";
import {
  bulkSetUserStatus,
  BULK_STUDENT_MAX,
} from "~server/users/service.server";
import { action as bulkUsersAction, loader as bulkUsersLoader } from "~/routes/admin.users";

/**
 * Phase A bulk student operations on REAL D1 + REAL route loader/action:
 * server-authoritative, bounded batches, per-item success/error (no silent
 * partial failures), non-student/unknown ids never acted on, each suspension
 * audited + sessions revoked, activation reactivates, and RBAC on the action.
 */
const db = getDb(env);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

let superA: { id: string; email: string; cookie: string };
let adminB: { id: string; email: string; cookie: string };
let teacherT: { id: string; email: string; cookie: string };
let s1: { id: string; email: string; cookie: string };
let s2: { id: string; email: string; cookie: string };

async function wipe() {
  for (const table of [
    "audit_logs", "security_events", "rate_limit_counters", "sessions", "devices", "users",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function makeUser(prefix: string, role: "student" | "teacher" | "admin" | "super_admin" = "student") {
  const r = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${r}@test.local`;
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const req = () => new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
  const reg = await registerUser(env, { email, password: "Str0ngPass!x", fullName: `${prefix} Tester` }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  if (role !== "student") await db.run(sql`UPDATE users SET role_id = ${role} WHERE id = ${reg.userId}`);
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed: " + JSON.stringify(loggedIn));
  return { id: reg.userId, email, cookie: loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

beforeEach(async () => {
  await wipe();
  await db.run(sql`INSERT OR IGNORE INTO role_permissions (role_id, permission, granted_at) VALUES
    ('admin', 'users.read', (strftime('%s','now') * 1000)),
    ('admin', 'users.manage', (strftime('%s','now') * 1000))`);
  superA = await makeUser("blk-super", "super_admin");
  adminB = await makeUser("blk-admin", "admin");
  teacherT = await makeUser("blk-teach", "teacher");
  s1 = await makeUser("blk-s1");
  s2 = await makeUser("blk-s2");
});

const call = (fn: unknown, req: Request, params: Record<string, string> = {}) =>
  (fn as (args: unknown) => unknown)({ context: routeCtx, request: req, params });
const get = (path: string, cookie?: string) =>
  new Request(`https://app.test${path}`, { method: "GET", headers: cookie ? { cookie, "user-agent": UA } : { "user-agent": UA } });

function postIds(path: string, ids: string[], status: string, cookie?: string) {
  const params = new URLSearchParams();
  params.set("_action", "bulk-status");
  params.set("status", status);
  for (const id of ids) params.append("ids", id);
  return new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie, "user-agent": UA } : { "user-agent": UA }) },
    body: params.toString(),
  });
}

async function catchResponse(p: Promise<unknown>): Promise<Response> {
  try {
    const v = await p;
    if (v instanceof Response) return v;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  throw new Error("expected a thrown Response");
}

async function countAudit(action: string, actorId: string): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)` }).from(auditLogs).where(sql`action = ${action} AND actor_user_id = ${actorId}`);
  return Number(r[0].n);
}

function statusOf(id: string) {
  return db.select({ status: users.status }).from(users).where(sql`id = ${id}`).then((r) => r[0]?.status);
}

describe("bulk student status service", () => {
  it("suspends several students, revoking sessions and auditing each; reports per-item success", async () => {
    // each student has real login session(s) from makeUser
    const before1 = await db.select({ n: sql<number>`count(*)` }).from(sessions).where(sql`user_id = ${s1.id}`);
    expect(Number(before1[0].n)).toBeGreaterThanOrEqual(1);

    const res = await bulkSetUserStatus(db, [s1.id, s2.id, adminB.id, "missing-id"], "suspended", { userId: adminB.id, role: "admin", rank: 3 });
    expect(res.requested).toBe(4);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(2);
    const byId = Object.fromEntries(res.results.map((r) => [r.id, r]));

    // both students suspended
    expect(await statusOf(s1.id)).toBe("suspended");
    expect(await statusOf(s2.id)).toBe("suspended");
    // their sessions (incl. the ones we inserted) were revoked (revoked_at set)
    const s1s = await db.select({ n: sql<number>`count(*)` }).from(sessions).where(sql`user_id = ${s1.id} AND revoked_at IS NULL`);
    const s2s = await db.select({ n: sql<number>`count(*)` }).from(sessions).where(sql`user_id = ${s2.id} AND revoked_at IS NULL`);
    expect(Number(s1s[0].n)).toBe(0);
    expect(Number(s2s[0].n)).toBe(0);

    // non-student reported per-item, never silently dropped; admin unaffected
    expect(byId[adminB.id].ok).toBe(false);
    expect(byId[adminB.id].error).toBe("not_student");
    expect(await statusOf(adminB.id)).toBe("active");
    // unknown id reported not_found
    expect(byId["missing-id"].ok).toBe(false);
    expect(byId["missing-id"].error).toBe("not_found");

    // two suspensions audited against the actor
    expect(await countAudit("users.status", adminB.id)).toBe(2);
  });

  it("dedupes, clamps to the bounded max, trims, and ignores empty ids", async () => {
    // Seed 60 throwaway students as lightweight rows. The bulk service only reads
    // each extra id's role/status/deletedAt, so driving them through the full
    // registerUser+login path (2x PBKDF2-100k + device/session/audit/security-event
    // writes EACH) is unnecessary and was pushing this test to vitest's default
    // 5000ms limit under suite load (~4s of the window was fixture building).
    // Direct inserts keep every assertion below identical (still 60 extras ->
    // requested===62 after dedupe/trim) without the auth hashing cost. The auth
    // path is intentionally slow (secure PBKDF2) — not an app perf regression.
    const now = Date.now();
    const extra: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = crypto.randomUUID();
      await db.insert(users).values({
        id, email: `blk-x${i}-${id.slice(0, 8)}@test.local`, passwordHash: "x", fullName: `Bulk X${i}`,
        roleId: "student", status: "active", localePref: "ar", createdAt: now, updatedAt: now,
      });
      extra.push(id);
    }
    const many = [...extra, s1.id, s1.id, s2.id, "  ", ""];
    const res = await bulkSetUserStatus(db, many, "suspended", { userId: superA.id, role: "super_admin", rank: 4 });
    expect(res.requested).toBeLessThanOrEqual(BULK_STUDENT_MAX);
    expect(res.requested).toBe(62); // 60 extra + s1 + s2 (deduped, empties dropped)
    expect(res.succeeded).toBe(62);
    expect(res.failed).toBe(0);
  });

  it("reactivates suspended students (activation path)", async () => {
    await db.run(sql`UPDATE users SET status = 'suspended' WHERE id IN ('${sql.raw(s1.id)}','${sql.raw(s2.id)}')`);
    const res = await bulkSetUserStatus(db, [s1.id, s2.id], "active", { userId: superA.id, role: "super_admin", rank: 4 });
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);
    expect(await statusOf(s1.id)).toBe("active");
    expect(await statusOf(s2.id)).toBe("active");
  });

  it("a teacher target in the batch is reported and untouched (rank discipline preserved per item)", async () => {
    await db.run(sql`UPDATE users SET status = 'active' WHERE id = '${sql.raw(teacherT.id)}'`);
    const res = await bulkSetUserStatus(db, [teacherT.id, s1.id], "suspended", { userId: superA.id, role: "super_admin", rank: 4 });
    expect(res.results.find((r) => r.id === teacherT.id)?.ok).toBe(false);
    expect(res.results.find((r) => r.id === teacherT.id)?.error).toBe("not_student");
    expect(await statusOf(teacherT.id)).toBe("active");
    expect(await statusOf(s1.id)).toBe("suspended");
  });
});

describe("bulk status route (loader + action)", () => {
  it("action suspends a batch and reports per-item results; loader exposes canManage", async () => {
    const d = (await call(bulkUsersLoader, get("/admin/users", adminB.cookie))) as { canManage: boolean; users: { total: number } };
    expect(d.canManage).toBe(true);
    expect(d.users.total).toBeGreaterThanOrEqual(2);

    const r = (await call(bulkUsersAction, postIds("/admin/users", [s1.id, s2.id, teacherT.id], "suspended", adminB.cookie))) as {
      bulk: { requested: number; succeeded: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> };
    };
    expect(r.bulk.requested).toBe(3);
    expect(r.bulk.succeeded).toBe(2);
    expect(r.bulk.failed).toBe(1);
    expect(r.bulk.results.find((x) => x.id === teacherT.id)?.error).toBe("not_student");
    expect(await statusOf(s1.id)).toBe("suspended");
    expect(await statusOf(s2.id)).toBe("suspended");
    expect(await statusOf(teacherT.id)).toBe("active");
  });

  it("action rejects invalid status, empty selection, and unprivileged callers", async () => {
    // invalid status
    const bad = (await call(bulkUsersAction, postIds("/admin/users", [s1.id], "bogus", adminB.cookie))) as { error?: string };
    expect(bad.error).toBe("bad_request");
    // empty selection
    const empty = (await call(bulkUsersAction, postIds("/admin/users", [], "suspended", adminB.cookie))) as { error?: string };
    expect(empty.error).toBe("empty");
    // caller without users.manage
    await db.run(sql`DELETE FROM role_permissions WHERE role_id='admin' AND permission='users.manage'`);
    const denied = (await call(bulkUsersAction, postIds("/admin/users", [s1.id], "suspended", adminB.cookie))) as { error?: string };
    expect(denied.error).toBe("denied");
    expect(await statusOf(s1.id)).toBe("active");
    // a non-admin (student) is rejected outright
    const asStudent = await catchResponse(call(bulkUsersAction, postIds("/admin/users", [s2.id], "suspended", s1.cookie)) as Promise<unknown>);
    expect(asStudent.status).toBeGreaterThanOrEqual(300);
    expect(await statusOf(s2.id)).toBe("active");
  });

  it("read-only admin (users.read, no manage) can load the list but bulk is denied", async () => {
    const d = (await call(bulkUsersLoader, get("/admin/users", adminB.cookie))) as { canManage: boolean };
    expect(d.canManage).toBe(true);
    await db.run(sql`DELETE FROM role_permissions WHERE role_id='admin' AND permission='users.manage'`);
    const readOnly = (await call(bulkUsersLoader, get("/admin/users", adminB.cookie))) as { canManage: boolean };
    expect(readOnly.canManage).toBe(false);
    const denied = (await call(bulkUsersAction, postIds("/admin/users", [s1.id], "suspended", adminB.cookie))) as { error?: string };
    expect(denied.error).toBe("denied");
    expect(await statusOf(s1.id)).toBe("active");
  });
});
