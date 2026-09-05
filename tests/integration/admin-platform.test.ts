/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { createCourse, createGrade, createLesson, createProgram, createSubject, createUnit, chainForLesson } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { grantEntitlement } from "~server/entitlements/grant.server";
import { canPlatform } from "~server/auth/permissions.server";
import { adminOverview, analyticsDetail, topWatched } from "~server/analytics/service.server";
import {
  forceLogoutUser,
  listActiveSessions,
  listSecurityEvents,
  listUsers,
  resetUserDevices,
  revokeSessionAdmin,
  setUserRole,
  setUserStatus,
  userAdminDetail,
} from "~server/users/service.server";
import {
  createAnnouncement,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  publishAnnouncement,
  unreadAnnouncementsCount,
  unpublishAnnouncement,
  updateAnnouncement,
  archiveAnnouncement,
  visibleAnnouncements,
} from "~server/announcements/service.server";
import { listAuditLogs } from "~server/audit/query.server";
import {
  activationCodeRedemptions,
  activationCodes,
  announcementReads,
  announcements,
  auditLogs,
  devices,
  entitlements,
  events,
  examAttempts,
  exams,
  lessonItems,
  lessonProgress,
  orders,
  payments,
  pricePlans,
  products,
  refunds,
  securityEvents,
  sessions,
  subscriptions,
  users,
  videoProgress,
  videoWatchSessions,
} from "~server/db/schema";

import { loader as homeLoader } from "~/routes/admin/home";
import { loader as usersLoader } from "~/routes/admin.users";
import { loader as userDetailLoader, action as userDetailAction } from "~/routes/admin.users.$id";
import { loader as analyticsLoader } from "~/routes/admin.analytics";
import { loader as auditLoader } from "~/routes/admin.audit";
import * as auditRoute from "~/routes/admin.audit";
import { loader as securityLoader, action as securityAction } from "~/routes/admin.security";
import { loader as announcementsLoader, action as announcementsAction } from "~/routes/admin.announcements";
import { loader as notificationsLoader, action as notificationsAction } from "~/routes/student/notifications";
import { loader as dashboardLoader } from "~/routes/student/dashboard";

/**
 * Phase 7 admin platform on REAL D1 + REAL route loaders/actions:
 * dashboard aggregation correctness (canonical events only, date windows,
 * integer money), user management (search/filter/pagination, IDOR, rank
 * discipline, suspension enforcement), announcements (drafts never visible,
 * audiences, windows, mark-read idempotency), audit viewer (read-only),
 * security center, and RBAC on every surface.
 */

const db = getDb(env);
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };
const DAY = 86_400_000;

let superA: { id: string; email: string; cookie: string };
let adminB: { id: string; email: string; cookie: string };
let teacherT: { id: string; email: string; cookie: string };
let s1: { id: string; email: string; cookie: string };
let s2: { id: string; email: string; cookie: string };
let s3: { id: string; email: string; cookie: string };
let courseId1: string;
let lessonId1: string;
let videoId1: string;
let videoId2: string;
let examId1: string;

