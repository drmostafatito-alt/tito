import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Content domain (DATABASE-SCHEMA.md "Content (P2)").
 * Hierarchy: program → grade → subject → course → unit → lesson → lesson_items.
 * Slugs unique per table; status draft|published|archived; soft delete via deleted_at.
 * IDs UUIDv4 generated in app code; timestamps INTEGER ms.
 *
 * NOTE (integrity): parent references (program_id, grade_id, …) and asset links
 * (lesson_items.video_id/file_id) are plain TEXT columns + indexes here, NOT
 * SQLite FK constraints. Referential integrity is enforced server-side in the
 * content service: every create* validates that referenced parent/video/file/
 * user rows exist (ContentReferenceError) BEFORE insert — a dangling reference
 * (the file-ID mismatch bug class) is rejected at write time. DB-level FKs for
 * these tables would require a SQLite table-rebuild migration plus a decision on
 * soft-delete and exam_id (Phase 4) semantics — tracked as a deferred item in
 * docs/DECISIONS.md, not changed silently.
 */

export const programs = sqliteTable(
  "programs",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [index("programs_status_idx").on(t.status, t.sortOrder)]
);

export const grades = sqliteTable(
  "grades",
  {
    id: text("id").primaryKey(),
    programId: text("program_id").notNull(),
    slug: text("slug").notNull().unique(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [index("grades_program_idx").on(t.programId, t.sortOrder)]
);

export const subjects = sqliteTable(
  "subjects",
  {
    id: text("id").primaryKey(),
    gradeId: text("grade_id").notNull(),
    slug: text("slug").notNull().unique(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    thumbnailFileId: text("thumbnail_file_id"),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [index("subjects_grade_idx").on(t.gradeId, t.sortOrder)]
);

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id").notNull(),
    teacherId: text("teacher_id"),
    slug: text("slug").notNull().unique(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    thumbnailFileId: text("thumbnail_file_id"),
    accessLevel: text("access_level", {
      enum: ["public", "authenticated", "entitled"],
    })
      .notNull()
      .default("entitled"),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    visibility: text("visibility", {
      enum: ["hidden", "catalog", "featured"],
    })
      .notNull()
      .default("catalog"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    publishAt: integer("publish_at", { mode: "number" }),
    expiresAt: integer("expires_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [
    index("courses_subject_idx").on(t.subjectId, t.status, t.sortOrder),
    index("courses_visibility_idx").on(t.visibility, t.status),
  ]
);

export const units = sqliteTable(
  "units",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [index("units_course_idx").on(t.courseId, t.sortOrder)]
);

export const lessons = sqliteTable(
  "lessons",
  {
    id: text("id").primaryKey(),
    unitId: text("unit_id").notNull(),
    slug: text("slug").notNull().unique(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    accessLevel: text("access_level", {
      enum: ["public", "authenticated", "entitled"],
    })
      .notNull()
      .default("entitled"),
    freePreview: integer("free_preview", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    publishAt: integer("publish_at", { mode: "number" }),
    expiresAt: integer("expires_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [index("lessons_unit_idx").on(t.unitId, t.sortOrder)]
);

/**
 * Course prerequisites (self-referential DAG): a row (courseId → prerequisiteCourseId)
 * means a learner must COMPLETE `prerequisite_course_id` before `course_id` is
 * openable. Plain TEXT refs + app-layer guards (content service validates both ends
 * exist and rejects self-reference / cycles before write), consistent with the
 * no-DB-FK convention on content tables. Completion is defined over lesson_progress
 * (all published lessons completed) — see content service.
 */
export const coursePrerequisites = sqliteTable(
  "course_prerequisites",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    prerequisiteCourseId: text("prerequisite_course_id").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("course_prerequisites_uidx").on(t.courseId, t.prerequisiteCourseId),
    index("course_prerequisites_course_idx").on(t.courseId),
    index("course_prerequisites_prereq_idx").on(t.prerequisiteCourseId),
  ]
);

export const lessonItems = sqliteTable(
  "lesson_items",
  {
    id: text("id").primaryKey(),
    lessonId: text("lesson_id").notNull(),
    itemType: text("item_type", { enum: ["video", "file", "exam"] }).notNull(),
    videoId: text("video_id"),
    fileId: text("file_id"),
    examId: text("exam_id"),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    required: integer("required", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("lesson_items_lesson_idx").on(t.lessonId, t.sortOrder)]
);

/**
 * Provider-neutral video registry (VIDEO-PROVIDERS.md §2). Masters live in R2
 * video-masters/ (never public). Provider specifics never leak to business logic.
 */
export const videos = sqliteTable(
  "videos",
  {
    id: text("id").primaryKey(),
    provider: text("provider", { enum: ["mux", "mock", "bunny", "cfstream"] }).notNull(),
    providerAssetId: text("provider_asset_id"),
    playbackId: text("playback_id"),
    status: text("status", {
      enum: ["pending", "preparing", "ready", "errored"],
    })
      .notNull()
      .default("pending"),
    durationSeconds: integer("duration_seconds", { mode: "number" }),
    thumbnailUrl: text("thumbnail_url"),
    thumbnailFileId: text("thumbnail_file_id"),
    byteSize: integer("byte_size", { mode: "number" }),
    width: integer("width", { mode: "number" }),
    height: integer("height", { mode: "number" }),
    masterR2Key: text("master_r2_key"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("videos_provider_asset_idx").on(t.provider, t.providerAssetId)]
);

/**
 * File registry. r2_key points into PUBLIC_ASSETS (visibility=public) or
 * PRIVATE_FILES (visibility=private) — raw keys/URLs are never exposed;
 * private files are streamed by /files/:id after an HMAC-signed-URL +
 * entitlement check.
 */
export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    r2Key: text("r2_key").notNull().unique(),
    bucket: text("bucket", { enum: ["PUBLIC_ASSETS", "PRIVATE_FILES", "VIDEO_MASTERS"] }).notNull(),
    kind: text("kind", {
      enum: ["pdf", "image", "doc", "audio", "archive", "video"],
    }).notNull(),
    originalFilename: text("original_filename").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("private"),
    downloadAllowed: integer("download_allowed", { mode: "boolean" }).notNull().default(false),
    altAr: text("alt_ar").notNull().default(""),
    altEn: text("alt_en").notNull().default(""),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull().default(0),
  },
  (t) => [index("files_kind_idx").on(t.kind, t.visibility)]
);
