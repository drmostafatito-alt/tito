/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import {
  createCourse, createGrade, createLesson, createLessonItem, createProgram, createSubject, createUnit,
} from "~server/content/service.server";
import { grantEntitlement } from "~server/entitlements/grant.server";
import { updateSettingsGroup } from "~server/settings/service.server";
import {
  AssessmentReferenceError,
  AssessmentValidationError,
  addExamQuestion,
  attemptContext,
  attemptEligibility,
  attemptsForStudent,
  attemptReview,
  attemptSummary,
  createExam,
  createQuestion,
  deleteQuestion,
  duplicateQuestion,
  ensureTag,
  examAccess,
  examQuestionsFull,
  adminAttemptReview,
  essayGradingQueue,
  expireAttemptIfNeeded,
  getAttempt,
  getExamBySlug,
  getOwnedAttempt,
  getQuestionFull,
  gradeEssayAnswer,
  listQuestions,
  listPublishedExamsForActor,
  moveExamQuestion,
  parseExamConfig,
  previewPoolSelection,
  publishExam,
  removeExamQuestion,
  resolveExamQuestionIds,
  resultsVisible,
  saveAnswer,
  setExamQuestionPoints,
  setQuestionStatus,
  startAttempt,
  submitAttempt,
  unpublishExam,
  updateExam,
  updateQuestion,
  validatePoolConfig,
} from "~server/assessment/service.server";
import { courses, events, examAnswers, examAttempts, files, lessonProgress } from "~server/db/schema";
import { loader as introLoader, action as introAction } from "~/routes/student/exams.$slug";
import { loader as attemptLoader } from "~/routes/student/exams.$slug.attempt";
import { action as attemptAction } from "~/routes/api.exam-attempt";
import { loader as resultLoader } from "~/routes/student/results.$attemptId";
import { loader as filesLoader } from "~/routes/files.$id";
import { signFileUrl } from "~server/files/storage.server";

/**
 * Phase 5 assessment engine on REAL D1 + REAL route loaders/actions:
 * question bank CRUD/workflow, exam publish gate, entitlement + window +
 * attempts eligibility, attempt start/resume/isolation, autosave idempotency,
 * server-authoritative timing (expiry auto-submit), idempotent submission with
 * exactly-once events, auto-grading math (incl. multi-select partial credit),
 * results/review policy, answer-key containment and progress integration.
 */