async function wipe() {
  for (const table of [
    "announcement_reads", "announcements",
    "subscription_events", "subscriptions",
    "refunds", "payment_events", "payments", "order_items", "orders",
    "activation_code_redemptions", "activation_codes", "activation_code_batches",
    "discount_redemptions", "discount_codes",
    "price_plans", "product_items", "products",
    "exam_answers", "exam_attempts", "exam_questions", "exams", "question_choices", "questions",
    "video_watch_sessions", "video_progress", "lesson_progress", "events",
    "entitlements",
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "audit_logs", "security_events", "rate_limit_counters",
    "sessions", "devices", "users",
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

/** Published course → unit → lesson (+2 video items) via the real content service. */
async function makeContent() {
  const actor = { userId: superA.id, role: "super_admin", ipHash: "test" };
  const program = await createProgram(db, { titleAr: "برنامج", titleEn: "Program", status: "published", sortOrder: 0 }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "صف", titleEn: "Grade", status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "مادة", titleEn: "Subject", status: "published", sortOrder: 0 }, actor);
  const course = await createCourse(
    db,
    {
      subjectId: subject.id, titleAr: "دورة", titleEn: "Course", status: "published", visibility: "catalog",
      accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null,
      teacherId: null, publishAt: null, expiresAt: null,
    },
    actor
  );
  const unit = await createUnit(db, { courseId: course.id, titleAr: "وحدة", titleEn: "Unit", status: "published", sortOrder: 0 }, actor);
  const lesson = await createLesson(
    db,
    {
      unitId: unit.id, titleAr: "درس", titleEn: "Lesson", status: "published", accessLevel: "entitled",
      freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null,
    },
    actor
  );
  courseId1 = course.id;
  lessonId1 = lesson.id;
  videoId1 = crypto.randomUUID();
  videoId2 = crypto.randomUUID();
  await db.insert(lessonItems).values([
    { id: crypto.randomUUID(), lessonId: lessonId1, itemType: "video", videoId: videoId1, sortOrder: 0, required: true, createdAt: Date.now() },
    { id: crypto.randomUUID(), lessonId: lessonId1, itemType: "video", videoId: videoId2, sortOrder: 1, required: false, createdAt: Date.now() },
  ]);
  examId1 = crypto.randomUUID();
  await db.insert(exams).values({
    id: examId1, slug: `p7-exam-${crypto.randomUUID().slice(0, 6)}`, titleAr: "امتحان", titleEn: "P7 Exam",
    config: {}, status: "published", createdBy: superA.id, createdAt: Date.now(), updatedAt: Date.now(),
  });
}

const ev = (type: string, createdAt: number, userId: string | null = null) => ({
  id: crypto.randomUUID(), type, userId, resourceType: null, resourceId: null, props: null, createdAt,
});

/** Deterministic metric fixtures — every expected number in the tests below derives from these. */
async function seedMetrics(now: number) {
  // learning: s1 + s2 entitled (enrolled=2); s1 active on 1 lesson (completed), 1 video watched
  await grantEntitlement(db, { studentId: s1.id, resourceType: "course", resourceId: courseId1, days: null }, { userId: superA.id, role: "super_admin" });
  await grantEntitlement(db, { studentId: s2.id, resourceType: "course", resourceId: courseId1, days: null }, { userId: superA.id, role: "super_admin" });
  await db.insert(lessonProgress).values({
    id: crypto.randomUUID(), studentId: s1.id, lessonId: lessonId1, status: "completed",
    completedAt: now - 3600_000, lastActivityAt: now - 3600_000, createdAt: now - 7200_000, updatedAt: now - 3600_000,
  });
  const vpId = crypto.randomUUID();
  await db.insert(videoProgress).values({
    id: vpId, studentId: s1.id, videoId: videoId1, lessonId: lessonId1, watchCount: 2, positionSeconds: 300,
    maxPositionSeconds: 400, durationSeconds: 400, completed: true, completedAt: now - 3000_000,
    lastWatchedAt: now - 3000_000, createdAt: now - 7200_000, updatedAt: now - 3000_000,
  });
  await db.insert(videoWatchSessions).values([
    { id: crypto.randomUUID(), videoProgressId: vpId, startedAt: now - 5000_000, endedAt: now - 4600_000, watchedSeconds: 400, deviceId: null },
    { id: crypto.randomUUID(), videoProgressId: vpId, startedAt: now - 4000_000, endedAt: now - 3800_000, watchedSeconds: 200, deviceId: null },
  ]);
  // events: canonical domain events (+ page_view noise that must NEVER be counted as video activity)
  await db.insert(events).values([
    ev("video_start", now - 5000_000, s1.id),
    ev("video_start", now - 4000_000, s1.id),
    ev("video_complete", now - 3000_000, s1.id),
    ev("lesson_complete", now - 2900_000, s1.id),
    ev("page_view", now - 2000_000, s1.id),
    ev("page_view", now - 1900_000, s2.id),
    ev("page_view", now - 1800_000, s2.id),
  ]);
  // exams: 3 attempts → 2 submissions, 2 graded (1 passed 80%, 1 failed 40%), 1 in progress
  await db.insert(examAttempts).values([
    { id: crypto.randomUUID(), examId: examId1, studentId: s1.id, attemptNumber: 1, status: "graded", startedAt: now - 9000_000, submittedAt: now - 8000_000, score: 8, maxScore: 10, passed: true, gradingStatus: "complete", randomSeed: 1 },
    { id: crypto.randomUUID(), examId: examId1, studentId: s2.id, attemptNumber: 1, status: "graded", startedAt: now - 8500_000, submittedAt: now - 7500_000, score: 4, maxScore: 10, passed: false, gradingStatus: "complete", randomSeed: 2 },
    { id: crypto.randomUUID(), examId: examId1, studentId: s3.id, attemptNumber: 1, status: "in_progress", startedAt: now - 1000_000, randomSeed: 3 },
  ]);
  // commerce: paid 10000 + pending 5000 in window; refund 2000; 1 payment under review; 1 redemption; 1 active subscription
  const paidOrderId = crypto.randomUUID();
  await db.insert(orders).values([
    { id: paidOrderId, orderNumber: `P7-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, studentId: s1.id, status: "paid", currency: "EGP", subtotalMinor: 10_000, discountMinor: 0, totalMinor: 10_000, source: "self", createdAt: now - 600_000, updatedAt: now - 600_000 },
    { id: crypto.randomUUID(), orderNumber: `P7-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, studentId: s2.id, status: "pending", currency: "EGP", subtotalMinor: 5_000, discountMinor: 0, totalMinor: 5_000, source: "self", createdAt: now - 500_000, updatedAt: now - 500_000 },
  ]);
  const paymentId = crypto.randomUUID();
  await db.insert(payments).values({
    id: paymentId, orderId: paidOrderId, provider: "manual", method: "instapay", amountMinor: 10_000, currency: "EGP",
    status: "under_review", createdAt: now - 590_000, updatedAt: now - 590_000,
  });
  await db.insert(refunds).values({ id: crypto.randomUUID(), paymentId, amountMinor: 2_000, reason: "partial", createdBy: superA.id, createdAt: now - 400_000 });
  const codeId = crypto.randomUUID();
  await db.insert(activationCodes).values({
    id: codeId, codeHash: crypto.randomUUID(), prefix: "P7XX", entitlementSpec: { resourceType: "course", resourceId: courseId1, days: 30 },
    maxUses: 1, useCount: 1, status: "exhausted", createdAt: now - 700_000, updatedAt: now - 300_000,
  });
  await db.insert(activationCodeRedemptions).values({ id: crypto.randomUUID(), codeId, studentId: s3.id, entitlementId: null, createdAt: now - 300_000, ipHash: "test" });
  const productId = crypto.randomUUID();
  const planId = crypto.randomUUID();
  await db.insert(products).values({
    id: productId, kind: "subscription_plan", slug: `p7-plan-${crypto.randomUUID().slice(0, 6)}`, nameAr: "خطة", nameEn: "P7 Plan",
    active: true, sortOrder: 0, createdAt: now, updatedAt: now,
  });
  await db.insert(pricePlans).values({
    id: planId, productId, currency: "EGP", amountMinor: 5_000, kind: "recurring", period: "monthly",
    active: true, sortOrder: 0, createdAt: now, updatedAt: now,
  });
  await db.insert(subscriptions).values({
    id: crypto.randomUUID(), studentId: s1.id, pricePlanId: planId,
    planSnapshot: { titleAr: "اشتراك شهري", titleEn: "Monthly", orderId: null, orderNumber: null, productId, currency: "EGP", amountMinor: 5_000, period: "monthly" },
    status: "active", startedAt: now - 20 * DAY, currentPeriodStart: now - 5 * DAY, currentPeriodEnd: now + 25 * DAY,
    autoRenew: false, createdAt: now - 20 * DAY, updatedAt: now,
  });
}

// ---- route call helpers -----------------------------------------------------
const call = (fn: unknown, req: Request, params: Record<string, string> = {}) =>
  (fn as (args: unknown) => unknown)({ context: routeCtx, request: req, params });

const get = (path: string, cookie?: string) =>
  new Request(`https://app.test${path}`, { method: "GET", headers: cookie ? { cookie, "user-agent": UA } : { "user-agent": UA } });

const post = (path: string, body: Record<string, string>, cookie?: string) =>
  new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie, "user-agent": UA } : { "user-agent": UA }) },
    body: new URLSearchParams(body).toString(),
  });

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

async function accessAllowed(studentId: string): Promise<boolean> {
  const chain = await chainForLesson(db, lessonId1);
  if (!chain) throw new Error("no chain");
  const verdict = await resolveContentAccess(db, { userId: studentId, roleRank: 1 }, chain);
  return verdict.allowed;
}

/** Narrow an AnnActionResult to its new id (throws loudly if creation failed). */
function annId(r: { ok: true; id?: string } | { ok: false; error: string }): string {
  if (!r.ok || !r.id) throw new Error("announcement create failed: " + JSON.stringify(r));
  return r.id;
}

const auditRows = async (action: string) =>
  db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(sql`created_at DESC`);

