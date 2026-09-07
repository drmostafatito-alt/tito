import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "~server/db/client.server";
import {
  courses, examAnswers, examAttempts, examQuestions, exams, events,
  lessons, questionChoices, questionTags, questions, subjects, tags, units, users,
} from "~server/db/schema";
import { slugify, type ChainRow } from "~server/content/service.server";
import { chainForCourse, chainForLesson } from "~server/content/service.server";
import { chainRefsOf, entitlementsFor, resolveContentAccess } from "~server/entitlements/access.server";
import { resolveAccess, type AccessVerdict } from "~server/entitlements/resolver.server";

/**
 * Assessment engine (Phase 5 — FEATURE-SPEC §5/§6, ADR-022).
 *
 * Hard rules:
 *  - The ANSWER KEY never leaves the server before submission: live-attempt
 *    payloads are sanitized (no is_correct / explanation / feedback).
 *  - Timing is server-authoritative: deadline = started_at + duration (server
 *    clock at start); submit verifies against the server clock + grace window
 *    (settings.assessment.graceSeconds). Client clocks are display-only.
 *  - Submission is idempotent: the first submit grades + emits `exam_submit`
 *    exactly once; later submits return the stored result without re-grading.
 *  - Attempts are isolated per student (ownership checked on every access;
 *    DB partial-unique index enforces ONE live attempt per student+exam).
 *  - Randomization is seeded per attempt (random_seed) — review shows the
 *    student's own order, recomputed deterministically.
 *  - Essay/manual grading is NOT implemented in Phase 5 (schema reserves
 *    text_answer/graded_by/needs_manual); objective questions only.
 */

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const now = () => Date.now();

// ---------------------------------------------------------------------------
// Permissions (mirrors the CMS permission model — role_permissions TEXT rows)
// ---------------------------------------------------------------------------

export const ASSESSMENT_PERMISSIONS = [
  "assessment.read", "assessment.create", "assessment.edit",
  "assessment.publish", "assessment.delete", "assessment.grade",
] as const;
export type AssessmentPermission = (typeof ASSESSMENT_PERMISSIONS)[number];

/** rank 4 (super_admin) bypasses; rank 3 needs an explicit role_permissions row. */
export async function canAssessment(
  db: DB,
  auth: { user: { rank: number; roleId: string } } | null,
  permission: AssessmentPermission
): Promise<boolean> {
  if (!auth) return false;
  if (auth.user.rank >= 4) return true;
  if (auth.user.rank < 3) return false;
  const { rolePermissions } = await import("~server/db/schema");
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, auth.user.roleId), eq(rolePermissions.permission, permission)))
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AssessmentValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "AssessmentValidationError";
  }
}

export class AssessmentReferenceError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "AssessmentReferenceError";
  }
}

// ---------------------------------------------------------------------------
// exam config contract (FEATURE-SPEC §6) — zod-validated on every write/read
// ---------------------------------------------------------------------------

export const examConfigSchema = z.object({
  duration_minutes: z.number().int().min(1).max(600).nullable().default(30),
  availability: z
    .object({
      starts_at: z.number().int().nullable().default(null),
      ends_at: z.number().int().nullable().default(null),
    })
    .default({ starts_at: null, ends_at: null }),
  selection: z
    .object({
      mode: z.enum(["manual", "pool"]).default("manual"),
      pools: z
        .array(
          z.object({
            filters: z
              .object({
                subject: uuid.nullable().optional(),
                unit: uuid.nullable().optional(),
                lesson: uuid.nullable().optional(),
                tags: z.array(uuid).max(20).optional(),
                difficulty: z.enum(["easy", "medium", "hard"]).nullable().optional(),
              })
              .prefault({}),
            count: z.number().int().min(1).max(100).default(5),
          })
        )
        .max(10)
        .default([]),
      max_questions: z.number().int().min(1).max(200).nullable().default(null),
      randomize_questions: z.boolean().default(false),
      randomize_choices: z.boolean().default(false),
    })
    .prefault({}),
  attempts: z
    .object({
      max: z.number().int().min(1).max(100).nullable().default(1),
      cooldown_minutes: z.number().int().min(0).max(10080).default(0),
      /** stored per contract; enforcement deferred (see ADR-022 limitations) */
      manual_extra_allowed: z.boolean().default(false),
    })
    .prefault({}),
  scoring: z
    .object({
      pass_percent: z.number().int().min(0).max(100).default(50),
      partial_credit_multiselect: z.boolean().default(true),
      /** reserved for essay grading (not implemented in Phase 5) */
      essay_points: z.number().min(0).max(1000).default(0),
    })
    .prefault({}),
  results: z
    .object({
      show: z.enum(["immediate", "after_end", "manual"]).default("immediate"),
      show_answers: z.boolean().default(true),
      show_explanations: z.boolean().default(false),
      review_mode: z.boolean().default(true),
    })
    .prefault({}),
});
export type ExamConfig = z.infer<typeof examConfigSchema>;

export function parseExamConfig(raw: unknown): ExamConfig {
  const parsed = examConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new AssessmentValidationError([{ path: "config", message: "invalid exam config" }]);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Question bank schemas
// ---------------------------------------------------------------------------

export const QUESTION_TYPES = ["mcq", "true_false", "multi_select", "essay"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
/** objective = auto-gradable in Phase 5 (essay needs the manual queue — deferred) */
export const OBJECTIVE_TYPES: ReadonlyArray<QuestionType> = ["mcq", "true_false", "multi_select"];

const choiceInput = z.object({
  // null OR absent both mean "new choice" (the admin editor serializes fresh
  // rows with id:null) — accept both, UUID string = keep existing row.
  id: uuid.nullish(),
  contentAr: z.string().trim().max(2000),
  contentEn: z.string().trim().max(2000),
  isCorrect: z.boolean().default(false),
  feedback: z.string().trim().max(2000).nullable().optional(),
});

export const questionInputSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  stemAr: z.string().trim().min(1).max(4000),
  stemEn: z.string().trim().min(1).max(4000),
  explanationAr: z.string().trim().max(4000).nullable().optional(),
  explanationEn: z.string().trim().max(4000).nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  pointsDefault: z.number().min(0.5).max(1000).default(1),
  subjectId: uuid.nullable().optional(),
  courseId: uuid.nullable().optional(),
  unitId: uuid.nullable().optional(),
  lessonId: uuid.nullable().optional(),
  choices: z.array(choiceInput).max(6).default([]),
  tagIds: z.array(uuid).max(20).default([]),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

function validateQuestionShape(input: QuestionInput): void {
  const issues: Array<{ path: string; message: string }> = [];
  const n = input.choices.length;
  const correct = input.choices.filter((c) => c.isCorrect).length;
  if (input.type === "mcq") {
    if (n < 2 || n > 6) issues.push({ path: "choices", message: "mcq needs 2–6 choices" });
    if (correct !== 1) issues.push({ path: "choices", message: "mcq needs exactly ONE correct choice" });
  } else if (input.type === "true_false") {
    if (n !== 2) issues.push({ path: "choices", message: "true/false needs exactly 2 choices" });
    if (correct !== 1) issues.push({ path: "choices", message: "true/false needs exactly ONE correct choice" });
  } else if (input.type === "multi_select") {
    if (n < 2 || n > 6) issues.push({ path: "choices", message: "multi_select needs 2–6 choices" });
    if (correct < 1) issues.push({ path: "choices", message: "multi_select needs at least ONE correct choice" });
  } else if (input.type === "essay") {
    if (n !== 0) issues.push({ path: "choices", message: "essay questions have no choices" });
  }
  if (issues.length) throw new AssessmentValidationError(issues);
}

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

export interface ActorCtx {
  userId: string;
  role: string;
  ipHash?: string;
}

// ---------------------------------------------------------------------------
// Question bank CRUD
// ---------------------------------------------------------------------------

async function assertRefs(db: DB, input: QuestionInput): Promise<void> {
  const { subjects, courses, units, lessons } = await import("~server/db/schema");
  const checks: Array<[string, string | null | undefined, Promise<unknown[]>]> = [
    ["subjectId", input.subjectId, db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, input.subjectId!)).limit(1)],
    ["courseId", input.courseId, db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.courseId!)).limit(1)],
    ["unitId", input.unitId, db.select({ id: units.id }).from(units).where(eq(units.id, input.unitId!)).limit(1)],
    ["lessonId", input.lessonId, db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, input.lessonId!)).limit(1)],
  ];
  for (const [field, value, promise] of checks) {
    if (!value) continue;
    const rows = await promise;
    if (!rows.length) throw new AssessmentReferenceError(field, `${field} does not exist`);
  }
  if (input.tagIds.length) {
    const found = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, input.tagIds));
    if (found.length !== new Set(input.tagIds).size) throw new AssessmentReferenceError("tagIds", "unknown tag");
  }
}