const db = getDb(env);
const actor = { userId: "00000000-0000-4000-8000-000000000005", role: "super_admin" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

let studentA: { id: string; cookie: string };
let studentB: { id: string; cookie: string };
let subjectId: string;
let lessonId: string;
let examSlug: string;
let examId: string;

async function makeStudent(prefix: string) {
  const r = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${r}@test.local`;
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const req = () => new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
  const reg = await registerUser(env, { email, fullName: "Exam Student", password: "Str0ngPass!x" }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed: " + JSON.stringify(loggedIn));
  return { id: reg.userId, cookie: loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

const mcqChoices = (correctIdx = 0) => [
  { contentAr: "أ", contentEn: "A", isCorrect: correctIdx === 0, feedback: null },
  { contentAr: "ب", contentEn: "B", isCorrect: correctIdx === 1, feedback: null },
  { contentAr: "ج", contentEn: "C", isCorrect: correctIdx === 2, feedback: null },
];

async function makeQuestion(type: "mcq" | "true_false" | "multi_select", over: Record<string, unknown> = {}) {
  const choices =
    type === "true_false"
      ? [
          { contentAr: "صواب", contentEn: "True", isCorrect: true, feedback: null },
          { contentAr: "خطأ", contentEn: "False", isCorrect: false, feedback: null },
        ]
      : type === "multi_select"
        ? [
            { contentAr: "أ", contentEn: "A", isCorrect: true, feedback: null },
            { contentAr: "ب", contentEn: "B", isCorrect: true, feedback: null },
            { contentAr: "ج", contentEn: "C", isCorrect: false, feedback: null },
            { contentAr: "د", contentEn: "D", isCorrect: false, feedback: null },
          ]
        : mcqChoices(0);
  return createQuestion(
    db,
    {
      type,
      stemAr: `سؤال ${type}`,
      stemEn: `Question ${type}`,
      difficulty: "medium",
      pointsDefault: type === "multi_select" ? 3 : 2,
      choices,
      tagIds: [],
      ...over,
    },
    actor
  );
}

/** published objective question */
async function makePublished(type: "mcq" | "true_false" | "multi_select", over: Record<string, unknown> = {}) {
  const q = await makeQuestion(type, over);
  await setQuestionStatus(db, q.id, "in_review", actor);
  await setQuestionStatus(db, q.id, "published", actor);
  return q;
}

beforeEach(async () => {
  for (const table of [
    "exam_answers", "exam_attempts", "exam_questions", "exams",
    "question_choices", "question_tags", "questions", "tags",
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "videos", "entitlements", "lesson_progress", "video_progress", "video_watch_sessions", "events",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
  await updateSettingsGroup(db, "video", { replayLimit: 0, completionThresholdPct: 90 }, actor);
  await updateSettingsGroup(db, "assessment", { graceSeconds: 30 }, actor);

  studentA = await makeStudent("exam-a");
  studentB = await makeStudent("exam-b");

  const program = await createProgram(db, { titleAr: "ب", titleEn: "Exam Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Exam Grade", status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Exam Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
  subjectId = subject.id;
  const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Exam Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
  const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "Exam Unit", status: "published", sortOrder: 0 }, actor);
  const lesson = await createLesson(db, { unitId: unit.id, titleAr: "درس", titleEn: "Exam Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  lessonId = lesson.id;

  // exam attached to the lesson + REQUIRED exam lesson item (Phase 5 integration)
  const q1 = await makePublished("mcq");
  const exam = await createExam(db, { titleAr: "امتحان", titleEn: `Exam ${crypto.randomUUID().slice(0, 6)}`, lessonId, courseId: null }, actor);
  examId = exam.id;
  examSlug = exam.slug;
  await addExamQuestion(db, examId, q1.id);
  await publishExam(db, examId);
  await createLessonItem(db, { lessonId, itemType: "exam", videoId: null, fileId: null, examId, sortOrder: 0, required: true }, actor);
});

// request helpers -----------------------------------------------------------
const getUrl = (path: string, cookie?: string) =>
  new Request(`https://app.test${path}`, { headers: cookie ? { cookie, "user-agent": UA } : { "user-agent": UA } });
const postForm = (path: string, body: Record<string, string>, cookie: string) =>
  new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
const callIntroLoader = (req: Request) =>
  introLoader({ context: routeCtx, request: req, params: { slug: examSlug } } as unknown as Parameters<typeof introLoader>[0]);
const callIntroAction = (req: Request) =>
  introAction({ context: routeCtx, request: req, params: { slug: examSlug } } as unknown as Parameters<typeof introAction>[0]);
const callAttemptLoader = (req: Request) =>
  attemptLoader({ context: routeCtx, request: req, params: { slug: examSlug } } as unknown as Parameters<typeof attemptLoader>[0]);
const callAttemptAction = (req: Request) =>
  attemptAction({ context: routeCtx, request: req, params: {} } as unknown as Parameters<typeof attemptAction>[0]);
const callResultLoader = (req: Request, attemptId: string) =>
  resultLoader({ context: routeCtx, request: req, params: { attemptId } } as unknown as Parameters<typeof resultLoader>[0]);

async function catchResponse(p: Promise<unknown>): Promise<Response> {
  // route handlers either THROW a Response (guards) or RETURN one (redirect())
  try {
    const v = await p;
    if (v instanceof Response) return v;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  throw new Error("expected a thrown or returned Response");
}

const studentActor = (s: { id: string }) => ({ userId: s.id, roleRank: 1 });

// ===========================================================================
describe("question bank CRUD + workflow", () => {
  it("creates a draft question with choices; list filters work", async () => {
    const q = await makeQuestion("mcq");
    const full = await getQuestionFull(db, q.id);
    expect(full).not.toBeNull();
    expect(full!.status).toBe("draft");
    expect(full!.choices).toHaveLength(3);
    expect(full!.choices.filter((c) => c.isCorrect)).toHaveLength(1);

    const drafts = await listQuestions(db, { status: "draft" });
    // the beforeEach published q1 + this draft
    expect(drafts.some((r) => r.id === q.id)).toBe(true);
    const search = await listQuestions(db, { q: "Question mcq" });
    expect(search.some((r) => r.id === q.id)).toBe(true);
  });

  it("validates shape: mcq needs exactly one correct; true_false exactly two choices", async () => {
    await expect(
      createQuestion(db, { type: "mcq", stemAr: "س", stemEn: "q", choices: [
        { contentAr: "1", contentEn: "1", isCorrect: true }, { contentAr: "2", contentEn: "2", isCorrect: true },
      ] }, actor)
    ).rejects.toThrow(AssessmentValidationError);
    await expect(
      createQuestion(db, { type: "mcq", stemAr: "س", stemEn: "q", choices: [{ contentAr: "1", contentEn: "1", isCorrect: true }] }, actor)
    ).rejects.toThrow(AssessmentValidationError);
    await expect(
      createQuestion(db, { type: "true_false", stemAr: "س", stemEn: "q", choices: mcqChoices(0) }, actor)
    ).rejects.toThrow(AssessmentValidationError);
  });

  it("accepts admin-editor choice rows with id:null (new choices)", async () => {
    // Regression: the question editor serializes fresh choice rows with
    // id:null — the schema must treat that as "create new" (not a 422).
    const q = await createQuestion(db, {
      type: "mcq",
      stemAr: "سؤال بمعرّف فارغ",
      stemEn: "Null-id choices question",
      choices: [
        { id: null, contentAr: "١", contentEn: "one", isCorrect: true, feedback: null },
        { id: null, contentAr: "٢", contentEn: "two", isCorrect: false, feedback: null },
      ],
    }, actor);
    expect(q.id).toBeTruthy();
  });

  it("enforces type immutability and replaces choices on update", async () => {
    const q = await makeQuestion("mcq");
    await expect(updateQuestion(db, q.id, { type: "essay" }, actor)).rejects.toThrow(AssessmentValidationError);
    await updateQuestion(db, q.id, { stemEn: "updated stem", choices: mcqChoices(2) }, actor);
    const full = await getQuestionFull(db, q.id);
    expect(full!.stemEn).toBe("updated stem");
    expect(full!.choices[2].isCorrect).toBe(true);
    expect(full!.choices[0].isCorrect).toBe(false);
  });

  it("follows the status workflow and rejects illegal transitions", async () => {
    const q = await makeQuestion("mcq");
    await expect(setQuestionStatus(db, q.id, "published", actor)).rejects.toThrow(AssessmentValidationError);
    await setQuestionStatus(db, q.id, "in_review", actor);
    await setQuestionStatus(db, q.id, "published", actor);
    await expect(setQuestionStatus(db, q.id, "in_review", actor)).rejects.toThrow(AssessmentValidationError);
    await setQuestionStatus(db, q.id, "archived", actor);
    await setQuestionStatus(db, q.id, "draft", actor);
    expect((await getQuestionFull(db, q.id))!.status).toBe("draft");
  });

  it("duplicates to a fresh draft and soft-deletes only when unattached", async () => {
    const q = await makeQuestion("mcq");
    const dup = await duplicateQuestion(db, q.id, actor);
    expect(dup.id).not.toBe(q.id);
    expect((await getQuestionFull(db, dup.id))!.status).toBe("draft");

    // attached question → delete refused (non-destructive)
    await setQuestionStatus(db, q.id, "in_review", actor);
    await setQuestionStatus(db, q.id, "published", actor);
    const exam = await createExam(db, { titleAr: "فحص", titleEn: "Del Exam" }, actor);
    await addExamQuestion(db, exam.id, q.id);
    await expect(deleteQuestion(db, q.id)).rejects.toThrow(AssessmentReferenceError);

    await removeExamQuestion(db, exam.id, q.id);
    await deleteQuestion(db, q.id);
    expect(await getQuestionFull(db, q.id)).toBeNull();
    const list = await listQuestions(db, {});
    expect(list.some((r) => r.id === q.id)).toBe(false);
  });

  it("supports tags (ensure + attach + filter)", async () => {
    const tag = await ensureTag(db, { labelAr: "وحدة أولى", labelEn: "unit one" });
    const again = await ensureTag(db, { labelAr: "وحدة أولى", labelEn: "unit one" });
    expect(again.id).toBe(tag.id);
    const q = await makeQuestion("mcq", { tagIds: [tag.id] });
    const list = await listQuestions(db, { tagId: tag.id });
    expect(list.some((r) => r.id === q.id)).toBe(true);
  });
});

// ===========================================================================
describe("exam build + publish gate", () => {
  it("publish fails closed without an attached published objective question", async () => {
    const exam = await createExam(db, { titleAr: "بوابة", titleEn: "Gate Exam" }, actor);
    await expect(publishExam(db, exam.id)).rejects.toThrow(AssessmentValidationError);

    // draft questions cannot even be attached
    const draftQ = await makeQuestion("mcq");
    await expect(addExamQuestion(db, exam.id, draftQ.id)).rejects.toThrow(AssessmentValidationError);

    await setQuestionStatus(db, draftQ.id, "in_review", actor);
    await setQuestionStatus(db, draftQ.id, "published", actor);
    await addExamQuestion(db, exam.id, draftQ.id);
    await publishExam(db, exam.id);
    expect((await getExamBySlug(db, exam.slug))!.status).toBe("published");
  });

  it("question-set mutations are draft-only; publish/unpublish round-trips", async () => {
    const q2 = await makePublished("mcq");
    await expect(addExamQuestion(db, examId, q2.id)).rejects.toThrow(AssessmentValidationError); // published exam
    await unpublishExam(db, examId);
    await addExamQuestion(db, examId, q2.id);
    await setExamQuestionPoints(db, examId, q2.id, 5);
    await moveExamQuestion(db, examId, q2.id, "up");
    const exam = (await getExamBySlug(db, examSlug))!;
    expect(exam.status).toBe("draft");
    await publishExam(db, examId);
    await expect(removeExamQuestion(db, examId, q2.id)).rejects.toThrow(AssessmentValidationError);
  });

  it("merges partial config updates without dropping sibling keys", async () => {
    await updateExam(db, examId, { config: { duration_minutes: 45, scoring: { pass_percent: 70 } } });
    const cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    expect(cfg.duration_minutes).toBe(45);
    expect(cfg.scoring.pass_percent).toBe(70);
    expect(cfg.scoring.partial_credit_multiselect).toBe(true);
    expect(cfg.attempts.max).toBe(1);
  });

  it("pool mode resolves tagged published questions at publish + start", async () => {
    const tag = await ensureTag(db, { labelAr: "تجمع", labelEn: "pool-tag" });
    const p1 = await makePublished("mcq", { tagIds: [tag.id] });
    const p2 = await makePublished("true_false", { tagIds: [tag.id] });
    await makePublished("mcq"); // untagged → must NOT be selected
    const exam = await createExam(db, { titleAr: "تجمعي", titleEn: "Pool Exam" }, actor);
    await updateExam(db, exam.id, {
      config: { selection: { mode: "pool", pools: [{ filters: { tags: [tag.id] }, count: 2 }] } },
    });
    await publishExam(db, exam.id);
    const res = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const order = (res.attempt.metadata as { questionOrder: string[] }).questionOrder;
    expect(order).toHaveLength(2);
    expect(order.sort()).toEqual([p1.id, p2.id].sort());
  });
});

// ===========================================================================
describe("access, entitlement, eligibility", () => {
  it("examAccess: anon denied, non-entitled denied, entitled allowed", async () => {
    const exam = (await getExamBySlug(db, examSlug))!;
    expect((await examAccess(db, { userId: null, roleRank: 0 }, exam)).allowed).toBe(false);
    expect((await examAccess(db, studentActor(studentA), exam)).allowed).toBe(false);
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    expect((await examAccess(db, studentActor(studentA), exam)).allowed).toBe(true);
    expect((await examAccess(db, studentActor(studentB), exam)).allowed).toBe(false);
  });

  it("listPublishedExamsForActor batches chains/entitlements/attempts without changing verdicts (W9)", async () => {
    // exam (from beforeEach) is lesson-scoped and entitled.
    const course = (await db.select().from(courses).limit(1))[0];
    const courseExam = await createExam(db, { titleAr: "كورس", titleEn: "Course Exam", lessonId: null, courseId: course.id }, actor);
    await addExamQuestion(db, courseExam.id, (await makePublished("mcq")).id);
    await publishExam(db, courseExam.id);
    const openExam = await createExam(db, { titleAr: "عام", titleEn: "Open Exam", lessonId: null, courseId: null }, actor);
    await addExamQuestion(db, openExam.id, (await makePublished("mcq")).id);
    await publishExam(db, openExam.id);

    // No entitlements yet: studentB (rank 1) sees only the open/authenticated exam.
    const anon = await listPublishedExamsForActor(db, { userId: null, roleRank: 0 }, Date.now());
    expect(anon.map((e) => e.titleEn)).toEqual([]); // all three need auth or entitlement

    const b = await listPublishedExamsForActor(db, studentActor(studentB), Date.now());
    expect(b.map((e) => e.titleEn)).toEqual(["Open Exam"]);

    // Grant subject entitlement to studentA → lesson + course exams become visible.
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    const lessonExamTitle = (await getExamBySlug(db, examSlug))!.titleEn;
    const a = await listPublishedExamsForActor(db, studentActor(studentA), Date.now());
    expect(a.map((e) => e.titleEn).sort()).toEqual(["Course Exam", "Open Exam", lessonExamTitle].sort());

    // Attempt counting is per exam and includes a live in-progress attempt.
    const started = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    expect(started.ok).toBe(true);
    const a2 = await listPublishedExamsForActor(db, studentActor(studentA), Date.now());
    const lessonEntry = a2.find((e) => e.hasLiveAttempt);
    expect(lessonEntry).toBeDefined();
    expect(lessonEntry!.attemptsUsed).toBe(1);
    const courseEntry = a2.find((e) => e.titleEn === "Course Exam");
    expect(courseEntry!.attemptsUsed).toBe(0);
    expect(courseEntry!.hasLiveAttempt).toBe(false);
  });

  it("intro route: anon → login redirect; non-entitled → 403; unpublished → 404", async () => {
    const anon = await catchResponse(callIntroLoader(getUrl(`/exams/${examSlug}`)));
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toContain("/login");

    const denied = await catchResponse(callIntroLoader(getUrl(`/exams/${examSlug}`, studentA.cookie)));
    expect(denied.status).toBe(403);

    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    await unpublishExam(db, examId);
    const hidden = await catchResponse(callIntroLoader(getUrl(`/exams/${examSlug}`, studentA.cookie)));
    expect(hidden.status).toBe(404);
    await publishExam(db, examId);

    const ok = await callIntroLoader(getUrl(`/exams/${examSlug}`, studentA.cookie));
    expect((ok as { exam: { slug: string } }).exam.slug).toBe(examSlug);
  });

  it("start action: non-entitled student cannot start (no attempt row)", async () => {
    const denied = await catchResponse(
      callIntroAction(postForm(`/exams/${examSlug}`, { _action: "start" }, studentB.cookie))
    );
    expect(denied.status).toBe(403);
    expect(await db.select().from(examAttempts)).toHaveLength(0);
  });

  it("windows + attempt caps are enforced server-side", async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    const nowMs = Date.now();

    await updateExam(db, examId, { config: { availability: { starts_at: nowMs + 60_000, ends_at: null } } });
    let el = await attemptEligibility(db, { exam: (await getExamBySlug(db, examSlug))!, actor: studentActor(studentA), nowMs });
    expect(el).toMatchObject({ ok: false, reason: "before_window" });

    await updateExam(db, examId, { config: { availability: { starts_at: null, ends_at: nowMs - 1000 } } });
    const exam2 = (await getExamBySlug(db, examSlug))!;
    el = await attemptEligibility(db, { exam: exam2, actor: studentActor(studentA), nowMs });
    expect(el).toMatchObject({ ok: false, reason: "after_window" });

    await updateExam(db, examId, { config: { availability: { starts_at: null, ends_at: null }, attempts: { max: 1 } } });
    const started = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs });
    expect(started.ok).toBe(true);
    await submitAttempt(db, { attempt: (started as { attempt: typeof examAttempts.$inferSelect }).attempt, graceSeconds: 30, nowMs, videoThresholdPct: 90 });
    el = await attemptEligibility(db, { exam: (await getExamBySlug(db, examSlug))!, actor: studentActor(studentA), nowMs });
    expect(el).toMatchObject({ ok: false, reason: "attempts_exhausted" });

    // cooldown blocks the next attempt while it is running
    await updateExam(db, examId, { config: { attempts: { max: 5, cooldown_minutes: 10 } } });
    el = await attemptEligibility(db, { exam: (await getExamBySlug(db, examSlug))!, actor: studentActor(studentA), nowMs });
    expect(el.ok).toBe(false);
    if (!el.ok) {
      expect(el.reason).toBe("cooldown");
      expect(el.retryAt).toBeGreaterThan(nowMs);
    }
  });
});