const noSecrets = (data: unknown, extra: string[] = []) => {
  const json = JSON.stringify(data);
  expect(json).not.toMatch(/password_hash|passwordHash|token_hash|tokenHash|key_hash|keyHash|user_agent_hash|userAgentHash|\$2[aby]\$/);
  for (const s of extra) expect(json).not.toContain(s);
};

beforeEach(async () => {
  await wipe();
  // RBAC tests below DELETE admin role_permissions; restore the migration-0007 seed each time
  await db.run(sql`INSERT OR IGNORE INTO role_permissions (role_id, permission, granted_at) VALUES
    ('admin', 'users.read', (strftime('%s','now') * 1000)),
    ('admin', 'users.manage', (strftime('%s','now') * 1000)),
    ('admin', 'analytics.read', (strftime('%s','now') * 1000)),
    ('admin', 'security.read', (strftime('%s','now') * 1000)),
    ('admin', 'audit.read', (strftime('%s','now') * 1000)),
    ('admin', 'announcements.manage', (strftime('%s','now') * 1000))`);
  superA = await makeUser("super", "super_admin");
  adminB = await makeUser("admin", "admin");
  teacherT = await makeUser("teach", "teacher");
  s1 = await makeUser("s1");
  s2 = await makeUser("s2");
  s3 = await makeUser("s3");
  await makeContent();
});

describe("dashboard aggregation correctness (P7 §3/§5)", () => {
  it("computes every metric group from the seeded fixtures exactly", async () => {
    const now = Date.now();
    await seedMetrics(now);
    const o = await adminOverview(db, "all");

    // users — 6 fixtures, 3 students, 2 admins (admin+super)
    expect(o.users.total).toBe(6);
    expect(o.users.students).toBe(3);
    expect(o.users.admins).toBe(2);
    expect(o.users.newInWindow).toBe(6);
    expect(o.users.recent.length).toBeLessThanOrEqual(5);

    // learning
    expect(o.learning.enrolledStudents).toBe(2);
    expect(o.learning.activeLearners).toBe(1);
    expect(o.learning.completedLessons).toBe(1);
    expect(o.learning.watchedVideos).toBe(1);

    // video — canonical events only; the 3 page_view rows must NOT inflate anything
    expect(o.video.watchedSeconds).toBe(600);
    expect(o.video.starts).toBe(2);
    expect(o.video.completions).toBe(1);
    expect(o.video.lessonCompletions).toBe(1);

    // exams
    expect(o.exams.attempts).toBe(3);
    expect(o.exams.submissions).toBe(2);
    expect(o.exams.graded).toBe(2);
    expect(o.exams.passed).toBe(1);
    expect(o.exams.passRatePct).toBe(50);
    expect(o.exams.avgScorePct).toBe(60); // (80 + 40) / 2

    // commerce — integer minor units only
    expect(o.commerce.orders).toBe(2);
    expect(o.commerce.paidOrders).toBe(1);
    expect(o.commerce.pendingOrders).toBe(1);
    expect(o.commerce.grossRevenueMinor).toBe(10_000);
    expect(o.commerce.refundedMinor).toBe(2_000);
    expect(o.commerce.netRevenueMinor).toBe(8_000);
    expect(Number.isInteger(o.commerce.grossRevenueMinor)).toBe(true);
    expect(Number.isInteger(o.commerce.netRevenueMinor)).toBe(true);
    expect(o.commerce.pendingPaymentReview).toBe(1);
    expect(o.commerce.redemptions).toBe(1);
    expect(o.commerce.activeSubscriptions).toBe(1);
  });

  it("applies date windows server-side (today / 30d / all)", async () => {
    const now = Date.now();
    await seedMetrics(now);
    // out-of-window paid order (40 days old) + old video_start (25h old)
    await db.insert(orders).values({
      id: crypto.randomUUID(), orderNumber: `P7OLD-${crypto.randomUUID().slice(0, 6)}`, studentId: s2.id, status: "paid",
      currency: "EGP", subtotalMinor: 20_000, discountMinor: 0, totalMinor: 20_000, source: "self",
      createdAt: now - 40 * DAY, updatedAt: now - 40 * DAY,
    });
    await db.insert(events).values(ev("video_start", now - 25 * 3600_000, s1.id));

    const d30 = await adminOverview(db, "30d");
    expect(d30.commerce.grossRevenueMinor).toBe(10_000); // 40d-old order excluded
    expect(d30.video.starts).toBe(3); // the 25h-old start IS inside the 30d window

    const all = await adminOverview(db, "all");
    expect(all.commerce.grossRevenueMinor).toBe(30_000);
    expect(all.video.starts).toBe(3);

    // "today" = UTC midnight boundary; expected value derived from the same definition
    // (keeps the assertion deterministic regardless of when the suite runs)
    const today = await adminOverview(db, "today");
    const midnightRow = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(events)
      .where(sql`type = 'video_start' AND created_at >= ${now - (now % DAY)}`);
    expect(today.video.starts).toBe(Number(midnightRow[0].n));
    expect(today.video.starts).toBeLessThanOrEqual(3);
    expect(today.commerce.grossRevenueMinor).toBeLessThanOrEqual(all.commerce.grossRevenueMinor);
  });

  it("serves real metrics through the /admin loader with ?range=", async () => {
    const now = Date.now();
    await seedMetrics(now);
    await db.insert(orders).values({
      id: crypto.randomUUID(), orderNumber: `P7OLD2-${crypto.randomUUID().slice(0, 5)}`, studentId: s2.id, status: "paid",
      currency: "EGP", subtotalMinor: 20_000, discountMinor: 0, totalMinor: 20_000, source: "self",
      createdAt: now - 40 * DAY, updatedAt: now - 40 * DAY,
    });

    const d = (await call(homeLoader, get("/admin?range=30d", superA.cookie))) as { overview: { commerce: { grossRevenueMinor: number }; users: { total: number } }; maintenance: boolean };
    expect(d.overview.commerce.grossRevenueMinor).toBe(10_000);
    expect(d.overview.users.total).toBe(6);
    expect(d.maintenance).toBe(false);

    const a = (await call(homeLoader, get("/admin?range=all", superA.cookie))) as { overview: { commerce: { grossRevenueMinor: number } } };
    expect(a.overview.commerce.grossRevenueMinor).toBe(30_000);
  });

  it("renders honest empty states (zeroes + null rates) on a fresh platform", async () => {
    const o = await adminOverview(db, "30d");
    expect(o.users.total).toBe(6); // fixtures exist; metrics do not
    expect(o.learning.enrolledStudents).toBe(0);
    expect(o.video.watchedSeconds).toBe(0);
    expect(o.exams.attempts).toBe(0);
    expect(o.exams.passRatePct).toBeNull();
    expect(o.exams.avgScorePct).toBeNull();
    expect(o.commerce.grossRevenueMinor).toBe(0);
    expect(o.recentActivity).toEqual([]);
  });

  it("never double-counts: repeated reads are stable and page_view is not video activity", async () => {
    const now = Date.now();
    await seedMetrics(now);
    const a = await adminOverview(db, "all", now);
    const b = await adminOverview(db, "all", now);
    expect(b.video.starts).toBe(a.video.starts);
    expect(b.commerce.grossRevenueMinor).toBe(a.commerce.grossRevenueMinor);
    expect(a.video.starts).toBe(2); // 3 page_views + 2 real starts → exactly 2
  });

  it("topWatched ranks by watched seconds with lesson titles (no N+1)", async () => {
    const now = Date.now();
    await seedMetrics(now);
    const vp2 = crypto.randomUUID();
    await db.insert(videoProgress).values({
      id: vp2, studentId: s2.id, videoId: videoId2, lessonId: lessonId1, watchCount: 1, positionSeconds: 10,
      maxPositionSeconds: 10, durationSeconds: 100, completed: false, completedAt: null,
      lastWatchedAt: now - 100_000, createdAt: now - 100_000, updatedAt: now - 100_000,
    });
    await db.insert(videoWatchSessions).values({ id: crypto.randomUUID(), videoProgressId: vp2, startedAt: now - 100_000, endedAt: now - 99_000, watchedSeconds: 50, deviceId: null });
    const top = await topWatched(db, "all", Date.now(), 5);
    expect(top.length).toBe(2);
    expect(top[0].videoId).toBe(videoId1);
    expect(top[0].seconds).toBe(600);
    expect(top[0].plays).toBe(2);
    expect(top[0].lessonTitleEn).toBe("Lesson");
    expect(top[1].seconds).toBe(50);
  });

  it("analyticsDetail groups events, daily watch time, orders and exam performance", async () => {
    const now = Date.now();
    await seedMetrics(now);
    const d = await analyticsDetail(db, "all");
    const byType = Object.fromEntries(d.eventBreakdown.map((e) => [e.type, e.count]));
    expect(byType.video_start).toBe(2);
    expect(byType.page_view).toBe(3);
    expect(byType.lesson_complete).toBe(1);
    expect(d.watchDaily.reduce((s, r) => s + r.seconds, 0)).toBe(600);
    expect(d.examPerformance.length).toBe(1);
    expect(d.examPerformance[0].attempts).toBe(3);
    expect(d.examPerformance[0].graded).toBe(2);
    expect(d.examPerformance[0].passed).toBe(1);
    expect(d.examPerformance[0].avgPct).toBe(60);
    const paid = d.ordersByStatus.find((o) => o.status === "paid");
    expect(paid?.count).toBe(1);
    expect(paid?.totalMinor).toBe(10_000);
    // analytics route serves it (RBAC-checked surface)
    const rd = (await call(analyticsLoader, get("/admin/analytics?range=all", superA.cookie))) as { detail: { eventBreakdown: Array<{ type: string }> } };
    expect(rd.detail.eventBreakdown.length).toBeGreaterThan(0);
  });
});

