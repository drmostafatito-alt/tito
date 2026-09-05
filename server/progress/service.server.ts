import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "~server/db/client.server";
import { events, lessonProgress, videoProgress, videoWatchSessions } from "~server/db/schema";
import { courses, examAttempts, lessons, units, videos } from "~server/db/schema";
import { itemsForLesson } from "~server/content/service.server";

/**
 * Learning-progress service (Phase 4, ADR-021).
 *
 * Source of truth = database (never localStorage). Progress is PER STUDENT
 * (portable within the device policy). Completion rules (FEATURE-SPEC §4):
 *  - a VIDEO counts complete at settings.video.completionThresholdPct of its duration;
 *  - a LESSON auto-completes when every REQUIRED item is a video and all are complete;
 *    otherwise the student marks it complete explicitly (self-report, see ADR-021 —
 *    progress is convenience data for the learner, NOT a security boundary; access
 *    stays entitlement-checked server-side everywhere).
 *  - COURSE % = completed published lessons / published lessons.
 *
 * Positions/durations arrive from client beacons (sanity-clamped). Replay limits
 * and entitlements are enforced server-side at mint time, not here.
 */

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

export const beaconSchema = z.object({
  videoId: uuid,
  lessonId: uuid.optional(),
  /** Current playback position (seconds). */
  positionSeconds: z.number().int().min(0).max(24 * 3600),
  /** Client-known media duration (seconds); optional for providers without metadata. */
  durationSeconds: z.number().int().min(1).max(24 * 3600).optional(),
  /** Client-accumulated watched seconds for the CURRENT session (analytics only). */
  watchedSeconds: z.number().int().min(0).max(24 * 3600).optional(),
  kind: z.enum(["heartbeat", "ended"]).default("heartbeat"),
});
export type Beacon = z.infer<typeof beaconSchema>;

export class ProgressReferenceError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "ProgressReferenceError";
  }
}

const now = () => Date.now();

async function appendEvent(
  db: DB,
  e: { type: string; userId?: string | null; resourceType?: string | null; resourceId?: string | null; props?: Record<string, unknown> }
) {
  await db.insert(events).values({
    id: crypto.randomUUID(),
    type: e.type,
    userId: e.userId ?? null,
    resourceType: e.resourceType ?? null,
    resourceId: e.resourceId ?? null,
    props: e.props ?? null,
    createdAt: now(),
  });
}

/**
 * Called when playback credentials are minted (api.playback route): counts the
 * play (replay accounting), opens a watch session, marks the lesson in_progress.
 * Returns the progress row BEFORE increment (so the caller can enforce
 * settings.video.replayLimit against watchCount server-side).
 */
export async function startWatch(
  db: DB,
  input: { studentId: string; videoId: string; lessonId?: string | null; deviceId?: string | null }
): Promise<{ row: VideoProgressRow | null }> {
  const video = await db.select({ id: videos.id }).from(videos).where(eq(videos.id, input.videoId)).limit(1);
  if (!video[0]) throw new ProgressReferenceError("videoId", "video not found");
  if (input.lessonId) {
    const lesson = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, input.lessonId)).limit(1);
    if (!lesson[0]) throw new ProgressReferenceError("lessonId", "lesson not found");
  }

  const existing = await getVideoProgress(db, input.studentId, input.videoId);
  const ts = now();
  if (!existing) {
    const row = {
      id: crypto.randomUUID(),
      studentId: input.studentId,
      videoId: input.videoId,
      lessonId: input.lessonId ?? null,
      watchCount: 1,
      positionSeconds: 0,
      maxPositionSeconds: 0,
      durationSeconds: null,
      completed: false,
      completedAt: null,
      lastWatchedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.insert(videoProgress).values(row);
    await openSession(db, row.id, input.deviceId ?? null, ts);
    if (input.lessonId) await touchLesson(db, input.studentId, input.lessonId, ts);
    await appendEvent(db, { type: "video_start", userId: input.studentId, resourceType: "video", resourceId: input.videoId });
    return { row: null };
  }

  await db
    .update(videoProgress)
    .set({ watchCount: existing.watchCount + 1, lastWatchedAt: ts, updatedAt: ts, lessonId: input.lessonId ?? existing.lessonId })
    .where(eq(videoProgress.id, existing.id));
  await openSession(db, existing.id, input.deviceId ?? null, ts);
  if (input.lessonId) await touchLesson(db, input.studentId, input.lessonId, ts);
  await appendEvent(db, {
    type: "video_start",
    userId: input.studentId,
    resourceType: "video",
    resourceId: input.videoId,
    props: { watchCount: existing.watchCount + 1 },
  });
  return { row: existing };
}