// ===========================================================================
describe("attempt lifecycle: start, resume, isolation", () => {
  beforeEach(async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
  });

  it("start materializes frozen order/points + deadline; duplicate start resumes", async () => {
    const nowMs = Date.now();
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const attempt = res.attempt;
    expect(attempt.status).toBe("in_progress");
    expect(attempt.attemptNumber).toBe(1);
    expect(attempt.deadlineAt).toBe(nowMs + 30 * 60_000); // default duration 30
    const md = attempt.metadata as { questionOrder: string[]; points: Record<string, number> };
    expect(md.questionOrder.length).toBeGreaterThan(0);
    expect(Object.values(md.points).every((p) => p > 0)).toBe(true);

    // duplicate start → SAME attempt, still one row
    const again = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: nowMs + 5000 });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.attempt.id).toBe(attempt.id);
    expect(await db.select().from(examAttempts)).toHaveLength(1);

    // exam_start emitted exactly once
    const starts = await db.select().from(events).where(eq(events.type, "exam_start"));
    expect(starts).toHaveLength(1);
  });

  it("live context is sanitized — no answer key, no explanations", async () => {
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    if (!res.ok) throw new Error("start failed");
    const cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    const ctx = await attemptContext(db, { attempt: res.attempt, config: cfg, nowMs: Date.now() });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("isCorrect");
    expect(json).not.toContain("explanation");
    expect(json).not.toContain("feedback");
    // every choice object exposes ONLY id + content (no key material)
    for (const q of ctx.questions) {
      for (const c of q.choices) {
        expect(Object.keys(c).sort()).toEqual(["contentAr", "contentEn", "id"]);
      }
    }
  });

  it("attempt route: no live attempt → redirect to intro; live → questions + answers", async () => {
    const noAttempt = await catchResponse(callAttemptLoader(getUrl(`/exams/${examSlug}/attempt`, studentA.cookie)));
    expect(noAttempt.status).toBe(302);
    expect(noAttempt.headers.get("location")).toBe(`/exams/${examSlug}`);

    const started = await callIntroAction(postForm(`/exams/${examSlug}`, { _action: "start" }, studentA.cookie));
    expect((started as Response).status).toBe(302);

    const data = (await callAttemptLoader(getUrl(`/exams/${examSlug}/attempt`, studentA.cookie))) as {
      attemptId: string; questions: Array<{ id: string }>; answers: Record<string, string[]>; remainingSeconds: number | null;
    };
    expect(data.questions.length).toBeGreaterThan(0);
    expect(data.remainingSeconds).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain("isCorrect");

    // student B (non-entitled) → 403 on the attempt route too
    const denied = await catchResponse(callAttemptLoader(getUrl(`/exams/${examSlug}/attempt`, studentB.cookie)));
    expect(denied.status).toBe(403);
  });

  it("IDOR: student B cannot read or act on student A's attempt", async () => {
    await grantEntitlement(db, { studentId: studentB.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    if (!res.ok) throw new Error("start failed");
    expect(await getOwnedAttempt(db, res.attempt.id, studentB.id)).toBeNull();

    const bResult = await catchResponse(callResultLoader(getUrl(`/results/${res.attempt.id}`, studentB.cookie), res.attempt.id));
    expect(bResult.status).toBe(404);

    const bSave = await callAttemptAction(
      postForm(`/api/exam-attempt`, { _action: "save", attemptId: res.attempt.id, questionId: "x", choiceIds: "" }, studentB.cookie)
    );
    expect((bSave as Response).status).toBe(404);

    const randomId = await catchResponse(callResultLoader(getUrl(`/results/${crypto.randomUUID()}`, studentA.cookie), crypto.randomUUID()));
    expect(randomId.status).toBe(404);
  });
});

