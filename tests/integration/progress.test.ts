/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { eq } from "drizzle-orm";
import { login, registerUser } from "~server/auth/service.server";
import {
  createCourse, createGrade, createLesson, createLessonItem, createProgram, createSubject, createUnit,
} from "~server/content/service.server";
import { grantEntitlement } from "~server/entitlements/grant.server";
import { registerMockVideo } from "~server/video/service.server";
import { updateSettingsGroup } from "~server/settings/service.server";
import {
  courseProgress, continueLearning, progressStats, setLessonCompleted, getVideoProgress,
} from "~server/progress/service.server";
import { events, lessonProgress, videoProgress, videoWatchSessions } from "~server/db/schema";
import { action as beaconAction } from "~/routes/beacons.progress";
import { action as playbackAction } from "~/routes/api.playback.$videoId";

/**
 * Phase 4 progress pipeline with REAL D1 + REAL route actions: beacon auth /
 * entitlement gates, threshold completion, single lesson_complete event,
 * playback-mint watch accounting, server-enforced replay limit (+admin bypass),
 * resume positions, course %, continue-learning and stats.
 */

const db = getDb(env);
const actor = { userId: "00000000-0000-4000-8000-000000000005", role: "super_admin" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

// direct route-action context (cf.server accepts the plain { cloudflare: { env, ctx } } shape)
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

let studentId: string;
let cookie: string;
let videoId: string;
let lessonId: string;
let lesson2Id: string;
let courseId: string;
let subjectId: string;
let courseSlug: string;

function makeRequest(ip: string, cookieHeader?: string) {
  const headers: Record<string, string> = { "user-agent": UA, "cf-connecting-ip": ip };
  if (cookieHeader) headers.cookie = cookieHeader;
  return new Request("https://app.test/login", { method: "POST", headers });
}

function beaconRequest(body: unknown, cookieHeader?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": UA };
  if (cookieHeader) headers.cookie = cookieHeader;
  return new Request("https://app.test/beacons/progress", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function playbackRequest(cookieHeader?: string, video = videoId) {
  const headers: Record<string, string> = { "user-agent": UA };
  if (cookieHeader) headers.cookie = cookieHeader;
  return new Request(`https://app.test/api/playback/${video}`, { method: "POST", headers });
}

const callBeacon = (request: Request) =>
  beaconAction({ context: routeCtx, request, params: {} } as unknown as Parameters<typeof beaconAction>[0]);
const callPlayback = (request: Request) =>
  playbackAction({ context: routeCtx, request, params: { videoId } } as unknown as Parameters<typeof playbackAction>[0]);

beforeEach(async () => {
  for (const table of [
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "videos", "entitlements", "lesson_progress", "video_progress", "video_watch_sessions", "events",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
  // reset video settings to defaults (replay limit tests mutate them)
  await updateSettingsGroup(db, "video", { replayLimit: 0, completionThresholdPct: 90 }, actor);

  // student + real session cookie via register → login
  const r = crypto.randomUUID().slice(0, 8);
  const email = `prog-${r}@test.local`;
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const reg = await registerUser(env, { email, fullName: "Progress Student", password: "Str0ngPass!x" }, makeRequest(ip));
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  studentId = reg.userId;
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, makeRequest(ip));
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed: " + JSON.stringify(loggedIn));
  cookie = loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  // content chain: entitled course → unit → 2 published lessons; lesson 1 has one REQUIRED video (90s)
  const program = await createProgram(db, { titleAr: "ب", titleEn: "Prog Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Prog Grade", status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Prog Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
  subjectId = subject.id;
  courseSlug = `prog-course-${r}`;
  const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Prog Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
  courseId = course.id;
  const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "Prog Unit", status: "published", sortOrder: 0 }, actor);
  const lesson = await createLesson(db, { unitId: unit.id, titleAr: "م1", titleEn: "Prog Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  lessonId = lesson.id;
  const lesson2 = await createLesson(db, { unitId: unit.id, titleAr: "م2", titleEn: "Prog Lesson 2", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 1, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  lesson2Id = lesson2.id;

  const video = await registerMockVideo(db, { durationSeconds: 90, title: "Progress video" });
  videoId = video.id;
  await createLessonItem(db, { lessonId, itemType: "video", videoId, fileId: null, examId: null, sortOrder: 0, required: true }, actor);
});

describe("beacon route auth + entitlement gates", () => {
  it("anonymous beacon → 401; GET → 405", async () => {
    const res = await callBeacon(beaconRequest({ videoId, positionSeconds: 10 }));
    expect(res.status).toBe(401);
  });

  it("invalid payloads → 400", async () => {
    expect((await callBeacon(beaconRequest("not-json", cookie))).status).toBe(400);
    expect((await callBeacon(beaconRequest({ videoId: "nope", positionSeconds: 10 }, cookie))).status).toBe(400);
    expect((await callBeacon(beaconRequest({ videoId, positionSeconds: -5 }, cookie))).status).toBe(400);
  });

  it("student WITHOUT entitlement → 403; unknown lesson → 404", async () => {
    const denied = await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 10 }, cookie));
    expect(denied.status).toBe(403);
    // no progress rows were written
    expect(await db.select().from(videoProgress)).toHaveLength(0);

    const missing = await callBeacon(beaconRequest({ videoId, lessonId: crypto.randomUUID(), positionSeconds: 10 }, cookie));
    expect(missing.status).toBe(404);
  });

  it("unknown video → 404 (ProgressReferenceError)", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    const res = await callBeacon(beaconRequest({ videoId: crypto.randomUUID(), lessonId, positionSeconds: 10 }, cookie));
    expect(res.status).toBe(404);
  });

  it("entitled student: heartbeat upserts position + touches the lesson", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    const res = await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 30, watchedSeconds: 30 }, cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ completed: false, lessonCompleted: false, positionSeconds: 30 });

    const vp = await getVideoProgress(db, studentId, videoId);
    expect(vp).toMatchObject({ positionSeconds: 30, maxPositionSeconds: 30, completed: false });
    const lp = await db.select().from(lessonProgress).where(eq(lessonProgress.studentId, studentId));
    expect(lp).toHaveLength(1);
    expect(lp[0]).toMatchObject({ lessonId, status: "in_progress" });
  });
});