export async function createQuestion(db: DB, raw: unknown, actor: ActorCtx) {
  const parsed = questionInputSchema.safeParse(raw);
  if (!parsed.success) throw new AssessmentValidationError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const input = parsed.data;
  validateQuestionShape(input);
  await assertRefs(db, input);

  const id = crypto.randomUUID();
  const ts = now();
  await db.insert(questions).values({
    id,
    type: input.type,
    stemAr: input.stemAr,
    stemEn: input.stemEn,
    explanationAr: input.explanationAr ?? null,
    explanationEn: input.explanationEn ?? null,
    difficulty: input.difficulty,
    pointsDefault: input.pointsDefault,
    subjectId: input.subjectId ?? null,
    courseId: input.courseId ?? null,
    unitId: input.unitId ?? null,
    lessonId: input.lessonId ?? null,
    status: "draft",
    createdBy: actor.userId,
    reviewedBy: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  });
  await replaceChoices(db, id, input.choices);
  await replaceTags(db, id, input.tagIds);
  return { id };
}

async function replaceChoices(db: DB, questionId: string, choices: QuestionInput["choices"]) {
  await db.delete(questionChoices).where(eq(questionChoices.questionId, questionId));
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    await db.insert(questionChoices).values({
      id: c.id ?? crypto.randomUUID(),
      questionId,
      contentAr: c.contentAr,
      contentEn: c.contentEn,
      isCorrect: c.isCorrect,
      sortOrder: i,
      feedback: c.feedback ?? null,
    });
  }
}

async function replaceTags(db: DB, questionId: string, tagIds: string[]) {
  await db.delete(questionTags).where(eq(questionTags.questionId, questionId));
  for (const tagId of new Set(tagIds)) {
    await db.insert(questionTags).values({ questionId, tagId });
  }
}

