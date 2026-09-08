/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { auditLogs, rolePermissions } from "~server/db/schema";
import { canAssessment } from "~server/assessment/service.server";
import {
  canManageTeachers,
  canViewTeachers,
  isTeacherGrantable,
  setTeacherPermission,
  teacherPermissionMatrix,
} from "~server/teachers/service.server";
import { listUsers } from "~server/users/service.server";
import { loader as layoutLoader } from "~/routes/admin/layout";
import { loader as assessmentHubLoader } from "~/routes/admin.assessment";

/**
 * Teacher role + permission matrix (Batch 3).
 *
 * Teachers (rank 2) can never author in the question bank unless the operator
 * grants the teacher ROLE an assessment.* permission row. That grant is
 * restricted to the authoring allowlist — billing/payment/user-admin/security/
 * system permissions are unreachable — and mutations are limited to
 * super_admin or an admin with users.manage.
 */
const db = getDb(env);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

let superA: { id: string; email: string; cookie: string };
let adminB: { id: string; email: string; cookie: string };
let teacherT: { id: string; email: string; cookie: string };
let studentS: { id: string; email: string; cookie: string };

async function wipe() {
  for (const table of [
    "assignment_submissions", "assignments", "exam_answers", "exam_attempts", "exams",
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "entitlements", "audit_logs", "events", "security_events", "sessions", "devices",
    "role_permissions", "users",
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

const sup = () => ({ userId: superA.id, role: "super_admin", rank: 4, roleId: "super_admin", ipHash: null });

beforeEach(async () => {
  await wipe();
  await db.run(sql`INSERT OR IGNORE INTO role_permissions (role_id, permission, granted_at) VALUES
    ('admin', 'users.read', (strftime('%s','now') * 1000)),
    ('admin', 'users.manage', (strftime('%s','now') * 1000))`);
  superA = await makeUser("tch-super", "super_admin");
  adminB = await makeUser("tch-admin", "admin");
  teacherT = await makeUser("tch-tea", "teacher");
  studentS = await makeUser("tch-stu", "student");
});

const teacherRows = () =>
  db.select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission }).from(rolePermissions).where(sql`role_id = 'teacher'`);

describe("teacher permission matrix & enforcement", () => {
  it("teacher with no grants cannot author; forbidden permissions are never grantable", async () => {
    const teacherSubject = { rank: 2, roleId: "teacher" };
    expect(await canAssessment(db, { user: teacherSubject }, "assessment.create")).toBe(false);
    expect(await canAssessment(db, { user: teacherSubject }, "assessment.read")).toBe(false);
    expect(await canAssessment(db, { user: { rank: 4, roleId: "super_admin" } }, "assessment.create")).toBe(true);

    const actor = sup();
    for (const forbidden of ["users.manage", "users.read", "commerce.manage", "billing.read", "security.read", "audit.read", "system.settings"]) {
      expect(isTeacherGrantable(forbidden)).toBe(false);
      const out = await setTeacherPermission(db, actor, forbidden, true);
      expect(out.ok).toBe(false);
      expect(out.ok ? null : out.code).toBe("bad_permission");
    }
    expect((await teacherRows()).length).toBe(0);
  });

  it("super_admin can grant/revoke an authoring permission to the teacher role", async () => {
    const actor = sup();
    const res = await setTeacherPermission(db, actor, "assessment.create", true);
    expect(res).toEqual({ ok: true, permission: "assessment.create", granted: true });

    const teacherSubject = { user: { rank: 2, roleId: "teacher" } };
    expect(await canAssessment(db, teacherSubject, "assessment.create")).toBe(true);
    await setTeacherPermission(db, actor, "assessment.create", false);
    expect(await canAssessment(db, teacherSubject, "assessment.create")).toBe(false);
  });

  it("grant is role-scoped (only the teacher role changes)", async () => {
    const actor = sup();
    await setTeacherPermission(db, actor, "assessment.edit", true);
    const rows = await teacherRows();
    expect(rows).toEqual([{ roleId: "teacher", permission: "assessment.edit" }]);
  });

  it("only super_admin or an admin with users.manage may edit; teacher & student denied", async () => {
    expect(await canManageTeachers(db, { rank: 3, roleId: "admin" })).toBe(true);
    const adminActor = { userId: adminB.id, role: "admin", rank: 3, roleId: "admin", ipHash: null };
    const ok = await setTeacherPermission(db, adminActor, "assessment.publish", true);
    expect(ok.ok).toBe(true);

    const teacherActor = { userId: teacherT.id, role: "teacher", rank: 2, roleId: "teacher", ipHash: null };
    expect(await canManageTeachers(db, { rank: 2, roleId: "teacher" })).toBe(false);
    const tDeny = await setTeacherPermission(db, teacherActor, "assessment.create", true);
    expect(tDeny.ok).toBe(false);
    expect(tDeny.ok ? null : tDeny.code).toBe("denied");

    const studentActor = { userId: studentS.id, role: "student", rank: 1, roleId: "student", ipHash: null };
    const sDeny = await setTeacherPermission(db, studentActor, "assessment.create", true);
    expect(sDeny.ok).toBe(false);
    expect(sDeny.ok ? null : sDeny.code).toBe("denied");
  });

  it("an admin without users.manage can view but not edit the matrix", async () => {
    await db.run(sql`DELETE FROM role_permissions WHERE role_id = 'admin' AND permission = 'users.manage'`);
    expect(await canViewTeachers(db, { rank: 3, roleId: "admin" })).toBe(true);
    expect(await canManageTeachers(db, { rank: 3, roleId: "admin" })).toBe(false);
    const actor = { userId: adminB.id, role: "admin", rank: 3, roleId: "admin", ipHash: null };
    const out = await setTeacherPermission(db, actor, "assessment.create", true);
    expect(out.ok).toBe(false);
    expect(out.ok ? null : out.code).toBe("denied");
  });

  it("matrix reflects current grants; teacher list only returns teacher role users", async () => {
    const actor = sup();
    await setTeacherPermission(db, actor, "assessment.create", true);
    const matrix = await teacherPermissionMatrix(db);
    expect(matrix.find((m) => m.permission === "assessment.create")?.granted).toBe(true);
    expect(matrix.find((m) => m.permission === "assessment.publish")?.granted).toBe(false);

    const teachers = await listUsers(db, { role: "teacher" });
    expect(teachers.rows.length).toBe(1);
    expect(teachers.rows[0].id).toBe(teacherT.id);
  });

  it("grant + revoke are audited (rbac.teacher.*)", async () => {
    const actor = sup();
    await setTeacherPermission(db, actor, "assessment.read", true);
    await setTeacherPermission(db, actor, "assessment.read", false);
    const rows = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(sql`entity_type = 'role' AND entity_id = 'teacher'`);
    expect(rows.map((r) => r.action).sort()).toEqual(["rbac.teacher.grant", "rbac.teacher.revoke"]);
  });

  it("granted teacher authoring perms pass canAssessment; publish/delete stay denied unless granted", async () => {
    const actor = sup();
    for (const p of ["assessment.read", "assessment.create", "assessment.edit"]) {
      await setTeacherPermission(db, actor, p, true);
    }
    const subject = { user: { rank: 2, roleId: "teacher" } };
    expect(await canAssessment(db, subject, "assessment.read")).toBe(true);
    expect(await canAssessment(db, subject, "assessment.create")).toBe(true);
    expect(await canAssessment(db, subject, "assessment.edit")).toBe(true);
    expect(await canAssessment(db, subject, "assessment.publish")).toBe(false);
    expect(await canAssessment(db, subject, "assessment.delete")).toBe(false);
  });

  it("reused admin route: a granted teacher reaches the question-bank hub; un-granted teacher & students are refused", async () => {
    const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
    const get = (path: string, cookie: string) =>
      new Request(`https://app.test${path}`, { method: "GET", headers: { cookie, "user-agent": UA } });
    const run = (fn: unknown, req: Request) => (fn as (a: unknown) => unknown)({ context: routeCtx, request: req }) as Promise<unknown>;
    async function resOf(p: Promise<unknown>): Promise<Response> {
      try {
        const v = await p;
        if (v instanceof Response) return v;
        throw new Error("not a redirect Response");
      } catch (e) {
        if (e instanceof Response) return e;
        throw e;
      }
    }

    // Un-granted teacher: the admin layout refuses entry (3xx redirect).
    expect((await resOf(run(layoutLoader, get("/admin/assessment", teacherT.cookie)))).status).toBeGreaterThanOrEqual(300);

    // A student (rank 1) is also refused by the layout.
    expect((await resOf(run(layoutLoader, get("/admin/assessment", studentS.cookie)))).status).toBeGreaterThanOrEqual(300);

    // Grant authoring (read/create/edit) on the teacher role.
    for (const p of ["assessment.read", "assessment.create", "assessment.edit"]) {
      const out = await setTeacherPermission(db, sup(), p, true);
      expect(out.ok).toBe(true);
    }

    // Now the layout admits the teacher in teacherMode, and the hub loader returns authoring data.
    const laid = (await run(layoutLoader, get("/admin/assessment", teacherT.cookie))) as { teacherMode: boolean; admin: { roleId: string } };
    expect(laid.teacherMode).toBe(true);
    expect(laid.admin.roleId).toBe("teacher");

    const hub = (await run(assessmentHubLoader, get("/admin/assessment?tab=questions", teacherT.cookie))) as {
      perms: { read: boolean; create: boolean; grade: boolean };
      tab: string;
    };
    expect(hub.perms.read).toBe(true);
    expect(hub.perms.create).toBe(true);
    expect(hub.perms.grade).toBe(false);
    expect(hub.tab).toBe("questions");
  });
});
