import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Assessment domain (Phase 5 — FEATURE-SPEC §5/§6, DATABASE-SCHEMA "Assessment").
 *
 * The exam config contract lives in `exams.config` (JSON, zod-validated in
 * server/assessment/service.server.ts). Server is the source of truth for
 * timing, grading, and attempt state; the answer key NEVER leaves the server
 * before submission (ADR-022).
 *
 * Integrity policy mirrors ADR-017/019/021: plain TEXT references to other
 * domains (subjects/courses/units/lessons/users) + app-layer guards in the
 * assessment service (references validated before write; no cross-domain FKs).
 */

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["mcq", "true_false", "multi_select", "essay"] }).notNull(),
    stemAr: text("stem_ar").notNull(),
    stemEn: text("stem_en").notNull(),
    explanationAr: text("explanation_ar"),
    explanationEn: text("explanation_en"),
    difficulty: text("difficulty", { enum: ["easy", "medium", "hard"] }).notNull().default("medium"),
    pointsDefault: real("points_default").notNull().default(1),
    // optional topic links (app-layer refs — ADR-017)
    subjectId: text("subject_id"),
    courseId: text("course_id"),
    unitId: text("unit_id"),
    lessonId: text("lesson_id"),
    status: text("status", { enum: ["draft", "in_review", "published", "archived"] }).notNull().default("draft"),
    createdBy: text("created_by"),
    reviewedBy: text("reviewed_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [
    index("questions_status_type_subject_idx").on(t.status, t.type, t.subjectId),
    index("questions_lesson_idx").on(t.lessonId),
  ]
);

export const questionChoices = sqliteTable(
  "question_choices",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id").notNull(),
    contentAr: text("content_ar").notNull(),
    contentEn: text("content_en").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    feedback: text("feedback"),
  },
  (t) => [index("question_choices_q_idx").on(t.questionId, t.sortOrder)]
);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  labelAr: text("label_ar").notNull(),
  labelEn: text("label_en").notNull(),
});

export const questionTags = sqliteTable(
  "question_tags",
  {
    questionId: text("question_id").notNull(),
    tagId: text("tag_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.tagId] })]
);

export const exams = sqliteTable(
  "exams",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    // optional content attachment (app-layer refs — ADR-017); access inherits the chain
    courseId: text("course_id"),
    lessonId: text("lesson_id"),
    /** full policy object — FEATURE-SPEC §6 contract (zod-validated on every write/read) */
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("exams_status_idx").on(t.status), index("exams_lesson_idx").on(t.lessonId)]
);

export const examQuestions = sqliteTable(
  "exam_questions",
  {
    examId: text("exam_id").notNull(),
    questionId: text("question_id").notNull(),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    /** per-exam points override (falls back to questions.points_default) */
    points: real("points").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.examId, t.questionId] }), index("exam_questions_order_idx").on(t.examId, t.sortOrder)]
);

export const examAttempts = sqliteTable(
  "exam_attempts",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id").notNull(),
    studentId: text("student_id").notNull(),
    attemptNumber: integer("attempt_number", { mode: "number" }).notNull(),
    status: text("status", { enum: ["in_progress", "submitted", "grading", "graded", "expired", "cancelled"] })
      .notNull()
      .default("in_progress"),
    startedAt: integer("started_at", { mode: "number" }).notNull(),
    /** server-computed deadline (started_at + duration) — the ONLY authoritative clock */
    deadlineAt: integer("deadline_at", { mode: "number" }),
    submittedAt: integer("submitted_at", { mode: "number" }),
    timeUsedSeconds: integer("time_used_seconds", { mode: "number" }),
    score: real("score"),
    maxScore: real("max_score"),
    passed: integer("passed", { mode: "boolean" }),
    gradingStatus: text("grading_status", { enum: ["auto", "needs_manual", "complete"] }).notNull().default("auto"),
    /** seeds question/choice order — randomization is stable per attempt (review shows the student's own order) */
    randomSeed: integer("random_seed", { mode: "number" }).notNull().default(0),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("exam_attempts_unique_idx").on(t.examId, t.studentId, t.attemptNumber),
    // exactly ONE live attempt per student+exam (enforced by the DB, not by app logic)
    uniqueIndex("exam_attempts_one_live_idx")
      .on(t.examId, t.studentId)
      .where(sql`status = 'in_progress'`),
    index("exam_attempts_student_idx").on(t.studentId, t.startedAt),
    index("exam_attempts_started_idx").on(t.startedAt),
  ]
);

export const examAnswers = sqliteTable(
  "exam_answers",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id").notNull(),
    questionId: text("question_id").notNull(),
    /** selected choice ids (JSON array) for mcq/true_false/multi_select */
    choiceIds: text("choice_ids", { mode: "json" }).$type<string[]>(),
    /** reserved for essay/manual grading (Phase 5 attaches objective questions only) */
    textAnswer: text("text_answer"),
    pointsEarned: real("points_earned"),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    gradedBy: text("graded_by"),
    gradedAt: integer("graded_at", { mode: "number" }),
    feedback: text("feedback"),
    /** autosave idempotency: last-writer-wins per (attempt, question), version bumps */
    version: integer("version").notNull().default(1),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("exam_answers_unique_idx").on(t.attemptId, t.questionId), index("exam_answers_attempt_idx").on(t.attemptId)]
);