describe("RBAC on every P7 surface (P7 §15/§17)", () => {
  it("canPlatform: rank-4 bypass, rank-3 via role_permissions, rank<3 never", async () => {
    expect(await canPlatform(db, { user: { rank: 4, roleId: "super_admin" } }, "users.manage")).toBe(true);
    expect(await canPlatform(db, { user: { rank: 3, roleId: "admin" } }, "users.read")).toBe(true); // seeded by 0007
    expect(await canPlatform(db, { user: { rank: 3, roleId: "admin" } }, "analytics.read")).toBe(true);
    await db.run(sql`DELETE FROM role_permissions WHERE role_id = 'admin' AND permission = 'analytics.read'`);
    expect(await canPlatform(db, { user: { rank: 3, roleId: "admin" } }, "analytics.read")).toBe(false);
    expect(await canPlatform(db, { user: { rank: 2, roleId: "teacher" } }, "users.read")).toBe(false);
    expect(await canPlatform(db, { user: { rank: 1, roleId: "student" } }, "audit.read")).toBe(false);
    expect(await canPlatform(db, null, "users.read")).toBe(false);
  });

  it("students are redirected away from every admin route (no 200, no data)", async () => {
    for (const path of ["/admin/users", "/admin/analytics", "/admin/audit", "/admin/security", "/admin/announcements"]) {
      const res = await catchResponse(call(path === "/admin/users" ? usersLoader : path === "/admin/analytics" ? analyticsLoader : path === "/admin/audit" ? auditLoader : path === "/admin/security" ? securityLoader : announcementsLoader, get(path, s1.cookie)) as Promise<unknown>);
      expect(res.status, path).toBeGreaterThanOrEqual(300);
      expect(res.status, path).toBeLessThan(400);
    }
  });

  it("each admin route 403s without its specific permission (UI hiding is not authorization)", async () => {
    await db.run(sql`DELETE FROM role_permissions WHERE role_id = 'admin'`);
    const cases: Array<[string, unknown, Request]> = [
      ["users", usersLoader, get("/admin/users", adminB.cookie)],
      ["analytics", analyticsLoader, get("/admin/analytics", adminB.cookie)],
      ["audit", auditLoader, get("/admin/audit", adminB.cookie)],
      ["security", securityLoader, get("/admin/security", adminB.cookie)],
      ["announcements", announcementsLoader, get("/admin/announcements", adminB.cookie)],
    ];
    for (const [name, ldr, req] of cases) {
      const res = await catchResponse(call(ldr as never, req) as Promise<unknown>);
      expect(res.status, name).toBe(403);
    }
    // user detail too
    const res = await catchResponse(call(userDetailLoader, get(`/admin/users/${s1.id}`, adminB.cookie), { id: s1.id }) as Promise<unknown>);
    expect(res.status).toBe(403);
  });

  it("home hides metrics without analytics.read but still works (maintenance stays)", async () => {
    await db.run(sql`DELETE FROM role_permissions WHERE role_id = 'admin' AND permission = 'analytics.read'`);
    const d = (await call(homeLoader, get("/admin", adminB.cookie))) as { canAnalytics: boolean; overview: unknown; maintenance: boolean };
    expect(d.canAnalytics).toBe(false);
    expect(d.overview).toBeNull();
    expect(d.maintenance).toBe(false);
  });

  it("admin actions deny without users.manage / announcements.manage even with valid sessions", async () => {
    await db.run(sql`DELETE FROM role_permissions WHERE role_id = 'admin'`);
    const r1 = (await call(userDetailAction, post(`/admin/users/${s1.id}`, { _action: "force-logout" }, adminB.cookie), { id: s1.id })) as { error?: string };
    expect(r1.error).toBe("denied");
    const r2 = (await call(announcementsAction, post("/admin/announcements", { _action: "create", titleAr: "x", titleEn: "x", bodyAr: "", bodyEn: "", audience: "all" }, adminB.cookie))) as { error?: string };
    expect(r2.error).toBe("denied");
    const r3 = (await call(securityAction, post("/admin/security", { _action: "force-logout", userId: s1.id }, adminB.cookie))) as { error?: string };
    expect(r3.error).toBe("denied");
  });
});

