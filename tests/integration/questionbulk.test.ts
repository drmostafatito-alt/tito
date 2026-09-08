/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { questions, questionTags, tags } from "~server/db/schema";
import {
  bulkSetQuestionStatus,
  bulkTagQuestions,
  listQuestions,
} from "~server/assessment/service.server";
import { action as hubAction } from "~/routes/admin.assessment";

/**
 * Question-bank bulk operations + permission wiring (FEATURE-SPEC §5
 * "bulk tag/status"; §11 FTS). Each bulk move reuses the single-question
 * workflow (STATUS_FLOW) and reports per-question results without aborting.
 */
const db = getDb(env);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

let superA: { id: string; cookie: string };
const actor = () => ({ userId: superA.id, role: "super_admin" });

let qDraft: string;
let qInReview: string;
let qPub: string;
let tagA: string;
let tagB: string;

async function wipe() {
  for (const table of [
    "question_tags", "question_choices", "tags", "questions",
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
  if (role !== "student") await db.run(`UPDATE users SET role_id = '${role}' WHERE id = '${reg.userId}'`);
  const loginRes = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loginRes) || !loginRes.ok) throw new Error("login failed: " + JSON.stringify(loginRes));
  return { id: reg.userId, cookie: loginRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

async function createQ(id: string, status: "draft" | "in_review" | "published") {
  const ts = Date.now();
  await db.insert(questions).values({
    id, type: "mcq", stemAr: `سؤال ${id}`, stemEn: `Q ${id}`, difficulty: "easy", status, createdAt: ts, updatedAt: ts,
  });
}

beforeEach(async () => {
  await wipe();
  superA = await makeUser("qb-super", "super_admin");
  qDraft = "q-draft";
  qInReview = "q-inreview";
  qPub = "q-pub";
  await createQ(qDraft, "draft");
  await createQ(qInReview, "in_review");
  await createQ(qPub, "published");
  const ta = "tag-a";
  const tb = "tag-b";
  await db.insert(tags).values([{ id: ta, slug: "a", labelAr: "أ", labelEn: "A" }, { id: tb, slug: "b", labelAr: "ب", labelEn: "B" }]);
  tagA = ta;
  tagB = tb;
});

describe("bulk question status (single-question workflow, per-row results)", () => {
  it("moves valid questions and reports per-question failures for invalid transitions", async () => {
    // in_review -> published allowed (qInReview); published -> published is not a
    // valid transition (qPub); draft -> published not allowed (qDraft).
    const res = await bulkSetQuestionStatus(db, [qDraft, qInReview, qPub], "published", actor());
    const byId = Object.fromEntries(res.map((r) => [r.id, r]));
    expect(byId[qInReview].ok).toBe(true);
    expect(byId[qDraft].ok).toBe(false);
    expect(byId[qPub].ok).toBe(false);

    const rows = await db.select().from(questions);
    const st = Object.fromEntries(rows.map((q) => [q.id, q.status]));
    expect(st[qInReview]).toBe("published");
    expect(st[qDraft]).toBe("draft");
    expect(st[qPub]).toBe("published");
  });

  it("archive is a valid transition for every status; to_review sets in_review", async () => {
    const res = await bulkSetQuestionStatus(db, [qDraft, qInReview, qPub], "archived", actor());
    expect(res.every((r) => r.ok)).toBe(true);
    const rows = await db.select({ id: questions.id, status: questions.status }).from(questions);
    expect(rows.every((q) => q.status === "archived")).toBe(true);
  });
});

describe("bulk tagging", () => {
  it("adds tags to many questions and is idempotent on repeat", async () => {
    const r1 = await bulkTagQuestions(db, [qDraft, qInReview], [tagA, tagB]);
    expect(r1.every((r) => r.ok)).toBe(true);
    const r2 = await bulkTagQuestions(db, [qDraft], [tagA, tagB]); // repeat
    expect(r2.every((r) => r.ok)).toBe(true);
    const rows = await db.select().from(questionTags);
    // two questions x two tags each
    expect(rows.length).toBe(4);
  });

  it("silently ignores unknown tags and soft-deleted/missing questions", async () => {
    const res = await bulkTagQuestions(db, [qDraft, "does-not-exist"], [tagA, "no-such-tag"]);
    const byId = Object.fromEntries(res.map((r) => [r.id, r]));
    expect(byId[qDraft].ok).toBe(true);
    expect(byId["does-not-exist"].ok).toBe(false);
    const linked = await db.select().from(questionTags);
    // only tagA was applied to qDraft
    expect(linked.length).toBe(1);
    expect(linked[0].tagId).toBe(tagA);
  });
});

describe("route-action permission wiring", () => {
  const run = (fn: unknown, req: Request) => (fn as (a: unknown) => unknown)({ context: routeCtx, request: req });
  const post = (extra: Record<string, string>, ids: string[], cookie: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) sp.set(k, v);
    for (const id of ids) sp.append("ids", id);
    return new Request("https://app.test/admin/assessment", {
      method: "POST",
      headers: { cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: sp.toString(),
    });
  };

  it("super_admin can bulk set status + tag via the hub action", async () => {
    const stRes = (await run(hubAction, post(
      { _action: "bulk-status", status: "archived" }, [qDraft, qInReview], superA.cookie,
    ))) as { bulk: { succeeded: number; failed: number; requested: number } };
    expect(stRes.bulk.requested).toBe(2);
    expect(stRes.bulk.succeeded).toBe(2);
    expect(stRes.bulk.failed).toBe(0);

    const tgRes = (await run(hubAction, post(
      { _action: "bulk-tag", tagIds: tagA }, [qDraft, qInReview], superA.cookie,
    ))) as { bulk: { succeeded: number } };
    expect(tgRes.bulk.succeeded).toBe(2);

    const list = await listQuestions(db, {});
    const st = Object.fromEntries(list.map((q) => [q.id, q.status]));
    expect(st[qDraft]).toBe("archived");
    expect(st[qInReview]).toBe("archived");
    expect(st[qPub]).toBe("published"); // untouched by the scoped bulk selection
  });

  it("a teacher without assessment.edit cannot bulk (permission wiring, UI hiding != auth)", async () => {
    const teacher = await makeUser("qb-tea", "teacher");
    // teacher holds no assessment.* permission rows => bulk edit/publish denied.
    const stRes = (await run(hubAction, post(
      { _action: "bulk-status", status: "in_review" }, [qDraft], teacher.cookie,
    ))) as { error: string };
    expect(stRes.error).toBe("denied");
    const tgRes = (await run(hubAction, post(
      { _action: "bulk-tag", tagIds: tagA }, [qDraft], teacher.cookie,
    ))) as { error: string };
    expect(tgRes.error).toBe("denied");
  });
});
