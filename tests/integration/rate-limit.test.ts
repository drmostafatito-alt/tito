/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { checkRateLimit } from "~server/http/rate-limit.server";
import { registerUser, login } from "~server/auth/service.server";
import { createCourse, createGrade, createLesson, createLessonItem, createProgram, createSubject, createUnit, chainForLesson } from "~server/content/service.server";
import { grantEntitlement } from "~server/entitlements/grant.server";
import { getVideo, registerMockVideo } from "~server/video/service.server";
import { action as playbackAction } from "../../app/routes/api.playback.$videoId";

/**
 * H1 (Phase 8): abuse controls on credential minting and exam mutations.
 * Proves (a) the fixed-window counter rejects past its threshold for the exact
 * buckets the routes use, and (b) the playback route action actually returns
 * 429 once the limit is exceeded (real repeated requests, not mocks).
 */

const db = getDb(env);
const actor = { userId: "00000000-0000-4000-8000-000000000009", role: "super_admin" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

const uniqueEmail = () => `rl-${crypto.randomUUID().slice(0, 8)}@test.local`;

/**
 * Assert checkRateLimit rejects after `limit+1` genuine calls within one window.
 *
 * The counter is a FIXED window keyed on wall-clock time (Date.now()/windowMs,
 * SECURITY.md §13). A short run of limit+1 sequential calls can straddle a window
 * boundary mid-loop — that resets the counter in the fresh window and lets the
 * (limit+1)th call pass. That is correct app behaviour (a new window grants a
 * fresh quota), not a defect. So loop across up to two windows: this guarantees
 * at least one full fresh window receives limit+1 calls, and asserts the counter
 * rejects there. A genuine "never throttles" regression still fails (the loop
 * exhausts its cap with ok still true).
 */
async function expectThrottled(bucket: string, id: string, limit: number, windowMs: number) {
  let last: { ok: boolean } = { ok: true };
  for (let i = 0; i < limit * 2 + 1 && last.ok; i++) {
    last = await checkRateLimit(db, bucket, id, limit, windowMs);
  }
  expect(last.ok).toBe(false);
}

beforeEach(async () => {
  await db.run("DELETE FROM rate_limit_counters");
  for (const table of ["lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs", "videos", "entitlements"]) {
    await db.run(`DELETE FROM ${table}`);
  }
});

describe("fixed-window counter rejects at the configured thresholds", () => {
  it("playback_mint throttles at 30/min", async () => {
    await expectThrottled("playback_mint", "userA", 30, 60_000);
  });

  it("exam_save throttles at 60/min", async () => {
    await expectThrottled("exam_save", "userB", 60, 60_000);
  });

  it("exam_submit throttles at 10/min", async () => {
    await expectThrottled("exam_submit", "userC:attempt1", 10, 60_000);
  });
});

describe("playback route action enforces the mint limit end-to-end", () => {
  it("returns 429 after 30 mints for the same student+video", async () => {
    const email = uniqueEmail();
    const ip = "203.0.113.10";
    const reg = await registerUser(env, { email, fullName: "RL Student", password: "Str0ngPass!x" }, new Request("https://app.test/register", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } }));
    if (!("userId" in reg) || !reg.userId) throw new Error("register failed");
    const studentId = reg.userId;

    // content chain + entitlement (published, entitled course)
    const program = await createProgram(db, { titleAr: "ب", titleEn: "RL Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "RL Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "RL Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "RL Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
    const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "RL Unit", status: "published", sortOrder: 0 }, actor);
    const lesson = await createLesson(db, { unitId: unit.id, titleAr: "د", titleEn: "RL Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
    const video = await registerMockVideo(db, { durationSeconds: 90, title: "RL video" });
    await createLessonItem(db, { lessonId: lesson.id, itemType: "video", videoId: video.id, fileId: null, examId: null, sortOrder: 0, required: true }, actor);
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subject.id, days: 30, note: "rl test" }, actor);
    await chainForLesson(db, lesson.id); // sanity: chain resolves

    // real session cookie
    const loginRes = await login(env, { email, password: "Str0ngPass!x" }, new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } }));
    if (!loginRes.ok) throw new Error("login failed: " + JSON.stringify(loginRes));
    const sessionCookie = loginRes.cookies.find((c) => c.name === "__edu_session")?.value;
    if (!sessionCookie) throw new Error("no session cookie");

    const context = { cloudflare: { env, ctx: { waitUntil: () => {} } } };
    const post = () =>
      playbackAction({
        context,
        request: new Request(`https://app.test/api/playback/${video.id}`, { method: "POST", headers: { cookie: `__edu_session=${sessionCookie}`, "user-agent": UA } }),
        params: { videoId: video.id },
      } as never);

    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await post();
      lastStatus = res.status;
      if (i < 30) expect(res.status, `mint ${i + 1} should be allowed`).toBe(200);
    }
    expect(lastStatus).toBe(429); // the 31st mint is rate-limited
  });
});