describe("user management (P7 §6/§7/§14)", () => {
  it("lists users with search, role and status filters + pagination", async () => {
    // 25 lightweight rows for pagination (page size 20)
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      await db.insert(users).values({
        id: crypto.randomUUID(), email: `bulk${i}@test.local`, passwordHash: "x", fullName: `Bulk ${i}`,
        roleId: "student", status: "active", localePref: "ar", createdAt: now - i * 1000, updatedAt: now,
      });
    }
    const all = await listUsers(db, {});
    expect(all.total).toBe(31); // 6 fixtures + 25
    expect(all.rows.length).toBe(20);
    const p2 = await listUsers(db, { page: 2 });
    expect(p2.rows.length).toBe(11);

    const byMail = await listUsers(db, { q: "bulk7@" });
    expect(byMail.total).toBe(1);
    const byName = await listUsers(db, { q: "s1 Tester" });
    expect(byName.total).toBe(1);
    const byRole = await listUsers(db, { role: "teacher" });
    expect(byRole.total).toBe(1);
    await setUserStatus(db, s2.id, "suspended", { userId: superA.id, role: "super_admin", rank: 4 });
    const byStatus = await listUsers(db, { status: "suspended" });
    expect(byStatus.total).toBe(1);
    expect(byStatus.rows[0].id).toBe(s2.id);

    // through the route
    const d = (await call(usersLoader, get("/admin/users?q=bulk&role=student", adminB.cookie))) as { users: { total: number } };
    expect(d.users.total).toBe(25);
  });

  it("detail aggregates entitlements/progress/attempts/orders/devices/sessions/security WITHOUT secrets", async () => {
    const now = Date.now();
    await seedMetrics(now);
    const d = await userAdminDetail(db, s1.id);
    expect(d).not.toBeNull();
    expect(d!.user.email).toBe(s1.email);
    expect(d!.counts.activeEntitlements).toBe(1);
    expect(d!.counts.lessonsCompleted).toBe(1);
    expect(d!.counts.attempts).toBe(1);
    expect(d!.counts.orders).toBe(1);
    expect(d!.recentProgress[0].titleEn).toBe("Lesson");
    expect(d!.recentAttempts[0].examTitleEn).toBe("P7 Exam");
    expect(d!.recentOrders.length).toBe(1);
    expect(d!.activeSessions.length).toBe(1);
    expect(d!.devicesList.length).toBe(1);
    expect(d!.entitlements[0].resourceType).toBe("course");
    noSecrets(d);
    // through the route
    const rd = (await call(userDetailLoader, get(`/admin/users/${s1.id}`, adminB.cookie), { id: s1.id })) as Record<string, unknown>;
    noSecrets(rd);
  });

  it("404s on unknown ids (no enumeration oracle beyond existence)", async () => {
    const res = await catchResponse(call(userDetailLoader, get(`/admin/users/${crypto.randomUUID()}`, superA.cookie), { id: crypto.randomUUID() }) as Promise<unknown>);
    expect(res.status).toBe(404);
  });

  it("suspension revokes sessions immediately, blocks login, and is audited", async () => {
    // s1 session works before
    await expect(call(notificationsLoader, get("/notifications", s1.cookie))).resolves.toBeTruthy();
    const res = await setUserStatus(db, s1.id, "suspended", { userId: adminB.id, role: "admin", rank: 3 });
    expect(res.ok).toBe(true);

    // session dead: guarded route now redirects
    const redirected = await catchResponse(call(notificationsLoader, get("/notifications", s1.cookie)) as Promise<unknown>);
    expect(redirected.status).toBeGreaterThanOrEqual(300);

    // login blocked while suspended
    const bad = await login(env, { email: s1.email, password: "Str0ngPass!x" }, new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA } }));
    expect("ok" in bad && bad.ok).toBe(false);

    // audited + security event
    const audit = await auditRows("users.status");
    expect(audit.length).toBe(1);
    expect((audit[0].after as { status: string }).status).toBe("suspended");
    const secCount = await db.$count(securityEvents, sql`type = 'sessions_revoked_all' AND user_id = ${s1.id}`);
    expect(secCount).toBe(1);

    // idempotent re-suspend
    const again = await setUserStatus(db, s1.id, "suspended", { userId: adminB.id, role: "admin", rank: 3 });
    expect(again.ok && again.changed).toBe(0);

    // reactivate → login works again (device list reset first: device policy max=1 still holds the old device)
    await setUserStatus(db, s1.id, "active", { userId: superA.id, role: "super_admin", rank: 4 });
    await resetUserDevices(db, s1.id, { userId: superA.id, role: "super_admin", rank: 4 });
    const ok = await login(env, { email: s1.email, password: "Str0ngPass!x" }, new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA } }));
    expect("ok" in ok && ok.ok).toBe(true);
  });

  it("rank discipline: no self actions, no acting on peers/superiors", async () => {
    const adminActor = { userId: adminB.id, role: "admin", rank: 3 };
    expect((await setUserStatus(db, adminB.id, "suspended", adminActor)).ok).toBe(false); // self
    const selfRes = await setUserStatus(db, adminB.id, "suspended", adminActor);
    expect(!selfRes.ok && selfRes.error).toBe("self");
    const peerRes = await setUserStatus(db, superA.id, "suspended", adminActor);
    expect(!peerRes.ok && peerRes.error).toBe("forbidden_rank");
    // super CAN suspend admin
    expect((await setUserStatus(db, adminB.id, "suspended", { userId: superA.id, role: "super_admin", rank: 4 })).ok).toBe(true);
    await setUserStatus(db, adminB.id, "active", { userId: superA.id, role: "super_admin", rank: 4 });
  });

  it("role changes: rank-4 only, audited, last-super-admin lockout", async () => {
    const adminActor = { userId: adminB.id, role: "admin", rank: 3 };
    const denied = await setUserRole(db, s1.id, "admin", adminActor);
    expect(!denied.ok && denied.error).toBe("forbidden");

    const superActor = { userId: superA.id, role: "super_admin", rank: 4 };
    const ok = await setUserRole(db, s1.id, "teacher", superActor);
    expect(ok.ok).toBe(true);
    const audit = await auditRows("users.role");
    expect(audit.length).toBe(1);
    expect((audit[0].after as { roleId: string }).roleId).toBe("teacher");

    // self role change blocked even for super
    const selfRes = await setUserRole(db, superA.id, "student", superActor);
    expect(!selfRes.ok && selfRes.error).toBe("self");

    // last active super_admin cannot be demoted (defense in depth via ghost actor)
    const ghost = { userId: "00000000-0000-4000-8000-ffffffffffff", role: "super_admin", rank: 4 };
    const lockout = await setUserRole(db, superA.id, "admin", ghost);
    expect(!lockout.ok && lockout.error).toBe("last_super_admin");
  });

  it("force logout / device reset / single-session revoke kill the right sessions only", async () => {
    // s2 force logout by admin
    const res = await forceLogoutUser(db, s2.id, { userId: adminB.id, role: "admin", rank: 3 });
    expect(res.ok).toBe(true);
    expect((res as { changed?: number }).changed).toBe(1);
    const dead = await catchResponse(call(notificationsLoader, get("/notifications", s2.cookie)) as Promise<unknown>);
    expect(dead.status).toBeGreaterThanOrEqual(300);
    expect((await auditRows("users.force_logout")).length).toBe(1);
    // other users unaffected
    await expect(call(notificationsLoader, get("/notifications", s1.cookie))).resolves.toBeTruthy();

    // device reset for s3 → device revoked, session dead, re-login possible
    await resetUserDevices(db, s3.id, { userId: superA.id, role: "super_admin", rank: 4 });
    const dev = await db.select().from(devices).where(eq(devices.userId, s3.id));
    expect(dev.every((d) => d.status === "revoked")).toBe(true);
    const dead3 = await catchResponse(call(notificationsLoader, get("/notifications", s3.cookie)) as Promise<unknown>);
    expect(dead3.status).toBeGreaterThanOrEqual(300);
    const relog = await login(env, { email: s3.email, password: "Str0ngPass!x" }, new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA } }));
    expect("ok" in relog && relog.ok).toBe(true);

    // single session revoke via security-center service + idempotency + self/rank guards
    const sess = await db.select({ id: sessions.id }).from(sessions).where(sql`user_id = ${s1.id} AND revoked_at IS NULL`);
    const one = await revokeSessionAdmin(db, sess[0].id, { userId: adminB.id, role: "admin", rank: 3 });
    expect(one.ok).toBe(true);
    const twice = await revokeSessionAdmin(db, sess[0].id, { userId: adminB.id, role: "admin", rank: 3 });
    expect(twice.ok && twice.changed).toBe(0);
    const selfSess = await db.select({ id: sessions.id }).from(sessions).where(sql`user_id = ${adminB.id} AND revoked_at IS NULL`);
    const selfRes = await revokeSessionAdmin(db, selfSess[0].id, { userId: adminB.id, role: "admin", rank: 3 });
    expect(!selfRes.ok && selfRes.error).toBe("self");
    const superSess = await db.select({ id: sessions.id }).from(sessions).where(sql`user_id = ${superA.id} AND revoked_at IS NULL`);
    const rankRes = await revokeSessionAdmin(db, superSess[0].id, { userId: adminB.id, role: "admin", rank: 3 });
    expect(!rankRes.ok && rankRes.error).toBe("forbidden_rank");
  });

  it("entitlement revoke from user detail flows through the EXISTING resolver (P7 §8)", async () => {
    const now = Date.now();
    await seedMetrics(now);
    expect(await accessAllowed(s1.id)).toBe(true);

    const ent = await db.select({ id: entitlements.id }).from(entitlements).where(eq(entitlements.studentId, s1.id));
    const res = (await call(userDetailAction, post(`/admin/users/${s1.id}`, { _action: "revoke-entitlement", entitlementId: ent[0].id, reason: "policy" }, adminB.cookie), { id: s1.id })) as { done?: string; error?: string };
    expect(res.done).toBe("entitlement");

    expect(await accessAllowed(s1.id)).toBe(false); // resolver re-evaluated
    expect((await auditRows("users.entitlement_revoke")).length).toBe(1);
    const row = await db.select().from(entitlements).where(eq(entitlements.id, ent[0].id));
    expect(row[0].status).toBe("revoked");
    expect(row[0].revokeReason).toBe("policy");
  });

  it("students cannot call user-management actions (IDOR through the action door)", async () => {
    const res = await catchResponse(call(userDetailAction, post(`/admin/users/${s2.id}`, { _action: "force-logout" }, s1.cookie), { id: s2.id }) as Promise<unknown>);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });
});

