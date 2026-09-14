import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Curriculum lessons — future real educational content for the 48 real lessons
 * from Keyword Universe. This table is for FUTURE content insertion without rebuilding.
 *
 * Currently, the 48 lessons live as static data in server/seo/realLessons.server.ts
 * (from CSV). This table allows later import of real شرح/ملخص/مراجعة when source
 * content becomes available, via admin UI or import script.
 *
 * No content is invented here — all fields nullable except official hierarchy.
 * When empty, public curriculum pages fall back to static realLessons data.
 */
export const curriculumLessons = sqliteTable(
  "curriculum_lessons",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    // Official hierarchy from CSV (لا تخمّن، لا تستبدل)
    subject: text("subject").notNull(),
    grade: text("grade").notNull(),
    term: text("term").notNull(),
    unit: text("unit").notNull(),
    chapter: text("chapter").notNull(),
    lesson: text("lesson").notNull(), // official name حرفيًا من CSV
    semanticRaw: text("semantic_raw").notNull(),
    semanticJson: text("semantic_json", { mode: "json" }).$type<string[]>(),
    // Future real educational content (nullable — when source available)
    summaryAr: text("summary_ar"),
    summaryEn: text("summary_en"),
    reviewAr: text("review_ar"),
    reviewEn: text("review_en"),
    conceptsJson: text("concepts_json", { mode: "json" }).$type<string[]>(),
    // Mapping to existing Tito pages (for internal linking)
    subjectSlug: text("subject_slug"), // e.g., falsafa-manteq-1st
    gradeSlug: text("grade_slug"), // e.g., grade-1-secondary
    courseSlug: text("course_slug"), // best matching course
    unitId: text("unit_id"), // best matching unit
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("curriculum_lessons_subject_idx").on(t.subject, t.grade),
    index("curriculum_lessons_slug_idx").on(t.slug),
    index("curriculum_lessons_status_idx").on(t.status, t.sortOrder),
  ]
);

/**
 * Curriculum contents — rich content blocks for a lesson (for future expansion)
 * e.g., شرح مفصل، ملخص، مراجعة، مفاهيم، تمارين
 * Each block can be a separate row, allowing incremental content addition
 */
export const curriculumContents = sqliteTable(
  "curriculum_contents",
  {
    id: text("id").primaryKey(),
    curriculumLessonId: text("curriculum_lesson_id").notNull(),
    blockType: text("block_type", { enum: ["explanation", "summary", "review", "concepts", "glossary", "resources"] }).notNull(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    bodyAr: text("body_ar"), // real educational content, when available
    bodyEn: text("body_en"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("curriculum_contents_lesson_idx").on(t.curriculumLessonId, t.sortOrder),
    index("curriculum_contents_type_idx").on(t.blockType, t.status),
  ]
);