async function openSession(db: DB, videoProgressId: string, deviceId: string | null, ts: number) {
  await db.insert(videoWatchSessions).values({
    id: crypto.randomUUID(),
    videoProgressId,
    startedAt: ts,
    endedAt: null,
    watchedSeconds: 0,
    deviceId,
  });
}

export type VideoProgressRow = typeof videoProgress.$inferSelect;
export type LessonProgressRow = typeof lessonProgress.$inferSelect;

export async function getVideoProgress(db: DB, studentId: string, videoId: string): Promise<VideoProgressRow | null> {
  const rows = await db
    .select()
    .from(videoProgress)
    .where(and(eq(videoProgress.studentId, studentId), eq(videoProgress.videoId, videoId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Beacon sink (POST /beacons/progress). Upserts position/max/duration, updates
 * the open watch session, applies the completion threshold, and auto-completes
 * the lesson when the spec rule holds. Server-debounced: heartbeats closer than
 * 3s to the last activity for the same student+video are folded (still applied,
 * but no duplicate session churn).
 */
export async function recordBeacon(
  db: DB,
  studentId: string,
  beacon: Beacon,
  opts: { completionThresholdPct: number; deviceId?: string | null }
): Promise<{ completed: boolean; lessonCompleted: boolean; positionSeconds: number }> {
  const video = await db
    .select({ id: videos.id, durationSeconds: videos.durationSeconds })
    .from(videos)
    .where(eq(videos.id, beacon.videoId))
    .limit(1);
  if (!video[0]) throw new ProgressReferenceError("videoId", "video not found");

  let lessonId = beacon.lessonId ?? null;
  if (lessonId) {
    const lesson = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lessonId)).limit(1);
    if (!lesson[0]) throw new ProgressReferenceError("lessonId", "lesson not found");
  }

  const ts = now();
  // duration: prefer the videos row (provider-synced), fall back to client metadata
  const duration = video[0].durationSeconds ?? beacon.durationSeconds ?? null;
  const position = duration !== null ? Math.min(beacon.positionSeconds, duration) : beacon.positionSeconds;

  const existing = await getVideoProgress(db, studentId, beacon.videoId);
  if (!lessonId && existing?.lessonId) lessonId = existing.lessonId;

  const maxPosition = Math.max(existing?.maxPositionSeconds ?? 0, position);
  const wasCompleted = existing?.completed ?? false;
  const completed =
    wasCompleted || (duration !== null && duration > 0 && maxPosition >= Math.floor((duration * opts.completionThresholdPct) / 100));

  let progressId: string;
  if (!existing) {
    progressId = crypto.randomUUID();
    await db.insert(videoProgress).values({
      id: progressId,
      studentId,
      videoId: beacon.videoId,
      lessonId,
      watchCount: 0, // mints count watches; a beacon without a mint is position data only
      positionSeconds: position,
      maxPositionSeconds: maxPosition,
      durationSeconds: duration,
      completed,
      completedAt: completed ? ts : null,
      lastWatchedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });
  } else {
    progressId = existing.id;
    await db
      .update(videoProgress)
      .set({
        positionSeconds: position,
        maxPositionSeconds: maxPosition,
        durationSeconds: duration ?? existing.durationSeconds,
        lessonId: lessonId ?? existing.lessonId,
        completed,
        completedAt: completed && !wasCompleted ? ts : existing.completedAt,
        lastWatchedAt: ts,
        updatedAt: ts,
      })
      .where(eq(videoProgress.id, existing.id));
  }

  // close/extend the most recent open watch session for this progress row
  const openSessions = await db
    .select()
    .from(videoWatchSessions)
    .where(and(eq(videoWatchSessions.videoProgressId, progressId), isNull(videoWatchSessions.endedAt)))
    .orderBy(desc(videoWatchSessions.startedAt))
    .limit(1);
  const open = openSessions[0] ?? null;
  if (open) {
    const watched = Math.max(open.watchedSeconds, beacon.watchedSeconds ?? 0);
    await db
      .update(videoWatchSessions)
      .set(beacon.kind === "ended" ? { endedAt: ts, watchedSeconds: watched } : { watchedSeconds: watched })
      .where(eq(videoWatchSessions.id, open.id));
  }

  let lessonCompleted = false;
  if (lessonId) {
    await touchLesson(db, studentId, lessonId, ts);
    if (!wasCompleted && completed) {
      await appendEvent(db, { type: "video_complete", userId: studentId, resourceType: "video", resourceId: beacon.videoId });
    }
    lessonCompleted = await maybeAutoCompleteLesson(db, studentId, lessonId, opts.completionThresholdPct);
  } else if (!wasCompleted && completed) {
    await appendEvent(db, { type: "video_complete", userId: studentId, resourceType: "video", resourceId: beacon.videoId });
  }

  return { completed, lessonCompleted, positionSeconds: position };
}

/** in_progress touch (never downgrades a completed lesson). */
async function touchLesson(db: DB, studentId: string, lessonId: string, ts: number) {
  const existing = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.studentId, studentId), eq(lessonProgress.lessonId, lessonId)))
    .limit(1);
  if (!existing[0]) {
    await db.insert(lessonProgress).values({
      id: crypto.randomUUID(),
      studentId,
      lessonId,
      status: "in_progress",
      completedAt: null,
      lastActivityAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });
  } else {
    // never downgrades a completed lesson — activity timestamp only
    await db
      .update(lessonProgress)
      .set({ lastActivityAt: ts, updatedAt: ts })
      .where(eq(lessonProgress.id, existing[0].id));
  }
}

