/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { createAnnouncement } from "~server/announcements/service.server";
import { loader as announcementsLoader } from "~/routes/admin.announcements";

/**
 * Phase C — admin announcement preview. Read-only, admins-with-announcements.manage
 * only: renders any row (incl. drafts/scheduled/archived) as the recipient would see
 * it, never leaking to non-authorized callers. No mutation.
 */
const db = getDb(env);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

let superA: { id: string; email: string; cookie: string };
let adminB: { id: string; email: string; cookie: string };
let student: { id: string; email: string; cookie: string };

async function wipe() {
  for (const table of ["announcement_reads", "announcements", "audit_logs", "security_events", "sessions", "devices", "users"]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function makeUser(prefix: string, role: "student" | "admin" | "super_admin" = "student") {
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
    ('admin', 'announcements.manage', (strftime('%s','now') * 1000))`);
  superA = await makeUser("pv-super", "super_admin");
  adminB = await makeUser("pv-admin", "admin");
  student = await makeUser("pv-stu");
});

const call = (fn: unknown, req: Request, params: Record<string, string> = {}) =>
  (fn as (args: unknown) => unknown)({ context: routeCtx, request: req, params });
const get = (path: string, cookie?: string) =>
  new Request(`https://app.test${path}`, { method: "GET", headers: cookie ? { cookie, "user-agent": UA } : { "user-agent": UA } });

describe("admin announcement preview (Phase C)", () => {
  it("returns any row (draft included) as preview for an authorized admin", async () => {
    const created = await createAnnouncement(
      db,
      { titleAr: "دليل", titleEn: "Guide", bodyAr: "نص", bodyEn: "body", audience: "students", publishAt: null, expiresAt: null },
      { userId: adminB.id, role: "admin" }
    );
    const id = (created as { ok: true; id: string }).id;

    // still a draft — but an authorized admin may preview it (drafts never reach students)
    const d = (await call(announcementsLoader, get(`/admin/announcements?preview=${id}`, adminB.cookie))) as {
      preview: { id: string; status: string; audience: string; titleAr: string; bodyEn: string } | null;
    };
    expect(d.preview?.id).toBe(id);
    expect(d.preview?.status).toBe("draft");
    expect(d.preview?.audience).toBe("students");
    expect(d.preview?.bodyEn).toBe("body");

    // no preview param -> null
    const plain = (await call(announcementsLoader, get("/admin/announcements", adminB.cookie))) as { preview: unknown };
    expect(plain.preview).toBeNull();
  });

  it("preview never leaks: students and admins without announcements.manage cannot read it", async () => {
    const created = await createAnnouncement(
      db,
      { titleAr: "سرّي", titleEn: "Secret", bodyAr: "", bodyEn: "sensitive", audience: "all", publishAt: null, expiresAt: null },
      { userId: superA.id, role: "super_admin" }
    );
    const id = (created as { ok: true; id: string }).id;

    // a student cannot reach the admin announcements loader at all (redirect/deny)
    const sRes = await Promise.resolve(call(announcementsLoader, get(`/admin/announcements?preview=${id}`, student.cookie))).catch((e) => e);
    expect((sRes as { status?: number }).status).toBeGreaterThanOrEqual(300);

    // admin without announcements.manage is denied (403)
    await db.run(sql`DELETE FROM role_permissions WHERE role_id='admin' AND permission='announcements.manage'`);
    const dRes = await Promise.resolve(call(announcementsLoader, get(`/admin/announcements?preview=${id}`, adminB.cookie))).catch((e) => e);
    expect((dRes as { status?: number }).status).toBe(403);
  });
});