// ===========================================================================
describe("autosave, refresh-resume, submission", () => {
  beforeEach(async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
  });

  it("save upserts one row per question and bumps version; invalid input rejected", async () => {
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    if (!res.ok) throw new Error("start failed");
    const attempt = res.attempt;
    const cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    const ctx = await attemptContext(db, { attempt, config: cfg, nowMs: Date.now() });
    const q = ctx.questions[0];
    const full = await getQuestionFull(db, q.id);
    const wrongId = full!.choices.find((c) => !c.isCorrect)!.id;
    const rightId = full!.choices.find((c) => c.isCorrect)!.id;

    const s1 = await saveAnswer(db, { attempt, questionId: q.id, choiceIds: [wrongId], nowMs: Date.now() });
    expect(s1).toMatchObject({ ok: true, version: 1 });
    const s2 = await saveAnswer(db, { attempt, questionId: q.id, choiceIds: [rightId], nowMs: Date.now() });
    expect(s2).toMatchObject({ ok: true, version: 2 });
    const rows = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id));
    expect(rows).toHaveLength(1); // retry/change never duplicates
    expect(rows[0].choiceIds).toEqual([rightId]);

    expect(await saveAnswer(db, { attempt, questionId: crypto.randomUUID(), choiceIds: [], nowMs: Date.now() })).toMatchObject({ ok: false, error: "unknown_question" });
    expect(await saveAnswer(db, { attempt, questionId: q.id, choiceIds: [crypto.randomUUID()], nowMs: Date.now() })).toMatchObject({ ok: false, error: "invalid_choice" });
    const otherQ = full!.choices.map((c) => c.id);
    expect(await saveAnswer(db, { attempt, questionId: q.id, choiceIds: otherQ.slice(0, 2), nowMs: Date.now() })).toMatchObject({ ok: false, error: "too_many" });
  });

  it("route autosave persists across 'refresh' (loader returns saved answers)", async () => {
    await callIntroAction(postForm(`/exams/${examSlug}`, { _action: "start" }, studentA.cookie));
    const data = (await callAttemptLoader(getUrl(`/exams/${examSlug}/attempt`, studentA.cookie))) as {
      attemptId: string; questions: Array<{ id: string; choices: Array<{ id: string }> }>;
    };
    const q = data.questions[0];
    const choiceId = q.choices[0].id;

    const saveRes = await callAttemptAction(
      postForm(`/api/exam-attempt`, { _action: "save", attemptId: data.attemptId, questionId: q.id, choiceIds: choiceId }, studentA.cookie)
    );
    expect(await (saveRes as Response).json()).toMatchObject({ ok: true, version: 1 });

    // duplicate save (retry) → version 2, still ONE row
    const save2 = await callAttemptAction(
      postForm(`/api/exam-attempt`, { _action: "save", attemptId: data.attemptId, questionId: q.id, choiceIds: choiceId }, studentA.cookie)
    );
    expect(await (save2 as Response).json()).toMatchObject({ ok: true, version: 2 });

    // "refresh": loader restores server-side state
    const after = (await callAttemptLoader(getUrl(`/exams/${examSlug}/attempt`, studentA.cookie))) as { answers: Record<string, string[]> };
    expect(after.answers[q.id]).toEqual([choiceId]);
  });

  it("submit grades, is idempotent, locks the attempt and emits exam_submit once", async () => {
    const started = await callIntroAction(postForm(`/exams/${examSlug}`, { _action: "start" }, studentA.cookie));
    expect((started as Response).status).toBe(302);
    const data = (await callAttemptLoader(getUrl(`/exams/${examSlug}/attempt`, studentA.cookie))) as { attemptId: string };

    const submit1 = await callAttemptAction(postForm(`/api/exam-attempt`, { _action: "submit", attemptId: data.attemptId }, studentA.cookie));
    const j1 = (await (submit1 as Response).json()) as { ok: boolean; redirect: string };
    expect(j1.ok).toBe(true);
    expect(j1.redirect).toBe(`/results/${data.attemptId}`);

    // double submit (retry / double click) → same result, no re-grade, no dup events
    const submit2 = await callAttemptAction(postForm(`/api/exam-attempt`, { _action: "submit", attemptId: data.attemptId }, studentA.cookie));
    const j2 = (await (submit2 as Response).json()) as { ok: boolean };
    expect(j2.ok).toBe(true);
    const submits = await db.select().from(events).where(eq(events.type, "exam_submit"));
    expect(submits).toHaveLength(1);

    // attempt locked: further saves rejected
    const row = (await getOwnedAttempt(db, data.attemptId, studentA.id))!;
    expect(row.status).toBe("graded");
    expect(await saveAnswer(db, { attempt: row, questionId: "whatever", choiceIds: [], nowMs: Date.now() })).toMatchObject({ ok: false, error: "closed" });

    // attempt page after submit → redirect back to intro (no reuse)
    const noLive = await catchResponse(callAttemptLoader(getUrl(`/exams/${examSlug}/attempt`, studentA.cookie)));
    expect(noLive.status).toBe(302);
  });

  it("max attempts: exhausted → start denied; raised cap → attempt 2 with a new id", async () => {
    await updateExam(db, examId, { config: { attempts: { max: 1 } } });
    const nowMs = Date.now();
    const a1 = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs });
    if (!a1.ok) throw new Error("start failed");
    await submitAttempt(db, { attempt: a1.attempt, graceSeconds: 30, nowMs, videoThresholdPct: 90 });

    const denied = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs });
    expect(denied).toMatchObject({ ok: false, reason: "attempts_exhausted" });

    // route-level start also denied (intro action surfaces the reason)
    const res = await callIntroAction(postForm(`/exams/${examSlug}`, { _action: "start" }, studentA.cookie));
    expect(res).toMatchObject({ startError: "attempts_exhausted" });

    await updateExam(db, examId, { config: { attempts: { max: 2 } } });
    const a2 = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs });
    expect(a2.ok).toBe(true);
    if (a2.ok) {
      expect(a2.attempt.id).not.toBe(a1.attempt.id);
      expect(a2.attempt.attemptNumber).toBe(2);
    }
    const all = await attemptsForStudent(db, studentA.id, examId);
    expect(all).toHaveLength(2);
  });
});