export async function updateQuestion(db: DB, id: string, raw: unknown, actor: ActorCtx) {
  const rows = await db.select().from(questions).where(and(eq(questions.id, id), isNull(questions.deletedAt))).limit(1);
  const existing = rows[0];
  if (!existing) throw new AssessmentReferenceError("id", "question not found");
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  // partial updates: when the patch omits choices/tags, validate against the
  // stored rows (a stem-only edit must not be rejected for "no choices")
  let fallbackChoices: Array<{ id: string; contentAr: string; contentEn: string; isCorrect: boolean; feedback: string | null }> = [];
  if (!Array.isArray(rawObj.choices)) {
    const cs = await db.select().from(questionChoices).where(eq(questionChoices.questionId, id)).orderBy(asc(questionChoices.sortOrder));
    fallbackChoices = cs.map((c) => ({ id: c.id, contentAr: c.contentAr, contentEn: c.contentEn, isCorrect: c.isCorrect, feedback: c.feedback }));
  }
  const parsed = questionInputSchema.safeParse({
    type: existing.type,
    stemAr: existing.stemAr,
    stemEn: existing.stemEn,
    explanationAr: existing.explanationAr,
    explanationEn: existing.explanationEn,
    difficulty: existing.difficulty,
    pointsDefault: existing.pointsDefault,
    subjectId: existing.subjectId,
    courseId: existing.courseId,
    unitId: existing.unitId,
    lessonId: existing.lessonId,
    choices: fallbackChoices,
    tagIds: [],
    ...rawObj,
  });
  if (!parsed.success) throw new AssessmentValidationError(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const input = parsed.data;
  if (input.type !== existing.type) throw new AssessmentValidationError([{ path: "type", message: "question type is immutable after creation" }]);
  validateQuestionShape(input);
  await assertRefs(db, input);

  // Grading uses the CURRENT key at submit time; edits are audited by the caller.
  await db
    .update(questions)
    .set({
      stemAr: input.stemAr,
      stemEn: input.stemEn,
      explanationAr: input.explanationAr ?? null,
      explanationEn: input.explanationEn ?? null,
      difficulty: input.difficulty,
      pointsDefault: input.pointsDefault,
      subjectId: input.subjectId ?? null,
      courseId: input.courseId ?? null,
      unitId: input.unitId ?? null,
      lessonId: input.lessonId ?? null,
      updatedAt: now(),
    })
    .where(eq(questions.id, id));
  if (Array.isArray(rawObj.choices)) await replaceChoices(db, id, input.choices);
  if (Array.isArray(rawObj.tagIds)) await replaceTags(db, id, input.tagIds);
  void actor;
  return { id };
}

const STATUS_FLOW: Record<string, string[]> = {
  draft: ["in_review", "archived"],
  in_review: ["published", "draft", "archived"],
  published: ["archived"],
  archived: ["draft"],
};

export async function setQuestionStatus(db: DB, id: string, status: string, actor: ActorCtx) {
  const rows = await db.select().from(questions).where(and(eq(questions.id, id), isNull(questions.deletedAt))).limit(1);
  const q = rows[0];
  if (!q) throw new AssessmentReferenceError("id", "question not found");
  if (!(STATUS_FLOW[q.status] ?? []).includes(status)) {
    throw new AssessmentValidationError([{ path: "status", message: `cannot move ${q.status} → ${status}` }]);
  }
  await db
    .update(questions)
    .set({ status: status as "draft", reviewedBy: status === "published" ? actor.userId : q.reviewedBy, updatedAt: now() })
    .where(eq(questions.id, id));
  return { id, status };
}

/** Soft delete — refused while the question is attached to any exam (archive instead). */
export async function deleteQuestion(db: DB, id: string) {
  const attached = await db.select({ examId: examQuestions.examId }).from(examQuestions).where(eq(examQuestions.questionId, id)).limit(1);
  if (attached.length) throw new AssessmentReferenceError("id", "question is attached to an exam — archive it instead");
  await db.update(questions).set({ deletedAt: now(), updatedAt: now() }).where(eq(questions.id, id));
  return { id };
}

export async function duplicateQuestion(db: DB, id: string, actor: ActorCtx) {
  const rows = await db.select().from(questions).where(and(eq(questions.id, id), isNull(questions.deletedAt))).limit(1);
  const q = rows[0];
  if (!q) throw new AssessmentReferenceError("id", "question not found");
  const choices = await db.select().from(questionChoices).where(eq(questionChoices.questionId, id)).orderBy(asc(questionChoices.sortOrder));
  const tagRows = await db.select().from(questionTags).where(eq(questionTags.questionId, id));
  const newId = crypto.randomUUID();
  const ts = now();
  await db.insert(questions).values({
    ...q,
    id: newId,
    stemAr: `${q.stemAr} (نسخة)`,
    stemEn: `${q.stemEn} (copy)`,
    status: "draft",
    createdBy: actor.userId,
    reviewedBy: null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  });
  for (const c of choices) await db.insert(questionChoices).values({ ...c, id: crypto.randomUUID(), questionId: newId });
  for (const t of tagRows) await db.insert(questionTags).values({ questionId: newId, tagId: t.tagId });
  return { id: newId };
}

export async function listQuestions(
  db: DB,
  filter: { status?: string; type?: string; q?: string; subjectId?: string; tagId?: string; difficulty?: string; limit?: number } = {}
) {
  const limit = Math.min(filter.limit ?? 50, 200);
  let idsFilter: string[] | null = null;
  if (filter.tagId) {
    const rows = await db.select({ questionId: questionTags.questionId }).from(questionTags).where(eq(questionTags.tagId, filter.tagId));
    idsFilter = rows.map((r) => r.questionId);
    if (!idsFilter.length) return [];
  }
  const conds = [isNull(questions.deletedAt)];
  if (filter.status) conds.push(eq(questions.status, filter.status as "draft"));
  if (filter.type) conds.push(eq(questions.type, filter.type as "mcq"));
  if (filter.difficulty) conds.push(eq(questions.difficulty, filter.difficulty as "easy"));
  if (filter.subjectId) conds.push(eq(questions.subjectId, filter.subjectId));
  if (idsFilter) conds.push(inArray(questions.id, idsFilter));
  if (filter.q) {
    const like = `%${filter.q}%`;
    conds.push(or(sql`${questions.stemAr} LIKE ${like}`, sql`${questions.stemEn} LIKE ${like}`)!);
  }
  return db.select().from(questions).where(and(...conds)).orderBy(desc(questions.updatedAt)).limit(limit);
}

export async function getQuestionFull(db: DB, id: string) {
  const rows = await db.select().from(questions).where(and(eq(questions.id, id), isNull(questions.deletedAt))).limit(1);
  const q = rows[0];
  if (!q) return null;
  const [choices, tagRows] = await Promise.all([
    db.select().from(questionChoices).where(eq(questionChoices.questionId, id)).orderBy(asc(questionChoices.sortOrder)),
    db.select({ tagId: questionTags.tagId }).from(questionTags).where(eq(questionTags.questionId, id)),
  ]);
  return { ...q, choices, tagIds: tagRows.map((t) => t.tagId) };
}

export async function ensureTag(db: DB, input: { slug?: string; labelAr: string; labelEn: string }) {
  const slug = slugify(input.slug || input.labelEn || input.labelAr);
  const existing = await db.select().from(tags).where(eq(tags.slug, slug)).limit(1);
  if (existing[0]) return existing[0];
  const row = { id: crypto.randomUUID(), slug, labelAr: input.labelAr, labelEn: input.labelEn };
  await db.insert(tags).values(row);
  return row;
}

export async function listTags(db: DB) {
  return db.select().from(tags).orderBy(asc(tags.slug));
}

// ---------------------------------------------------------------------------
// Exam CRUD
// ---------------------------------------------------------------------------

async function uniqueExamSlug(db: DB, base: string) {
  const root = slugify(base) || `exam-${crypto.randomUUID().slice(0, 8)}`;
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const rows = await db.select({ id: exams.id }).from(exams).where(eq(exams.slug, candidate)).limit(1);
    if (!rows.length) return candidate;
  }
  return `${root}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function createExam(
  db: DB,
  input: { titleAr: string; titleEn: string; descriptionAr?: string | null; descriptionEn?: string | null; courseId?: string | null; lessonId?: string | null; config?: unknown },
  actor: ActorCtx
) {
  if (!input.titleAr.trim() || !input.titleEn.trim()) {
    throw new AssessmentValidationError([{ path: "title", message: "titleAr and titleEn are required" }]);
  }
  const config = parseExamConfig(input.config ?? {});
  const id = crypto.randomUUID();
  const slug = await uniqueExamSlug(db, input.titleEn);
  const ts = now();
  await db.insert(exams).values({
    id,
    slug,
    titleAr: input.titleAr.trim(),
    titleEn: input.titleEn.trim(),
    descriptionAr: input.descriptionAr ?? null,
    descriptionEn: input.descriptionEn ?? null,
    courseId: input.courseId ?? null,
    lessonId: input.lessonId ?? null,
    config: config as unknown as Record<string, unknown>,
    status: "draft",
    createdBy: actor.userId,
    createdAt: ts,
    updatedAt: ts,
  });
  return { id, slug };
}

export async function getExam(db: DB, id: string) {
  const rows = await db.select().from(exams).where(eq(exams.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getExamBySlug(db: DB, slug: string) {
  const rows = await db.select().from(exams).where(eq(exams.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/** attempt totals per exam (admin listings) */
export async function examAttemptCounts(db: DB): Promise<Record<string, { total: number; live: number }>> {
  const rows = await db
    .select({
      examId: examAttempts.examId,
      total: sql<number>`COUNT(*)`,
      live: sql<number>`SUM(CASE WHEN ${examAttempts.status} = 'in_progress' THEN 1 ELSE 0 END)`,
    })
    .from(examAttempts)
    .groupBy(examAttempts.examId);
  const out: Record<string, { total: number; live: number }> = {};
  for (const r of rows) out[r.examId] = { total: Number(r.total), live: Number(r.live ?? 0) };
  return out;
}

export async function listExams(db: DB, filter: { status?: string } = {}) {
  const conds = [];
  if (filter.status) conds.push(eq(exams.status, filter.status as "draft"));
  return db
    .select()
    .from(exams)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(exams.updatedAt));
}

export async function updateExam(
  db: DB,
  id: string,
  patch: { titleAr?: string; titleEn?: string; descriptionAr?: string | null; descriptionEn?: string | null; courseId?: string | null; lessonId?: string | null; config?: unknown }
) {
  const exam = await getExam(db, id);
  if (!exam) throw new AssessmentReferenceError("id", "exam not found");
  const set: Record<string, unknown> = { updatedAt: now() };
  if (patch.titleAr !== undefined) set.titleAr = patch.titleAr.trim();
  if (patch.titleEn !== undefined) set.titleEn = patch.titleEn.trim();
  if (patch.descriptionAr !== undefined) set.descriptionAr = patch.descriptionAr;
  if (patch.descriptionEn !== undefined) set.descriptionEn = patch.descriptionEn;
  if (patch.courseId !== undefined) set.courseId = patch.courseId;
  if (patch.lessonId !== undefined) set.lessonId = patch.lessonId;
  if (patch.config !== undefined) {
    // merge over the current config, then validate the whole contract
    const merged = { ...(exam.config as Record<string, unknown>), ...(patch.config as Record<string, unknown>) };
    set.config = parseExamConfig(merged) as unknown as Record<string, unknown>;
  }
  await db.update(exams).set(set).where(eq(exams.id, id));
  return { id };
}

/**
 * Publish gate (fail closed): manual mode needs ≥1 attached objective question;
 * pool mode needs pools that currently resolve to ≥1 published question.
 * Config must be contract-valid; essay-only exams cannot publish in Phase 5.
 */
export async function publishExam(db: DB, id: string) {
  const exam = await getExam(db, id);
  if (!exam) throw new AssessmentReferenceError("id", "exam not found");
  if (exam.status === "published") return { id, status: "published" };
  if (exam.status === "archived") throw new AssessmentValidationError([{ path: "status", message: "archived exams cannot be published (unarchive first)" }]);
  const config = parseExamConfig(exam.config);
  const resolved = await resolveExamQuestionIds(db, exam.id, config, 12345);
  if (resolved.length === 0) {
    throw new AssessmentValidationError([
      { path: "questions", message: config.selection.mode === "manual" ? "attach at least one published question" : "no published questions match the pools" },
    ]);
  }
  await db.update(exams).set({ status: "published", updatedAt: now() }).where(eq(exams.id, id));
  return { id, status: "published" };
}

export async function unpublishExam(db: DB, id: string) {
  const exam = await getExam(db, id);
  if (!exam) throw new AssessmentReferenceError("id", "exam not found");
  await db.update(exams).set({ status: "draft", updatedAt: now() }).where(eq(exams.id, id));
  return { id, status: "draft" };
}

/** Archive is the non-destructive delete (attempts/answers are preserved forever). */
export async function archiveExam(db: DB, id: string) {
  const exam = await getExam(db, id);
  if (!exam) throw new AssessmentReferenceError("id", "exam not found");
  await db.update(exams).set({ status: "archived", updatedAt: now() }).where(eq(exams.id, id));
  return { id, status: "archived" };
}

// --- exam_questions management (manual mode) --------------------------------

export async function addExamQuestion(db: DB, examId: string, questionId: string, points?: number | null) {
  const exam = await getExam(db, examId);
  if (!exam) throw new AssessmentReferenceError("examId", "exam not found");
  if (exam.status !== "draft") throw new AssessmentValidationError([{ path: "status", message: "questions can only change while the exam is draft" }]);
  const qRows = await db.select().from(questions).where(and(eq(questions.id, questionId), isNull(questions.deletedAt))).limit(1);
  const q = qRows[0];
  if (!q) throw new AssessmentReferenceError("questionId", "question not found");
  if (q.status !== "published") throw new AssessmentValidationError([{ path: "questionId", message: "only published questions can be attached" }]);
  if (!OBJECTIVE_TYPES.includes(q.type)) throw new AssessmentValidationError([{ path: "questionId", message: "essay questions cannot be attached in Phase 5 (manual grading deferred)" }]);

  const existing = await db.select().from(examQuestions).where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, questionId))).limit(1);
  if (existing.length) throw new AssessmentValidationError([{ path: "questionId", message: "question already attached" }]);
  const maxOrder = await db
    .select({ m: sql<number>`COALESCE(MAX(${examQuestions.sortOrder}), -1)` })
    .from(examQuestions)
    .where(eq(examQuestions.examId, examId));
  await db.insert(examQuestions).values({
    examId,
    questionId,
    sortOrder: Number(maxOrder[0]?.m ?? -1) + 1,
    points: points ?? q.pointsDefault,
  });
  return { examId, questionId };
}

export async function removeExamQuestion(db: DB, examId: string, questionId: string) {
  const exam = await getExam(db, examId);
  if (!exam) throw new AssessmentReferenceError("examId", "exam not found");
  if (exam.status !== "draft") throw new AssessmentValidationError([{ path: "status", message: "questions can only change while the exam is draft" }]);
  await db.delete(examQuestions).where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, questionId)));
  return { examId, questionId };
}

export async function moveExamQuestion(db: DB, examId: string, questionId: string, direction: "up" | "down") {
  const exam = await getExam(db, examId);
  if (!exam) throw new AssessmentReferenceError("examId", "exam not found");
  if (exam.status !== "draft") throw new AssessmentValidationError([{ path: "status", message: "questions can only change while the exam is draft" }]);
  const rows = await db.select().from(examQuestions).where(eq(examQuestions.examId, examId)).orderBy(asc(examQuestions.sortOrder));
  const idx = rows.findIndex((r) => r.questionId === questionId);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= rows.length) return { ok: false as const, error: "boundary" };
  const a = rows[idx];
  const b = rows[swapWith];
  await db.update(examQuestions).set({ sortOrder: b.sortOrder }).where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, a.questionId)));
  await db.update(examQuestions).set({ sortOrder: a.sortOrder }).where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, b.questionId)));
  return { ok: true as const };
}

export async function setExamQuestionPoints(db: DB, examId: string, questionId: string, points: number) {
  if (!(points >= 0.5 && points <= 1000)) throw new AssessmentValidationError([{ path: "points", message: "points must be 0.5–1000" }]);
  const exam = await getExam(db, examId);
  if (!exam) throw new AssessmentReferenceError("examId", "exam not found");
  if (exam.status !== "draft") throw new AssessmentValidationError([{ path: "status", message: "questions can only change while the exam is draft" }]);
  await db.update(examQuestions).set({ points }).where(and(eq(examQuestions.examId, examId), eq(examQuestions.questionId, questionId)));
  return { examId, questionId, points };
}

export async function examQuestionsFull(db: DB, examId: string) {
  const rows = await db
    .select({ eq: examQuestions, q: questions })
    .from(examQuestions)
    .innerJoin(questions, eq(questions.id, examQuestions.questionId))
    .where(eq(examQuestions.examId, examId))
    .orderBy(asc(examQuestions.sortOrder));
  return rows.map((r) => ({ ...r.eq, question: r.q }));
}

// ---------------------------------------------------------------------------
// Seeded randomization (stable per attempt — FEATURE-SPEC §6)
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, deterministic PRNG. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  const rand = prng(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** per-question choice order seed derived from the attempt seed (deterministic) */
export function choiceSeed(randomSeed: number, questionId: string): number {
  return (randomSeed ^ hashCode(questionId)) >>> 0;
}

// ---------------------------------------------------------------------------
// Question-set materialization (manual + pool modes)
// ---------------------------------------------------------------------------

async function poolQuestionIds(db: DB, pool: { filters: Record<string, unknown>; count: number }, seed: number): Promise<string[]> {
  const conds = [eq(questions.status, "published"), isNull(questions.deletedAt), inArray(questions.type, [...OBJECTIVE_TYPES] as ["mcq"])];
  const f = pool.filters as { subject?: string | null; unit?: string | null; lesson?: string | null; tags?: string[]; difficulty?: string | null };
  if (f.subject) conds.push(eq(questions.subjectId, f.subject));
  if (f.unit) conds.push(eq(questions.unitId, f.unit));
  if (f.lesson) conds.push(eq(questions.lessonId, f.lesson));
  if (f.difficulty) conds.push(eq(questions.difficulty, f.difficulty as "easy"));
  if (f.tags?.length) {
    const rows = await db.select({ questionId: questionTags.questionId }).from(questionTags).where(inArray(questionTags.tagId, f.tags));
    const ids = [...new Set(rows.map((r) => r.questionId))];
    if (!ids.length) return [];
    conds.push(inArray(questions.id, ids));
  }
  const rows = await db.select({ id: questions.id }).from(questions).where(and(...conds)).orderBy(asc(questions.createdAt));
  return seededShuffle(rows.map((r) => r.id), seed).slice(0, pool.count);
}

/**
 * Resolves the attempt's question set: manual → exam_questions order; pool →
 * seeded selection per pool (deduped, capped by max_questions). Returns point
 * values too (manual override → question default).
 */
export async function resolveExamQuestionIds(
  db: DB,
  examId: string,
  config: ExamConfig,
  seed: number
): Promise<string[]> {
  if (config.selection.mode === "manual") {
    const rows = await db
      .select({ questionId: examQuestions.questionId })
      .from(examQuestions)
      .innerJoin(questions, eq(questions.id, examQuestions.questionId))
      .where(and(eq(examQuestions.examId, examId), eq(questions.status, "published"), isNull(questions.deletedAt)))
      .orderBy(asc(examQuestions.sortOrder));
    let ids = rows.map((r) => r.questionId);
    if (config.selection.randomize_questions) ids = seededShuffle(ids, seed);
    return config.selection.max_questions ? ids.slice(0, config.selection.max_questions) : ids;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < config.selection.pools.length; i++) {
    const picked = await poolQuestionIds(db, config.selection.pools[i], (seed ^ (i * 0x9e3779b9)) >>> 0);
    for (const id of picked) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  const limited = config.selection.max_questions ? out.slice(0, config.selection.max_questions) : out;
  return config.selection.randomize_questions ? seededShuffle(limited, seed) : limited;
}

async function pointsForQuestions(db: DB, examId: string, questionIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!questionIds.length) return out;
  const rows = await db
    .select({ id: questions.id, pointsDefault: questions.pointsDefault })
    .from(questions)
    .where(inArray(questions.id, questionIds));
  for (const r of rows) out[r.id] = r.pointsDefault;
  const overrides = await db
    .select({ questionId: examQuestions.questionId, points: examQuestions.points })
    .from(examQuestions)
    .where(and(eq(examQuestions.examId, examId), inArray(examQuestions.questionId, questionIds)));
  for (const o of overrides) out[o.questionId] = o.points;
  return out;
}

// ---------------------------------------------------------------------------
// Attempt eligibility + access
// ---------------------------------------------------------------------------

export interface AttemptActor {
  userId: string | null;
  roleRank: number;
}

/**
 * Access to an exam inherits the content chain it is attached to (lesson →
 * course); an unattached published exam requires authentication. The resolver
 * (ADR-009) decides — this wrapper only picks the chain.
 */
export async function examAccess(db: DB, actor: AttemptActor, exam: { lessonId: string | null; courseId: string | null }) {
  if (exam.lessonId) {
    const chain = await chainForLesson(db, exam.lessonId);
    if (!chain) return { allowed: false, reason: "not_found" as const };
    return resolveContentAccess(db, actor, chain);
  }
  if (exam.courseId) {
    const chain = await chainForCourse(db, exam.courseId);
    if (!chain) return { allowed: false, reason: "not_found" as const };
    return resolveContentAccess(db, actor, chain);
  }
  return actor.userId
    ? { allowed: true, reason: "authenticated" as const }
    : { allowed: false, reason: "anon" as const };
}

export type EligibilityReason =
  | "unpublished" | "before_window" | "after_window" | "attempts_exhausted" | "cooldown";

export type Eligibility =
  | { ok: true; resume?: { attemptId: string } }
  | { ok: false; reason: EligibilityReason; retryAt?: number };

export async function attemptEligibility(
  db: DB,
  opts: { exam: { id: string; status: string; config: unknown }; actor: AttemptActor; nowMs: number }
): Promise<Eligibility> {
  const { exam, actor, nowMs } = opts;
  if (!actor.userId) return { ok: false, reason: "unpublished" };
  const isAdmin = actor.roleRank >= 3;
  if (exam.status !== "published" && !isAdmin) return { ok: false, reason: "unpublished" };
  const config = parseExamConfig(exam.config);

  const { starts_at: startsAt, ends_at: endsAt } = config.availability;
  if (startsAt !== null && nowMs < startsAt) return { ok: false, reason: "before_window" };
  if (endsAt !== null && nowMs >= endsAt) return { ok: false, reason: "after_window" };

  // one live attempt → resume it (reconnect resumes exactly — FEATURE-SPEC §6)
  const live = await db
    .select({ id: examAttempts.id })
    .from(examAttempts)
    .where(and(eq(examAttempts.examId, exam.id), eq(examAttempts.studentId, actor.userId), eq(examAttempts.status, "in_progress")))
    .limit(1);
  if (live[0]) return { ok: true, resume: { attemptId: live[0].id } };

  const prior = await db
    .select()
    .from(examAttempts)
    .where(and(eq(examAttempts.examId, exam.id), eq(examAttempts.studentId, actor.userId), ne(examAttempts.status, "cancelled")))
    .orderBy(desc(examAttempts.attemptNumber));
  if (!isAdmin && config.attempts.max !== null && prior.length >= config.attempts.max) {
    return { ok: false, reason: "attempts_exhausted" };
  }
  if (config.attempts.cooldown_minutes > 0 && prior.length) {
    const last = prior[0];
    const anchor = last.submittedAt ?? last.startedAt;
    const retryAt = anchor + config.attempts.cooldown_minutes * 60_000;
    if (nowMs < retryAt) return { ok: false, reason: "cooldown", retryAt };
  }
  return { ok: true };
}

export type AttemptRow = typeof examAttempts.$inferSelect;

export async function startAttempt(
  db: DB,
  opts: { examId: string; actor: AttemptActor; nowMs: number }
): Promise<{ ok: true; attempt: AttemptRow } | { ok: false; reason: EligibilityReason | "no_access" | "no_questions"; retryAt?: number }> {
  const { examId, actor, nowMs } = opts;
  if (!actor.userId) return { ok: false, reason: "no_access" };
  const exam = await getExam(db, examId);
  if (!exam) throw new AssessmentReferenceError("examId", "exam not found");

  const access = await examAccess(db, actor, exam);
  if (!access.allowed) return { ok: false, reason: "no_access" };

  const eligibility = await attemptEligibility(db, { exam, actor, nowMs });
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason, retryAt: eligibility.retryAt };
  if (eligibility.resume) {
    const existing = await getAttempt(db, eligibility.resume.attemptId);
    if (existing) return { ok: true, attempt: existing };
  }

  const config = parseExamConfig(exam.config);
  const randomSeed = crypto.getRandomValues(new Uint32Array(1))[0];
  const questionOrder = await resolveExamQuestionIds(db, exam.id, config, randomSeed);
  if (questionOrder.length === 0) return { ok: false, reason: "no_questions" };
  const points = await pointsForQuestions(db, exam.id, questionOrder);

  const numberRows = await db
    .select({ n: sql<number>`COALESCE(MAX(${examAttempts.attemptNumber}), 0)` })
    .from(examAttempts)
    .where(and(eq(examAttempts.examId, examId), eq(examAttempts.studentId, actor.userId)));
  const attemptNumber = Number(numberRows[0]?.n ?? 0) + 1;
  const deadlineAt = config.duration_minutes ? nowMs + config.duration_minutes * 60_000 : null;

  const attempt: AttemptRow = {
    id: crypto.randomUUID(),
    examId,
    studentId: actor.userId,
    attemptNumber,
    status: "in_progress",
    startedAt: nowMs,
    deadlineAt,
    submittedAt: null,
    timeUsedSeconds: null,
    score: null,
    maxScore: null,
    passed: null,
    gradingStatus: "auto",
    randomSeed,
    metadata: { questionOrder, points },
  };
  try {
    await db.insert(examAttempts).values(attempt);
  } catch {
    // the partial unique index caught a concurrent start → resume the live attempt
    const live = await db
      .select()
      .from(examAttempts)
      .where(and(eq(examAttempts.examId, examId), eq(examAttempts.studentId, actor.userId), eq(examAttempts.status, "in_progress")))
      .limit(1);
    if (live[0]) return { ok: true, attempt: live[0] };
    throw new AssessmentValidationError([{ path: "attempt", message: "could not start attempt" }]);
  }
  await appendEvent(db, { type: "exam_start", userId: actor.userId, resourceType: "exam", resourceId: examId, props: { attemptId: attempt.id, attemptNumber } });
  return { ok: true, attempt };
}

export async function getAttempt(db: DB, id: string): Promise<AttemptRow | null> {
  const rows = await db.select().from(examAttempts).where(eq(examAttempts.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Ownership-guarded fetch (IDOR protection): null when the attempt belongs to someone else. */
export async function getOwnedAttempt(db: DB, attemptId: string, studentId: string): Promise<AttemptRow | null> {
  const rows = await db
    .select()
    .from(examAttempts)
    .where(and(eq(examAttempts.id, attemptId), eq(examAttempts.studentId, studentId)))
    .limit(1);
  return rows[0] ?? null;
}

export function attemptMetadata(attempt: AttemptRow): { questionOrder: string[]; points: Record<string, number> } {
  const md = (attempt.metadata ?? {}) as Record<string, unknown>;
  return {
    questionOrder: Array.isArray(md.questionOrder) ? (md.questionOrder as string[]) : [],
    points: (md.points as Record<string, number>) ?? {},
  };
}

// ---------------------------------------------------------------------------
// Live attempt context (SANITIZED — the answer key never leaves the server)
// ---------------------------------------------------------------------------

export interface LiveQuestion {
  id: string;
  type: QuestionType;
  stemAr: string;
  stemEn: string;
  points: number;
  choices: Array<{ id: string; contentAr: string; contentEn: string }>;
}

export async function attemptContext(
  db: DB,
  opts: { attempt: AttemptRow; config: ExamConfig; nowMs: number }
): Promise<{
  questions: LiveQuestion[];
  answers: Record<string, string[]>;
  remainingSeconds: number | null;
  expired: boolean;
}> {
  const { attempt, config, nowMs } = opts;
  const { questionOrder, points } = attemptMetadata(attempt);
  if (!questionOrder.length) return { questions: [], answers: {}, remainingSeconds: null, expired: false };

  const qRows = await db.select().from(questions).where(inArray(questions.id, questionOrder));
  const qMap = new Map(qRows.map((q) => [q.id, q]));
  const cRows = await db.select().from(questionChoices).where(inArray(questionChoices.questionId, questionOrder)).orderBy(asc(questionChoices.sortOrder));
  const byQ = new Map<string, typeof cRows>();
  for (const c of cRows) byQ.set(c.questionId, [...(byQ.get(c.questionId) ?? []), c]);

  const liveQuestions: LiveQuestion[] = [];
  for (const qid of questionOrder) {
    const q = qMap.get(qid);
    if (!q) continue;
    let choices = (byQ.get(qid) ?? []).map((c) => ({ id: c.id, contentAr: c.contentAr, contentEn: c.contentEn }));
    if (config.selection.randomize_choices) choices = seededShuffle(choices, choiceSeed(attempt.randomSeed, qid));
    liveQuestions.push({
      id: qid,
      type: q.type as QuestionType,
      stemAr: q.stemAr,
      stemEn: q.stemEn,
      points: points[qid] ?? q.pointsDefault,
      choices,
    });
  }

  const aRows = await db
    .select({ questionId: examAnswers.questionId, choiceIds: examAnswers.choiceIds })
    .from(examAnswers)
    .where(eq(examAnswers.attemptId, attempt.id));
  const answers: Record<string, string[]> = {};
  for (const a of aRows) answers[a.questionId] = (a.choiceIds as string[] | null) ?? [];

  const remainingSeconds =
    attempt.deadlineAt !== null ? Math.max(0, Math.ceil((attempt.deadlineAt - nowMs) / 1000)) : null;
  const expired = attempt.deadlineAt !== null && nowMs > attempt.deadlineAt;
  return { questions: liveQuestions, answers, remainingSeconds, expired };
}

// ---------------------------------------------------------------------------
// Autosave (idempotent per (attempt, question) — retries never duplicate)
// ---------------------------------------------------------------------------

export async function saveAnswer(
  db: DB,
  opts: { attempt: AttemptRow; questionId: string; choiceIds: string[]; nowMs: number }
): Promise<{ ok: true; version: number } | { ok: false; error: "closed" | "unknown_question" | "invalid_choice" | "too_many" }> {
  const { attempt, questionId, choiceIds, nowMs } = opts;
  if (attempt.status !== "in_progress") return { ok: false, error: "closed" };
  const { questionOrder } = attemptMetadata(attempt);
  if (!questionOrder.includes(questionId)) return { ok: false, error: "unknown_question" };

  const qRows = await db.select({ type: questions.type }).from(questions).where(eq(questions.id, questionId)).limit(1);
  const q = qRows[0];
  if (!q) return { ok: false, error: "unknown_question" };

  const selected = [...new Set(choiceIds)];
  if ((q.type === "mcq" || q.type === "true_false") && selected.length > 1) return { ok: false, error: "too_many" };
  if (selected.length) {
    const cRows = await db.select({ id: questionChoices.id }).from(questionChoices).where(inArray(questionChoices.id, selected));
    const owned = await db
      .select({ id: questionChoices.id })
      .from(questionChoices)
      .where(and(eq(questionChoices.questionId, questionId), inArray(questionChoices.id, selected)));
    if (cRows.length !== selected.length || owned.length !== selected.length) return { ok: false, error: "invalid_choice" };
  }

  const existing = await db
    .select({ version: examAnswers.version })
    .from(examAnswers)
    .where(and(eq(examAnswers.attemptId, attempt.id), eq(examAnswers.questionId, questionId)))
    .limit(1);
  const version = (existing[0]?.version ?? 0) + 1;
  await db
    .insert(examAnswers)
    .values({
      id: crypto.randomUUID(),
      attemptId: attempt.id,
      questionId,
      choiceIds: selected,
      textAnswer: null,
      pointsEarned: null,
      isCorrect: null,
      gradedBy: null,
      gradedAt: null,
      feedback: null,
      version,
      updatedAt: nowMs,
    })
    .onConflictDoUpdate({
      target: [examAnswers.attemptId, examAnswers.questionId],
      set: { choiceIds: selected, version, updatedAt: nowMs },
    });
  return { ok: true, version };
}

// ---------------------------------------------------------------------------
// Submission + auto-grading (idempotent, server-timed, exactly-once events)
// ---------------------------------------------------------------------------

export interface SubmitResult {
  status: "graded";
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  submittedAt: number;
  expired: boolean;
  alreadySubmitted: boolean;
}

export async function submitAttempt(
  db: DB,
  opts: { attempt: AttemptRow; graceSeconds: number; nowMs: number; videoThresholdPct: number }
): Promise<SubmitResult> {
  const { attempt, graceSeconds, nowMs, videoThresholdPct } = opts;

  // idempotent replay: a graded attempt returns its stored result (no re-grade, no duplicate events)
  if (attempt.status === "graded" || (attempt.status === "submitted" && attempt.score !== null)) {
    return storedResult(attempt);
  }
  if (attempt.status !== "in_progress" && attempt.status !== "grading") {
    // expired/cancelled without a submission window — treat as closed
    return storedResult(attempt);
  }

  const examRow = await getExam(db, attempt.examId);
  if (!examRow) throw new AssessmentReferenceError("examId", "exam not found");
  const config = parseExamConfig(examRow.config);
  const expired = attempt.deadlineAt !== null && nowMs > attempt.deadlineAt + graceSeconds * 1000;
  // Server clock decides: client-clock tricks are irrelevant (no client time is ever read).
  // Past deadline+grace the attempt is AUTO-SUBMITTED with whatever is answered (FEATURE-SPEC §6).

  // claim the submission atomically (prevents double grading + duplicate events)
  const submittedAt = nowMs;
  const timeUsedSeconds =
    attempt.deadlineAt !== null
      ? Math.round((Math.min(nowMs, attempt.deadlineAt + graceSeconds * 1000) - attempt.startedAt) / 1000)
      : Math.round((nowMs - attempt.startedAt) / 1000);
  const claim = await db
    .update(examAttempts)
    .set({ status: "grading", submittedAt, timeUsedSeconds })
    .where(and(eq(examAttempts.id, attempt.id), inArray(examAttempts.status, ["in_progress", "grading"])))
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) {
    const fresh = await getAttempt(db, attempt.id);
    if (fresh) return storedResult(fresh);
    throw new AssessmentReferenceError("attemptId", "attempt vanished");
  }

  const graded = await gradeAttempt(db, { attemptId: attempt.id, examId: attempt.examId, config, expired });
  const md = ((attempt.metadata ?? {}) as Record<string, unknown>);
  await db
    .update(examAttempts)
    .set({
      status: "graded",
      gradingStatus: "complete",
      score: graded.score,
      maxScore: graded.maxScore,
      passed: graded.passed,
      metadata: { ...md, ...(expired ? { expired: true } : {}) },
    })
    .where(eq(examAttempts.id, attempt.id));

  // exactly-once: only the claimer reaches this point
  await appendEvent(db, {
    type: "exam_submit",
    userId: attempt.studentId,
    resourceType: "exam",
    resourceId: attempt.examId,
    props: { attemptId: attempt.id, attemptNumber: attempt.attemptNumber, score: graded.score, maxScore: graded.maxScore, passed: graded.passed, expired },
  });

  if (examRow.lessonId) {
    // FEATURE-SPEC §4: a required exam item now HAS a completion signal — let the
    // progress service re-evaluate the lesson (submission counts, never mere opening).
    try {
      const { maybeAutoCompleteLesson } = await import("~server/progress/service.server");
      await maybeAutoCompleteLesson(db, attempt.studentId, examRow.lessonId, videoThresholdPct);
    } catch {
      // lesson completion is convenience data — never fail the submission for it
    }
  }

  return {
    status: "graded",
    score: graded.score,
    maxScore: graded.maxScore,
    percentage: graded.percentage,
    passed: graded.passed,
    submittedAt,
    expired,
    alreadySubmitted: false,
  };
}

function storedResult(attempt: AttemptRow): SubmitResult {
  const maxScore = attempt.maxScore ?? 0;
  const score = attempt.score ?? 0;
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
  const md = (attempt.metadata ?? {}) as Record<string, unknown>;
  return {
    status: "graded",
    score,
    maxScore,
    percentage,
    passed: attempt.passed ?? false,
    submittedAt: attempt.submittedAt ?? attempt.startedAt,
    expired: Boolean(md.expired),
    alreadySubmitted: true,
  };
}

async function gradeAttempt(
  db: DB,
  opts: { attemptId: string; examId: string; config: ExamConfig; expired: boolean }
): Promise<{ score: number; maxScore: number; percentage: number; passed: boolean; correctCount: number }> {
  const { attemptId, examId, config } = opts;
  const attempt = await getAttempt(db, attemptId);
  const { questionOrder, points } = attemptMetadata(attempt!);

  const qRows = questionOrder.length
    ? await db.select().from(questions).where(inArray(questions.id, questionOrder))
    : [];
  const qMap = new Map(qRows.map((q) => [q.id, q]));
  const cRows = questionOrder.length
    ? await db.select().from(questionChoices).where(inArray(questionChoices.questionId, questionOrder))
    : [];
  const correctByQ = new Map<string, Set<string>>();
  const choicesByQ = new Map<string, Set<string>>();
  for (const c of cRows) {
    if (!choicesByQ.has(c.questionId)) choicesByQ.set(c.questionId, new Set());
    choicesByQ.get(c.questionId)!.add(c.id);
    if (c.isCorrect) {
      if (!correctByQ.has(c.questionId)) correctByQ.set(c.questionId, new Set());
      correctByQ.get(c.questionId)!.add(c.id);
    }
  }
  const aRows = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attemptId));
  const aMap = new Map(aRows.map((a) => [a.questionId, a]));

  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  const partial = config.scoring.partial_credit_multiselect;
  for (const qid of questionOrder) {
    const pts = points[qid] ?? qMap.get(qid)?.pointsDefault ?? 0;
    maxScore += pts;
    const answer = aMap.get(qid);
    const selected = new Set(((answer?.choiceIds as string[] | null) ?? []).filter((cid) => choicesByQ.get(qid)?.has(cid)));
    const correct = correctByQ.get(qid) ?? new Set<string>();
    let earned = 0;
    let isCorrect = false;
    const type = qMap.get(qid)?.type;
    if (type === "mcq" || type === "true_false") {
      isCorrect = selected.size === 1 && correct.has([...selected][0]);
      earned = isCorrect ? pts : 0;
    } else if (type === "multi_select") {
      let hits = 0;
      let misses = 0;
      for (const cid of selected) (correct.has(cid) ? hits++ : misses++);
      isCorrect = hits === correct.size && misses === 0;
      if (isCorrect) earned = pts;
      else if (partial && correct.size > 0) {
        earned = Math.round(pts * (Math.max(0, hits - misses) / correct.size) * 100) / 100;
      } else earned = 0;
    }
    if (isCorrect) correctCount++;
    score += earned;
    if (answer) {
      await db
        .update(examAnswers)
        .set({ pointsEarned: earned, isCorrect, gradedAt: Date.now() })
        .where(eq(examAnswers.id, answer.id));
    }
  }
  score = Math.round(score * 100) / 100;
  maxScore = Math.round(maxScore * 100) / 100;
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
  const passed = percentage >= config.scoring.pass_percent;
  void examId;
  return { score, maxScore, percentage, passed, correctCount };
}

/**
 * Sweeps the student's live attempt for an exam: if it is past deadline+grace,
 * it is auto-submitted with whatever is answered (policy per FEATURE-SPEC §6).
 * Called on every student touch (exam page, attempt page, results) so state
 * converges without background jobs (Workers-cron-free design).
 */
export async function expireAttemptIfNeeded(
  db: DB,
  opts: { examId: string; studentId: string; graceSeconds: number; nowMs: number; videoThresholdPct: number }
): Promise<SubmitResult | null> {
  const live = await db
    .select()
    .from(examAttempts)
    .where(and(eq(examAttempts.examId, opts.examId), eq(examAttempts.studentId, opts.studentId), eq(examAttempts.status, "in_progress")))
    .limit(1);
  const attempt = live[0];
  if (!attempt || attempt.deadlineAt === null) return null;
  if (opts.nowMs <= attempt.deadlineAt + opts.graceSeconds * 1000) return null;
  return submitAttempt(db, { attempt, graceSeconds: opts.graceSeconds, nowMs: opts.nowMs, videoThresholdPct: opts.videoThresholdPct });
}

// ---------------------------------------------------------------------------
// Results + review (policy-gated reveal — ADR-022)
// ---------------------------------------------------------------------------

export interface AttemptResultSummary {
  attemptId: string;
  examId: string;
  examSlug: string;
  examTitleAr: string;
  examTitleEn: string;
  attemptNumber: number;
  status: string;
  submittedAt: number | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
  correctCount: number | null;
  timeUsedSeconds: number | null;
  visible: boolean;
}

export function resultsVisible(config: ExamConfig, attempt: AttemptRow, nowMs: number): boolean {
  if (attempt.status !== "graded") return false;
  if (config.results.show === "immediate") return true;
  if (config.results.show === "after_end") {
    return config.availability.ends_at === null || nowMs >= config.availability.ends_at;
  }
  return false; // manual: hidden until the admin switches the policy
}

export async function attemptSummary(db: DB, attempt: AttemptRow, config: ExamConfig, nowMs: number): Promise<AttemptResultSummary | null> {
  const exam = await getExam(db, attempt.examId);
  if (!exam) return null;
  const visible = resultsVisible(config, attempt, nowMs);
  const aRows = visible
    ? await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(examAnswers)
        .where(and(eq(examAnswers.attemptId, attempt.id), eq(examAnswers.isCorrect, true)))
    : [];
  const maxScore = attempt.maxScore ?? null;
  const score = attempt.score ?? null;
  return {
    attemptId: attempt.id,
    examId: exam.id,
    examSlug: exam.slug,
    examTitleAr: exam.titleAr,
    examTitleEn: exam.titleEn,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
    score: visible ? score : null,
    maxScore: visible ? maxScore : null,
    percentage: visible && score !== null && maxScore ? Math.round((score / maxScore) * 1000) / 10 : null,
    passed: visible ? attempt.passed : null,
    correctCount: visible && aRows[0] ? Number(aRows[0].n) : null,
    timeUsedSeconds: visible ? attempt.timeUsedSeconds : null,
    visible,
  };
}

export async function attemptsForStudent(db: DB, studentId: string, examId?: string) {
  const conds = [eq(examAttempts.studentId, studentId)];
  if (examId) conds.push(eq(examAttempts.examId, examId));
  return db.select().from(examAttempts).where(and(...conds)).orderBy(desc(examAttempts.startedAt));
}

/**
 * Review payload (post-submission only, policy-gated): the student's OWN order,
 * their selections, and — only when results.show_answers — the correct flags +
 * earned points; explanations only when results.show_explanations.
 */
export async function attemptReview(
  db: DB,
  opts: { attempt: AttemptRow; config: ExamConfig }
): Promise<null | {
  questions: Array<{
    id: string;
    type: string;
    stemAr: string;
    stemEn: string;
    points: number;
    earned: number | null;
    answered: boolean;
    choices: Array<{ id: string; contentAr: string; contentEn: string; selected: boolean; correct: boolean | null; feedback: string | null }>;
    explanationAr: string | null;
    explanationEn: string | null;
  }>;
}> {
  const { attempt, config } = opts;
  if (attempt.status !== "graded") return null;
  if (!config.results.review_mode || !config.results.show_answers) return null;
  const { questionOrder, points } = attemptMetadata(attempt);
  if (!questionOrder.length) return { questions: [] };

  const qRows = await db.select().from(questions).where(inArray(questions.id, questionOrder));
  const qMap = new Map(qRows.map((q) => [q.id, q]));
  const cRows = await db.select().from(questionChoices).where(inArray(questionChoices.questionId, questionOrder)).orderBy(asc(questionChoices.sortOrder));
  const byQ = new Map<string, typeof cRows>();
  for (const c of cRows) byQ.set(c.questionId, [...(byQ.get(c.questionId) ?? []), c]);
  const aRows = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id));
  const aMap = new Map(aRows.map((a) => [a.questionId, a]));

  const out = [];
  for (const qid of questionOrder) {
    const q = qMap.get(qid);
    if (!q) continue;
    const answer = aMap.get(qid);
    const selected = new Set((answer?.choiceIds as string[] | null) ?? []);
    let choices = (byQ.get(qid) ?? []).map((c) => ({
      id: c.id,
      contentAr: c.contentAr,
      contentEn: c.contentEn,
      selected: selected.has(c.id),
      correct: config.results.show_answers ? c.isCorrect : null,
      feedback: config.results.show_answers && selected.has(c.id) ? c.feedback : null,
    }));
    if (config.selection.randomize_choices) choices = seededShuffle(choices, choiceSeed(attempt.randomSeed, qid));
    out.push({
      id: qid,
      type: q.type,
      stemAr: q.stemAr,
      stemEn: q.stemEn,
      points: points[qid] ?? q.pointsDefault,
      earned: answer?.pointsEarned ?? 0,
      answered: Boolean(answer && ((answer.choiceIds as string[] | null)?.length ?? 0) > 0),
      choices,
      explanationAr: config.results.show_explanations ? q.explanationAr : null,
      explanationEn: config.results.show_explanations ? q.explanationEn : null,
    });
  }
  return { questions: out };
}

// ---------------------------------------------------------------------------
// Admin results & grading (Phase 6). Objective questions are auto-graded on
// submit; essay/manual grading remains a documented backend deferral (schema
// reserves text_answer / graded_by / needs_manual). This section gives admins
// a full read on every attempt regardless of the student-facing result policy.
// ---------------------------------------------------------------------------

export interface AdminAttemptRow {
  id: string;
  attemptNumber: number;
  status: string;
  gradingStatus: string;
  startedAt: number;
  submittedAt: number | null;
  timeUsedSeconds: number | null;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  studentName: string;
  studentEmail: string;
  percentage: number | null;
}

export async function adminAttemptsForExam(db: DB, examId: string): Promise<AdminAttemptRow[]> {
  const rows = await db
    .select({
      id: examAttempts.id,
      attemptNumber: examAttempts.attemptNumber,
      status: examAttempts.status,
      gradingStatus: examAttempts.gradingStatus,
      startedAt: examAttempts.startedAt,
      submittedAt: examAttempts.submittedAt,
      timeUsedSeconds: examAttempts.timeUsedSeconds,
      score: examAttempts.score,
      maxScore: examAttempts.maxScore,
      passed: examAttempts.passed,
      studentName: users.fullName,
      studentEmail: users.email,
    })
    .from(examAttempts)
    .innerJoin(users, eq(users.id, examAttempts.studentId))
    .where(eq(examAttempts.examId, examId))
    .orderBy(desc(examAttempts.startedAt));
  return rows.map((r) => ({
    ...r,
    percentage: r.score !== null && r.maxScore ? Math.round((r.score / r.maxScore) * 1000) / 10 : null,
  }));
}

/** One student's answers against the question's correct answers — admin always sees the full picture. */
export interface AdminReviewQuestion {
  id: string;
  type: string;
  stemAr: string;
  stemEn: string;
  points: number;
  earned: number | null;
  answered: boolean;
  textAnswer: string | null;
  isCorrect: boolean | null;
  choices: Array<{ id: string; contentAr: string; contentEn: string; selected: boolean; correct: boolean; feedback: string | null }>;
  explanationAr: string | null;
  explanationEn: string | null;
}

export interface AdminAttemptReview {
  examId: string;
  examTitleAr: string;
  examTitleEn: string;
  examSlug: string;
  attemptNumber: number;
  status: string;
  gradingStatus: string;
  startedAt: number;
  submittedAt: number | null;
  timeUsedSeconds: number | null;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  studentName: string;
  studentEmail: string;
  questions: AdminReviewQuestion[];
}

export async function adminAttemptReview(db: DB, attemptId: string): Promise<AdminAttemptReview | null> {
  const attemptRows = await db
    .select({
      att: examAttempts,
      studentName: users.fullName,
      studentEmail: users.email,
    })
    .from(examAttempts)
    .innerJoin(users, eq(users.id, examAttempts.studentId))
    .where(eq(examAttempts.id, attemptId))
    .limit(1);
  if (!attemptRows[0]) return null;
  const { att, studentName, studentEmail } = attemptRows[0];
  const exam = await getExam(db, att.examId);
  if (!exam) return null;

  const { questionOrder, points } = attemptMetadata(att);
  const questions_out: AdminReviewQuestion[] = [];
  if (questionOrder.length) {
    const qRows = await db.select().from(questions).where(inArray(questions.id, questionOrder));
    const qMap = new Map(qRows.map((q) => [q.id, q]));
    const cRows = await db.select().from(questionChoices).where(inArray(questionChoices.questionId, questionOrder)).orderBy(asc(questionChoices.sortOrder));
    const byQ = new Map<string, typeof cRows>();
    for (const c of cRows) byQ.set(c.questionId, [...(byQ.get(c.questionId) ?? []), c]);
    const aRows = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, att.id));
    const aMap = new Map(aRows.map((a) => [a.questionId, a]));
    for (const qid of questionOrder) {
      const q = qMap.get(qid);
      if (!q) continue;
      const answer = aMap.get(qid);
      const selected = new Set((answer?.choiceIds as string[] | null) ?? []);
      questions_out.push({
        id: qid,
        type: q.type,
        stemAr: q.stemAr,
        stemEn: q.stemEn,
        points: points[qid] ?? q.pointsDefault,
        earned: answer?.pointsEarned ?? null,
        answered: Boolean(answer && ((answer.choiceIds as string[] | null)?.length ?? 0) > 0),
        textAnswer: answer?.textAnswer ?? null,
        isCorrect: answer?.isCorrect ?? null,
        choices: (byQ.get(qid) ?? []).map((c) => ({
          id: c.id,
          contentAr: c.contentAr,
          contentEn: c.contentEn,
          selected: selected.has(c.id),
          correct: c.isCorrect,
          feedback: selected.has(c.id) ? c.feedback : null,
        })),
        explanationAr: q.explanationAr,
        explanationEn: q.explanationEn,
      });
    }
  }

  return {
    examId: exam.id,
    examTitleAr: exam.titleAr,
    examTitleEn: exam.titleEn,
    examSlug: exam.slug,
    attemptNumber: att.attemptNumber,
    status: att.status,
    gradingStatus: att.gradingStatus,
    startedAt: att.startedAt,
    submittedAt: att.submittedAt,
    timeUsedSeconds: att.timeUsedSeconds,
    score: att.score,
    maxScore: att.maxScore,
    passed: att.passed,
    studentName,
    studentEmail,
    questions: questions_out,
  };
}

// ---------------------------------------------------------------------------
// Student-facing exam listings
// ---------------------------------------------------------------------------

export async function listPublishedExamsForActor(db: DB, actor: AttemptActor, nowMs: number) {
  const rows = await db.select().from(exams).where(eq(exams.status, "published")).orderBy(desc(exams.createdAt));
  if (rows.length === 0) return [];

  // W9: the old loop resolved each exam's ancestry chain + entitlements +
  // attempt counts with ~6 sequential queries PER exam (N+1). Batch instead:
  // load every referenced node in a constant number of queries, fetch the
  // actor's entitlements once, and let the pure resolver decide each verdict.
  const lessonIds = [...new Set(rows.map((e) => e.lessonId).filter((x): x is string => Boolean(x)))];
  const directCourseIds = [...new Set(rows.map((e) => e.courseId).filter((x): x is string => Boolean(x)))];

  const lessonRows = lessonIds.length
    ? await db.select().from(lessons).where(inArray(lessons.id, lessonIds))
    : [];
  const unitIds = [...new Set(lessonRows.map((l) => l.unitId))];
  const unitRows = unitIds.length
    ? await db.select().from(units).where(inArray(units.id, unitIds))
    : [];
  const chainCourseIds = [...new Set(unitRows.map((u) => u.courseId))];
  const allCourseIds = [...new Set([...directCourseIds, ...chainCourseIds])];
  const courseRows = allCourseIds.length
    ? await db.select().from(courses).where(inArray(courses.id, allCourseIds))
    : [];
  const subjectIds = [...new Set(courseRows.map((c) => c.subjectId))];
  const subjectRows = subjectIds.length
    ? await db.select().from(subjects).where(inArray(subjects.id, subjectIds))
    : [];

  const lessonById = new Map(lessonRows.map((l) => [l.id, l]));
  const unitById = new Map(unitRows.map((u) => [u.id, u]));
  const courseById = new Map(courseRows.map((c) => [c.id, c]));
  const subjectById = new Map(subjectRows.map((s) => [s.id, s]));

  // Rebuilds the exact ChainRow shape chainForLesson/chainForCourse produce
  // (including "missing node → null"), so resolver semantics are unchanged.
  const lessonChain = (id: string): ChainRow | null => {
    const lesson = lessonById.get(id);
    if (!lesson) return null;
    const unit = unitById.get(lesson.unitId);
    if (!unit) return null;
    const course = courseById.get(unit.courseId);
    if (!course) return null;
    const subject = subjectById.get(course.subjectId);
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
  };
  const courseChain = (id: string): ChainRow | null => {
    const course = courseById.get(id);
    if (!course) return null;
    const subject = subjectById.get(course.subjectId);
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
  };

  // One entitlement fetch covering every referenced node (+ plan), shared by
  // all exams. resolveAccess only matches entitlements that cover a given
  // chain, so a superset yields identical verdicts to per-exam fetches.
  const allRefIds = [
    ...lessonIds,
    ...unitIds,
    ...allCourseIds,
    ...subjectIds,
  ];
  const grants = actor.userId ? await entitlementsFor(db, actor.userId, allRefIds) : [];

  // One attempt aggregate for every exam at once (grouped), not one per exam.
  const attemptByExam = new Map<string, { n: number; live: number }>();
  if (actor.userId) {
    const examIds = rows.map((e) => e.id);
    const attemptRows = await db
      .select({
        examId: examAttempts.examId,
        n: sql<number>`COUNT(*)`,
        live: sql<number>`SUM(CASE WHEN ${examAttempts.status} = 'in_progress' THEN 1 ELSE 0 END)`,
      })
      .from(examAttempts)
      .where(and(inArray(examAttempts.examId, examIds), eq(examAttempts.studentId, actor.userId), ne(examAttempts.status, "cancelled")))
      .groupBy(examAttempts.examId);
    for (const r of attemptRows) attemptByExam.set(r.examId, { n: Number(r.n), live: Number(r.live ?? 0) });
  }

  const out = [];
  for (const exam of rows) {
    // Mirrors examAccess(): resolve the chain (lesson → course → neither) and
    // delegate to the SAME pure resolver, only with pre-fetched inputs.
    let access: AccessVerdict | { allowed: false; reason: "not_found" };
    if (exam.lessonId) {
      const chain = lessonChain(exam.lessonId);
      access = chain
        ? resolveAccess({
            subject: actor,
            resource: {
              accessLevel: chain.accessLevel,
              status: chain.status,
              publishAt: chain.publishAt,
              expiresAt: chain.expiresAt,
              freePreview: chain.freePreview,
            },
            chain: chainRefsOf(chain),
            entitlements: grants,
            now: nowMs,
          })
        : { allowed: false, reason: "not_found" as const };
    } else if (exam.courseId) {
      const chain = courseChain(exam.courseId);
      access = chain
        ? resolveAccess({
            subject: actor,
            resource: {
              accessLevel: chain.accessLevel,
              status: chain.status,
              publishAt: chain.publishAt,
              expiresAt: chain.expiresAt,
              freePreview: chain.freePreview,
            },
            chain: chainRefsOf(chain),
            entitlements: grants,
            now: nowMs,
          })
        : { allowed: false, reason: "not_found" as const };
    } else {
      access = actor.userId
        ? { allowed: true, reason: "authenticated" as const }
        : { allowed: false, reason: "anon" as const };
    }

    if (!access.allowed && actor.roleRank < 3) continue; // never list exams the student cannot access
    const config = parseExamConfig(exam.config);
    const { starts_at: startsAt, ends_at: endsAt } = config.availability;
    let state: "available" | "before_window" | "after_window" = "available";
    if (startsAt !== null && nowMs < startsAt) state = "before_window";
    else if (endsAt !== null && nowMs >= endsAt) state = "after_window";
    const used = attemptByExam.get(exam.id)?.n ?? 0;
    const hasLive = (attemptByExam.get(exam.id)?.live ?? 0) > 0;
    out.push({
      slug: exam.slug,
      titleAr: exam.titleAr,
      titleEn: exam.titleEn,
      durationMinutes: config.duration_minutes,
      attemptsMax: config.attempts.max,
      attemptsUsed: used,
      hasLiveAttempt: hasLive,
      state,
      passPercent: config.scoring.pass_percent,
    });
  }
  return out;
}
