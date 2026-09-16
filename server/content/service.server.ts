import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.server";
import {
  academicYears,
  coursePrerequisites,
  courses,
  files,
  grades,
  lessonItems,
  lessonProgress,
  lessons,
  programs,
  subjects,
  terms,
  units,
  users,
  videos,
} from "../db/schema";
import { logAudit } from "../audit/log.server";

/**
 * Content tree service (Phase 2): Program→Grade→Subject→Course→Unit→Lesson→LessonItem.
 * Admin mutations are audited; catalog reads expose only published/visible nodes;
 * ordering is explicit (sort_order within parent); slugs are unique per table.
 *
 * Owner content model (Study phase): AcademicYear → Grade → Subject → Term → Lesson.
 * `academic_years` and `terms` are first-class owner-created rows. The (year, term)
 * binding lives on the `courses` row — internally a "term offering" container — so
 * the existing chain, resolver, progress and prerequisite machinery is reused
 * unchanged while the student-facing surfaces speak only سنة/صف/مادة/ترم/درس.
 */

export const CONTENT_TYPES = ["academicYear", "term", "program", "grade", "subject", "course", "unit", "lesson", "lessonItem"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const statusSchema = z.enum(["draft", "published", "archived"]);
export const accessLevelSchema = z.enum(["public", "authenticated", "entitled"]);
export const visibilitySchema = z.enum(["hidden", "catalog", "featured"]);

const titleSchema = z.string().trim().min(1).max(200);
const descSchema = z.string().trim().max(4000).optional().nullable();

export const createProgramSchema = z.object({
  slug: z.string().trim().min(1).max(120).optional(),
  titleAr: titleSchema,
  titleEn: titleSchema,
  descriptionAr: descSchema,
  descriptionEn: descSchema,
  status: statusSchema.default("draft"),
  sortOrder: z.number().int().min(0).default(0),
});

/**
 * Academic year ("2026/2027"). The admin types the label AND the two calendar
 * years, so nothing is derived by guessing from a string. `endYear` must follow
 * `startYear`. Years are never auto-created by the system.
 */
export const createAcademicYearSchema = z
  .object({
    slug: z.string().trim().min(1).max(120).optional(),
    titleAr: titleSchema,
    titleEn: titleSchema,
    startYear: z.number().int().min(1990).max(2999),
    endYear: z.number().int().min(1990).max(2999),
    isCurrent: z.boolean().default(false),
    status: statusSchema.default("draft"),
    sortOrder: z.number().int().min(0).default(0),
  })
  .refine((v) => v.endYear === v.startYear + 1 || v.endYear === v.startYear, {
    message: "endYear must be the same or the next calendar year",
    path: ["endYear"],
  });

/**
 * Term ("الترم الأول"). A free, owner-defined list — the platform never assumes
 * a fixed number of terms and never seeds one.
 */
export const createTermSchema = z.object({
  slug: z.string().trim().min(1).max(120).optional(),
  titleAr: titleSchema,
  titleEn: titleSchema,
  startsAt: z.number().int().positive().optional().nullable(),
  endsAt: z.number().int().positive().optional().nullable(),
  status: statusSchema.default("draft"),
  sortOrder: z.number().int().min(0).default(0),
});

export const createGradeSchema = createProgramSchema.omit({ descriptionAr: true, descriptionEn: true }).extend({ programId: z.string().min(1) });
export const createSubjectSchema = createProgramSchema.extend({
  gradeId: z.string().min(1),
  thumbnailFileId: z.string().optional().nullable(),
});

export const createCourseSchema = z.object({
  subjectId: z.string().min(1),
  teacherId: z.string().optional().nullable(),
  /** Academic scoping: when both are set the row is a "term offering" container. */
  academicYearId: z.string().min(1).optional().nullable(),
  termId: z.string().min(1).optional().nullable(),
  slug: z.string().trim().min(1).max(120).optional(),
  titleAr: titleSchema,
  titleEn: titleSchema,
  descriptionAr: descSchema,
  descriptionEn: descSchema,
  thumbnailFileId: z.string().optional().nullable(),
  accessLevel: accessLevelSchema.default("entitled"),
  status: statusSchema.default("draft"),
  visibility: visibilitySchema.default("catalog"),
  sortOrder: z.number().int().min(0).default(0),
  publishAt: z.number().int().positive().optional().nullable(),
  expiresAt: z.number().int().positive().optional().nullable(),
});

export const createUnitSchema = z.object({
  courseId: z.string().min(1),
  titleAr: titleSchema,
  titleEn: titleSchema,
  status: statusSchema.default("draft"),
  sortOrder: z.number().int().min(0).default(0),
});

export const createLessonSchema = z.object({
  unitId: z.string().min(1),
  slug: z.string().trim().min(1).max(120).optional(),
  titleAr: titleSchema,
  titleEn: titleSchema,
  descriptionAr: descSchema,
  descriptionEn: descSchema,
  accessLevel: accessLevelSchema.default("entitled"),
  freePreview: z.boolean().default(false),
  status: statusSchema.default("draft"),
  sortOrder: z.number().int().min(0).default(0),
  publishAt: z.number().int().positive().optional().nullable(),
  expiresAt: z.number().int().positive().optional().nullable(),
});

export const createLessonItemSchema = z.object({
  lessonId: z.string().min(1),
  itemType: z.enum(["video", "file", "exam", "link"]),
  videoId: z.string().optional().nullable(),
  fileId: z.string().optional().nullable(),
  examId: z.string().optional().nullable(),
  // "link" items (external Google Form / quiz) — linkUrl must already be the
  // canonical embed URL produced by parseGoogleFormUrl(); this layer does not
  // accept raw owner input.
  linkUrl: z.string().url().max(500).optional().nullable(),
  titleAr: z.string().max(200).optional().nullable(),
  titleEn: z.string().max(200).optional().nullable(),
  descriptionAr: z.string().max(2000).optional().nullable(),
  descriptionEn: z.string().max(2000).optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
  required: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** Arabic-aware slugify: keeps Arabic letters + latin + digits, '-' for spaces. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "") // latin diacritics
    .replace(/[^\w\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100);
}

async function uniqueSlug(taken: (s: string) => Promise<boolean>, base: string): Promise<string> {
  const root = slugify(base) || `n-${crypto.randomUUID().slice(0, 8)}`;
  if (!(await taken(root))) return root;
  for (let i = 2; i < 200; i++) {
    const candidate = `${root}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${root}-${crypto.randomUUID().slice(0, 6)}`;
}

// ---------------------------------------------------------------------------
// Table registry (typing per node type without dynimport games)
// ---------------------------------------------------------------------------

function tableFor(type: ContentType) {
  switch (type) {
    case "academicYear": return academicYears;
    case "term": return terms;
    case "program": return programs;
    case "grade": return grades;
    case "subject": return subjects;
    case "course": return courses;
    case "unit": return units;
    case "lesson": return lessons;
    case "lessonItem": return lessonItems;
  }
}

const idCol = (t: ReturnType<typeof tableFor>) => (t as unknown as Record<string, never>)["id"];

export async function getNode(db: DB, type: ContentType, id: string) {
  const t = tableFor(type);
  const rows = await db.select().from(t).where(eq(idCol(t), id as never)).limit(1);
  return (rows[0] as Record<string, unknown>) ?? null;
}

export async function getNodes(db: DB, type: ContentType, ids: string[]) {
  if (ids.length === 0) return [];
  const t = tableFor(type);
  const rows = await db.select().from(t).where(inArray(idCol(t), ids as never));
  return rows as unknown as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Referential integrity (application-enforced)
//
// Content tables carry no SQLite FK constraints (see db/schema/content.ts note);
// the service layer is therefore the integrity gate: every parent/asset reference
// must resolve to an existing row BEFORE insert. This is the regression guard for
// the file-ID mismatch bug class — an ID that doesn't match a persisted row is
// rejected here instead of producing a dangling lesson_items reference.
// ---------------------------------------------------------------------------

export class ContentReferenceError extends Error {
  constructor(public readonly field: string, public readonly referenceId: string) {
    super(`reference not found: ${field}=${referenceId}`);
    this.name = "ContentReferenceError";
  }
}

async function assertContentRef(db: DB, type: ContentType, id: string, field: string): Promise<void> {
  if (!(await getNode(db, type, id))) throw new ContentReferenceError(field, id);
}

async function assertOptionalContentRef(db: DB, type: ContentType, id: string | null | undefined, field: string): Promise<void> {
  if (id) await assertContentRef(db, type, id, field);
}

async function assertFileRef(db: DB, id: string | null | undefined, field: string): Promise<void> {
  if (!id) return;
  const rows = await db.select({ id: files.id }).from(files).where(eq(files.id, id)).limit(1);
  if (rows.length === 0) throw new ContentReferenceError(field, id);
}

async function assertVideoRef(db: DB, id: string | null | undefined, field: string): Promise<void> {
  if (!id) return;
  const rows = await db.select({ id: videos.id }).from(videos).where(eq(videos.id, id)).limit(1);
  if (rows.length === 0) throw new ContentReferenceError(field, id);
}

async function assertUserRef(db: DB, id: string | null | undefined, field: string): Promise<void> {
  if (!id) return;
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (rows.length === 0) throw new ContentReferenceError(field, id);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface ActorCtx {
  userId: string;
  role: string;
  ipHash?: string | null;
}

export async function createAcademicYear(db: DB, input: z.infer<typeof createAcademicYearSchema>, actor: ActorCtx) {
  const slug = await uniqueSlug(
    async (s) => (await db.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.slug, s)).limit(1)).length > 0,
    input.slug ?? `${input.startYear}-${input.endYear}`
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  // "current year" is a single-select flag: setting it clears the previous one so
  // the student hub never has to guess which year to open first.
  if (input.isCurrent) {
    await db.update(academicYears).set({ isCurrent: false, updatedAt: now }).where(eq(academicYears.isCurrent, true));
  }
  const row = {
    id, slug, titleAr: input.titleAr, titleEn: input.titleEn,
    startYear: input.startYear, endYear: input.endYear, isCurrent: input.isCurrent,
    status: input.status, sortOrder: input.sortOrder, createdAt: now, updatedAt: now, deletedAt: null,
  };
  await db.insert(academicYears).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.academicYear.created", entityType: "academicYear", entityId: id, after: row });
  return row;
}

export async function createTerm(db: DB, input: z.infer<typeof createTermSchema>, actor: ActorCtx) {
  const slug = await uniqueSlug(
    async (s) => (await db.select({ id: terms.id }).from(terms).where(eq(terms.slug, s)).limit(1)).length > 0,
    input.slug ?? input.titleEn
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    id, slug, titleAr: input.titleAr, titleEn: input.titleEn,
    startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
    status: input.status, sortOrder: input.sortOrder, createdAt: now, updatedAt: now, deletedAt: null,
  };
  await db.insert(terms).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.term.created", entityType: "term", entityId: id, after: row });
  return row;
}

export async function createProgram(db: DB, input: z.infer<typeof createProgramSchema>, actor: ActorCtx) {
  const slug = await uniqueSlug(
    async (s) => (await db.select({ id: programs.id }).from(programs).where(eq(programs.slug, s)).limit(1)).length > 0,
    input.slug ?? input.titleEn
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = { id, slug, titleAr: input.titleAr, titleEn: input.titleEn, descriptionAr: input.descriptionAr ?? null, descriptionEn: input.descriptionEn ?? null, status: input.status, sortOrder: input.sortOrder, createdAt: now, updatedAt: now, deletedAt: null };
  await db.insert(programs).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.program.created", entityType: "program", entityId: id, after: row });
  return row;
}

export async function createGrade(db: DB, input: z.infer<typeof createGradeSchema>, actor: ActorCtx) {
  await assertContentRef(db, "program", input.programId, "programId");
  const slug = await uniqueSlug(
    async (s) => (await db.select({ id: grades.id }).from(grades).where(eq(grades.slug, s)).limit(1)).length > 0,
    input.slug ?? input.titleEn
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = { id, programId: input.programId, slug, titleAr: input.titleAr, titleEn: input.titleEn, status: input.status, sortOrder: input.sortOrder, createdAt: now, updatedAt: now, deletedAt: null };
  await db.insert(grades).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.grade.created", entityType: "grade", entityId: id, after: row });
  return row;
}

export async function createSubject(db: DB, input: z.infer<typeof createSubjectSchema>, actor: ActorCtx) {
  await assertContentRef(db, "grade", input.gradeId, "gradeId");
  await assertFileRef(db, input.thumbnailFileId, "thumbnailFileId");
  const slug = await uniqueSlug(
    async (s) => (await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.slug, s)).limit(1)).length > 0,
    input.slug ?? input.titleEn
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = { id, gradeId: input.gradeId, slug, titleAr: input.titleAr, titleEn: input.titleEn, descriptionAr: input.descriptionAr ?? null, descriptionEn: input.descriptionEn ?? null, thumbnailFileId: input.thumbnailFileId ?? null, status: input.status, sortOrder: input.sortOrder, createdAt: now, updatedAt: now, deletedAt: null };
  await db.insert(subjects).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.subject.created", entityType: "subject", entityId: id, after: row });
  return row;
}

export async function createCourse(db: DB, input: z.infer<typeof createCourseSchema>, actor: ActorCtx) {
  await assertContentRef(db, "subject", input.subjectId, "subjectId");
  await assertUserRef(db, input.teacherId, "teacherId");
  await assertFileRef(db, input.thumbnailFileId, "thumbnailFileId");
  await assertOptionalContentRef(db, "academicYear", input.academicYearId, "academicYearId");
  await assertOptionalContentRef(db, "term", input.termId, "termId");
  // A term is only meaningful inside a year: refuse the ambiguous half-scope so
  // authorization can never have to guess what "الترم الأول" alone refers to.
  if (input.termId && !input.academicYearId) throw new ContentReferenceError("academicYearId", "(required with termId)");
  const slug = await uniqueSlug(
    async (s) => (await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, s)).limit(1)).length > 0,
    input.slug ?? input.titleEn
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    id, subjectId: input.subjectId, teacherId: input.teacherId ?? null, slug,
    academicYearId: input.academicYearId ?? null, termId: input.termId ?? null,
    titleAr: input.titleAr, titleEn: input.titleEn,
    descriptionAr: input.descriptionAr ?? null, descriptionEn: input.descriptionEn ?? null,
    thumbnailFileId: input.thumbnailFileId ?? null,
    accessLevel: input.accessLevel, status: input.status, visibility: input.visibility,
    sortOrder: input.sortOrder, publishAt: input.publishAt ?? null, expiresAt: input.expiresAt ?? null,
    createdAt: now, updatedAt: now, deletedAt: null,
  };
  await db.insert(courses).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.course.created", entityType: "course", entityId: id, after: row });
  return row;
}

export async function createUnit(db: DB, input: z.infer<typeof createUnitSchema>, actor: ActorCtx) {
  await assertContentRef(db, "course", input.courseId, "courseId");
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = { id, courseId: input.courseId, titleAr: input.titleAr, titleEn: input.titleEn, status: input.status, sortOrder: input.sortOrder, createdAt: now, updatedAt: now, deletedAt: null };
  await db.insert(units).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.unit.created", entityType: "unit", entityId: id, after: row });
  return row;
}

export async function createLesson(db: DB, input: z.infer<typeof createLessonSchema>, actor: ActorCtx) {
  await assertContentRef(db, "unit", input.unitId, "unitId");
  const slug = await uniqueSlug(
    async (s) => (await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.slug, s)).limit(1)).length > 0,
    input.slug ?? input.titleEn
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    id, unitId: input.unitId, slug, titleAr: input.titleAr, titleEn: input.titleEn,
    descriptionAr: input.descriptionAr ?? null, descriptionEn: input.descriptionEn ?? null,
    accessLevel: input.accessLevel, freePreview: input.freePreview, status: input.status,
    sortOrder: input.sortOrder, publishAt: input.publishAt ?? null, expiresAt: input.expiresAt ?? null,
    createdAt: now, updatedAt: now, deletedAt: null,
  };
  await db.insert(lessons).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.lesson.created", entityType: "lesson", entityId: id, after: row });
  return row;
}

export async function createLessonItem(db: DB, input: z.infer<typeof createLessonItemSchema>, actor: ActorCtx) {
  if (input.itemType === "video" && !input.videoId) throw new Error("video item requires videoId");
  if (input.itemType === "file" && !input.fileId) throw new Error("file item requires fileId");
  if (input.itemType === "link" && !input.linkUrl) throw new Error("link item requires linkUrl");
  await assertContentRef(db, "lesson", input.lessonId, "lessonId");
  await assertVideoRef(db, input.videoId, "videoId");
  await assertFileRef(db, input.fileId, "fileId");
  const id = crypto.randomUUID();
  const row = {
    id, lessonId: input.lessonId, itemType: input.itemType,
    videoId: input.videoId ?? null, fileId: input.fileId ?? null, examId: input.examId ?? null,
    linkUrl: input.itemType === "link" ? (input.linkUrl ?? null) : null,
    titleAr: input.titleAr ?? null, titleEn: input.titleEn ?? null,
    descriptionAr: input.descriptionAr ?? null, descriptionEn: input.descriptionEn ?? null,
    sortOrder: input.sortOrder, required: input.required, createdAt: Date.now(),
  };
  await db.insert(lessonItems).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "content.lesson_item.created", entityType: "lesson_item", entityId: id, after: row });
  return row;
}

