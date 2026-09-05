import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import {
  activationCodeRedemptions,
  activationCodes,
  entitlements,
  events,
  examAttempts,
  exams,
  lessonItems,
  lessonProgress,
  lessons,
  orders,
  payments,
  refunds,
  subscriptions,
  users,
  videoProgress,
  videoWatchSessions,
} from "../db/schema";

/**
 * Phase 7 analytics — a READ-ONLY aggregation service over the tables the
 * product already writes (events, video_watch_sessions, lesson/video
 * progress, exam attempts, orders/payments/refunds, entitlements, users).
 * No parallel tracking, no new event kinds (owner brief P7 §4).
 *
 * Metric sources are the canonical domain events (P7 §5):
 * - video starts/completions  → events type video_start / video_complete
 * - lesson completions        → events type lesson_complete
 * - watched time              → video_watch_sessions.watched_seconds
 * - exam submissions          → exam_attempts.submitted_at
 * - revenue                   → orders.total_minor WHERE status='paid' (integer minor units)
 *
 * Every dashboard page issues ONE Promise.all batch of indexed aggregate
 * queries (single pass each) — never per-row loops, never N+1.
 */

export { RANGE_KEYS, parseRange, rangeSinceMs, type RangeKey } from "./ranges";
import { rangeSinceMs, type RangeKey } from "./ranges";

const num = (v: unknown): number => Number(v ?? 0);

export interface AdminOverview {
  range: RangeKey;
  sinceMs: number;
  users: {
    total: number;
    students: number;
    admins: number;
    newInWindow: number;
    recent: Array<{ id: string; email: string; fullName: string; roleId: string; createdAt: number }>;
  };
  learning: {
    enrolledStudents: number; // current snapshot (active entitlements)
    activeLearners: number; // distinct students with lesson activity in window
    completedLessons: number; // lesson_progress completed (completed_at in window)
    watchedVideos: number; // video_progress rows touched in window
  };
  video: {
    watchedSeconds: number; // SUM(video_watch_sessions.watched_seconds) in window
    starts: number; // events video_start
    completions: number; // events video_complete
    lessonCompletions: number; // events lesson_complete
  };
  exams: {
    attempts: number;
    submissions: number;
    graded: number;
    passed: number;
    passRatePct: number | null; // integer %, null when nothing graded
    avgScorePct: number | null; // integer %, graded attempts with max_score>0
  };
  commerce: {
    orders: number;
    paidOrders: number;
    pendingOrders: number;
    grossRevenueMinor: number; // SUM(total_minor) of paid orders in window — integer minor units
    refundedMinor: number; // SUM(refunds.amount_minor) in window
    netRevenueMinor: number; // gross - refunded (integer)
    pendingPaymentReview: number; // payments under_review (current snapshot)
    redemptions: number; // activation_code_redemptions in window
    activeSubscriptions: number; // current snapshot
  };
  recentActivity: Array<{ id: string; type: string; userId: string | null; resourceType: string | null; resourceId: string | null; createdAt: number }>;
}