describe("announcements & notifications (FEATURE-SPEC §9 / P7 §12)", () => {
  const input = { titleAr: "إعلان", titleEn: "Hello", bodyAr: "نص", bodyEn: "body", audience: "all" as const, publishAt: null, expiresAt: null };
  const adminActor = { get userId() { return adminB.id; }, role: "admin" };

  it("drafts are invisible; publishing makes them visible with unread tracking", async () => {
    const created = await createAnnouncement(db, input, adminActor);
    expect(created.ok && created.id).toBeTruthy();
    const id = annId(created);

    expect(await visibleAnnouncements(db, { id: s1.id, roleId: "student" })).toEqual([]);
    expect(await unreadAnnouncementsCount(db, { id: s1.id, roleId: "student" })).toBe(0);

    expect((await publishAnnouncement(db, id, adminActor)).ok).toBe(true);
    const items = await visibleAnnouncements(db, { id: s1.id, roleId: "student" });
    expect(items.length).toBe(1);
    expect(items[0].readAt).toBeNull();
    expect(await unreadAnnouncementsCount(db, { id: s1.id, roleId: "student" })).toBe(1);

    // publish is idempotent
    const again = await publishAnnouncement(db, id, adminActor);
    expect(again.ok && again.changed).toBe(0);

    // audited lifecycle
    expect((await auditRows("announcements.create")).length).toBe(1);
    expect((await auditRows("announcements.publish")).length).toBe(1);
  });

  it("mark-read is idempotent and mark-all-read clears the badge", async () => {
    const a1 = await createAnnouncement(db, input, adminActor);
    const a2 = await createAnnouncement(db, { ...input, titleEn: "Second" }, adminActor);
    await publishAnnouncement(db, annId(a1), adminActor);
    await publishAnnouncement(db, annId(a2), adminActor);
    const student = { id: s1.id, roleId: "student" };
    expect(await unreadAnnouncementsCount(db, student)).toBe(2);

    expect(await markAnnouncementRead(db, annId(a1), student)).toBe(true);
    expect(await markAnnouncementRead(db, annId(a1), student)).toBe(true); // again — no error, no dup
    const reads = await db.$count(announcementReads, sql`announcement_id = ${annId(a1)} AND user_id = ${s1.id}`);
    expect(reads).toBe(1);
    expect(await unreadAnnouncementsCount(db, student)).toBe(1);

    expect(await markAllAnnouncementsRead(db, student)).toBe(1);
    expect(await unreadAnnouncementsCount(db, student)).toBe(0);
    expect(await markAllAnnouncementsRead(db, student)).toBe(0);
  });

  it("mark-read refuses announcements not visible to the user (no blind writes)", async () => {
    const created = await createAnnouncement(db, { ...input, audience: "teachers" }, adminActor);
    await publishAnnouncement(db, annId(created), adminActor);
    expect(await markAnnouncementRead(db, annId(created), { id: s1.id, roleId: "student" })).toBe(false);
    expect(await db.$count(announcementReads)).toBe(0);
  });

  it("audiences target exactly the right roles", async () => {
    const studentsOnly = await createAnnouncement(db, { ...input, audience: "students" }, adminActor);
    const teachersOnly = await createAnnouncement(db, { ...input, audience: "teachers" }, adminActor);
    await publishAnnouncement(db, annId(studentsOnly), adminActor);
    await publishAnnouncement(db, annId(teachersOnly), adminActor);

    expect((await visibleAnnouncements(db, { id: s1.id, roleId: "student" })).map((a) => a.id)).toEqual([annId(studentsOnly)]);
    expect((await visibleAnnouncements(db, { id: teacherT.id, roleId: "teacher" })).map((a) => a.id)).toEqual([annId(teachersOnly)]);
    expect((await visibleAnnouncements(db, { id: adminB.id, roleId: "admin" })).map((a) => a.id)).toEqual([]); // admins match 'all' only
  });

  it("publish/expiry windows gate visibility; expired-window publish is rejected", async () => {
    const now = Date.now();
    const future = await createAnnouncement(db, { ...input, publishAt: now + DAY }, adminActor);
    await publishAnnouncement(db, annId(future), adminActor);
    expect(await visibleAnnouncements(db, { id: s1.id, roleId: "student" }, now)).toEqual([]);
    expect((await visibleAnnouncements(db, { id: s1.id, roleId: "student" }, now + DAY + 1000)).length).toBe(1);

    const expired = await createAnnouncement(db, { ...input, expiresAt: now - 1000 }, adminActor);
    const res = await publishAnnouncement(db, annId(expired), adminActor, now);
    expect(!res.ok && res.error).toBe("expires_past");

    const windowed = await createAnnouncement(db, { ...input, expiresAt: now + 3600_000 }, adminActor);
    await publishAnnouncement(db, annId(windowed), adminActor, now);
    expect((await visibleAnnouncements(db, { id: s1.id, roleId: "student" }, now)).some((a) => a.id === annId(windowed))).toBe(true);
    expect((await visibleAnnouncements(db, { id: s1.id, roleId: "student" }, now + 2 * 3600_000)).some((a) => a.id === annId(windowed))).toBe(false);
  });

  it("unpublish hides again; archive freezes content", async () => {
    const created = await createAnnouncement(db, input, adminActor);
    await publishAnnouncement(db, annId(created), adminActor);
    expect((await visibleAnnouncements(db, { id: s1.id, roleId: "student" })).length).toBe(1);

    expect((await unpublishAnnouncement(db, annId(created), adminActor)).ok).toBe(true);
    expect(await visibleAnnouncements(db, { id: s1.id, roleId: "student" })).toEqual([]);

    await publishAnnouncement(db, annId(created), adminActor);
    expect((await archiveAnnouncement(db, annId(created), adminActor)).ok).toBe(true);
    expect(await visibleAnnouncements(db, { id: s1.id, roleId: "student" })).toEqual([]);
    const frozen = await updateAnnouncement(db, annId(created), { titleEn: "Hacked" }, adminActor);
    expect(!frozen.ok && frozen.error).toBe("archived");
  });

  it("editing a published announcement updates what students see (audited)", async () => {
    const created = await createAnnouncement(db, input, adminActor);
    await publishAnnouncement(db, annId(created), adminActor);
    const upd = await updateAnnouncement(db, annId(created), { titleEn: "Updated", bodyEn: "new body" }, adminActor);
    expect(upd.ok).toBe(true);
    const items = await visibleAnnouncements(db, { id: s1.id, roleId: "student" });
    expect(items[0].titleEn).toBe("Updated");
    expect(items[0].bodyEn).toBe("new body");
    const audit = await auditRows("announcements.update");
    expect(audit.length).toBe(1);
    expect((audit[0].before as { titleEn: string }).titleEn).toBe("Hello");
  });

  it("notification center route: students see published+targeted only; actions are per-user", async () => {
    const created = await createAnnouncement(db, input, adminActor);
    await publishAnnouncement(db, annId(created), adminActor);

    const d = (await call(notificationsLoader, get("/notifications", s1.cookie))) as { items: Array<{ id: string; readAt: number | null }>; unread: number };
    expect(d.items.length).toBe(1);
    expect(d.unread).toBe(1);

    const r = (await call(notificationsAction, post("/notifications", { _action: "mark-read", id: annId(created) }, s1.cookie))) as { done?: string };
    expect(r.done).toBe("read");
    const d2 = (await call(notificationsLoader, get("/notifications", s1.cookie))) as { unread: number };
    expect(d2.unread).toBe(0);

    // marking someone else's invisible announcement fails
    const bad = (await call(notificationsAction, post("/notifications", { _action: "mark-read", id: crypto.randomUUID() }, s1.cookie))) as { error?: string };
    expect(bad.error).toBe("not_found");

    // mark-all through the route
    const c2 = await createAnnouncement(db, { ...input, titleEn: "Two" }, adminActor);
    await publishAnnouncement(db, annId(c2), adminActor);
    const rAll = (await call(notificationsAction, post("/notifications", { _action: "mark-all-read" }, s1.cookie))) as { done?: string; n?: number };
    expect(rAll.done).toBe("all");
    const d3 = (await call(notificationsLoader, get("/notifications", s1.cookie))) as { unread: number };
    expect(d3.unread).toBe(0);
  });

  it("student dashboard module exposes unread announcements + ≤14d expiring subscriptions", async () => {
    const now = Date.now();
    await seedMetrics(now); // provides the s1 subscription fixture (+ entitlement/order noise, harmless here)
    const created = await createAnnouncement(db, input, { userId: adminB.id, role: "admin" });
    await publishAnnouncement(db, annId(created), { userId: adminB.id, role: "admin" });
    // expiring in 5 days
    await db.update(subscriptions).set({ currentPeriodEnd: now + 5 * DAY }).where(sql`student_id = ${s1.id}`);

    const d = (await call(dashboardLoader, get("/dashboard", s1.cookie))) as {
      announcementsModule: { unread: number; items: Array<{ id: string }> } | null;
      expiringModule: Array<{ endAt: number }> | null;
    };
    expect(d.announcementsModule?.unread).toBe(1);
    expect(d.announcementsModule?.items.length).toBe(1);
    expect(d.expiringModule?.length).toBe(1);

    // 40 days out → no warning card
    await db.update(subscriptions).set({ currentPeriodEnd: now + 40 * DAY }).where(sql`student_id = ${s1.id}`);
    const d2 = (await call(dashboardLoader, get("/dashboard", s1.cookie))) as { expiringModule: Array<unknown> | null };
    expect(d2.expiringModule?.length).toBe(0);
  });

  it("announcements admin route rejects students and lists for authorized admins", async () => {
    const res = await catchResponse(call(announcementsLoader, get("/admin/announcements", s1.cookie)) as Promise<unknown>);
    expect(res.status).toBeGreaterThanOrEqual(300);

    const created = await createAnnouncement(db, input, { userId: adminB.id, role: "admin" });
    const d = (await call(announcementsLoader, get("/admin/announcements", adminB.cookie))) as { list: { total: number; rows: Array<{ id: string; status: string }> } };
    expect(d.list.total).toBe(1);
    expect(d.list.rows[0].status).toBe("draft");
    expect(d.list.rows[0].id).toBe(annId(created));

    // route action create → publish flow end-to-end
    const r1 = (await call(announcementsAction, post("/admin/announcements", { _action: "create", titleAr: "ع", titleEn: "T", bodyAr: "", bodyEn: "", audience: "students" }, adminB.cookie))) as { done?: string; id?: string };
    expect(r1.done).toBe("created");
    const r2 = (await call(announcementsAction, post("/admin/announcements", { _action: "publish", id: r1.id! }, adminB.cookie))) as { done?: string };
    expect(r2.done).toBe("published");
    // validation error path
    const r3 = (await call(announcementsAction, post("/admin/announcements", { _action: "create", titleAr: "", titleEn: "", bodyAr: "", bodyEn: "", audience: "all" }, adminB.cookie))) as { error?: string };
    expect(r3.error).toBe("validation");
  });
});

