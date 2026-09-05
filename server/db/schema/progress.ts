import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Learning-progress domain (Phase 4 — FEATURE-SPEC §2/§4, DATABASE-SCHEMA "Progress & analytics").
 *
 * Server/database is the source of truth for progress (never localStorage):
 * - `lesson_progress`: one row per (student, lesson) — in_progress|completed + last activity.
 * - `video_progress`: one row per (student, video) — resume position, max position, watch count
 *   (replay accounting), completion by threshold (settings.video.completionThresholdPct).
 * - `video_watch_sessions`: per-playback append log (replay policy + audit).
 * - `events`: append-only product analytics (no PII in props).
 *
 * Integrity policy mirrors ADR-017/019: plain TEXT references + app-layer guards in
 * server/progress/service.server.ts (student/lesson/video validated before write).
 * Progress is per STUDENT (not per device) — portable within the device policy (FEATURE-SPEC §4).
 */

export const lessonProgress = sqliteTable(
  "lesson_progress",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    status: text("status", { enum: ["in_progress", "completed"] }).notNull().default("in_progress"),
    completedAt: integer("completed_at", { mode: "number" }),
    lastActivityAt: integer("last_activity_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("lesson_progress_student_lesson_idx").on(t.studentId, t.lessonId),
    index("lesson_progress_student_activity_idx").on(t.studentId, t.lastActivityAt),
  ]
);

export const videoProgress = sqliteTable(
  "video_progress",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    videoId: text("video_id").notNull(),
    /** Lesson the video was watched in (first/last context; NULL for detached previews). */
    lessonId: text("lesson_id"),
    watchCount: integer("watch_count").notNull().default(0),
    positionSeconds: integer("position_seconds").notNull().default(0),
    maxPositionSeconds: integer("max_position_seconds").notNull().default(0),
    /** Client-reported duration (provider metadata may be absent for mock assets). */
    durationSeconds: integer("duration_seconds"),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: integer("completed_at", { mode: "number" }),
    lastWatchedAt: integer("last_watched_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("video_progress_student_video_idx").on(t.studentId, t.videoId),
    index("video_progress_student_watched_idx").on(t.studentId, t.lastWatchedAt),
  ]
);

export const videoWatchSessions = sqliteTable(
  "video_watch_sessions",
  {
    id: text("id").primaryKey(),
    videoProgressId: text("video_progress_id").notNull(),
    startedAt: integer("started_at", { mode: "number" }).notNull(),
    endedAt: integer("ended_at", { mode: "number" }),
    watchedSeconds: integer("watched_seconds").notNull().default(0),
    deviceId: text("device_id"),
  },
  (t) => [index("watch_sessions_progress_idx").on(t.videoProgressId, t.startedAt)]
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    userId: text("user_id"),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("events_type_idx").on(t.type, t.createdAt), index("events_user_idx").on(t.userId, t.createdAt)]
);