/** One batched read model for the admin dashboard (P7 §3). All money integer minor units. */
export async function adminOverview(db: DB, range: RangeKey, nowMs: number = Date.now()): Promise<AdminOverview> {
  const since = rangeSinceMs(range, nowMs);
  const win = (col: any) => (since > 0 ? gte(col, since) : undefined);
  const live = isNull(users.deletedAt);

  const [
    totalUsers,
    studentsCount,
    adminsCount,
    newUsers,
    recentRegs,
    enrolled,
    activeLearners,
    completedLessons,
    watchedVideos,
    watchAgg,
    startEvents,
    completeEvents,
    lessonCompleteEvents,
    examAgg,
    orderAgg,
    refundAgg,
    pendingReview,
    redemptions,
    activeSubs,
    recentEvents,
  ] = await Promise.all([
    db.$count(users, live),
    db.$count(users, and(live, eq(users.roleId, "student"))),
    db.$count(users, and(live, inArray(users.roleId, ["admin", "super_admin"]))),
    db.$count(users, and(live, win(users.createdAt))),
    db
      .select({ id: users.id, email: users.email, fullName: users.fullName, roleId: users.roleId, createdAt: users.createdAt })
      .from(users)
      .where(live)
      .orderBy(desc(users.createdAt))
      .limit(5),
    db
      .select({ n: sql<number>`COUNT(DISTINCT ${entitlements.studentId})` })
      .from(entitlements)
      .where(
        and(
          eq(entitlements.status, "active"),
          sql`${entitlements.startsAt} <= ${nowMs}`,
          sql`(${entitlements.expiresAt} IS NULL OR ${entitlements.expiresAt} > ${nowMs})`
        )
      ),
    db
      .select({ n: sql<number>`COUNT(DISTINCT ${lessonProgress.studentId})` })
      .from(lessonProgress)
      .where(win(lessonProgress.lastActivityAt)),
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(lessonProgress)
      .where(and(eq(lessonProgress.status, "completed"), win(lessonProgress.completedAt))),
    db.select({ n: sql<number>`COUNT(*)` }).from(videoProgress).where(win(videoProgress.lastWatchedAt)),
    db
      .select({ secs: sql<number>`COALESCE(SUM(${videoWatchSessions.watchedSeconds}), 0)` })
      .from(videoWatchSessions)
      .where(win(videoWatchSessions.startedAt)),
    db.select({ n: sql<number>`COUNT(*)` }).from(events).where(and(eq(events.type, "video_start"), win(events.createdAt))),
    db.select({ n: sql<number>`COUNT(*)` }).from(events).where(and(eq(events.type, "video_complete"), win(events.createdAt))),
    db.select({ n: sql<number>`COUNT(*)` }).from(events).where(and(eq(events.type, "lesson_complete"), win(events.createdAt))),
    // single pass: attempts (started in window), submissions/graded/passed (submitted in window), avg pct
    db
      .select({
        attempts: sql<number>`COUNT(*)`,
        submissions: sql<number>`SUM(CASE WHEN ${examAttempts.submittedAt} IS NOT NULL${since > 0 ? sql` AND ${examAttempts.submittedAt} >= ${since}` : sql``} THEN 1 ELSE 0 END)`,
        graded: sql<number>`SUM(CASE WHEN ${examAttempts.status} = 'graded'${since > 0 ? sql` AND ${examAttempts.submittedAt} >= ${since}` : sql``} THEN 1 ELSE 0 END)`,
        passed: sql<number>`SUM(CASE WHEN ${examAttempts.passed} = 1${since > 0 ? sql` AND ${examAttempts.submittedAt} >= ${since}` : sql``} THEN 1 ELSE 0 END)`,
        avgPct: sql<number | null>`AVG(CASE WHEN ${examAttempts.status} = 'graded' AND ${examAttempts.maxScore} > 0${since > 0 ? sql` AND ${examAttempts.submittedAt} >= ${since}` : sql``} THEN ${examAttempts.score} * 100.0 / ${examAttempts.maxScore} END)`,
      })
      .from(examAttempts)
      .where(win(examAttempts.startedAt)),
    // single pass over orders in window: counts by status + gross revenue (paid only, integer minor units)
    db
      .select({
        total: sql<number>`COUNT(*)`,
        paid: sql<number>`SUM(CASE WHEN ${orders.status} = 'paid' THEN 1 ELSE 0 END)`,
        pending: sql<number>`SUM(CASE WHEN ${orders.status} = 'pending' THEN 1 ELSE 0 END)`,
        gross: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} = 'paid' THEN ${orders.totalMinor} ELSE 0 END), 0)`,
      })
      .from(orders)
      .where(win(orders.createdAt)),
    db
      .select({ total: sql<number>`COALESCE(SUM(${refunds.amountMinor}), 0)` })
      .from(refunds)
      .where(win(refunds.createdAt)),
    db.$count(payments, eq(payments.status, "under_review")),
    db.select({ n: sql<number>`COUNT(*)` }).from(activationCodeRedemptions).where(win(activationCodeRedemptions.createdAt)),
    db.$count(subscriptions, eq(subscriptions.status, "active")),
    db
      .select({ id: events.id, type: events.type, userId: events.userId, resourceType: events.resourceType, resourceId: events.resourceId, createdAt: events.createdAt })
      .from(events)
      .orderBy(desc(events.createdAt))
      .limit(8),
  ]);

  const graded = num(examAgg[0]?.graded);
  const passed = num(examAgg[0]?.passed);
  const gross = num(orderAgg[0]?.gross);
  const refunded = num(refundAgg[0]?.total);
  const avgRaw = examAgg[0]?.avgPct;

  return {
    range,
    sinceMs: since,
    users: {
      total: num(totalUsers),
      students: num(studentsCount),
      admins: num(adminsCount),
      newInWindow: num(newUsers),
      recent: recentRegs,
    },
    learning: {
      enrolledStudents: num(enrolled[0]?.n),
      activeLearners: num(activeLearners[0]?.n),
      completedLessons: num(completedLessons[0]?.n),
      watchedVideos: num(watchedVideos[0]?.n),
    },
    video: {
      watchedSeconds: num(watchAgg[0]?.secs),
      starts: num(startEvents[0]?.n),
      completions: num(completeEvents[0]?.n),
      lessonCompletions: num(lessonCompleteEvents[0]?.n),
    },
    exams: {
      attempts: num(examAgg[0]?.attempts),
      submissions: num(examAgg[0]?.submissions),
      graded,
      passed,
      passRatePct: graded > 0 ? Math.round((passed / graded) * 100) : null,
      avgScorePct: avgRaw == null ? null : Math.round(num(avgRaw)),
    },
    commerce: {
      orders: num(orderAgg[0]?.total),
      paidOrders: num(orderAgg[0]?.paid),
      pendingOrders: num(orderAgg[0]?.pending),
      grossRevenueMinor: gross,
      refundedMinor: refunded,
      netRevenueMinor: gross - refunded,
      pendingPaymentReview: num(pendingReview),
      redemptions: num(redemptions[0]?.n),
      activeSubscriptions: num(activeSubs),
    },
    recentActivity: recentEvents,
  };
}

export interface TopWatchedRow {
  videoId: string;
  seconds: number;
  plays: number;
  lessonTitleAr: string | null;
  lessonTitleEn: string | null;
}

/** Most-watched videos in window — one grouped query + one title lookup (no N+1). */
export async function topWatched(db: DB, range: RangeKey, nowMs: number = Date.now(), limit = 5): Promise<TopWatchedRow[]> {
  const since = rangeSinceMs(range, nowMs);
  const rows = await db
    .select({
      videoId: videoProgress.videoId,
      seconds: sql<number>`COALESCE(SUM(${videoWatchSessions.watchedSeconds}), 0)`,
      plays: sql<number>`COUNT(*)`,
    })
    .from(videoWatchSessions)
    .innerJoin(videoProgress, eq(videoProgress.id, videoWatchSessions.videoProgressId))
    .where(since > 0 ? gte(videoWatchSessions.startedAt, since) : undefined)
    .groupBy(videoProgress.videoId)
    .orderBy(desc(sql`COALESCE(SUM(${videoWatchSessions.watchedSeconds}), 0)`))
    .limit(limit);
  if (!rows.length) return [];

  const videoIds = rows.map((r) => r.videoId);
  const itemRows = await db
    .select({ videoId: lessonItems.videoId, titleAr: lessons.titleAr, titleEn: lessons.titleEn })
    .from(lessonItems)
    .innerJoin(lessons, eq(lessons.id, lessonItems.lessonId))
    .where(inArray(lessonItems.videoId, videoIds));
  const titleByVideo = new Map(itemRows.map((r) => [r.videoId, r]));
  return rows.map((r) => ({
    videoId: r.videoId,
    seconds: num(r.seconds),
    plays: num(r.plays),
    lessonTitleAr: titleByVideo.get(r.videoId)?.titleAr ?? null,
    lessonTitleEn: titleByVideo.get(r.videoId)?.titleEn ?? null,
  }));
}

export interface AnalyticsDetail {
  range: RangeKey;
  eventBreakdown: Array<{ type: string; count: number }>;
  watchDaily: Array<{ epochDay: number; seconds: number }>; // last 14 UTC days
  registrationsDaily: Array<{ epochDay: number; count: number }>; // last 14 UTC days
  examPerformance: Array<{ examId: string; titleAr: string | null; titleEn: string | null; attempts: number; graded: number; passed: number; avgPct: number | null }>;
  ordersByStatus: Array<{ status: string; count: number; totalMinor: number }>;
  codeStatusBreakdown: Array<{ status: string; count: number }>;
}

/** Deeper analytics page (FEATURE-SPEC §10) — one batch of grouped queries. */
export async function analyticsDetail(db: DB, range: RangeKey, nowMs: number = Date.now()): Promise<AnalyticsDetail> {
  const since = rangeSinceMs(range, nowMs);
  const win = (col: any) => (since > 0 ? gte(col, since) : undefined);
  const day14 = nowMs - 14 * 86_400_000;
  const epochDay = (col: any) => sql<number>`CAST(${col} / 86400000 AS INTEGER)`;

  const [eventRows, watchRows, regRows, examRows, orderRows, codeRows] = await Promise.all([
    db
      .select({ type: events.type, count: sql<number>`COUNT(*)` })
      .from(events)
      .where(win(events.createdAt))
      .groupBy(events.type)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(15),
    db
      .select({ epochDay: epochDay(videoWatchSessions.startedAt), seconds: sql<number>`COALESCE(SUM(${videoWatchSessions.watchedSeconds}), 0)` })
      .from(videoWatchSessions)
      .where(gte(videoWatchSessions.startedAt, day14))
      .groupBy(epochDay(videoWatchSessions.startedAt))
      .orderBy(epochDay(videoWatchSessions.startedAt)),
    db
      .select({ epochDay: epochDay(users.createdAt), count: sql<number>`COUNT(*)` })
      .from(users)
      .where(and(gte(users.createdAt, day14), isNull(users.deletedAt)))
      .groupBy(epochDay(users.createdAt))
      .orderBy(epochDay(users.createdAt)),
    db
      .select({
        examId: examAttempts.examId,
        titleAr: exams.titleAr,
        titleEn: exams.titleEn,
        attempts: sql<number>`COUNT(*)`,
        graded: sql<number>`SUM(CASE WHEN ${examAttempts.status} = 'graded' THEN 1 ELSE 0 END)`,
        passed: sql<number>`SUM(CASE WHEN ${examAttempts.passed} = 1 THEN 1 ELSE 0 END)`,
        avgPct: sql<number | null>`AVG(CASE WHEN ${examAttempts.status} = 'graded' AND ${examAttempts.maxScore} > 0 THEN ${examAttempts.score} * 100.0 / ${examAttempts.maxScore} END)`,
      })
      .from(examAttempts)
      .innerJoin(exams, eq(exams.id, examAttempts.examId))
      .where(win(examAttempts.startedAt))
      .groupBy(examAttempts.examId, exams.titleAr, exams.titleEn)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10),
    db
      .select({
        status: orders.status,
        count: sql<number>`COUNT(*)`,
        totalMinor: sql<number>`COALESCE(SUM(${orders.totalMinor}), 0)`,
      })
      .from(orders)
      .where(win(orders.createdAt))
      .groupBy(orders.status),
    db.select({ status: activationCodes.status, count: sql<number>`COUNT(*)` }).from(activationCodes).groupBy(activationCodes.status),
  ]);

  return {
    range,
    eventBreakdown: eventRows.map((r) => ({ type: r.type, count: num(r.count) })),
    watchDaily: watchRows.map((r) => ({ epochDay: num(r.epochDay), seconds: num(r.seconds) })),
    registrationsDaily: regRows.map((r) => ({ epochDay: num(r.epochDay), count: num(r.count) })),
    examPerformance: examRows.map((r) => ({
      examId: r.examId,
      titleAr: r.titleAr,
      titleEn: r.titleEn,
      attempts: num(r.attempts),
      graded: num(r.graded),
      passed: num(r.passed),
      avgPct: r.avgPct == null ? null : Math.round(num(r.avgPct)),
    })),
    ordersByStatus: orderRows.map((r) => ({ status: r.status, count: num(r.count), totalMinor: num(r.totalMinor) })),
    codeStatusBreakdown: codeRows.map((r) => ({ status: r.status, count: num(r.count) })),
  };
}