describe("audit viewer (P7 §13)", () => {
  it("lists entries newest-first with actor identity, filters, pagination — and has NO mutation export", async () => {
    const actor = { userId: adminB.id, role: "admin" };
    const a = await createAnnouncement(db, { titleAr: "ا", titleEn: "A", bodyAr: "", bodyEn: "", audience: "all", publishAt: null, expiresAt: null }, actor);
    await publishAnnouncement(db, annId(a), actor);

    const list = await listAuditLogs(db, {});
    expect(list.total).toBeGreaterThanOrEqual(2);
    expect(list.rows[0].createdAt).toBeGreaterThanOrEqual(list.rows[1].createdAt);
    expect(list.rows.some((r) => r.action === "announcements.publish" && r.actorEmail === adminB.email)).toBe(true);

    const filtered = await listAuditLogs(db, { q: "announcements.publish" });
    expect(filtered.total).toBe(1);
    const byEntity = await listAuditLogs(db, { entityType: "announcement" });
    expect(byEntity.total).toBe(2);

    const d = (await call(auditLoader, get("/admin/audit?q=announcements", adminB.cookie))) as { audit: { total: number } };
    expect(d.audit.total).toBeGreaterThanOrEqual(2);

    // append-only from the UI: the audit route module exports no action at all
    expect((auditRoute as Record<string, unknown>).action).toBeUndefined();
  });

  it("every P7 mutation writes an audit row (create/status/role/logout/revoke/publish)", async () => {
    const superActor = { userId: superA.id, role: "super_admin", rank: 4 };
    await setUserStatus(db, s1.id, "suspended", superActor);
    await setUserRole(db, s2.id, "teacher", superActor);
    await forceLogoutUser(db, s3.id, superActor);
    await createAnnouncement(db, { titleAr: "ا", titleEn: "A", bodyAr: "", bodyEn: "", audience: "all", publishAt: null, expiresAt: null }, { userId: superA.id, role: "super_admin" });

    for (const action of ["users.status", "users.role", "users.force_logout", "announcements.create"]) {
      const rows = await auditRows(action);
      expect(rows.length, action).toBeGreaterThanOrEqual(1);
      expect(rows[0].actorUserId).toBe(superA.id);
    }
  });
});