// ===========================================================================
describe("server-authoritative timing", () => {
  beforeEach(async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
  });

  it("deadline = server startedAt + duration; submit inside window grades normally", async () => {
    await updateExam(db, examId, { config: { duration_minutes: 1 } });
    const t0 = Date.now();
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: t0 });
    if (!res.ok) throw new Error("start failed");
    expect(res.attempt.deadlineAt).toBe(t0 + 60_000);

    const cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    const ctx = await attemptContext(db, { attempt: res.attempt, config: cfg, nowMs: t0 + 30_000 });
    expect(ctx.remainingSeconds).toBe(30);
    expect(ctx.expired).toBe(false);

    const out = await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs: t0 + 30_000, videoThresholdPct: 90 });
    expect(out.status).toBe("graded");
    expect(out.expired).toBe(false);
    const row = (await getOwnedAttempt(db, res.attempt.id, studentA.id))!;
    expect(row.timeUsedSeconds).toBe(30);
  });

  it("expiry auto-submits answered-so-far (expireAttemptIfNeeded sweep)", async () => {
    await updateExam(db, examId, { config: { duration_minutes: 1 } });
    const t0 = Date.now() - 5 * 60_000; // started 5 min ago → long past deadline+grace
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: t0 });
    if (!res.ok) throw new Error("start failed");

    // one correct answer saved before the connection 'dropped'
    const qid = (res.attempt.metadata as { questionOrder: string[] }).questionOrder[0];
    const full = await getQuestionFull(db, qid);
    const rightId = full!.choices.find((c) => c.isCorrect)!.id;
    await saveAnswer(db, { attempt: res.attempt, questionId: qid, choiceIds: [rightId], nowMs: t0 + 1000 });

    const swept = await expireAttemptIfNeeded(db, {
      examId, studentId: studentA.id, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90,
    });
    expect(swept).not.toBeNull();
    expect(swept!.expired).toBe(true);
    expect(swept!.passed).toBe(true); // the single answered question was correct → 100%
    const row = (await getOwnedAttempt(db, res.attempt.id, studentA.id))!;
    expect(row.status).toBe("graded");

    // sweep is idempotent — a second touch returns null (nothing live left)
    expect(await expireAttemptIfNeeded(db, { examId, studentId: studentA.id, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 })).toBeNull();
    const submits = await db.select().from(events).where(eq(events.type, "exam_submit"));
    expect(submits).toHaveLength(1);
  });

  it("attempt route touch-sweeps an expired live attempt → redirect with expired flag", async () => {
    await updateExam(db, examId, { config: { duration_minutes: 1 } });
    await updateSettingsGroup(db, "assessment", { graceSeconds: 0 }, actor);
    const t0 = Date.now() - 5 * 60_000;
    await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: t0 });

    const res = await catchResponse(callAttemptLoader(getUrl(`/exams/${examSlug}/attempt`, studentA.cookie)));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/exams/${examSlug}?expired=1`);

    const row = (await attemptsForStudent(db, studentA.id, examId))[0];
    expect(row.status).toBe("graded");
    await updateSettingsGroup(db, "assessment", { graceSeconds: 30 }, actor);
  });

  it("late submit beyond grace still closes the attempt (auto-submit), client clock is never read", async () => {
    await updateExam(db, examId, { config: { duration_minutes: 1 } });
    const t0 = Date.now();
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: t0 });
    if (!res.ok) throw new Error("start failed");
    const late = await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs: t0 + 61_000 + 31_000, videoThresholdPct: 90 });
    expect(late.status).toBe("graded");
    expect(late.expired).toBe(true);
    const row = (await getOwnedAttempt(db, res.attempt.id, studentA.id))!;
    // time used is clamped at deadline+grace — never the manipulated client value
    expect(row.timeUsedSeconds).toBe(60 + 30);
  });
});

// ===========================================================================
describe("auto-grading math", () => {
  beforeEach(async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    await updateExam(db, examId, { config: { attempts: { max: null }, scoring: { pass_percent: 50 } } });
  });

  /** rebuild the seeded exam's question set (draft-only mutations) + config */
  async function rebuildExam(questionIds: Array<{ id: string; points?: number | null }>, configOver: Record<string, unknown> = {}) {
    await unpublishExam(db, examId);
    for (const row of await examQuestionsFull(db, examId)) {
      await removeExamQuestion(db, examId, row.questionId);
    }
    for (const q of questionIds) {
      await addExamQuestion(db, examId, q.id, q.points ?? null);
    }
    if (Object.keys(configOver).length) await updateExam(db, examId, { config: configOver });
    await publishExam(db, examId);
  }

  /** run one full attempt; picks index into getQuestionFull(...).choices order */
  async function runAttempt(picks: Array<number[] | null>, config?: { nowMs?: number }) {
    const nowMs = config?.nowMs ?? Date.now();
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs });
    if (!res.ok) throw new Error("start failed: " + JSON.stringify(res));
    const order = (res.attempt.metadata as { questionOrder: string[] }).questionOrder;
    for (let i = 0; i < picks.length; i++) {
      const full = await getQuestionFull(db, order[i]);
      const choiceIds = (picks[i] ?? []).map((ci) => full!.choices[ci].id);
      await saveAnswer(db, { attempt: res.attempt, questionId: order[i], choiceIds, nowMs });
    }
    const out = await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs, videoThresholdPct: 90 });
    return { out, attempt: res.attempt };
  }

  it("all correct → full score, 100%, passed", async () => {
    const tf = await makePublished("true_false", { pointsDefault: 3 });
    const mcq = await makePublished("mcq", { pointsDefault: 2 });
    await rebuildExam([{ id: mcq.id }, { id: tf.id }]);
    const { out } = await runAttempt([[0], [0]]); // mcq correct = choice 0; tf correct = "صواب" (0)
    expect(out).toMatchObject({ status: "graded", score: 5, maxScore: 5, percentage: 100, passed: true });
  });

  it("all wrong / unanswered → zero, failed", async () => {
    const mcq = await makePublished("mcq", { pointsDefault: 2 });
    await rebuildExam([{ id: mcq.id }]);
    const wrong = await runAttempt([[1]]);
    expect(wrong.out).toMatchObject({ score: 0, maxScore: 2, percentage: 0, passed: false });
    const none = await runAttempt([[]]);
    expect(none.out).toMatchObject({ score: 0, percentage: 0, passed: false });
  });

  it("multi_select partial credit = points × max(0, hits−misses)/totalCorrect", async () => {
    const ms = await makePublished("multi_select", { pointsDefault: 3 }); // correct = choices 0 and 1
    await rebuildExam([{ id: ms.id }]);

    const half = await runAttempt([[0]]); // 1 hit, 0 misses → 3 × 1/2
    expect(half.out.score).toBe(1.5);
    expect(half.out.percentage).toBe(50);
    expect(half.out.passed).toBe(true); // boundary: exactly pass_percent passes

    const netZero = await runAttempt([[0, 2]]); // 1 hit, 1 miss → 0
    expect(netZero.out.score).toBe(0);

    const fullSel = await runAttempt([[0, 1]]); // exact → full points, counted correct
    expect(fullSel.out).toMatchObject({ score: 3, percentage: 100, passed: true });
  });

  it("partial_credit_multiselect=false → all-or-nothing", async () => {
    const ms = await makePublished("multi_select", { pointsDefault: 3 });
    await rebuildExam([{ id: ms.id }], { scoring: { pass_percent: 50, partial_credit_multiselect: false } });
    const partialPick = await runAttempt([[0]]);
    expect(partialPick.out.score).toBe(0);
    const exact = await runAttempt([[0, 1]]);
    expect(exact.out.score).toBe(3);
  });

  it("per-exam points overrides drive maxScore; grading uses frozen points", async () => {
    const mcq = await makePublished("mcq", { pointsDefault: 2 });
    await rebuildExam([{ id: mcq.id, points: 10 }]);
    const { out, attempt } = await runAttempt([[0]]);
    expect(out).toMatchObject({ score: 10, maxScore: 10 });
    // bank edit mid-flight does not change the frozen attempt points
    await updateQuestion(db, mcq.id, { pointsDefault: 99 }, actor);
    const row = (await getOwnedAttempt(db, attempt.id, studentA.id))!;
    expect(row.maxScore).toBe(10);
  });
});

// ===========================================================================
describe("results policy + review gating", () => {
  beforeEach(async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
  });

  async function gradedAttempt() {
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    if (!res.ok) throw new Error("start failed");
    const qid = (res.attempt.metadata as { questionOrder: string[] }).questionOrder[0];
    const full = await getQuestionFull(db, qid);
    await saveAnswer(db, { attempt: res.attempt, questionId: qid, choiceIds: [full!.choices.find((c) => c.isCorrect)!.id], nowMs: Date.now() });
    const out = await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    const row = (await getOwnedAttempt(db, res.attempt.id, studentA.id))!;
    return { result: out, attempt: row, qid };
  }

  it("show=immediate → summary visible with score + correctCount only", async () => {
    const { attempt } = await gradedAttempt();
    const cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    expect(resultsVisible(cfg, attempt, Date.now())).toBe(true);
    const summary = await attemptSummary(db, attempt, cfg, Date.now());
    expect(summary).toMatchObject({ visible: true, score: 2, maxScore: 2, percentage: 100, passed: true, correctCount: 1 });
    // the summary never carries the answer key
    expect(JSON.stringify(summary)).not.toContain("isCorrect");
  });

  it("show=manual hides score everywhere until the policy changes", async () => {
    const { attempt } = await gradedAttempt();
    await updateExam(db, examId, { config: { results: { show: "manual" } } });
    let cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    expect(resultsVisible(cfg, attempt, Date.now())).toBe(false);
    let summary = await attemptSummary(db, attempt, cfg, Date.now());
    expect(summary!.visible).toBe(false);
    expect(summary!.score).toBeNull();
    expect(summary!.passed).toBeNull();

    const page = (await callResultLoader(getUrl(`/results/${attempt.id}`, studentA.cookie), attempt.id)) as {
      summary: { visible: boolean; score: number | null }; review: unknown;
    };
    expect(page.summary.visible).toBe(false);
    expect(page.summary.score).toBeNull();
    expect(page.review).toBeNull();
    expect(JSON.stringify(page)).not.toContain('"passed":true');

    // admin flips the policy → visible
    await updateExam(db, examId, { config: { results: { show: "immediate" } } });
    cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    expect(resultsVisible(cfg, attempt, Date.now())).toBe(true);
    summary = await attemptSummary(db, attempt, cfg, Date.now());
    expect(summary!.score).toBe(2);
  });

  it("show=after_end follows the availability window", async () => {
    const { attempt } = await gradedAttempt();
    const nowMs = Date.now();
    await updateExam(db, examId, { config: { results: { show: "after_end" }, availability: { starts_at: null, ends_at: nowMs + 60_000 } } });
    let cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    expect(resultsVisible(cfg, attempt, nowMs)).toBe(false);
    expect(resultsVisible(cfg, attempt, nowMs + 61_000)).toBe(true);
  });

  it("review payload is gated by review_mode / show_answers / show_explanations", async () => {
    const { attempt, qid } = await gradedAttempt();
    await updateQuestion(db, qid, { explanationEn: "because physics" }, actor);

    await updateExam(db, examId, { config: { results: { review_mode: true, show_answers: true, show_explanations: true } } });
    let cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    let review = await attemptReview(db, { attempt, config: cfg });
    expect(review).not.toBeNull();
    const q = review!.questions[0];
    expect(q.choices.some((c) => c.correct === true)).toBe(true);
    expect(q.explanationEn).toBe("because physics");
    expect(q.earned).toBe(2);

    await updateExam(db, examId, { config: { results: { review_mode: true, show_answers: false, show_explanations: true } } });
    cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    expect(await attemptReview(db, { attempt, config: cfg })).toBeNull();

    await updateExam(db, examId, { config: { results: { review_mode: false, show_answers: true, show_explanations: true } } });
    cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    expect(await attemptReview(db, { attempt, config: cfg })).toBeNull();

    await updateExam(db, examId, { config: { results: { review_mode: true, show_answers: true, show_explanations: false } } });
    cfg = parseExamConfig((await getExamBySlug(db, examSlug))!.config);
    review = await attemptReview(db, { attempt, config: cfg });
    expect(review!.questions[0].explanationEn).toBeNull();
  });

  it("in-progress attempt result page shows no score and links resume", async () => {
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    if (!res.ok) throw new Error("start failed");
    const page = (await callResultLoader(getUrl(`/results/${res.attempt.id}`, studentA.cookie), res.attempt.id)) as {
      summary: { visible: boolean; score: number | null }; attemptInProgress: boolean;
    };
    expect(page.attemptInProgress).toBe(true);
    expect(page.summary.visible).toBe(false);
    expect(page.summary.score).toBeNull();
  });
});

// ===========================================================================
describe("progress + events integration (ADR-021/022)", () => {
  beforeEach(async () => {
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
  });

  it("opening/starting an exam does NOT complete the lesson; graded submission does", async () => {
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    if (!res.ok) throw new Error("start failed");
    let lp = await db.select().from(lessonProgress).where(eq(lessonProgress.studentId, studentA.id));
    expect(lp.some((r) => r.lessonId === lessonId && r.status === "completed")).toBe(false);

    await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    lp = await db.select().from(lessonProgress).where(eq(lessonProgress.studentId, studentA.id));
    expect(lp.some((r) => r.lessonId === lessonId && r.status === "completed")).toBe(true);
  });

  it("exam_start + exam_submit are emitted exactly once across retries", async () => {
    const res = await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    if (!res.ok) throw new Error("start failed");
    // duplicate starts
    await startAttempt(db, { examId, actor: studentActor(studentA), nowMs: Date.now() });
    // duplicate submits
    await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    const stale = (await getOwnedAttempt(db, res.attempt.id, studentA.id))!;
    await submitAttempt(db, { attempt: stale, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    await expireAttemptIfNeeded(db, { examId, studentId: studentA.id, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });

    const starts = await db.select().from(events).where(eq(events.type, "exam_start"));
    const submits = await db.select().from(events).where(eq(events.type, "exam_submit"));
    expect(starts).toHaveLength(1);
    expect(submits).toHaveLength(1);
    // video/progress event pipeline untouched
    const others = await db.select().from(events).where(eq(events.type, "lesson_complete"));
    expect(others.length).toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
describe("essay (written-response) grading", () => {
  async function makePublishedEssay(over: Record<string, unknown> = {}) {
    const q = await createQuestion(
      db,
      {
        type: "essay",
        stemAr: "سؤال مقالي",
        stemEn: "Essay prompt",
        modelAnswerAr: "إجابة نموذجية عربية",
        modelAnswerEn: "Model answer EN",
        pointsDefault: 5,
        choices: [],
        ...over,
      },
      actor
    );
    await setQuestionStatus(db, q.id, "in_review", actor);
    await setQuestionStatus(db, q.id, "published", actor);
    return q;
  }

  it("stores model answers (grader-only) on the question record", async () => {
    const q = await makePublishedEssay();
    const full = await getQuestionFull(db, q.id);
    expect(full?.type).toBe("essay");
    expect(full?.modelAnswerAr).toBe("إجابة نموذجية عربية");
    expect(full?.modelAnswerEn).toBe("Model answer EN");
  });

  it("an essay submission stays needs_manual until graded; grade finalizes the attempt", async () => {
    const essay = await makePublishedEssay();
    const exam = await createExam(db, { titleAr: "مقالي", titleEn: "Essay Exam" }, actor);
    await addExamQuestion(db, exam.id, essay.id); // essay attach now allowed
    await publishExam(db, exam.id);

    const res = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // student types a written answer (textAnswer path — no fabricated correctness)
    const save = await saveAnswer(db, { attempt: res.attempt, questionId: essay.id, choiceIds: [], text: "إجابة الطالب الكتابية", nowMs: Date.now() });
    expect(save.ok).toBe(true);

    const submitted = await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    expect(submitted.pendingGrading).toBe(true);
    expect(submitted.status).toBe("submitted");

    const after = (await getAttempt(db, res.attempt.id))!;
    expect(after.status).toBe("submitted");
    expect(after.gradingStatus).toBe("needs_manual");
    expect(after.score).toBeNull();
    expect(after.maxScore).toBe(5);

    // queue surfaces the pending written answer with the student's text
    const pending = await essayGradingQueue(db, { status: "pending" });
    const item = pending.find((i) => i.attemptId === res.attempt.id);
    expect(item).toBeTruthy();
    expect(item?.textAnswer).toBe("إجابة الطالب الكتابية");
    expect(item?.modelAnswerAr).toBe("إجابة نموذجية عربية");

    // grade 4/5 → attempt is finalized and graded
    const g = await gradeEssayAnswer(db, { attemptId: res.attempt.id, questionId: essay.id, points: 4, feedback: "أحسنت", grader: { userId: actor.userId, role: actor.role } });
    expect(g.finalized).toBe(true);
    const graded = (await getAttempt(db, res.attempt.id))!;
    expect(graded.status).toBe("graded");
    expect(graded.gradingStatus).toBe("complete");
    expect(graded.score).toBe(4);
    expect(graded.passed).toBe(true); // 4/5 = 80% ≥ 50%

    // queue is now empty (fully graded)
    const afterGrade = await essayGradingQueue(db, { status: "pending" });
    expect(afterGrade.some((i) => i.attemptId === res.attempt.id)).toBe(false);

    // grading is clamped to [0, max] and re-grading recomputes the aggregate
    const over = await gradeEssayAnswer(db, { attemptId: res.attempt.id, questionId: essay.id, points: 99, grader: { userId: actor.userId, role: actor.role } });
    expect(over.points).toBe(5);
    const regraded = (await getAttempt(db, res.attempt.id))!;
    expect(regraded.score).toBe(5);
  });

  it("aggregates objective auto-score + essay manual score into one attempt", async () => {
    const essay = await makePublishedEssay(); // 5 pts
    const mcq = await makePublished("mcq"); // 2 pts
    const exam = await createExam(db, { titleAr: "مختلط", titleEn: "Mixed Exam" }, actor);
    await addExamQuestion(db, exam.id, mcq.id);
    await addExamQuestion(db, exam.id, essay.id);
    await publishExam(db, exam.id);

    const res = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // objective answered correctly (choice index 0 correct by default)
    const mcqFull = (await getQuestionFull(db, mcq.id))!;
    const correct = mcqFull.choices.find((c) => c.isCorrect)!;
    await saveAnswer(db, { attempt: res.attempt, questionId: mcq.id, choiceIds: [correct.id], nowMs: Date.now() });
    await saveAnswer(db, { attempt: res.attempt, questionId: essay.id, choiceIds: [], text: "نص الإجابة", nowMs: Date.now() });

    await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    let attempt = (await getAttempt(db, res.attempt.id))!;
    expect(attempt.gradingStatus).toBe("needs_manual");
    expect(attempt.score).toBeNull();

    await gradeEssayAnswer(db, { attemptId: res.attempt.id, questionId: essay.id, points: 3, grader: { userId: actor.userId, role: actor.role } });
    attempt = (await getAttempt(db, res.attempt.id))!;
    expect(attempt.status).toBe("graded");
    expect(attempt.score).toBe(5); // 2 objective + 3 essay
    expect(attempt.maxScore).toBe(7);
    expect(attempt.passed).toBe(true); // 5/7 ≈ 71% ≥ 50%
  });

  it("attempt review exposes the model answer to graders but never to students", async () => {
    const essay = await makePublishedEssay();
    const exam = await createExam(db, { titleAr: "مراجعة", titleEn: "Review Exam" }, actor);
    await addExamQuestion(db, exam.id, essay.id);
    await publishExam(db, exam.id);

    const res = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await saveAnswer(db, { attempt: res.attempt, questionId: essay.id, choiceIds: [], text: "جواب", nowMs: Date.now() });
    await submitAttempt(db, { attempt: res.attempt, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    await gradeEssayAnswer(db, { attemptId: res.attempt.id, questionId: essay.id, points: 5, grader: { userId: actor.userId, role: actor.role } });

    // admin review sees the model answer + the student's written answer
    const adminView = await adminAttemptReview(db, res.attempt.id);
    expect(adminView?.questions[0].modelAnswerAr).toBe("إجابة نموذجية عربية");
    expect(adminView?.questions[0].textAnswer).toBe("جواب");
    // the student-facing review payload has no model-answer field and no choice key
    const cfg = parseExamConfig((await getExamBySlug(db, exam.slug))!.config);
    const studentView = await attemptReview(db, { attempt: (await getAttempt(db, res.attempt.id))!, config: cfg });
    const q = studentView?.questions[0];
    expect(q).toBeTruthy();
    expect(q && "modelAnswerAr" in q).toBe(false);
    expect(q && "modelAnswerEn" in q).toBe(false);
  });
});

// ===========================================================================
describe("essay handwritten-work file upload (secure R2)", () => {
  async function makeEssayExam() {
    const q = await createQuestion(
      db,
      { type: "essay", stemAr: "مقال مصور", stemEn: "Picture essay", pointsDefault: 5, modelAnswerAr: "نموذجية", modelAnswerEn: "Model", choices: [] },
      actor
    );
    await setQuestionStatus(db, q.id, "in_review", actor);
    await setQuestionStatus(db, q.id, "published", actor);
    const exam = await createExam(db, { titleAr: "مقال مصور", titleEn: "Picture Exam" }, actor);
    await addExamQuestion(db, exam.id, q.id);
    await publishExam(db, exam.id);
    return { exam, questionId: q.id };
  }
  async function startFor(student: { id: string }) {
    const e = await makeEssayExam();
    const res = await startAttempt(db, { examId: e.exam.id, actor: studentActor(student), nowMs: Date.now() });
    if (!res.ok) throw new Error("start failed");
    return { ...e, attempt: res.attempt };
  }
  function uploadRequest(attemptId: string, questionId: string, cookie: string, file: File) {
    const fd = new FormData();
    fd.set("_action", "upload");
    fd.set("attemptId", attemptId);
    fd.set("questionId", questionId);
    fd.append("file", file);
    return new Request("https://app.test/api/exam-attempt", {
      method: "POST",
      headers: { cookie, "user-agent": UA },
      body: fd,
    });
  }
  const json = async (req: Request) => {
    const res = await attemptAction({ context: routeCtx, request: req, params: {} } as unknown as Parameters<typeof attemptAction>[0]);
    return { status: (res as Response).status, body: (await (res as Response).json()) as Record<string, unknown> };
  };

  it("authorized student uploads a valid image that is stored private + associated with the answer", async () => {
    const { attempt, questionId } = await startFor(studentA);
    const png = new File([new Uint8Array([137, 80, 78, 71])], "scan.png", { type: "image/png" });
    const out = await json(uploadRequest(attempt.id, questionId, studentA.cookie, png));
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    const fileId = out.body.fileId as string;
    expect(fileId).toBeTruthy();

    const row = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id));
    expect(row[0]?.fileId).toBe(fileId);

    // registry row is a PRIVATE file (never publicly exposed by raw key)
    const f = (await db.select().from(files).where(eq(files.id, fileId)))[0];
    expect(f?.visibility).toBe("private");
    expect(f?.kind).toBe("image");

    // owner can stream their own submission via the signed url the loader returns
    const signed = await signFileUrl(env, fileId, "view", 60);
    const url = new URL(`https://app.test${signed.path}`);
    const req = new Request(url, { headers: { "user-agent": UA } });
    const streamRes = await filesLoader({ context: routeCtx, request: req, params: { id: fileId } } as unknown as Parameters<typeof filesLoader>[0]);
    expect(streamRes.status).toBe(200);
    expect([...new Uint8Array(await streamRes.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  });

  it("unauthorized student cannot attach a file to another student's attempt (404)", async () => {
    const { attempt, questionId } = await startFor(studentA);
    const png = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const out = await json(uploadRequest(attempt.id, questionId, studentB.cookie, png));
    expect(out.status).toBe(404);
    expect(out.body.error).toBe("not_found");
  });

  it("rejects invalid MIME (not image/pdf) before any storage write", async () => {
    const { attempt, questionId } = await startFor(studentA);
    const bad = new File([new TextEncoder().encode("hello")], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const out = await json(uploadRequest(attempt.id, questionId, studentA.cookie, bad));
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("invalid_type");
    // nothing associated
    const row = await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id));
    expect(row.length).toBe(0);
  });

  it("rejects oversized uploads (size cap)", async () => {
    const { attempt, questionId } = await startFor(studentA);
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" });
    const out = await json(uploadRequest(attempt.id, questionId, studentA.cookie, big));
    expect(out.status).toBe(413);
    expect(out.body.error).toBe("too_large");
  });

  it("private file cannot be streamed without a valid signature (no public exposure)", async () => {
    const { attempt, questionId } = await startFor(studentA);
    const png = new File([new Uint8Array([7, 7, 7])], "a.png", { type: "image/png" });
    const out = await json(uploadRequest(attempt.id, questionId, studentA.cookie, png));
    const fileId = out.body.fileId as string;
    // raw path with no signature -> 404-shaped
    const req = new Request(`https://app.test/files/${fileId}`, { headers: { "user-agent": UA } });
    await expect(filesLoader({ context: routeCtx, request: req, params: { id: fileId } } as unknown as Parameters<typeof filesLoader>[0])).rejects.toMatchObject({ status: 404 });
  });

  it("typed answer + uploaded file coexist on one essay answer", async () => {
    const { attempt, questionId } = await startFor(studentA);
    await saveAnswer(db, { attempt, questionId, choiceIds: [], text: "إجابة مكتوبة", nowMs: Date.now() });
    const png = new File([new Uint8Array([1, 1, 1])], "b.png", { type: "image/png" });
    const out = await json(uploadRequest(attempt.id, questionId, studentA.cookie, png));
    expect(out.body.ok).toBe(true);
    const row = (await db.select().from(examAnswers).where(eq(examAnswers.attemptId, attempt.id)))[0];
    expect(row?.textAnswer).toBe("إجابة مكتوبة");
    expect(row?.fileId).toBe(out.body.fileId);
  });

  it("a file-only essay can be submitted, queued, and graded with the file visible to the grader", async () => {
    const { attempt, questionId } = await startFor(studentA);
    const png = new File([new Uint8Array([3, 3, 3])], "c.png", { type: "image/png" });
    const out = await json(uploadRequest(attempt.id, questionId, studentA.cookie, png));
    const fileId = out.body.fileId as string;

    const submitted = await submitAttempt(db, { attempt, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    expect(submitted.pendingGrading).toBe(true);

    await gradeEssayAnswer(db, { attemptId: attempt.id, questionId, points: 4, grader: { userId: actor.userId, role: actor.role } });
    const graded = (await getAttempt(db, attempt.id))!;
    expect(graded.status).toBe("graded");
    expect(graded.score).toBe(4);

    // grader review surfaces the private file metadata (model answer stays grader-only)
    const adminView = await adminAttemptReview(db, attempt.id);
    const q = adminView?.questions[0];
    expect(q?.file?.id).toBe(fileId);
    expect(q?.file?.mime).toBe("image/png");
  });
});