// ---------------------------------------------------------------------------
// Update / archive (audited, whitelisted fields per type)
// ---------------------------------------------------------------------------

export const updateFieldsSchema = z.record(z.string(), z.unknown());

/** Whitelisted mutable fields per node type. */
const MUTABLE: Record<ContentType, string[]> = {
  academicYear: ["titleAr", "titleEn", "startYear", "endYear", "isCurrent", "status", "sortOrder"],
  term: ["titleAr", "titleEn", "startsAt", "endsAt", "status", "sortOrder"],
  program: ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "status", "sortOrder"],
  grade: ["titleAr", "titleEn", "status", "sortOrder"],
  subject: ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "thumbnailFileId", "status", "sortOrder"],
  course: ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "thumbnailFileId", "accessLevel", "status", "visibility", "sortOrder", "publishAt", "expiresAt", "teacherId", "academicYearId", "termId"],
  unit: ["titleAr", "titleEn", "status", "sortOrder"],
  lesson: ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "accessLevel", "freePreview", "status", "sortOrder", "publishAt", "expiresAt"],
  lessonItem: ["sortOrder", "required"],
};

export async function updateNode(
  db: DB,
  type: ContentType,
  id: string,
  patch: Record<string, unknown>,
  actor: ActorCtx
): Promise<{ ok: true } | { ok: false; error: "not_found" | "unknown_field" }> {
  const allowed = MUTABLE[type];
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue; // ignore unknown keys silently (forms send extras)
    clean[k] = v;
  }
  const before = await getNode(db, type, id);
  if (!before) return { ok: false, error: "not_found" };
  const table = tableFor(type);
  await db
    .update(table)
    .set({ ...clean, updatedAt: Date.now() } as never)
    .where(eq(table.id, id));
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: `content.${type}.updated`, entityType: type, entityId: id,
    before: before as Record<string, unknown>, after: clean,
  });
  return { ok: true };
}