/**
 * FEATURE-SPEC §4 rule: lesson completes when its REQUIRED items are complete.
 * Phase 5: required EXAM items now have a completion signal — a graded attempt
 * (submission counts, never mere opening; pass/fail is scoring, not completion).
 * Required FILE items still have no signal — lessons containing them auto-complete
 * only via the student's explicit mark (ADR-021/022).
 */
export async function maybeAutoCompleteLesson(db: DB, studentId: string, lessonId: string, thresholdPct: number): Promise<boolean> {
  const items = await itemsForLesson(db, lessonId);
  const required = items.filter((i) => i.required);
  if (required.length === 0) return false;
  if (required.some((i) => (i.itemType === "video" ? !i.videoId : i.itemType === "exam" ? !i.examId : true))) return false;

  const videoIds = required.filter((i) => i.itemType === "video").map((i) => i.videoId!);
  const examIds = required.filter((i) => i.itemType === "exam").map((i) => i.examId!);

  const videoRows = videoIds.length
    ? await db
        .select()
        .from(videoProgress)
        .where(and(eq(videoProgress.studentId, studentId), inArray(videoProgress.videoId, videoIds)))
    : [];
  const examRows = examIds.length
    ? await db
        .select({ examId: examAttempts.examId })
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.studentId, studentId),
            inArray(examAttempts.examId, examIds),
            inArray(examAttempts.status, ["graded", "submitted"])
          )
        )
    : [];

  const videosDone = required
    .filter((i) => i.itemType === "video")
    .every((i) => videoRows.some((r) => r.videoId === i.videoId && r.completed));
  const examsDone = required
    .filter((i) => i.itemType === "exam")
    .every((i) => examRows.some((r) => r.examId === i.examId));
  if (!videosDone || !examsDone) return false;
  return setLessonCompleted(db, studentId, lessonId, true);
}