// ===========================================================================
describe("question pools + random exams (FEATURE-SPEC §6)", () => {
  // Builds a fresh content hierarchy + grants studentA subject entitlement so
  // pool exams (linked to a lesson) are startable. Every test is DB-isolated by
  // the file-level beforeEach.
  async function makeHierarchy() {
    const program = await createProgram(db, { titleAr: "ب", titleEn: "Pool Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
    const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Pool Grade", status: "published", sortOrder: 0 }, actor);
    const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Pool Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
    const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Pool Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
    const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "Pool Unit", status: "published", sortOrder: 0 }, actor);
    const lesson = await createLesson(db, { unitId: unit.id, titleAr: "درس", titleEn: "Pool Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subject.id, days: 30 }, actor);
    return { subject, course, unit, lesson };
  }

  /** publish any question type (objective or essay). */
  async function pub(type: "mcq" | "true_false" | "multi_select" | "essay", over: Record<string, unknown> = {}) {
    const q = await createQuestion(
      db,
      {
        type,
        stemAr: `سؤال تجمع ${type}`,
        stemEn: `Pool ${type} ${crypto.randomUUID().slice(0, 6)}`,
        difficulty: "medium",
        pointsDefault: type === "essay" ? 5 : 2,
        modelAnswerAr: type === "essay" ? "نموذجية" : null,
        modelAnswerEn: type === "essay" ? "Model" : null,
        choices:
          type === "essay"
            ? []
            : type === "true_false"
              ? [
                  { contentAr: "صواب", contentEn: "True", isCorrect: true, feedback: null },
                  { contentAr: "خطأ", contentEn: "False", isCorrect: false, feedback: null },
                ]
              : type === "multi_select"
                ? [
                    { contentAr: "أ", contentEn: "A", isCorrect: true, feedback: null },
                    { contentAr: "ب", contentEn: "B", isCorrect: true, feedback: null },
                    { contentAr: "ج", contentEn: "C", isCorrect: false, feedback: null },
                  ]
                : mcqChoices(0),
        tagIds: [],
        ...over,
      },
      actor
    );
    await setQuestionStatus(db, q.id, "in_review", actor);
    await setQuestionStatus(db, q.id, "published", actor);
    return q;
  }

  /** create a pool-mode exam linked to the given lesson (entitled via subject). */
  async function makePoolExam(h: Awaited<ReturnType<typeof makeHierarchy>>, configOver: Record<string, unknown>) {
    const exam = await createExam(db, { titleAr: "امتحان تجمع", titleEn: "Random Pool Exam", lessonId: h.lesson.id, courseId: null, config: { selection: { mode: "pool", pools: [], max_questions: null } } }, actor);
    await updateExam(db, exam.id, { config: configOver });
    return exam;
  }

  it("100→20: a large matching bank is sliced to max_questions with no duplicates", async () => {
    const h = await makeHierarchy();
    const qs: string[] = [];
    for (let i = 0; i < 100; i++) {
      const type = (i % 3 === 0 ? "mcq" : i % 3 === 1 ? "true_false" : "multi_select") as "mcq" | "true_false" | "multi_select";
      qs.push((await pub(type, { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id })).id);
    }
    const exam = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id }, count: 100 }], max_questions: 20 } });
    await publishExam(db, exam.id); // valid: 100 eligible → resolves to 20

    const cfg = parseExamConfig((await getExamBySlug(db, exam.slug))!.config);
    const order = await resolveExamQuestionIds(db, exam.id, cfg, 7);
    expect(order).toHaveLength(20);
    expect(new Set(order).size).toBe(20); // deduped
    expect(qs).toContain(order[0]); // drawn from the matching bank
  });

  it("filters by lesson/unit/difficulty/type select only matching published questions", async () => {
    const h = await makeHierarchy();
    // unit A: 3 medium mcq · unit B: 2 medium mcq + 1 easy true_false
    const a1 = await pub("mcq", { unitId: h.unit.id, lessonId: h.lesson.id, courseId: h.course.id, subjectId: h.subject.id, difficulty: "medium" });
    const a2 = await pub("mcq", { unitId: h.unit.id, lessonId: h.lesson.id, courseId: h.course.id, subjectId: h.subject.id, difficulty: "medium" });
    await pub("mcq", { unitId: h.unit.id, lessonId: h.lesson.id, courseId: h.course.id, subjectId: h.subject.id, difficulty: "easy" });
    const b1 = await pub("mcq", { unitId: h.unit.id, lessonId: h.lesson.id, courseId: h.course.id, subjectId: h.subject.id, difficulty: "hard" });

    // scope by DIFFICULTY + LESSON → the 2 medium questions in this lesson only
    const byDiff = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id, difficulty: "medium" }, count: 2 }] } });
    await publishExam(db, byDiff.id);
    let cfg = parseExamConfig((await getExamBySlug(db, byDiff.slug))!.config);
    const diffResolved = await resolveExamQuestionIds(db, byDiff.id, cfg, 1);
    expect(diffResolved).toHaveLength(2);
    expect(new Set(diffResolved)).toEqual(new Set([a1.id, a2.id]));
    // preview reports the full matching eligible count (2) — not the requested
    expect((await previewPoolSelection(db, byDiff.id, cfg)).pools[0].eligible).toBe(2);

    // scope by COURSE only → includes a1,a2,b1 and the easy one (all in course)
    const byCourse = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { course: h.course.id }, count: 4 }] } });
    await publishExam(db, byCourse.id);
    cfg = parseExamConfig((await getExamBySlug(db, byCourse.slug))!.config);
    const resolved = await resolveExamQuestionIds(db, byCourse.id, cfg, 2);
    expect(resolved).toHaveLength(4);
    expect(new Set(resolved).size).toBe(4); // no duplicates within a pool
    expect(resolved).toContain(b1.id);

    // scope by TYPE = true_false → only the easy true_false drawn (none exist here → ineligible)
    const tf = await pub("true_false", { unitId: h.unit.id, lessonId: h.lesson.id, courseId: h.course.id, subjectId: h.subject.id, difficulty: "easy" });
    const byType = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id, types: ["true_false"] }, count: 1 }] } });
    await publishExam(db, byType.id);
    cfg = parseExamConfig((await getExamBySlug(db, byType.slug))!.config);
    expect((await resolveExamQuestionIds(db, byType.id, cfg, 3))).toEqual([tf.id]);
  });

  it("filters by lesson/unit/difficulty/type: an under-filled bucket cannot publish (fail-closed)", async () => {
    const h = await makeHierarchy();
    await pub("true_false", { unitId: h.unit.id, lessonId: h.lesson.id, courseId: h.course.id, subjectId: h.subject.id, difficulty: "easy" });
    // request 3 essay questions but only objective + essay exist / too few essay
    const exam = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id, types: ["essay"], difficulty: "hard" }, count: 3 }] } });
    await expect(publishExam(db, exam.id)).rejects.toThrow(AssessmentValidationError);
    expect((await getExamBySlug(db, exam.slug))!.status).toBe("draft"); // exam not published
    // preview flags the same insufficiency as an issue (no silent shrink)
    const cfg = parseExamConfig((await getExamBySlug(db, exam.slug))!.config);
    await expect(validatePoolConfig(db, exam.id, cfg)).rejects.toThrow(AssessmentValidationError);
    expect((await previewPoolSelection(db, exam.id, cfg)).pools[0].eligible).toBe(0);
  });

  it("mixed pool (objective + essay): essay is selectable and routes to manual grading", async () => {
    const h = await makeHierarchy();
    const obj = await pub("mcq", { unitId: h.unit.id, lessonId: h.lesson.id, courseId: h.course.id, subjectId: h.subject.id, difficulty: "medium", pointsDefault: 2 });
    const essay = await pub("essay", { unitId: h.unit.id, lessonId: h.lesson.id, courseId: h.course.id, subjectId: h.subject.id, difficulty: "medium", pointsDefault: 5 });
    // explicit types include essay → the pool may draw it alongside the objective
    const exam = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id, types: ["mcq", "essay"] }, count: 2 }] } });
    await publishExam(db, exam.id);
    const cfg = parseExamConfig((await getExamBySlug(db, exam.slug))!.config);
    const resolved = await resolveExamQuestionIds(db, exam.id, cfg, 5);
    expect(new Set(resolved)).toEqual(new Set([obj.id, essay.id])); // mixed distribution

    const started = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const ctx = await attemptContext(db, { attempt: started.attempt, config: cfg, nowMs: Date.now() });
    const types = ctx.questions.map((q) => q.type);
    expect(types).toEqual(expect.arrayContaining(["mcq", "essay"]));
    // essay carries no answer choices in the sanitized live context
    const essayQ = ctx.questions.find((q) => q.type === "essay")!;
    expect(essayQ.choices).toHaveLength(0);

    const objFull = (await getQuestionFull(db, obj.id))!;
    await saveAnswer(db, { attempt: started.attempt, questionId: obj.id, choiceIds: [objFull.choices.find((c) => c.isCorrect)!.id], nowMs: Date.now() });
    await saveAnswer(db, { attempt: started.attempt, questionId: essay.id, choiceIds: [], text: "إجابة مقالية", nowMs: Date.now() });
    const out = await submitAttempt(db, { attempt: started.attempt, graceSeconds: 30, nowMs: Date.now(), videoThresholdPct: 90 });
    expect(out.pendingGrading).toBe(true);
    const row = (await getAttempt(db, started.attempt.id))!;
    expect(row.gradingStatus).toBe("needs_manual");
  });

  it("frozen set + resume: pool draw is stable per attempt and duplicate start resumes it", async () => {
    const h = await makeHierarchy();
    for (let i = 0; i < 10; i++) await pub("mcq", { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id });
    const exam = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id }, count: 5 }] } });
    await publishExam(db, exam.id);
    const cfg = parseExamConfig((await getExamBySlug(db, exam.slug))!.config);

    const first = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const order1 = (first.attempt.metadata as { questionOrder: string[] }).questionOrder;
    expect(order1).toHaveLength(5);

    // duplicate start / resume returns the SAME attempt with the SAME frozen order
    const resumed = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() + 1000 });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.attempt.id).toBe(first.attempt.id);
    expect((resumed.attempt.metadata as { questionOrder: string[] }).questionOrder).toEqual(order1);

    // a second student's attempt draws its own frozen set; the live context
    // always reflects exactly the stored (server-authoritative) order
    await grantEntitlement(db, { studentId: studentB.id, resourceType: "subject", resourceId: h.subject.id, days: 30 }, actor);
    const other = await startAttempt(db, { examId: exam.id, actor: studentActor(studentB), nowMs: Date.now() });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    const order2 = (other.attempt.metadata as { questionOrder: string[] }).questionOrder;
    expect(order2).toHaveLength(5);
    expect(order2).toEqual((await attemptContext(db, { attempt: other.attempt, config: cfg, nowMs: Date.now() })).questions.map((q) => q.id));
    // resume path returns the SAME server-authoritative context for student B too
    const resumedB = await startAttempt(db, { examId: exam.id, actor: studentActor(studentB), nowMs: Date.now() + 2000 });
    expect(resumedB.ok).toBe(true);
    if (resumedB.ok) expect(resumedB.attempt.id).toBe(other.attempt.id);
  });

  it("seeded determinism: same seed → identical order; different seed → different order", async () => {
    const h = await makeHierarchy();
    for (let i = 0; i < 30; i++) await pub("mcq", { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id });
    const exam = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id }, count: 10 }], max_questions: 10 } });
    const cfg = parseExamConfig((await getExamBySlug(db, exam.slug))!.config);
    const a = await resolveExamQuestionIds(db, exam.id, cfg, 99);
    const b = await resolveExamQuestionIds(db, exam.id, cfg, 99);
    const c = await resolveExamQuestionIds(db, exam.id, cfg, 100);
    expect(a).toEqual(b); // deterministic
    expect(a).not.toEqual(c); // seed changes the draw
    expect(new Set(a).size).toBe(10);
  });

  it("published pool exam: adding questions to the bank does not alter an in-flight attempt", async () => {
    const h = await makeHierarchy();
    for (let i = 0; i < 5; i++) await pub("mcq", { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id });
    const exam = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id }, count: 3 }] } });
    await publishExam(db, exam.id);
    const cfg = parseExamConfig((await getExamBySlug(db, exam.slug))!.config);
    const started = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const frozen = (started.attempt.metadata as { questionOrder: string[] }).questionOrder;

    // bank grows AFTER the student started — their attempt stays frozen
    await pub("mcq", { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id });
    await pub("mcq", { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id });
    const ctx = await attemptContext(db, { attempt: started.attempt, config: cfg, nowMs: Date.now() });
    expect(ctx.questions.map((q) => q.id)).toEqual(frozen);

    // a brand-new attempt after the pool grew may differ, but the old one is unchanged
    const again = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() + 999_999 });
    if (again.ok && again.attempt.id !== started.attempt.id) {
      expect((started.attempt.metadata as { questionOrder: string[] }).questionOrder).toEqual(frozen);
    }
  });

  it("unauthorized manipulation is rejected: the draw is server-side and out-of-set answers are refused", async () => {
    const h = await makeHierarchy();
    const inBank = [
      await pub("mcq", { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id }),
      await pub("mcq", { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id }),
      await pub("mcq", { lessonId: h.lesson.id, unitId: h.unit.id, courseId: h.course.id, subjectId: h.subject.id }),
    ];
    const exam = await makePoolExam(h, { selection: { mode: "pool", pools: [{ filters: { lesson: h.lesson.id }, count: 2 }] } });
    await publishExam(db, exam.id);
    const cfg = parseExamConfig((await getExamBySlug(db, exam.slug))!.config);
    const started = await startAttempt(db, { examId: exam.id, actor: studentActor(studentA), nowMs: Date.now() });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const frozen = (started.attempt.metadata as { questionOrder: string[] }).questionOrder;
    expect(frozen).toHaveLength(2); // the client never supplies the set — the server drew it

    // every one of the drawn ids is from the configured bank (server-authoritative)
    expect(frozen.every((id) => inBank.some((q) => q.id === id))).toBe(true);

    // a drawn question the student is entitled to answer saves fine (no selection = unanswered)
    const good = await saveAnswer(db, { attempt: started.attempt, questionId: frozen[0], choiceIds: [], nowMs: Date.now() });
    expect(good.ok).toBe(true);

    // ...but an answer aimed at a question OUTSIDE the frozen set is refused
    const outside = inBank.find((q) => !frozen.includes(q.id))!;
    const bogus = await saveAnswer(db, { attempt: started.attempt, questionId: outside.id, choiceIds: [], nowMs: Date.now() });
    expect(bogus).toMatchObject({ ok: false, error: "unknown_question" });
    void cfg;
  });
});