/** Archive = status 'archived' (reversible; soft, hides from catalog & access). */
export async function archiveNode(db: DB, type: ContentType, id: string, actor: ActorCtx): Promise<boolean> {
  const r = await updateNode(db, type, id, { status: "archived" }, actor);
  return r.ok;
}

// ---------------------------------------------------------------------------
// Duplicate — deep copy of a node and its descendants through the SAME
// validated create* paths (slug uniqueness, reference assertions, audit).
// Safety: copies are always created as DRAFT so nothing publishes implicitly.
// ---------------------------------------------------------------------------

/**
 * Duplication is meaningful for the content tree only. Academic years and terms
 * are small owner-managed reference rows (a copied year/term would be a duplicate
 * label, not useful content), so they are excluded — they are created/edited and
 * reordered directly.
 */
type DuplicableType = Exclude<ContentType, "lessonItem" | "academicYear" | "term">;

export async function duplicateNode(
  db: DB,
  type: DuplicableType,
  id: string,
  actor: ActorCtx
): Promise<{ ok: true; id: string } | { ok: false; error: "not_found" }> {
  const node = (await getNode(db, type, id)) as unknown as Record<string, unknown> | null;
  if (!node) return { ok: false, error: "not_found" };

  const copyTitle = (v: unknown, suffix: string) =>
    `${String(v ?? "")}${String(v ?? "").trim() === "" ? "" : " "}${suffix}`.trim();
  const suffixAr = "(نسخة)";
  const suffixEn = "(copy)";

  let newRootId: string;

  switch (type) {
    case "program":
      newRootId = (await createProgram(db, {
        titleAr: copyTitle(node.titleAr, suffixAr),
        titleEn: copyTitle(node.titleEn, suffixEn),
        descriptionAr: (node.descriptionAr as string | null) ?? null,
        descriptionEn: (node.descriptionEn as string | null) ?? null,
        status: "draft",
        sortOrder: (node.sortOrder as number) + 1,
        slug: undefined,
      }, actor)).id;
      break;
    case "grade":
      newRootId = (await createGrade(db, {
        programId: node.programId as string,
        titleAr: copyTitle(node.titleAr, suffixAr),
        titleEn: copyTitle(node.titleEn, suffixEn),
        status: "draft",
        sortOrder: (node.sortOrder as number) + 1,
        slug: undefined,
      }, actor)).id;
      break;
    case "subject":
      newRootId = (await createSubject(db, {
        gradeId: node.gradeId as string,
        titleAr: copyTitle(node.titleAr, suffixAr),
        titleEn: copyTitle(node.titleEn, suffixEn),
        descriptionAr: (node.descriptionAr as string | null) ?? null,
        descriptionEn: (node.descriptionEn as string | null) ?? null,
        thumbnailFileId: (node.thumbnailFileId as string | null) ?? null,
        status: "draft",
        sortOrder: (node.sortOrder as number) + 1,
        slug: undefined,
      }, actor)).id;
      break;
    case "course":
      newRootId = (await createCourse(db, {
        subjectId: node.subjectId as string,
        academicYearId: (node.academicYearId as string | null) ?? null,
        termId: (node.termId as string | null) ?? null,
        titleAr: copyTitle(node.titleAr, suffixAr),
        titleEn: copyTitle(node.titleEn, suffixEn),
        descriptionAr: (node.descriptionAr as string | null) ?? null,
        descriptionEn: (node.descriptionEn as string | null) ?? null,
        thumbnailFileId: (node.thumbnailFileId as string | null) ?? null,
        visibility: node.visibility as "catalog" | "hidden" | "featured",
        accessLevel: node.accessLevel as "public" | "authenticated" | "entitled",
        status: "draft",
        sortOrder: (node.sortOrder as number) + 1,
        teacherId: (node.teacherId as string | null) ?? null,
        publishAt: null,
        expiresAt: null,
        slug: undefined,
      }, actor)).id;
      break;
    case "unit":
      newRootId = (await createUnit(db, {
        courseId: node.courseId as string,
        titleAr: copyTitle(node.titleAr, suffixAr),
        titleEn: copyTitle(node.titleEn, suffixEn),
        status: "draft",
        sortOrder: (node.sortOrder as number) + 1,
      }, actor)).id;
      break;
    case "lesson": {
      newRootId = (await createLesson(db, {
        unitId: node.unitId as string,
        titleAr: copyTitle(node.titleAr, suffixAr),
        titleEn: copyTitle(node.titleEn, suffixEn),
        descriptionAr: (node.descriptionAr as string | null) ?? null,
        descriptionEn: (node.descriptionEn as string | null) ?? null,
        accessLevel: node.accessLevel as "public" | "authenticated" | "entitled",
        freePreview: false, // never clone a free-preview flag onto a draft copy
        status: "draft",
        sortOrder: (node.sortOrder as number) + 1,
        publishAt: null,
        expiresAt: null,
        slug: undefined,
      }, actor)).id;
      // lesson items: share the same video/file/exam references (no media copy)
      const items = await itemsForLesson(db, id);
      for (const it of items) {
        await createLessonItem(db, {
          lessonId: newRootId,
          itemType: it.itemType as "video" | "file" | "exam",
          videoId: it.itemType === "video" ? it.videoId : null,
          fileId: it.itemType === "file" ? it.fileId : null,
          examId: it.itemType === "exam" ? it.examId : null,
          sortOrder: it.sortOrder,
          required: it.required,
        }, actor);
      }
      break;
    }
  }

  // Recurse into children (units of a course, lessons of a unit, …).
  const table = tableFor(type);
  const childType: DuplicableType | null =
    type === "program" ? "grade" :
    type === "grade" ? "subject" :
    type === "subject" ? "course" :
    type === "course" ? "unit" :
    type === "unit" ? "lesson" : null;
  if (childType) {
    const childTable = tableFor(childType);
    const childParentField = PARENT_FIELD[childType]!;
    const children = (await db
      .select()
      .from(childTable)
      .where(eq((childTable as unknown as Record<string, never>)[childParentField], id as never))
      .orderBy(asc((childTable as unknown as Record<string, never>)["sortOrder"]))) as unknown as Array<Record<string, unknown>>;
    for (const child of children) {
      if (child.deletedAt) continue;
      await duplicateInto(db, childType, child.id as string, type, newRootId, actor);
    }
  }
  void table;
  return { ok: true, id: newRootId };
}