describe("threshold completion (server-decided)", () => {
  it("90% of a 90s video completes video + lesson with EXACTLY ONE lesson_complete event", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    // below threshold (81s): not completed
    const mid = await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 80 }, cookie));
    expect(await mid.json()).toMatchObject({ completed: false, lessonCompleted: false });

    const done = await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 85, kind: "ended", watchedSeconds: 85 }, cookie));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ completed: true, lessonCompleted: true });

    const evs = await db.select().from(events).where(eq(events.userId, studentId));
    const types = evs.map((e) => e.type);
    expect(types.filter((x) => x === "lesson_complete")).toHaveLength(1);
    expect(types.filter((x) => x === "video_complete")).toHaveLength(1);

    // an extra beacon never duplicates completion events
    await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 86, kind: "ended" }, cookie));
    const after = await db.select().from(events).where(eq(events.userId, studentId));
    expect(after.map((e) => e.type).filter((x) => x === "lesson_complete")).toHaveLength(1);

    // ended beacon closed the watch session (session only exists after a mint — none here)
    const lp = await db.select().from(lessonProgress).where(eq(lessonProgress.studentId, studentId));
    expect(lp[0].status).toBe("completed");
  });
});

describe("playback route: watch accounting, resume, replay limit", () => {
  it("anonymous mint → 401; non-entitled → 403", async () => {
    expect((await callPlayback(playbackRequest())).status).toBe(401);
    expect((await callPlayback(playbackRequest(cookie))).status).toBe(403);
  });

  it("mint → watch_count 1 + resumeAt 0; after a 30s beacon the next mint resumes at 30", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);

    const first = await callPlayback(playbackRequest(cookie));
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { resumeAt: number; url: string };
    expect(firstJson.resumeAt).toBe(0);
    expect(firstJson.url).toBeTruthy();
    const vp1 = await getVideoProgress(db, studentId, videoId);
    expect(vp1).toMatchObject({ watchCount: 1, positionSeconds: 0 });
    // a watch session was opened by the mint
    const sessions = await db.select().from(videoWatchSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].endedAt).toBeNull();
    // lesson marked in_progress by startWatch
    const lp = await db.select().from(lessonProgress).where(eq(lessonProgress.studentId, studentId));
    expect(lp[0].status).toBe("in_progress");

    await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 30, watchedSeconds: 30 }, cookie));
    // the heartbeat updated the open session's watched seconds
    const s2 = await db.select().from(videoWatchSessions);
    expect(s2[0].watchedSeconds).toBe(30);

    const second = await callPlayback(playbackRequest(cookie));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { resumeAt: number }).resumeAt).toBe(30);
    const vp2 = await getVideoProgress(db, studentId, videoId);
    expect(vp2?.watchCount).toBe(2);

    // "ended" beacon closes the newest open session
    await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 31, kind: "ended" }, cookie));
    const s3 = await db.select().from(videoWatchSessions);
    const open = s3.filter((s) => s.endedAt === null);
    expect(open).toHaveLength(1); // one of two sessions remains open (the second mint's)
    const closed = s3.filter((s) => s.endedAt !== null);
    expect(closed).toHaveLength(1);
  });

  it("completed video → resumeAt 0 (no resume past completion)", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 89, kind: "ended" }, cookie));
    const res = await callPlayback(playbackRequest(cookie));
    expect(((await res.json()) as { resumeAt: number }).resumeAt).toBe(0);
  });

  it("replayLimit=1 blocks the second mint (403 replay_limit); admins bypass", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    await updateSettingsGroup(db, "video", { replayLimit: 1 }, actor);

    expect((await callPlayback(playbackRequest(cookie))).status).toBe(200); // watchCount → 1
    const blocked = await callPlayback(playbackRequest(cookie));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: "replay_limit" });

    // promote to super_admin → bypass
    await db.run(`UPDATE users SET role_id = 'super_admin' WHERE id = '${studentId}'`);
    const adminRes = await callPlayback(playbackRequest(cookie));
    expect(adminRes.status).toBe(200);
  });
});