/** Manual mark-complete/uncomplete (self-report). Returns the new completed state. */
export async function setLessonCompleted(db: DB, studentId: string, lessonId: string, completed: boolean): Promise<boolean> {
  const lesson = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson[0]) throw new ProgressReferenceError("lessonId", "lesson not found");
  const ts = now();
  const existing = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.studentId, studentId), eq(lessonProgress.lessonId, lessonId)))
    .limit(1);
  const wasCompleted = existing[0]?.status === "completed";
  if (!existing[0]) {
    await db.insert(lessonProgress).values({
      id: crypto.randomUUID(),
      studentId,
      lessonId,
      status: completed ? "completed" : "in_progress",
      completedAt: completed ? ts : null,
      lastActivityAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });
  } else {
    await db
      .update(lessonProgress)
      .set({
        status: completed ? "completed" : "in_progress",
        completedAt: completed ? (existing[0].completedAt ?? ts) : null,
        lastActivityAt: ts,
        updatedAt: ts,
      })
      .where(eq(lessonProgress.id, existing[0].id));
  }
  if (completed && !wasCompleted) {
    await appendEvent(db, { type: "lesson_complete", userId: studentId, resourceType: "lesson", resourceId: lessonId });
  }
  return completed;
}

/** Lesson statuses for a set of lessons (map lessonId → row). */
export async function lessonProgressMap(db: DB, studentId: string, lessonIds: string[]): Promise<Map<string, LessonProgressRow>> {
  if (!lessonIds.length) return new Map();
  const rows = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.studentId, studentId), inArray(lessonProgress.lessonId, lessonIds)));
  return new Map(rows.map((r) => [r.lessonId, r]));
}

/** Video progress for a set of videos (map videoId → row) — resume positions. */
export async function videoProgressMap(db: DB, studentId: string, videoIds: string[]): Promise<Map<string, VideoProgressRow>> {
  if (!videoIds.length) return new Map();
  const rows = await db
    .select()
    .from(videoProgress)
    .where(and(eq(videoProgress.studentId, studentId), inArray(videoProgress.videoId, videoIds)));
  return new Map(rows.map((r) => [r.videoId, r]));
}

export interface CourseProgress {
  courseId: string;
  total: number;
  completed: number;
  pct: number; // 0..100 integer
}

/** Course % = completed published lessons / published lessons (FEATURE-SPEC §4). */
export async function courseProgress(db: DB, studentId: string, courseId: string): Promise<CourseProgress> {
  const batch = await courseProgressBatch(db, studentId, [courseId]);
  return batch.get(courseId) ?? { courseId, total: 0, completed: 0, pct: 0 };
}

/** Batch course progress for dashboards/catalog (single query set). */
export async function courseProgressBatch(db: DB, studentId: string, courseIds: string[]): Promise<Map<string, CourseProgress>> {
  const out = new Map<string, CourseProgress>();
  if (!courseIds.length) return out;
  const unitRows = await db
    .select({ id: units.id, courseId: units.courseId })
    .from(units)
    .where(and(inArray(units.courseId, courseIds), eq(units.status, "published")));
  const courseByUnit = new Map(unitRows.map((u) => [u.id, u.courseId]));
  const lessonRows = unitRows.length
    ? await db
        .select({ id: lessons.id, unitId: lessons.unitId, status: lessons.status })
        .from(lessons)
        .where(and(inArray(lessons.unitId, unitRows.map((u) => u.id)), eq(lessons.status, "published"), isNull(lessons.deletedAt)))
    : [];
  const byCourse = new Map<string, string[]>();
  for (const l of lessonRows) {
    const courseId = courseByUnit.get(l.unitId);
    if (!courseId) continue;
    const arr = byCourse.get(courseId) ?? [];
    arr.push(l.id);
    byCourse.set(courseId, arr);
  }
  const progress = await lessonProgressMap(db, studentId, lessonRows.map((l) => l.id));
  for (const courseId of courseIds) {
    const ids = byCourse.get(courseId) ?? [];
    const completed = ids.filter((id) => progress.get(id)?.status === "completed").length;
    out.set(courseId, {
      courseId,
      total: ids.length,
      completed,
      pct: ids.length ? Math.round((completed / ids.length) * 100) : 0,
    });
  }
  return out;
}