/** Duplicate `srcId` (of `type`) as a child of the new parent `newParentId`. */
async function duplicateInto(
  db: DB,
  type: DuplicableType,
  srcId: string,
  parentType: DuplicableType,
  newParentId: string,
  actor: ActorCtx
): Promise<void> {
  const node = (await getNode(db, type, srcId)) as unknown as Record<string, unknown> | null;
  if (!node) return;
  const copyTitle = (v: unknown) => String(v ?? "");
  let newId: string | null = null;
  switch (type) {
    case "grade":
      if (parentType !== "program") return;
      newId = (await createGrade(db, {
        programId: newParentId, titleAr: copyTitle(node.titleAr), titleEn: copyTitle(node.titleEn),
        status: "draft", sortOrder: node.sortOrder as number, slug: undefined,
      }, actor)).id;
      break;
    case "subject":
      if (parentType !== "grade") return;
      newId = (await createSubject(db, {
        gradeId: newParentId, titleAr: copyTitle(node.titleAr), titleEn: copyTitle(node.titleEn),
        descriptionAr: (node.descriptionAr as string | null) ?? null,
        descriptionEn: (node.descriptionEn as string | null) ?? null,
        thumbnailFileId: (node.thumbnailFileId as string | null) ?? null,
        status: "draft", sortOrder: node.sortOrder as number, slug: undefined,
      }, actor)).id;
      break;
    case "course":
      if (parentType !== "subject") return;
      newId = (await createCourse(db, {
        subjectId: newParentId, titleAr: copyTitle(node.titleAr), titleEn: copyTitle(node.titleEn),
        academicYearId: (node.academicYearId as string | null) ?? null,
        termId: (node.termId as string | null) ?? null,
        descriptionAr: (node.descriptionAr as string | null) ?? null,
        descriptionEn: (node.descriptionEn as string | null) ?? null,
        thumbnailFileId: (node.thumbnailFileId as string | null) ?? null,
        visibility: node.visibility as "catalog" | "hidden" | "featured",
        accessLevel: node.accessLevel as "public" | "authenticated" | "entitled",
        status: "draft", sortOrder: node.sortOrder as number,
        teacherId: (node.teacherId as string | null) ?? null,
        publishAt: null, expiresAt: null, slug: undefined,
      }, actor)).id;
      break;
    case "unit":
      if (parentType !== "course") return;
      newId = (await createUnit(db, {
        courseId: newParentId, titleAr: copyTitle(node.titleAr), titleEn: copyTitle(node.titleEn),
        status: "draft", sortOrder: node.sortOrder as number,
      }, actor)).id;
      break;
    case "lesson": {
      if (parentType !== "unit") return;
      newId = (await createLesson(db, {
        unitId: newParentId, titleAr: copyTitle(node.titleAr), titleEn: copyTitle(node.titleEn),
        descriptionAr: (node.descriptionAr as string | null) ?? null,
        descriptionEn: (node.descriptionEn as string | null) ?? null,
        accessLevel: node.accessLevel as "public" | "authenticated" | "entitled",
        freePreview: false,
        status: "draft", sortOrder: node.sortOrder as number,
        publishAt: null, expiresAt: null, slug: undefined,
      }, actor)).id;
      if (newId) {
        const items = await itemsForLesson(db, srcId);
        for (const it of items) {
          await createLessonItem(db, {
            lessonId: newId,
            itemType: it.itemType as "video" | "file" | "exam",
            videoId: it.itemType === "video" ? it.videoId : null,
            fileId: it.itemType === "file" ? it.fileId : null,
            examId: it.itemType === "exam" ? it.examId : null,
            sortOrder: it.sortOrder,
            required: it.required,
          }, actor);
        }
      }
      break;
    }
  }
  if (!newId) return;
  const childType: DuplicableType | null =
    type === "program" ? "grade" :
    type === "grade" ? "subject" :
    type === "subject" ? "course" :
    type === "course" ? "unit" :
    type === "unit" ? "lesson" : null;
  if (!childType) return;
  const childTable = tableFor(childType);
  const childParentField = PARENT_FIELD[childType]!;
  const children = (await db
    .select()
    .from(childTable)
    .where(eq((childTable as unknown as Record<string, never>)[childParentField], srcId as never))
    .orderBy(asc((childTable as unknown as Record<string, never>)["sortOrder"]))) as unknown as Array<Record<string, unknown>>;
  for (const child of children) {
    if (child.deletedAt) continue;
    await duplicateInto(db, childType, child.id as string, type, newId, actor);
  }
}

// ---------------------------------------------------------------------------
// Ordering — renumber siblings deterministically, then swap with the neighbor.
// ---------------------------------------------------------------------------

const PARENT_FIELD: Partial<Record<ContentType, string>> = {
  grade: "programId",
  subject: "gradeId",
  course: "subjectId",
  unit: "courseId",
  lesson: "unitId",
  lessonItem: "lessonId",
};

/** Root-level reference rows that are still reorderable among their own siblings. */
const SELF_ORDERED_ROOTS: ContentType[] = ["academicYear", "term"];