describe("security center (FEATURE-SPEC §8 / P7 §7)", () => {
  it("lists security events with type/email filters and active sessions with device context", async () => {
    const eventsAll = await listSecurityEvents(db, {});
    expect(eventsAll.total).toBeGreaterThanOrEqual(6); // ≥1 login_success per fixture
    const logins = await listSecurityEvents(db, { type: "login_success" });
    expect(logins.total).toBeGreaterThanOrEqual(6);
    expect(logins.rows.every((r) => r.type === "login_success")).toBe(true);
    const byEmail = await listSecurityEvents(db, { q: s1.email });
    expect(byEmail.total).toBeGreaterThanOrEqual(1);
    expect(byEmail.rows.every((r) => r.userEmail === s1.email)).toBe(true);

    const sess = await listActiveSessions(db, 1);
    expect(sess.total).toBe(6);
    expect(sess.rows[0].deviceLabel.length).toBeGreaterThan(0);

    const d = (await call(securityLoader, get("/admin/security?tab=sessions", adminB.cookie))) as { sessionsQ: { total: number } };
    expect(d.sessionsQ.total).toBe(6);
  });

  it("revokes sessions through the route action and hides them from the live list", async () => {
    const before = await listActiveSessions(db, 1);
    const target = before.rows.find((r) => r.userId === s2.id)!;
    const res = (await call(securityAction, post("/admin/security", { _action: "revoke-session", sessionId: target.id }, adminB.cookie))) as { done?: string; error?: string };
    expect(res.done).toBe("session");
    const after = await listActiveSessions(db, 1);
    expect(after.total).toBe(before.total - 1);
    expect((await auditRows("users.session_revoke")).length).toBe(1);

    // force-logout through the route
    const res2 = (await call(securityAction, post("/admin/security", { _action: "force-logout", userId: s3.id }, adminB.cookie))) as { done?: string };
    expect(res2.done).toBe("force");
    const dead = await catchResponse(call(notificationsLoader, get("/notifications", s3.cookie)) as Promise<unknown>);
    expect(dead.status).toBeGreaterThanOrEqual(300);
  });
});
