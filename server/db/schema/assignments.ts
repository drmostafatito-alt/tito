import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Homework / Assignments domain.
 *
 * A published assignment is offered to students who are entitled to the content
 * chain it is attached to (course / unit / lesson — app-layer TEXT refs, same
 * integrity policy as exams ADR-017/019/021). Students submit a written answer
 * and/or a private PDF/image file (stored in PRIVATE_FILES via the shared file
 * registry); an authorized grader (instructor/TA) scores it. Server is the
 * authority for who may see/edit/grade and for the deadline. Grading changes are
 * recorded in the append-only audit trail (audit_logs, entityType assignment).
 */

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    instructionsAr: text("instructions_ar"),
    instructionsEn: text("instructions_en"),
    // optional content attachment (app-layer refs — ADR-017); access inherits the chain
    courseId: text("course_id"),
    unitId: text("unit_id"),
    lessonId: text("lesson_id"),
    /** maximum achievable score for this assignment. */
    maxScore: real("max_score").notNull().default(100),
    /** deadline (epoch ms). NULL = no deadline (writes never close). */
    dueAt: integer("due_at", { mode: "number" }),
    /** which submission channels are allowed: subset of ["text","file"]. */
    allowedSubmissionTypes: text("allowed_submission_types", { mode: "json" }).$type<string[]>().notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("assignments_status_idx").on(t.status),
    index("assignments_lesson_idx").on(t.lessonId),
    index("assignments_course_idx").on(t.courseId),
  ]
);

export const assignmentSubmissions = sqliteTable(
  "assignment_submissions",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id").notNull(),
    studentId: text("student_id").notNull(),
    /** submitted = awaiting grading; graded = finalized (score + feedback visible). */
    status: text("status", { enum: ["submitted", "graded"] }).notNull().default("submitted"),
    /** the student's written answer. */
    textAnswer: text("text_answer"),
    /** uploaded PDF/image answer (app-ref to files, PRIVATE_FILES bucket). */
    fileId: text("file_id"),
    /** set on every (re)submission; a fresh submission before the deadline replaces it. */
    submittedAt: integer("submitted_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    score: real("score"),
    feedback: text("feedback"),
    gradedBy: text("graded_by"),
    gradedAt: integer("graded_at", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("assignment_submissions_uidx").on(t.assignmentId, t.studentId),
    index("assignment_submissions_assignment_idx").on(t.assignmentId, t.submittedAt),
    index("assignment_submissions_student_idx").on(t.studentId),
    index("assignment_submissions_status_idx").on(t.status),
  ]
);
