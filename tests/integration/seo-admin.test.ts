/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { registerUser, login } from "~server/auth/service.server";
import { createCourse, createGrade, createProgram, createSubject } from "~server/content/service.server";
import { updateSettingsGroup } from "~server/settings/service.server";
import { sql } from "drizzle-orm";
import { loader as adminSeoLoader } from "~/routes/admin.seo";

/**
 * Batch 6 regression — /admin/seo dashboard.
 *
 * The panel must be: (1) access-gated (platform staff only), (2) factual —
 * every finding backed by real rows, (3) in lockstep with the sitemap
 * inventory (same function), (4) never leaking private data (paths only,
 * no student/user/activation data).
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const db = getDb(env);

let superA: { id: string; cookie: string };
let student: { id: string; cookie: string };

async function wipe() {
  for (const table of [
    "form_submissions", "form_fields", "forms", "menu_items", "menus",
    "page_versions", "blocks", "pages", "page_templates", "role_permissions",
    "units", "lesson_items", "lessons", "courses", "subjects", "grades", "programs", "files",
    "audit_logs", "security_events", "events", "announcements",
    "orders", "order_items", "products", "price_plans", "product_items",
    "entitlements", "activation_codes", "activation_code_batches", "activation_code_redemptions",
    "assignments", "assignment_submissions",
    "video_progress", "video_watch_sessions", "videos",
    "sessions", "devices", "password_reset_tokens", "users",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
  await db.run(`DELETE FROM settings`);
}
beforeEach(wipe);

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
  return { id: reg.userId, cookie: loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

const call = async (cookie: string) =>
  (adminSeoLoader as (a: unknown) => unknown)({
    context: { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } },
    request: new Request("https://app.test/admin/seo", { method: "GET", headers: { "user-agent": UA, cookie } }),
  });

beforeEach(async () => {
  superA = await makeUser("seo-super", "super_admin");
  student = await makeUser("seo-student", "student");
});

describe("/admin/seo access control", () => {
  it("rank>=3 can open the dashboard", async () => {
    const data = (await call(superA.cookie)) as { urls: unknown[] };
    expect(Array.isArray(data.urls)).toBe(true);
  });

  it("students are redirected away (no 403 reveal, no data)", async () => {
    const rejected = await call(student.cookie).catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(Response);
    expect((rejected as Response).status).toBe(302);
    expect((rejected as Response).headers.get("Location")).toBe("/dashboard?error=forbidden");
  });
});

describe("/admin/seo factual audit", () => {
  it("flags published courses without a description and names the rows", async () => {
    const actor = { userId: superA.id, role: "super_admin" };
    const program = await createProgram(db, { titleAr: "ب", titleEn: "P", status: "published", sortOrder: 0, descriptionAr: "وصف", descriptionEn: "d" }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "G", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "S", status: "published", sortOrder: 0, descriptionAr: "مادة", descriptionEn: "Subject desc", thumbnailFileId: null }, actor);
    await createCourse(db, { subjectId: subject.id, titleAr: "كورس بلا وصف", titleEn: "NoDesc Course", status: "published", visibility: "catalog", accessLevel: "public", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
    await createCourse(db, { subjectId: subject.id, titleAr: "كورس بصف", titleEn: "WithDesc Course", status: "published", visibility: "catalog", accessLevel: "public", sortOrder: 1, descriptionAr: "وصف حقيقي", descriptionEn: "A real description", thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);

    const data = (await call(superA.cookie)) as {
      issues: string[];
      missingDesc: Array<{ type: string; titleAr: string; titleEn: string }>;
      counts: { courses: number; subjects: number };
    };
    expect(data.issues).toContain("missingDesc");
    expect(data.missingDesc).toHaveLength(1);
    expect(data.missingDesc[0].titleEn).toBe("NoDesc Course");
    expect(data.missingDesc[0].type).toBe("course");
    expect(data.counts.courses).toBe(2);
  });

  it("flags duplicate titles among published items of the same type", async () => {
    const actor = { userId: superA.id, role: "super_admin" };
    const program = await createProgram(db, { titleAr: "ب", titleEn: "P", status: "published", sortOrder: 0, descriptionAr: "", descriptionEn: "" }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "G", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "S", status: "published", sortOrder: 0, descriptionAr: "", descriptionEn: "", thumbnailFileId: null }, actor);
    const common = { status: "published" as const, visibility: "catalog" as const, accessLevel: "public" as const, descriptionAr: "", descriptionEn: "", thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null };
    await createCourse(db, { subjectId: subject.id, titleAr: "نفس العنوان", titleEn: "Same Title", sortOrder: 0, ...common }, actor);
    await createCourse(db, { subjectId: subject.id, titleAr: "نفس العنوان", titleEn: "Same Title", sortOrder: 1, ...common }, actor);

    const data = (await call(superA.cookie)) as { issues: string[]; dupGroups: Array<{ type: string; titleEn: string; count: number }> };
    expect(data.issues).toContain("dupTitles");
    expect(data.dupGroups).toHaveLength(1);
    expect(data.dupGroups[0]).toMatchObject({ type: "course", titleEn: "Same Title", count: 2 });
  });

  it("no-owner identity is flagged (and /about is absent from the sitemap inventory)", async () => {
    const data = (await call(superA.cookie)) as { issues: string[]; ownerConfigured: boolean; urls: Array<{ path: string }> };
    expect(data.ownerConfigured).toBe(false);
    expect(data.issues).toContain("noOwner");
    expect(data.urls.map((u) => u.path)).not.toContain("/about");
  });

  it("maintenance mode is flagged", async () => {
    await updateSettingsGroup(db, "platform", { maintenance: true }, { userId: superA.id, role: "super_admin" });
    const data = (await call(superA.cookie)) as { issues: string[]; maintenance: boolean };
    expect(data.maintenance).toBe(true);
    expect(data.issues).toContain("maintenance");
  });

  it("inventory matches the sitemap source (home + published rows only) and never private paths", async () => {
    const actor = { userId: superA.id, role: "super_admin" };
    const program = await createProgram(db, { titleAr: "ب", titleEn: "P", status: "published", sortOrder: 0, descriptionAr: "", descriptionEn: "" }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "G", status: "published", sortOrder: 0 }, actor);
    await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "S", status: "published", sortOrder: 0, descriptionAr: "", descriptionEn: "", thumbnailFileId: null }, actor);
    await createCourse(db, { subjectId: (await createSubject(db, { gradeId: grade.id, titleAr: "م2", titleEn: "S2", status: "published", sortOrder: 1, descriptionAr: "", descriptionEn: "", thumbnailFileId: null }, actor)).id, titleAr: "ك", titleEn: "C", status: "published", visibility: "catalog", accessLevel: "public", sortOrder: 0, descriptionAr: "", descriptionEn: "", thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);

    const data = (await call(superA.cookie)) as { urls: Array<{ path: string }>; issues: string[] };
    const paths = data.urls.map((u) => u.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/courses");
    expect(paths.some((p) => p.startsWith("/courses/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("/subjects/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("/grades/"))).toBe(true);
    // nothing private may ever reach the inventory
    for (const p of paths) {
      expect(["/admin", "/student", "/learn", "/login", "/register", "/files", "/api"]).not.toContain(p.split("/").slice(0, 2).join("/"));
    }
    expect(data.issues).not.toContain("robotsOverlap");
  });
});