describe("progress aggregates (dashboard data)", () => {
  it("courseProgress % counts published lessons; setLessonCompleted emits one event", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    expect(await courseProgress(db, studentId, courseId)).toMatchObject({ total: 2, completed: 0, pct: 0 });

    await setLessonCompleted(db, studentId, lessonId, true);
    expect(await courseProgress(db, studentId, courseId)).toMatchObject({ total: 2, completed: 1, pct: 50 });

    // idempotent: second completion does not duplicate the event
    await setLessonCompleted(db, studentId, lessonId, true);
    const evs = await db.select().from(events).where(eq(events.userId, studentId));
    expect(evs.map((e) => e.type).filter((x) => x === "lesson_complete")).toHaveLength(1);

    // un-mark → in_progress, pct drops
    await setLessonCompleted(db, studentId, lessonId, false);
    expect(await courseProgress(db, studentId, courseId)).toMatchObject({ completed: 0, pct: 0 });
    await setLessonCompleted(db, studentId, lessonId, true);
  });

  it("continueLearning + progressStats reflect real rows", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    await setLessonCompleted(db, studentId, lesson2Id, true);
    await callBeacon(beaconRequest({ videoId, lessonId, positionSeconds: 45 }, cookie));

    const items = await continueLearning(db, studentId, 5);
    expect(items.length).toBe(2);
    const byLesson = Object.fromEntries(items.map((i) => [i.lessonSlug, i]));
    const touched = items[0]; // most recent activity = the beacon-touched lesson
    expect(touched.status).toBe("in_progress");
    expect(touched.resumePositionSeconds).toBe(45);
    expect(byLesson).toBeDefined();

    const stats = await progressStats(db, studentId);
    expect(stats).toMatchObject({ completedLessons: 1, inProgressLessons: 1, completedVideos: 0 });
  });
});