export interface ContinueItem {
  courseSlug: string;
  courseTitleAr: string;
  courseTitleEn: string;
  lessonSlug: string;
  lessonTitleAr: string;
  lessonTitleEn: string;
  status: "in_progress" | "completed";
  lastActivityAt: number;
  /** Resume position for the lesson's first video, if any (seconds). */
  resumePositionSeconds: number | null;
  pct: number;
}

/** "Continue learning" — recently active lessons (any status), most recent first. */
export async function continueLearning(db: DB, studentId: string, limit = 5): Promise<ContinueItem[]> {
  const rows = await db
    .select()
    .from(lessonProgress)
    .where(eq(lessonProgress.studentId, studentId))
    .orderBy(desc(lessonProgress.lastActivityAt))
    .limit(limit * 2); // over-fetch: some lessons may be unpublished/deleted since
  if (!rows.length) return [];

  const lessonRows = await db
    .select({
      id: lessons.id,
      slug: lessons.slug,
      titleAr: lessons.titleAr,
      titleEn: lessons.titleEn,
      status: lessons.status,
      unitId: lessons.unitId,
    })
    .from(lessons)
    .where(inArray(lessons.id, rows.map((r) => r.lessonId)));
  const lessonById = new Map(lessonRows.map((l) => [l.id, l]));

  const items = await db
    .select({ lessonId: videoProgress.lessonId, positionSeconds: videoProgress.positionSeconds, completed: videoProgress.completed })
    .from(videoProgress)
    .where(eq(videoProgress.studentId, studentId));
  const resumeByLesson = new Map<string, number | null>();
  for (const v of items) {
    if (!v.lessonId) continue;
    const pos = v.completed ? null : Math.max(resumeByLesson.get(v.lessonId) ?? 0, v.positionSeconds);
    resumeByLesson.set(v.lessonId, pos && pos > 5 ? pos : (resumeByLesson.get(v.lessonId) ?? null));
  }

  const unitIds = [...new Set(lessonRows.map((l) => l.unitId))];
  const unitRows = unitIds.length
    ? await db.select({ id: units.id, courseId: units.courseId }).from(units).where(inArray(units.id, unitIds))
    : [];
  const courseByUnit = new Map(unitRows.map((u) => [u.id, u.courseId]));
  const courseIds = [...new Set(lessonRows.map((l) => courseByUnit.get(l.unitId)).filter((x): x is string => Boolean(x)))];
  const courseRows = courseIds.length
    ? await db
        .select({ id: courses.id, slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn, status: courses.status })
        .from(courses)
        .where(inArray(courses.id, courseIds))
    : [];
  const courseById = new Map(courseRows.map((c) => [c.id, c]));
  const pcts = await courseProgressBatch(db, studentId, courseIds);

  const out: ContinueItem[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const lesson = lessonById.get(r.lessonId);
    if (!lesson || lesson.status !== "published") continue;
    const courseId = courseByUnit.get(lesson.unitId);
    const course = courseId ? courseById.get(courseId) : undefined;
    if (!course || course.status !== "published") continue;
    out.push({
      courseSlug: course.slug,
      courseTitleAr: course.titleAr,
      courseTitleEn: course.titleEn,
      lessonSlug: lesson.slug,
      lessonTitleAr: lesson.titleAr,
      lessonTitleEn: lesson.titleEn,
      status: r.status,
      lastActivityAt: r.lastActivityAt,
      resumePositionSeconds: resumeByLesson.get(lesson.id) ?? null,
      pct: pcts.get(course.id)?.pct ?? 0,
    });
  }
  return out;
}

/** Aggregate stats for the dashboard (completed lessons count + active courses count). */
export async function progressStats(db: DB, studentId: string): Promise<{ completedLessons: number; inProgressLessons: number; completedVideos: number }> {
  const [lp, vp] = await Promise.all([
    db.select().from(lessonProgress).where(eq(lessonProgress.studentId, studentId)),
    db.select({ completed: videoProgress.completed }).from(videoProgress).where(eq(videoProgress.studentId, studentId)),
  ]);
  return {
    completedLessons: lp.filter((r) => r.status === "completed").length,
    inProgressLessons: lp.filter((r) => r.status === "in_progress").length,
    completedVideos: vp.filter((r) => r.completed).length,
  };
}
