import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.server";
import {
  coursePrerequisites,
  courses,
  files,
  grades,
  lessonItems,
  lessonProgress,
  lessons,
  programs,
  subjects,
  units,
  users,
  videos,
} from "../db/schema";
import { logAudit } from "../audit/log.server";

/**
 * Content tree service (Phase 2): Program→Grade→Subject→Course→Unit→Lesson→LessonItem.
 * Admin mutations are audited; catalog reads expose only published/visible nodes;
 * ordering is explicit (sort_order within parent); slugs are unique per table.
 */

export const CONTENT_TYPES = ["program", "grade", "subject", "course", "unit", "lesson", "lessonItem"] as const;
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

export const createGradeSchema = createProgramSchema.omit({ descriptionAr: true, descriptionEn: true }).extend({ programId: z.string().min(1) });
export const createSubjectSchema = createProgramSchema.extend({
  gradeId: z.string().min(1),
  thumbnailFileId: z.string().optional().nullable(),
});

export const createCourseSchema = z.object({
  subjectId: z.string().min(1),
  teacherId: z.string().optional().nullable(),
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
  const slug = await uniqueSlug(
    async (s) => (await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, s)).limit(1)).length > 0,
    input.slug ?? input.titleEn
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    id, subjectId: input.subjectId, teacherId: input.teacherId ?? null, slug,
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
  program: ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "status", "sortOrder"],
  grade: ["titleAr", "titleEn", "status", "sortOrder"],
  subject: ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "thumbnailFileId", "status", "sortOrder"],
  course: ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "thumbnailFileId", "accessLevel", "status", "visibility", "sortOrder", "publishAt", "expiresAt", "teacherId"],
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

type DuplicableType = Exclude<ContentType, "lessonItem">;

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

export async function moveNode(
  db: DB,
  type: ContentType,
  id: string,
  direction: "up" | "down"
): Promise<{ ok: true } | { ok: false; error: "not_found" | "no_neighbor" | "root_type" }> {
  const parentField = PARENT_FIELD[type];
  if (!parentField) return { ok: false, error: "root_type" };
  const node = await getNode(db, type, id);
  if (!node) return { ok: false, error: "not_found" };

  const table = tableFor(type);
  const col = (name: string) => (table as unknown as Record<string, never>)[name];
  const siblings = (await db
    .select()
    .from(table)
    .where(eq(col(parentField), node[parentField] as never))
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