export async function moveNode(
  db: DB,
  type: ContentType,
  id: string,
  direction: "up" | "down"
): Promise<{ ok: true } | { ok: false; error: "not_found" | "no_neighbor" | "root_type" }> {
  const parentField = PARENT_FIELD[type];
  const selfOrdered = SELF_ORDERED_ROOTS.includes(type);
  if (!parentField && !selfOrdered) return { ok: false, error: "root_type" };
  const node = await getNode(db, type, id);
  if (!node) return { ok: false, error: "not_found" };

  const table = tableFor(type);
  const col = (name: string) => (table as unknown as Record<string, never>)[name];
  const siblings = (await db
    .select()
    .from(table)
    .where(
      parentField
        ? eq(col(parentField), node[parentField] as never)
        : and(isNull(col("deletedAt")))
    )
    .orderBy(asc(col("sortOrder")), asc(col("createdAt")))) as unknown as Array<Record<string, unknown>>;

  const idx = siblings.findIndex((s) => s.id === id);
  const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0) return { ok: false, error: "not_found" };
  if (neighborIdx < 0 || neighborIdx >= siblings.length) return { ok: false, error: "no_neighbor" };

  // normalize 0..n-1 in memory, swap target/neighbor, persist both
  const order = siblings.map((s) => s.id as string);
  [order[idx], order[neighborIdx]] = [order[neighborIdx], order[idx]];
  const now = Date.now();
  for (let position = 0; position < order.length; position++) {
    const sid = order[position];
    const current = siblings.find((s) => s.id === sid)!;
    if ((current.sortOrder as number) !== position) {
      await db.update(table).set({ sortOrder: position, updatedAt: now } as never).where(eq(table.id, sid));
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tree + catalog reads
// ---------------------------------------------------------------------------

export interface AdminTreeNode {
  type: ContentType;
  id: string;
  slug?: string;
  titleAr: string;
  titleEn: string;
  status: string;
  sortOrder: number;
  children: AdminTreeNode[];
}

function toNode(type: ContentType, row: Record<string, unknown>): AdminTreeNode {
  return {
    type, id: row.id as string, slug: row.slug as string | undefined,
    titleAr: row.titleAr as string, titleEn: row.titleEn as string,
    status: row.status as string, sortOrder: row.sortOrder as number,
    children: [],
  };
}

const byOrder = <T extends { sortOrder: number; createdAt: number }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.createdAt - b.createdAt;

/** Full tree for the admin console (all statuses, archived included). */
export async function adminTree(db: DB): Promise<AdminTreeNode[]> {
  const [p, g, s, c, u, l] = await Promise.all([
    db.select().from(programs).where(isNull(programs.deletedAt)),
    db.select().from(grades).where(isNull(grades.deletedAt)),
    db.select().from(subjects).where(isNull(subjects.deletedAt)),
    db.select().from(courses).where(isNull(courses.deletedAt)),
    db.select().from(units).where(isNull(units.deletedAt)),
    db.select().from(lessons).where(isNull(lessons.deletedAt)),
  ]);
  const lessonNodes = new Map<string, AdminTreeNode[]>();
  for (const row of l.sort(byOrder)) {
    const list = lessonNodes.get(row.unitId as string) ?? [];
    list.push(toNode("lesson", row as unknown as Record<string, unknown>));
    lessonNodes.set(row.unitId as string, list);
  }
  const unitNodes = new Map<string, AdminTreeNode[]>();
  for (const row of u.sort(byOrder)) {
    const list = unitNodes.get(row.courseId as string) ?? [];
    list.push({ ...toNode("unit", row as unknown as Record<string, unknown>), children: lessonNodes.get(row.id as string) ?? [] });
    unitNodes.set(row.courseId as string, list);
  }
  const courseNodes = new Map<string, AdminTreeNode[]>();
  for (const row of c.sort(byOrder)) {
    const list = courseNodes.get(row.subjectId as string) ?? [];
    list.push({ ...toNode("course", row as unknown as Record<string, unknown>), children: unitNodes.get(row.id as string) ?? [] });
    courseNodes.set(row.subjectId as string, list);
  }
  const subjectNodes = new Map<string, AdminTreeNode[]>();
  for (const row of s.sort(byOrder)) {
    const list = subjectNodes.get(row.gradeId as string) ?? [];
    list.push({ ...toNode("subject", row as unknown as Record<string, unknown>), children: courseNodes.get(row.id as string) ?? [] });
    subjectNodes.set(row.gradeId as string, list);
  }
  const gradeNodes = new Map<string, AdminTreeNode[]>();
  for (const row of g.sort(byOrder)) {
    const list = gradeNodes.get(row.programId as string) ?? [];
    list.push({ ...toNode("grade", row as unknown as Record<string, unknown>), children: subjectNodes.get(row.id as string) ?? [] });
    gradeNodes.set(row.programId as string, list);
  }
  return p
    .sort(byOrder)
    .map((row) => ({ ...toNode("program", row as unknown as Record<string, unknown>), children: gradeNodes.get(row.id as string) ?? [] }));
}

/** Catalog: published + catalog/featured visible courses with their subject/grade/program titles. */
export async function catalogCourses(db: DB) {
  const rows = await db
    .select({
      course: courses,
      subjectAr: subjects.titleAr,
      subjectEn: subjects.titleEn,
      subjectSlug: subjects.slug,
      gradeAr: grades.titleAr,
      gradeEn: grades.titleEn,
      gradeSlug: grades.slug,
      programAr: programs.titleAr,
      programEn: programs.titleEn,
      programSlug: programs.slug,
      thumbnailFileId: courses.thumbnailFileId,
    })
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .innerJoin(grades, eq(subjects.gradeId, grades.id))
    .innerJoin(programs, eq(grades.programId, programs.id))
    .where(
      and(
        eq(courses.status, "published"),
        inArray(courses.visibility, ["catalog", "featured"]),
        isNull(courses.deletedAt),
        sql`(${courses.publishAt} IS NULL OR ${courses.publishAt} <= ${Date.now()})`,
        sql`(${courses.expiresAt} IS NULL OR ${courses.expiresAt} > ${Date.now()})`,
        eq(subjects.status, "published"),
        eq(grades.status, "published"),
        eq(programs.status, "published")
      )
    )
    .orderBy(asc(programs.sortOrder), asc(grades.sortOrder), asc(subjects.sortOrder), asc(courses.sortOrder));
  return rows;
}

export async function courseBySlug(db: DB, slug: string) {
  const rows = await db.select().from(courses).where(eq(courses.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function unitsForCourse(db: DB, courseId: string) {
  return db.select().from(units).where(and(eq(units.courseId, courseId), isNull(units.deletedAt))).orderBy(asc(units.sortOrder), asc(units.createdAt));
}

export async function lessonsForUnit(db: DB, unitId: string) {
  return db.select().from(lessons).where(and(eq(lessons.unitId, unitId), isNull(lessons.deletedAt))).orderBy(asc(lessons.sortOrder), asc(lessons.createdAt));
}

export async function allLessonsForCourse(db: DB, courseId: string) {
  const us = await unitsForCourse(db, courseId);
  if (us.length === 0) return [];
  const ls = await db
    .select()
    .from(lessons)
    .where(and(inArray(lessons.unitId, us.map((u) => u.id)), isNull(lessons.deletedAt)))
    .orderBy(asc(lessons.sortOrder));
  return us
    .sort(byOrder)
    .flatMap((u) => ls.filter((l) => l.unitId === u.id).sort(byOrder));
}

export async function lessonBySlug(db: DB, slug: string) {
  const rows = await db.select().from(lessons).where(eq(lessons.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function itemsForLesson(db: DB, lessonId: string) {
  return db.select().from(lessonItems).where(eq(lessonItems.lessonId, lessonId)).orderBy(asc(lessonItems.sortOrder), asc(lessonItems.createdAt));
}

// ---------------------------------------------------------------------------
// Ancestry chain — the resolver's coverage basis (ADR-009/014)
// ---------------------------------------------------------------------------

export interface ChainRow {
  lessonId?: string;
  unitId?: string;
  courseId?: string;
  subjectId?: string;
  accessLevel: "public" | "authenticated" | "entitled";
  freePreview: boolean;
  status: string;
  publishAt: number | null;
  expiresAt: number | null;
  /**
   * Academic scope of the node (owner content model). These are IDs — the
   * resolver compares them literally and never matches on titles/slugs/strings.
   */
  academicYearId?: string | null;
  gradeId?: string | null;
  termId?: string | null;
}

/** Loads lesson → unit → course → subject and returns the resolver input shape. */
export async function chainForLesson(db: DB, lessonId: string): Promise<ChainRow | null> {
  const lessonRows = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  const lesson = lessonRows[0];
  if (!lesson) return null;
  const unitRows = await db.select().from(units).where(eq(units.id, lesson.unitId)).limit(1);
  const unit = unitRows[0];
  if (!unit) return null;
  const courseRows = await db.select().from(courses).where(eq(courses.id, unit.courseId)).limit(1);
  const course = courseRows[0];
  if (!course) return null;
  const subjectRows = await db.select().from(subjects).where(eq(subjects.id, course.subjectId)).limit(1);
  const subject = subjectRows[0];
  if (!subject) return null;
  return {
    lessonId: lesson.id,
    unitId: unit.id,
    courseId: course.id,
    subjectId: subject.id,
    accessLevel: lesson.accessLevel,
    freePreview: lesson.freePreview,
    status: lesson.status,
    publishAt: lesson.publishAt ?? null,
    expiresAt: lesson.expiresAt ?? null,
    academicYearId: course.academicYearId ?? null,
    gradeId: subject.gradeId ?? null,
    termId: course.termId ?? null,
  };
}

/** Loads course → subject chain (course pages, course-scoped files). */
export async function chainForCourse(db: DB, courseId: string) {
  const courseRows = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  const course = courseRows[0];
  if (!course) return null;
  const subjectRows = await db.select().from(subjects).where(eq(subjects.id, course.subjectId)).limit(1);
  const subject = subjectRows[0];
  if (!subject) return null;
  return {
    courseId: course.id,
    subjectId: subject.id,
    accessLevel: course.accessLevel,
    freePreview: false,
    status: course.status,
    publishAt: course.publishAt ?? null,
    expiresAt: course.expiresAt ?? null,
    academicYearId: course.academicYearId ?? null,
    gradeId: subject.gradeId ?? null,
    termId: course.termId ?? null,
  };
}

/** Subject chain for subject pages. */
export async function chainForSubject(db: DB, subjectId: string) {
  const subjectRows = await db.select().from(subjects).where(eq(subjects.id, subjectId)).limit(1);
  const subject = subjectRows[0];
  if (!subject) return null;
  return {
    subjectId: subject.id,
    accessLevel: "entitled" as const,
    freePreview: false,
    status: subject.status,
    publishAt: null,
    expiresAt: null,
    academicYearId: null,
    gradeId: subject.gradeId ?? null,
    termId: null,
  };
}

// --- video/file lookup helpers used by item rendering -----------------------

export async function videosByIds(db: DB, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof videos.$inferSelect>();
  const rows = await db.select().from(videos).where(inArray(videos.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function filesByIds(db: DB, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof files.$inferSelect>();
  const rows = await db.select().from(files).where(inArray(files.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

// --- course prerequisites (Phase E) ---------------------------------------
// A course may declare prerequisite courses as a DAG (enforced acyclic at write).
// A learner may open a course only once every LIVE (published, non-deleted)
// transitive prerequisite course has been COMPLETED by that student. Completion =
// the course has >=1 published lesson and every published lesson has a completed
// lesson_progress row for the student. This gate is server-authoritative and is
// layered on top of resolveContentAccess (which stays pure). Teachers/admins and
// anonymous viewers bypass it (anon is redirected to login by the access layer).

export class PrerequisiteCycleError extends Error {
  constructor(public readonly courseId: string) {
    super(`prerequisite cycle would be created involving course ${courseId}`);
    this.name = "PrerequisiteCycleError";
  }
}

export interface CoursePrereq {
  courseId: string;
  slug: string;
  titleAr: string;
  titleEn: string;
}

async function prereqIdsFor(db: DB, courseId: string): Promise<string[]> {
  const rows = await db
    .select({ id: coursePrerequisites.prerequisiteCourseId })
    .from(coursePrerequisites)
    .where(eq(coursePrerequisites.courseId, courseId))
    .orderBy(asc(coursePrerequisites.createdAt));
  return rows.map((r) => r.id);
}

/** Direct prerequisites of a course, in declaration order. */
export async function prerequisitesForCourse(db: DB, courseId: string): Promise<CoursePrereq[]> {
  const ids = await prereqIdsFor(db, courseId);
  if (ids.length === 0) return [];
  const crs = await db.select().from(courses).where(inArray(courses.id, ids));
  const byId = new Map(crs.map((c) => [c.id, c]));
  return ids.flatMap((id) => {
    const c = byId.get(id);
    return c ? [{ courseId: c.id, slug: c.slug, titleAr: c.titleAr, titleEn: c.titleEn }] : [];
  });
}

/**
 * Replace the direct prerequisite set of a course. Validates that both ends exist
 * (ContentReferenceError), drops self-reference/duplicates and rejects any
 * prerequisite whose introduction would create a cycle (PrerequisiteCycleError).
 * Mutations are audited per course.
 */
export async function setCoursePrerequisites(
  db: DB,
  courseId: string,
  prerequisiteIds: string[],
  actor: ActorCtx
): Promise<void> {
  const exists = await db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, courseId), isNull(courses.deletedAt))).limit(1);
  if (exists.length === 0) throw new ContentReferenceError("courseId", courseId);

  const want = [...new Set(prerequisiteIds)].filter((x) => Boolean(x) && x !== courseId);
  if (want.length) {
    const found = await db.select({ id: courses.id }).from(courses).where(and(inArray(courses.id, want), isNull(courses.deletedAt)));
    const foundSet = new Set(found.map((r) => r.id));
    for (const id of want) if (!foundSet.has(id)) throw new ContentReferenceError("prerequisiteCourseId", id);
  }

  const all = await db
    .select({ fromId: coursePrerequisites.courseId, toId: coursePrerequisites.prerequisiteCourseId })
    .from(coursePrerequisites);
  const current = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const e of all) {
    if (e.fromId === courseId) {
      current.add(e.toId);
      continue;
    }
    const list = adj.get(e.fromId) ?? [];
    list.push(e.toId);
    adj.set(e.fromId, list);
  }
  adj.set(courseId, want);
  const reachesCourse = (start: string): boolean => {
    const seen = new Set<string>([start]);
    const q = [start];
    while (q.length) {
      const cur = q.shift()!;
      for (const nxt of adj.get(cur) ?? []) {
        if (nxt === courseId) return true;
        if (!seen.has(nxt)) {
          seen.add(nxt);
          q.push(nxt);
        }
      }
    }
    return false;
  };
  for (const p of want) if (reachesCourse(p)) throw new PrerequisiteCycleError(courseId);

  const wantSet = new Set(want);
  const adds = want.filter((x) => !current.has(x));
  const removes = [...current].filter((x) => !wantSet.has(x));
  const now = Date.now();

  if (removes.length) {
    await db
      .delete(coursePrerequisites)
      .where(and(eq(coursePrerequisites.courseId, courseId), inArray(coursePrerequisites.prerequisiteCourseId, removes)));
  }
  if (adds.length) {
    await db.insert(coursePrerequisites).values(adds.map((pid) => ({ id: crypto.randomUUID(), courseId, prerequisiteCourseId: pid, createdAt: now })));
  }
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "content.course.prerequisites",
    entityType: "course",
    entityId: courseId,
    before: { prerequisiteCourseIds: [...current].sort() },
    after: { prerequisiteCourseIds: want.slice().sort() },
  });
}

/** Transitive closure of a course's prerequisites (direct + indirect), BFS order. */
export async function prerequisiteClosureFor(db: DB, courseId: string): Promise<CoursePrereq[]> {
  const seen = new Set<string>();
  const out: CoursePrereq[] = [];
  const q = [courseId];
  while (q.length) {
    const cur = q.shift()!;
    const dir = await prerequisitesForCourse(db, cur);
    for (const p of dir) {
      if (seen.has(p.courseId)) continue;
      seen.add(p.courseId);
      out.push(p);
      q.push(p.courseId);
    }
  }
  return out;
}

async function courseCompletedByStudent(db: DB, courseId: string, studentId: string): Promise<boolean> {
  const unitRows = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.courseId, courseId), eq(units.status, "published"), isNull(units.deletedAt)));
  if (unitRows.length === 0) return false;
  const lessonRows = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(and(inArray(lessons.unitId, unitRows.map((u) => u.id)), eq(lessons.status, "published"), isNull(lessons.deletedAt)));
  if (lessonRows.length === 0) return false;
  const ids = lessonRows.map((l) => l.id);
  const prog = await db
    .select({ lessonId: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.studentId, studentId), eq(lessonProgress.status, "completed"), inArray(lessonProgress.lessonId, ids)));
  return prog.length === ids.length;
}

export interface PrereqSubject {
  userId: string | null;
  roleRank: number; // 0 anon, 1 student, 2 teacher, 3 admin, 4 super_admin
}

export interface CoursePrereqLock {
  locked: boolean;
  missing: CoursePrereq[];
}

/**
 * Server-authoritative prerequisite gate for opening a course. A signed-in student
 * is locked out of a course until every LIVE (published, non-deleted) transitive
 * prerequisite course is completed. Teachers/admins and anonymous viewers bypass.
 */
export async function coursePrereqGate(db: DB, subject: PrereqSubject, courseId: string): Promise<CoursePrereqLock> {
  if (!subject.userId || subject.roleRank >= 2) return { locked: false, missing: [] };
  const closure = await prerequisiteClosureFor(db, courseId);
  if (closure.length === 0) return { locked: false, missing: [] };

  const liveRows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(inArray(courses.id, closure.map((c) => c.courseId)), eq(courses.status, "published"), isNull(courses.deletedAt)));
  const live = new Set(liveRows.map((r) => r.id));
  const needed = closure.filter((c) => live.has(c.courseId));
  if (needed.length === 0) return { locked: false, missing: [] };

  const missing: CoursePrereq[] = [];
  for (const p of needed) {
    if (!(await courseCompletedByStudent(db, p.courseId, subject.userId))) missing.push(p);
  }
  return { locked: missing.length > 0, missing };
}

// ---------------------------------------------------------------------------
// Study hub — the STUDENT-facing content model
//   السنة الدراسية → الصف → المادة → الترم → الدرس → محتوى الدرس
//
// These reads never mention "courses": a `courses` row that carries an academic
// year + term is the internal term container, and everything below surfaces it as
// the *term*. Only PUBLISHED, non-deleted rows are ever returned, so drafts can
// never reach a student page or the sitemap (PART 21).
// ---------------------------------------------------------------------------

export async function listAcademicYears(db: DB, opts: { publishedOnly?: boolean } = {}) {
  const rows = await db
    .select()
    .from(academicYears)
    .where(and(isNull(academicYears.deletedAt), ...(opts.publishedOnly ? [eq(academicYears.status, "published")] : [])))
    .orderBy(asc(academicYears.sortOrder), asc(academicYears.createdAt));
  return rows;
}

export async function listTerms(db: DB, opts: { publishedOnly?: boolean } = {}) {
  const rows = await db
    .select()
    .from(terms)
    .where(and(isNull(terms.deletedAt), ...(opts.publishedOnly ? [eq(terms.status, "published")] : [])))
    .orderBy(asc(terms.sortOrder), asc(terms.createdAt));
  return rows;
}

/** Single-row lookups used for student-facing labels (مادة / ترم / سنة). */
export async function subjectById(db: DB, id: string) {
  const rows = await db
    .select({ id: subjects.id, slug: subjects.slug, titleAr: subjects.titleAr, titleEn: subjects.titleEn })
    .from(subjects)
    .where(eq(subjects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function gradeById(db: DB, id: string) {
  const rows = await db
    .select({ id: grades.id, slug: grades.slug, titleAr: grades.titleAr, titleEn: grades.titleEn })
    .from(grades)
    .where(eq(grades.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function termById(db: DB, id: string) {
  const rows = await db
    .select({ id: terms.id, slug: terms.slug, titleAr: terms.titleAr, titleEn: terms.titleEn })
    .from(terms)
    .where(eq(terms.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function academicYearById(db: DB, id: string) {
  const rows = await db
    .select({ id: academicYears.id, slug: academicYears.slug, titleAr: academicYears.titleAr, titleEn: academicYears.titleEn })
    .from(academicYears)
    .where(eq(academicYears.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Options for the admin scope pickers (year → grade → subject → term). */
export async function academicScopeOptions(db: DB) {
  const [years, termRows, gradeRows, subjectRows] = await Promise.all([
    listAcademicYears(db),
    listTerms(db),
    db.select().from(grades).where(isNull(grades.deletedAt)).orderBy(asc(grades.sortOrder)),
    db.select().from(subjects).where(isNull(subjects.deletedAt)).orderBy(asc(subjects.sortOrder)),
  ]);
  return { years, terms: termRows, grades: gradeRows, subjects: subjectRows };
}

/**
 * Student-facing material vocabulary for a lesson (PART 8/9). Derived ONLY from
 * real `lesson_items` rows + the referenced file's recorded `kind` — the listing
 * never guesses a "مذكرة" that the owner did not upload, and it never renders a
 * legacy internal-exam item (the exam engine lives on the external platform).
 */
export const LESSON_CONTENT_KINDS = ["video", "pdf", "doc", "image", "audio", "archive", "file", "practice"] as const;
export type LessonContentKind = (typeof LESSON_CONTENT_KINDS)[number];

/** File `kind` → material vocabulary; an unrecognised kind stays generic ("file"). */
export function contentKindForFileKind(kind: string | null | undefined): LessonContentKind {
  switch (kind) {
    case "pdf": return "pdf";
    case "doc": return "doc";
    case "image": return "image";
    case "audio": return "audio";
    case "archive": return "archive";
    case "video": return "video";
    default: return "file";
  }
}

export interface LessonContentSummary {
  /** distinct material kinds, in the canonical order of LESSON_CONTENT_KINDS */
  kinds: LessonContentKind[];
  itemCount: number;
}

/**
 * Material summary for many lessons in at most TWO queries (no N+1): the items
 * of every lesson, then the referenced files' kinds. Lesson-item rows are only
 * ever read here — nothing is written, nothing is invented.
 */
export async function lessonContentSummaries(
  db: DB,
  lessonIds: string[]
): Promise<Map<string, LessonContentSummary>> {
  const out = new Map<string, LessonContentSummary>();
  if (lessonIds.length === 0) return out;

  const itemRows = await db
    .select({ lessonId: lessonItems.lessonId, itemType: lessonItems.itemType, fileId: lessonItems.fileId, videoId: lessonItems.videoId })
    .from(lessonItems)
    .where(inArray(lessonItems.lessonId, lessonIds));

  const fileIds = [...new Set(itemRows.map((r) => r.fileId).filter((id): id is string => Boolean(id)))];
  const fileKinds = new Map<string, string>();
  if (fileIds.length > 0) {
    const fileRows = await db.select({ id: files.id, kind: files.kind }).from(files).where(inArray(files.id, fileIds));
    for (const f of fileRows) fileKinds.set(f.id, f.kind);
  }

  for (const id of lessonIds) out.set(id, { kinds: [], itemCount: 0 });
  for (const row of itemRows) {
    const entry = out.get(row.lessonId);
    if (!entry) continue;
    // Legacy internal-exam items are retained in the DB but never surface to a
    // student (the external questions platform replaced the internal engine).
    if (row.itemType === "exam") continue;
    let kind: LessonContentKind | null = null;
    if (row.itemType === "video") kind = "video";
    else if (row.itemType === "link") kind = "practice";
    else if (row.itemType === "file") kind = row.fileId ? contentKindForFileKind(fileKinds.get(row.fileId)) : null;
    if (!kind) continue;
    entry.itemCount += 1;
    if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
  }
  for (const entry of out.values()) {
    entry.kinds.sort((a, b) => LESSON_CONTENT_KINDS.indexOf(a) - LESSON_CONTENT_KINDS.indexOf(b));
  }
  return out;
}

export interface StudySubjectCard {
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  gradeSlug: string;
  gradeTitleAr: string;
  gradeTitleEn: string;
  programTitleAr: string;
  programTitleEn: string;
  /** published term containers, so the card can say how many terms are live */
  termCount: number;
  lessonCount: number;
  /** published lessons a registered student can open without a subscription */
  freeLessonCount: number;
  /** academic years the live term containers belong to (ordered, de-duplicated) */
  years: Array<{ id: string; titleAr: string; titleEn: string }>;
}

/**
 * The "المحتوى التعليمي" index: published subjects that actually have published
 * term containers. Empty-first — nothing is invented when the owner has not
 * published content yet.
 */
export async function studyHub(db: DB): Promise<StudySubjectCard[]> {
  const containers = await db
    .select({
      subjectId: courses.subjectId,
      courseId: courses.id,
      academicYearId: courses.academicYearId,
    })
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .innerJoin(grades, eq(subjects.gradeId, grades.id))
    .innerJoin(programs, eq(grades.programId, programs.id))
    .where(
      and(
        eq(courses.status, "published"),
        isNull(courses.deletedAt),
        isNull(subjects.deletedAt),
        isNull(grades.deletedAt),
        isNull(programs.deletedAt),
        eq(subjects.status, "published"),
        eq(grades.status, "published"),
        eq(programs.status, "published")
      )
    );
  if (containers.length === 0) return [];

  const subjectIds = [...new Set(containers.map((c) => c.subjectId))];
  const subjectRows = await db
    .select({
      subject: subjects,
      gradeSlug: grades.slug,
      gradeTitleAr: grades.titleAr,
      gradeTitleEn: grades.titleEn,
      gradeOrder: grades.sortOrder,
      programTitleAr: programs.titleAr,
      programTitleEn: programs.titleEn,
      programOrder: programs.sortOrder,
    })
    .from(subjects)
    .innerJoin(grades, eq(subjects.gradeId, grades.id))
    .innerJoin(programs, eq(grades.programId, programs.id))
    .where(and(inArray(subjects.id, subjectIds), eq(subjects.status, "published"), isNull(subjects.deletedAt)))
    .orderBy(asc(programs.sortOrder), asc(grades.sortOrder), asc(subjects.sortOrder));

  const lessonCounts = await publishedLessonStatsBySubject(db, subjectIds);
  const termCounts = new Map<string, number>();
  for (const c of containers) termCounts.set(c.subjectId, (termCounts.get(c.subjectId) ?? 0) + 1);

  // Academic years the subject's live term containers belong to (ordered by the
  // owner's year order). IDs + real titles only — the UI never hardcodes a year.
  const liveYearIds = [...new Set(containers.map((c) => c.academicYearId).filter((id): id is string => Boolean(id)))];
  const yearRows = await listAcademicYears(db);
  const yearsById = new Map(yearRows.map((y) => [y.id, { id: y.id, titleAr: y.titleAr, titleEn: y.titleEn }]));
  const yearsBySubject = new Map<string, Array<{ id: string; titleAr: string; titleEn: string }>>();
  for (const y of yearRows) {
    if (!liveYearIds.includes(y.id)) continue;
    for (const c of containers) {
      if (c.academicYearId !== y.id) continue;
      const list = yearsBySubject.get(c.subjectId) ?? [];
      if (!list.some((x) => x.id === y.id)) list.push(yearsById.get(y.id)!);
      yearsBySubject.set(c.subjectId, list);
    }
  }

  return subjectRows.map((r) => ({
    slug: r.subject.slug,
    titleAr: r.subject.titleAr,
    titleEn: r.subject.titleEn,
    descriptionAr: r.subject.descriptionAr,
    descriptionEn: r.subject.descriptionEn,
    gradeSlug: r.gradeSlug,
    gradeTitleAr: r.gradeTitleAr,
    gradeTitleEn: r.gradeTitleEn,
    programTitleAr: r.programTitleAr,
    programTitleEn: r.programTitleEn,
    termCount: termCounts.get(r.subject.id) ?? 0,
    lessonCount: lessonCounts.get(r.subject.id)?.total ?? 0,
    freeLessonCount: lessonCounts.get(r.subject.id)?.free ?? 0,
    years: yearsBySubject.get(r.subject.id) ?? [],
  }));
}

/** Published-lesson totals per subject + how many need no subscription (one query, no N+1). */
async function publishedLessonStatsBySubject(
  db: DB,
  subjectIds: string[]
): Promise<Map<string, { total: number; free: number }>> {
  if (subjectIds.length === 0) return new Map();
  const rows = await db
    .select({
      subjectId: subjects.id,
      n: sql<number>`count(*)`,
      free: sql<number>`sum(case when ${lessons.accessLevel} in ('public','authenticated') then 1 else 0 end)`,
    })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(
      and(
        inArray(subjects.id, subjectIds),
        eq(lessons.status, "published"),
        isNull(lessons.deletedAt),
        eq(units.status, "published"),
        isNull(units.deletedAt),
        eq(courses.status, "published"),
        isNull(courses.deletedAt)
      )
    )
    .groupBy(subjects.id);
  return new Map(rows.map((r) => [r.subjectId, { total: Number(r.n), free: Number(r.free ?? 0) }]));
}

export interface StudyTerm {
  /** internal term-container id (the `courses` row) */
  id: string;
  slug: string;
  /** label the student sees: the term name when bound, else the container title */
  titleAr: string;
  titleEn: string;
  academicYearId: string | null;
  academicYearTitleAr: string | null;
  academicYearTitleEn: string | null;
  termId: string | null;
  sortOrder: number;
  accessLevel: "public" | "authenticated" | "entitled";
  status: string;
}

export interface StudyLesson {
  id: string;
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  accessLevel: "public" | "authenticated" | "entitled";
  freePreview: boolean;
  status: string;
  publishAt: number | null;
  expiresAt: number | null;
  unitId: string;
  unitTitleAr: string;
  unitTitleEn: string;
  containerSlug: string;
  itemCount: number;
  /** material types that REALLY exist on this lesson (video / pdf / practice …) */
  contentKinds: LessonContentKind[];
  sortOrder: number;
}

export interface SubjectStudyView {
  subject: {
    id: string;
    slug: string;
    titleAr: string;
    titleEn: string;
    descriptionAr: string | null;
    descriptionEn: string | null;
  };
  grade: { slug: string; titleAr: string; titleEn: string } | null;
  program: { slug: string; titleAr: string; titleEn: string } | null;
  /** year → terms → lessons, already ordered */
  years: Array<{
    id: string | null;
    titleAr: string;
    titleEn: string;
    terms: Array<{ term: StudyTerm; lessons: StudyLesson[] }>;
  }>;
}

/**
 * Subject study page data: published term containers grouped by academic year,
 * each with its published lessons. Draft/archived rows and unpublished ancestors
 * are excluded here (never rendered, never linked, never in the sitemap).
 */
export async function subjectStudyView(db: DB, subjectSlug: string): Promise<SubjectStudyView | null> {
  const subjectRows = await db
    .select({
      subject: subjects,
      gradeSlug: grades.slug,
      gradeTitleAr: grades.titleAr,
      gradeTitleEn: grades.titleEn,
      programSlug: programs.slug,
      programTitleAr: programs.titleAr,
      programTitleEn: programs.titleEn,
    })
    .from(subjects)
    .innerJoin(grades, eq(subjects.gradeId, grades.id))
    .innerJoin(programs, eq(grades.programId, programs.id))
    .where(eq(subjects.slug, subjectSlug))
    .limit(1);
  const row = subjectRows[0];
  if (!row || row.subject.status !== "published" || row.subject.deletedAt) return null;

  const containers = await db
    .select({
      course: courses,
      yearTitleAr: academicYears.titleAr,
      yearTitleEn: academicYears.titleEn,
    })
    .from(courses)
    .leftJoin(academicYears, eq(courses.academicYearId, academicYears.id))
    .where(and(eq(courses.subjectId, row.subject.id), eq(courses.status, "published"), isNull(courses.deletedAt)))
    .orderBy(asc(courses.sortOrder), asc(courses.createdAt));
  if (containers.length === 0) {
    return {
      subject: {
        id: row.subject.id, slug: row.subject.slug, titleAr: row.subject.titleAr, titleEn: row.subject.titleEn,
        descriptionAr: row.subject.descriptionAr, descriptionEn: row.subject.descriptionEn,
      },
      grade: { slug: row.gradeSlug, titleAr: row.gradeTitleAr, titleEn: row.gradeTitleEn },
      program: { slug: row.programSlug, titleAr: row.programTitleAr, titleEn: row.programTitleEn },
      years: [],
    };
  }

  const containerIds = containers.map((c) => c.course.id);
  const unitRows = await db
    .select()
    .from(units)
    .where(and(inArray(units.courseId, containerIds), eq(units.status, "published"), isNull(units.deletedAt)))
    .orderBy(asc(units.sortOrder), asc(units.createdAt));
  const unitIds = unitRows.map((u) => u.id);
  const lessonRows = unitIds.length === 0 ? [] : await db
    .select()
    .from(lessons)
    .where(and(inArray(lessons.unitId, unitIds), eq(lessons.status, "published"), isNull(lessons.deletedAt)))
    .orderBy(asc(lessons.sortOrder), asc(lessons.createdAt));
  const itemRows = await lessonContentSummaries(db, lessonRows.map((l) => l.id));

  const termRows = await listTerms(db, { publishedOnly: false });
  const termById = new Map(termRows.map((t) => [t.id, t]));
  const yearRows = await listAcademicYears(db, { publishedOnly: false });
  const yearById = new Map(yearRows.map((y) => [y.id, y]));

  const years: SubjectStudyView["years"] = [];
  const yearIndex = new Map<string, number>();
  for (const c of containers) {
    const course = c.course;
    const term = course.termId ? termById.get(course.termId) ?? null : null;
    const year = course.academicYearId ? yearById.get(course.academicYearId) ?? null : null;
    // A container whose year/term row was archived or deleted still renders with
    // its own titles — content the owner published is never silently dropped.
    const studyTerm: StudyTerm = {
      id: course.id,
      slug: course.slug,
      titleAr: term?.titleAr ?? course.titleAr,
      titleEn: term?.titleEn ?? course.titleEn,
      academicYearId: course.academicYearId ?? null,
      academicYearTitleAr: year?.titleAr ?? c.yearTitleAr ?? null,
      academicYearTitleEn: year?.titleEn ?? c.yearTitleEn ?? null,
      termId: course.termId ?? null,
      sortOrder: course.sortOrder,
      accessLevel: course.accessLevel,
      status: course.status,
    };
    const courseUnits = unitRows.filter((u) => u.courseId === course.id);
    const lessonsForContainer: StudyLesson[] = courseUnits.flatMap((u) =>
      lessonRows
        .filter((l) => l.unitId === u.id)
        .map((l) => ({
          id: l.id,
          slug: l.slug,
          titleAr: l.titleAr,
          titleEn: l.titleEn,
          descriptionAr: l.descriptionAr,
          descriptionEn: l.descriptionEn,
          accessLevel: l.accessLevel,
          freePreview: l.freePreview,
          status: l.status,
          publishAt: l.publishAt ?? null,
          expiresAt: l.expiresAt ?? null,
          unitId: u.id,
          unitTitleAr: u.titleAr,
          unitTitleEn: u.titleEn,
          containerSlug: course.slug,
          itemCount: itemRows.get(l.id)?.itemCount ?? 0,
          contentKinds: itemRows.get(l.id)?.kinds ?? [],
          sortOrder: l.sortOrder,
        }))
    );

    const yearKey = course.academicYearId ?? "";
    let yi = yearIndex.get(yearKey);
    if (yi === undefined) {
      yi = years.length;
      yearIndex.set(yearKey, yi);
      years.push({
        id: course.academicYearId ?? null,
        titleAr: year?.titleAr ?? c.yearTitleAr ?? "",
        titleEn: year?.titleEn ?? c.yearTitleEn ?? "",
        terms: [],
      });
    }
    years[yi].terms.push({ term: studyTerm, lessons: lessonsForContainer });
  }

  return {
    subject: {
      id: row.subject.id, slug: row.subject.slug, titleAr: row.subject.titleAr, titleEn: row.subject.titleEn,
      descriptionAr: row.subject.descriptionAr, descriptionEn: row.subject.descriptionEn,
    },
    grade: { slug: row.gradeSlug, titleAr: row.gradeTitleAr, titleEn: row.gradeTitleEn },
    program: { slug: row.programSlug, titleAr: row.programTitleAr, titleEn: row.programTitleEn },
    years,
  };
}

/** Chain rows for every lesson of a subject study view — one batch, no N+1. */
export function chainsForStudyView(view: SubjectStudyView): Map<string, ChainRow> {
  const map = new Map<string, ChainRow>();
  for (const year of view.years) {
    for (const { term, lessons } of year.terms) {
      for (const l of lessons) {
        map.set(l.id, {
          lessonId: l.id,
          unitId: l.unitId,
          courseId: term.id,
          subjectId: view.subject.id,
          accessLevel: l.accessLevel,
          freePreview: l.freePreview,
          status: l.status,
          publishAt: l.publishAt,
          expiresAt: l.expiresAt,
          academicYearId: term.academicYearId,
          gradeId: null,
          termId: term.termId,
        });
      }
    }
  }
  return map;
}

/**
 * Term containers of a subject inside one academic year — the concrete resource
 * ids a FULL-YEAR entitlement/code must cover. IDs only: the full-year rule is
 * resolved by comparing these ids, never by matching titles or slugs.
 */
export async function termContainersForSubjectYear(db: DB, subjectId: string, academicYearId: string) {
  return db
    .select({ id: courses.id, termId: courses.termId, status: courses.status })
    .from(courses)
    .where(
      and(
        eq(courses.subjectId, subjectId),
        eq(courses.academicYearId, academicYearId),
        isNull(courses.deletedAt)
      )
    )
    .orderBy(asc(courses.sortOrder));
}

/**
 * The single term container for (subject, academic year, term) — the concrete
 * resource a TERM-scoped entitlement/code grants. Returns null when the owner has
 * not created that term yet (nothing is invented on their behalf).
 */
export async function termContainerFor(
  db: DB,
  scope: { subjectId: string; academicYearId: string; termId: string }
) {
  const rows = await db
    .select({ id: courses.id, status: courses.status, slug: courses.slug })
    .from(courses)
    .where(
      and(
        eq(courses.subjectId, scope.subjectId),
        eq(courses.academicYearId, scope.academicYearId),
        eq(courses.termId, scope.termId),
        isNull(courses.deletedAt)
      )
    )
    .orderBy(asc(courses.sortOrder), asc(courses.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * A lesson created straight under a term container still needs a unit row (the
 * schema requires one). The owner should not have to think about that, so the
 * study-facing admin flow ensures a single internal "الدروس" grouping per
 * container and reuses it. Real unit grouping remains fully available.
 */
export async function ensureDefaultUnit(db: DB, courseId: string, actor: ActorCtx) {
  const existing = await db
    .select()
    .from(units)
    .where(and(eq(units.courseId, courseId), isNull(units.deletedAt)))
    .orderBy(asc(units.sortOrder), asc(units.createdAt))
    .limit(1);
  if (existing[0]) return existing[0];
  return createUnit(
    db,
    { courseId, titleAr: "الدروس", titleEn: "Lessons", status: "published", sortOrder: 0 },
    actor
  );
}
