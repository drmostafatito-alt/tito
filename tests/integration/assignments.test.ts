/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import {
  createCourse, createGrade, createLesson, createProgram, createSubject, createUnit,
} from "~server/content/service.server";
import { grantEntitlement } from "~server/entitlements/grant.server";
import {
  adminAssignmentSummary,
  archiveAssignment,
  attachSubmissionFile,
  AssignmentReferenceError,
  AssignmentValidationError,
  canAssignment,
  createAssignment,
  getAssignment,
  getAssignmentForStudent,
  getOwnedSubmission,
  gradeSubmission,
  gradingQueue,
  listStudentAssignments,
  listAssignments,
  listAssignmentsAdmin,
  assignmentLocation,
  publishAssignment,
  setAssignmentStatus,
  submitTextAnswer,
  submissionGradeHistory,
  updateAssignment,
} from "~server/assignments/service.server";
import { buildR2Key, insertFile, signFileUrl, sha256HexOf } from "~server/files/storage.server";
import { assignmentSubmissions, files } from "~server/db/schema";
import { loader as filesLoader } from "~/routes/files.$id";

/**
 * Homework / Assignments domain on REAL D1 + REAL R2 + REAL file streaming:
 * assignment CRUD + ref validation, student visibility/entitlement, text + file
 * submission (private PDF/image in PRIVATE_FILES), replace-before-deadline,
 * deadline/graded locks, authorized grading with feedback + audit, result
 * visibility, and unauthorized-grader rejection.
 */

const db = getDb(env);
const adminActor = { userId: "00000000-0000-4000-8000-000000000005", role: "super_admin", ipHash: "x" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

let studentA: { id: string };
let studentB: { id: string };
let grader: { userId: string; roleId: string; role: string; rank: number };
let subjectId: string;
let courseId: string;
let unitId: string;
let lessonId: string;

async function makeStudent(prefix: string) {
  const r = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${r}@test.local`;
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const req = () => new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
  const reg = await registerUser(env, { email, fullName: "Assignment Student", password: "Str0ngPass!x" }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed: " + JSON.stringify(loggedIn));
  return { id: reg.userId };
}

const studentActor = (s: { id: string }) => ({ userId: s.id, roleRank: 1 });
const graderActor = { userId: "00000000-0000-4000-8000-000000000006", role: "super_admin", rank: 4, roleId: "super_admin" };

beforeEach(async () => {
  for (const table of [
    "assignment_submissions", "assignments", "files", "audit_logs", "entitlements",
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "events", "video_watch_sessions", "videos",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }

  studentA = await makeStudent("asm-a");
  studentB = await makeStudent("asm-b");
  grader = graderActor;

  const program = await createProgram(db, { titleAr: "ب", titleEn: "Asm Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, adminActor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Asm Grade", status: "published", sortOrder: 0 }, adminActor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Asm Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, adminActor);
  subjectId = subject.id;
  const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Asm Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, adminActor);
  courseId = course.id;
  const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "Asm Unit", status: "published", sortOrder: 0 }, adminActor);
  unitId = unit.id;
  const lesson = await createLesson(db, { unitId: unit.id, titleAr: "درس", titleEn: "Asm Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, adminActor);
  lessonId = lesson.id;

  await grantEntitlement(db, { studentId: studentA.id, resourceType: "subject", resourceId: subject.id, days: 30 }, adminActor);
});

// --- helpers ----------------------------------------------------------------

/** a private image/pdf stored in PRIVATE_FILES owned by `ownerId` (createdBy). */
async function storePrivateFile(ownerId: string, kind: "image" | "pdf" | "doc", bytes = new Uint8Array([137, 80, 78, 71])) {
  const mime = kind === "pdf" ? "application/pdf" : kind === "image" ? "image/png" : "text/plain";
  const buf = bytes.buffer as ArrayBuffer;
  const checksum = await sha256HexOf(buf);
  const r2Key = buildR2Key(kind, "answer.png", "private");
  await env.PRIVATE_FILES.put(r2Key, buf, { httpMetadata: { contentType: mime } });
  const id = await insertFile(db, {
    r2Key, bucket: "PRIVATE_FILES", kind, originalFilename: "answer", mime, byteSize: bytes.byteLength,
    checksumSha256: checksum, visibility: "private", createdBy: ownerId,
  });
  return id;
}

/** a published lesson-scoped assignment entitled via the subject grant. */
async function publishedAssignment(over: Record<string, unknown> = {}, actor = adminActor) {
  const created = await createAssignment(
    db,
    {
      titleAr: "واجب", titleEn: "Homework 1",
      descriptionAr: "وصف", descriptionEn: "Desc",
      instructionsAr: "تعليمات", instructionsEn: "Instructions",
      courseId, unitId, lessonId,
      maxScore: 10,
      dueAt: Date.now() + 3600_000,
      allowedSubmissionTypes: ["text", "file"],
      ...over,
    },
    actor
  );
  await publishAssignment(db, created.id);
  return created.id;
}

// ===========================================================================
describe("assignment creation + authorization", () => {
  it("creates a draft assignment with validated refs/channels/maxScore", async () => {
    const id = (await createAssignment(
      db,
      { titleAr: "واجب ١", titleEn: "HW One", courseId, lessonId, maxScore: 20, allowedSubmissionTypes: ["text", "file"], instructionsEn: "do it", dueAt: Date.now() + 1000 },
      adminActor
    )).id;
    const a = (await getAssignment(db, id))!;
    expect(a.titleEn).toBe("HW One");
    expect(a.status).toBe("draft");
    expect(a.maxScore).toBe(20);
    expect(a.allowedSubmissionTypes).toEqual(["text", "file"]);
    expect(a.courseId).toBe(courseId);

    // invalid ref rejected
    await expect(
      createAssignment(db, { titleAr: "x", titleEn: "y", courseId: crypto.randomUUID(), maxScore: 5, allowedSubmissionTypes: ["text"] }, adminActor)
    ).rejects.toThrow(AssignmentReferenceError);
    // empty channels / bad channel rejected
    await expect(
      createAssignment(db, { titleAr: "x", titleEn: "y", courseId, maxScore: 5, allowedSubmissionTypes: [] }, adminActor)
    ).rejects.toThrow(AssignmentValidationError);
    await expect(
      createAssignment(db, { titleAr: "x", titleEn: "y", courseId, maxScore: 5, allowedSubmissionTypes: ["video"] }, adminActor)
    ).rejects.toThrow(AssignmentValidationError);
    // non-positive max rejected
    await expect(
      createAssignment(db, { titleAr: "x", titleEn: "y", courseId, maxScore: 0, allowedSubmissionTypes: ["text"] }, adminActor)
    ).rejects.toThrow(AssignmentValidationError);
  });

  it("update merges fields and status follows draft→published→archived", async () => {
    const id = (await createAssignment(
      db,
      { titleAr: "واجب", titleEn: "First", courseId, lessonId, maxScore: 10, allowedSubmissionTypes: ["text"] },
      adminActor
    )).id;
    await updateAssignment(db, id, { titleEn: "Renamed", maxScore: 25, dueAt: Date.now() + 5000 });
    const a = (await getAssignment(db, id))!;
    expect(a.titleEn).toBe("Renamed");
    expect(a.maxScore).toBe(25);

    const pub = await publishAssignment(db, id);
    expect(pub.status).toBe("published");
    expect((await getAssignment(db, id))!.status).toBe("published");
    // cannot publish an archived assignment
    await setAssignmentStatus(db, id, "archived", adminActor);
    await expect(publishAssignment(db, id)).rejects.toThrow(AssignmentValidationError);
    // archive → back to draft round-trip via setAssignmentStatus
    await setAssignmentStatus(db, id, "draft", adminActor);
    expect((await getAssignment(db, id))!.status).toBe("draft");
    await archiveAssignment(db, id);
    expect((await getAssignment(db, id))!.status).toBe("archived");
  });

  it("only authorized staff can create (rank<3 denied); staff list shows all", async () => {
    // canAssignment: student rank 1 → false; super_admin rank 4 → true
    expect(await canAssignment(db, { user: { rank: 1, roleId: "student" } }, "assignment.create")).toBe(false);
    expect(await canAssignment(db, { user: { rank: 4, roleId: "super_admin" } }, "assignment.create")).toBe(true);
    const id = await publishedAssignment();
    const staffList = await listAssignments(db, { status: "published" });
    expect(staffList.some((x) => x.id === id)).toBe(true);
  });
});

// ===========================================================================
describe("student visibility + submission", () => {
  it("students see published assignments they are entitled to; drafts are hidden", async () => {
    const pubId = await publishedAssignment();
    const list = await listStudentAssignments(db, studentActor(studentA), Date.now());
    expect(list.map((x) => x.id)).toEqual([pubId]); // entitled + published
    // student B is NOT entitled → not listed
    const bList = await listStudentAssignments(db, studentActor(studentB), Date.now());
    expect(bList.length).toBe(0);

    // draft assignment invisible even to the entitled student
    const draftId = (await createAssignment(db, { titleAr: "w", titleEn: "Draft", courseId, unitId, lessonId, maxScore: 5, allowedSubmissionTypes: ["text"] }, adminActor)).id;
    await grantEntitlement(db, { studentId: studentB.id, resourceType: "subject", resourceId: subjectId, days: 30 }, adminActor);
    const aList = await listStudentAssignments(db, studentActor(studentA), Date.now());
    expect(aList.some((x) => x.id === draftId)).toBe(false);
  });

  it("a student submits a written answer; replacement before deadline updates the same row", async () => {
    const id = await publishedAssignment();
    const t0 = Date.now();
    const first = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "الجواب الأول", nowMs: t0 });
    expect(first.ok).toBe(true);
    const subId = first.ok ? first.submission.id : "";
    expect(subId).toBeTruthy();

    const replaced = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "الجواب المعدّل", nowMs: t0 + 1000 });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.submission.id).toBe(subId); // same single row
    expect(replaced.submission.textAnswer).toBe("الجواب المعدّل");
    const rows = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.assignmentId, id));
    expect(rows).toHaveLength(1);
  });

  it("a student uploads a private PDF/image that is stored securely + associated; invalid type rejected", async () => {
    const id = await publishedAssignment({ allowedSubmissionTypes: ["file"] });
    const fileId = await storePrivateFile(studentA.id, "image");
    const res = await attachSubmissionFile(db, { assignmentId: id, actor: studentActor(studentA), fileId, nowMs: Date.now() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.submission.fileId).toBe(fileId);
    const f = (await db.select().from(files).where(eq(files.id, fileId)))[0];
    expect(f.visibility).toBe("private"); // secure R2 — never public
    expect(f.kind).toBe("image");

    // invalid (non PDF/image) private file rejected before association
    const bad = await storePrivateFile(studentA.id, "doc", new TextEncoder().encode("hello"));
    const reject = await attachSubmissionFile(db, { assignmentId: id, actor: studentActor(studentA), fileId: bad, nowMs: Date.now() });
    expect(reject.ok).toBe(false);
    if (!reject.ok) expect(reject.error).toBe("invalid_file");
  });

  it("file ownership: a student cannot attach another student's private file", async () => {
    const id = await publishedAssignment({ allowedSubmissionTypes: ["file"] });
    const otherFile = await storePrivateFile(studentB.id, "image");
    const res = await attachSubmissionFile(db, { assignmentId: id, actor: studentActor(studentA), fileId: otherFile, nowMs: Date.now() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("denied");
  });

  it("deadline behavior: submissions/replacements close after due; grader still grades late work", async () => {
    const due = Date.now() + 10_000;
    const id = await publishedAssignment({ dueAt: due });
    // before deadline: submit + replace both fine
    expect((await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "قبل الموعد", nowMs: due - 1 })).ok).toBe(true);

    // a fresh student after the deadline cannot submit
    await grantEntitlement(db, { studentId: studentB.id, resourceType: "subject", resourceId: subjectId, days: 30 }, adminActor);
    const late = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentB), text: "متأخر", nowMs: due + 1 });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toBe("after_due");

    // owner cannot replace after the deadline either
    const ownerLate = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "تعديل بعد الموعد", nowMs: due + 1 });
    expect(ownerLate.ok).toBe(false);
    if (!ownerLate.ok) expect(ownerLate.error).toBe("after_due");

    // the grader can still grade the on-time submission after the deadline
    const sub = await getOwnedSubmission(db, (await db.select({ id: assignmentSubmissions.id }).from(assignmentSubmissions).where(eq(assignmentSubmissions.studentId, studentA.id)).limit(1))[0].id, studentA.id);
    const graded = await gradeSubmission(db, { submissionId: sub!.id, score: 8, feedback: "ممتاز", grader, nowMs: due + 60_000 });
    expect(graded.score).toBe(8);
  });

  it("graded lock: a student cannot replace an already-graded submission", async () => {
    const id = await publishedAssignment();
    const t0 = Date.now();
    const s = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "نص", nowMs: t0 });
    if (!s.ok) return;
    await gradeSubmission(db, { submissionId: s.submission.id, score: 9, feedback: "حسن", grader, nowMs: t0 + 1000 });
    const again = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "يحاول", nowMs: t0 + 2000 });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("graded");
  });
});

// ===========================================================================
describe("grading + feedback + audit + results", () => {
  it("authorized grader scores with feedback; score clamps to max; status graded", async () => {
    const id = await publishedAssignment({ maxScore: 10 });
    const s = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "إجابة", nowMs: Date.now() });
    if (!s.ok) return;
    const g = await gradeSubmission(db, { submissionId: s.submission.id, score: 40, feedback: "أعلى من الحد", grader, nowMs: Date.now() });
    expect(g.score).toBe(10); // clamped to maxScore

    const view = (await getAssignmentForStudent(db, { assignmentId: id, actor: studentActor(studentA), nowMs: Date.now() }))!;
    expect(view.submission?.status).toBe("graded");
    expect(view.submission?.score).toBe(10);
    expect(view.submission?.feedback).toBe("أعلى من الحد");
    expect(view.resultVisible).toBe(true);
  });

  it("audits every grading change (append-only history)", async () => {
    const id = await publishedAssignment({ maxScore: 10 });
    const s = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "إجابة", nowMs: Date.now() });
    if (!s.ok) return;
    await gradeSubmission(db, { submissionId: s.submission.id, score: 6, feedback: "متوسط", grader, nowMs: Date.now() });
    await gradeSubmission(db, { submissionId: s.submission.id, score: 9, feedback: "أفضل بعد إعادة التصحيح", grader, nowMs: Date.now() + 1000 });

    const history = await submissionGradeHistory(db, s.submission.id);
    expect(history).toHaveLength(2);
    expect(history[1].after).toMatchObject({ score: 9 });
    expect(history[1].before).toMatchObject({ score: 6 });
    expect(history[1].actorUserId).toBe(grader.userId);
  });

  it("unauthorized grader cannot grade (student / rank<3 rejected)", async () => {
    const id = await publishedAssignment();
    const s = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "إجابة", nowMs: Date.now() });
    if (!s.ok) return;
    const studentGrader = { userId: studentB.id, role: "student", rank: 1, roleId: "student" };
    await expect(
      gradeSubmission(db, { submissionId: s.submission.id, score: 8, grader: studentGrader, nowMs: Date.now() })
    ).rejects.toThrow(AssignmentValidationError);
    // submission stays ungraded
    const sub = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, s.submission.id)).limit(1);
    expect(sub[0].status).toBe("submitted");
    expect(sub[0].score).toBeNull();
  });

  it("result visibility: score/feedback shown only once graded; peers cannot see the submission", async () => {
    const id = await publishedAssignment();
    const t0 = Date.now();
    const s = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "نص إجابة", nowMs: t0 });

    // not yet graded → student sees their submission but not a result
    let view = (await getAssignmentForStudent(db, { assignmentId: id, actor: studentActor(studentA), nowMs: t0 }))!;
    expect(view.submission?.status).toBe("submitted");
    expect(view.resultVisible).toBe(false);
    expect(view.submission?.score).toBeNull();

    if (!s.ok) return;
    await gradeSubmission(db, { submissionId: s.submission.id, score: 7, feedback: "جيد جداً", grader, nowMs: t0 + 500 });
    view = (await getAssignmentForStudent(db, { assignmentId: id, actor: studentActor(studentA), nowMs: t0 + 600 }))!;
    expect(view.resultVisible).toBe(true);
    expect(view.submission?.score).toBe(7);
    expect(view.submission?.feedback).toBe("جيد جداً");

    // grading queue exposes it as graded; a fresh submission from A disappears from the queue
    const q = await gradingQueue(db, { assignmentId: id, status: "submitted" });
    expect(q.some((x) => x.submissionId === s.submission.id)).toBe(false);
    const gradedQ = await gradingQueue(db, { assignmentId: id, status: "graded" });
    expect(gradedQ.some((x) => x.submissionId === s.submission.id && x.feedback === "جيد جداً")).toBe(true);

    // a non-entitled peer cannot view A's submission
    await grantEntitlement(db, { studentId: studentB.id, resourceType: "subject", resourceId: subjectId, days: 30 }, adminActor);
    expect(await getOwnedSubmission(db, s.submission.id, studentB.id)).toBeNull();
  });
});

// ===========================================================================
describe("secure R2 streaming + admin summary", () => {
  it("submitted private file streams only with a valid signature (no public exposure)", async () => {
    const id = await publishedAssignment({ allowedSubmissionTypes: ["file"] });
    const fileId = await storePrivateFile(studentA.id, "image");
    const res = await attachSubmissionFile(db, { assignmentId: id, actor: studentActor(studentA), fileId, nowMs: Date.now() });
    expect(res.ok).toBe(true);

    // no-signature raw path → not streamed (404-shaped)
    const raw = new Request(`https://app.test/files/${fileId}`, { headers: { "user-agent": UA } });
    await expect(
      filesLoader({ context: routeCtx, request: raw, params: { id: fileId } } as unknown as Parameters<typeof filesLoader>[0])
    ).rejects.toMatchObject({ status: 404 });

    // signed view URL streams the private bytes
    const signed = await signFileUrl(env, fileId, "view", 60);
    const url = new URL(`https://app.test${signed.path}`);
    const req = new Request(url, { headers: { "user-agent": UA } });
    const ok = await filesLoader({ context: routeCtx, request: req, params: { id: fileId } } as unknown as Parameters<typeof filesLoader>[0]);
    expect(ok.status).toBe(200);
    expect([...new Uint8Array(await ok.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  });

  it("admin summary reports submitted/graded counts", async () => {
    const id = await publishedAssignment();
    const s = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "إجابة", nowMs: Date.now() });
    if (!s.ok) return;
    const summary = await adminAssignmentSummary(db, id);
    expect(summary?.submittedCount).toBe(1);
    expect(summary?.gradedCount).toBe(0);
    expect(summary?.submissions).toHaveLength(1);
    expect(summary?.submissions[0].studentId).toBe(studentA.id);
    expect(summary?.submissions[0].fileId).toBeNull();
  });
});

// ===========================================================================
describe("bounded admin listing + location helpers", () => {
  it("lists published assignments with grouped counts and location labels", async () => {
    const id = await publishedAssignment({ titleAr: "قائمة", titleEn: "Listable HW", maxScore: 10 });
    const s = await submitTextAnswer(db, { assignmentId: id, actor: studentActor(studentA), text: "جواب", nowMs: Date.now() });
    if (!s.ok) throw new Error("submit failed");

    const one = (await listAssignmentsAdmin(db, { status: "published", q: "Listable", limit: 10 })).items.find((a) => a.id === id);
    expect(one).toBeTruthy();
    expect(one?.submittedCount).toBe(1);
    expect(one?.gradedCount).toBe(0);

    const loc = await assignmentLocation(db, one!);
    expect(loc.course?.titleEn).toBe("Asm Course");
    expect(loc.unit?.titleEn).toBe("Asm Unit");
    expect(loc.lesson?.titleEn).toBe("Asm Lesson");
  });

  it("status filter, search across both languages, and pagination are bounded", async () => {
    await publishedAssignment({ titleAr: "منشور أ", titleEn: "Alpha Pub", maxScore: 10 });
    await publishedAssignment({ titleAr: "منشور ب", titleEn: "Beta Pub", maxScore: 10 });
    await createAssignment(db, { titleAr: "مسودة", titleEn: "Gamma Draft", courseId, maxScore: 10, allowedSubmissionTypes: ["text"] }, adminActor);

    const published = await listAssignmentsAdmin(db, { status: "published", limit: 50 });
    expect(published.total).toBe(2);
    expect(published.items).toHaveLength(2);

    // Arabic search matches only the Arabic-only title
    const byAr = await listAssignmentsAdmin(db, { q: "منشور ب", limit: 10 });
    expect(byAr.total).toBe(1);
    expect(byAr.items[0].titleEn).toBe("Beta Pub");

    // pagination slices within a page
    const page = await listAssignmentsAdmin(db, { status: "published", limit: 1, offset: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.limit).toBe(1);
  });

  it("grading queue returns submissions with student + file metadata for graders", async () => {
    const id = await publishedAssignment({ titleAr: "تصحيح", titleEn: "Queue HW", maxScore: 10 });
    const fileId = await storePrivateFile(studentA.id, "pdf", new Uint8Array([37, 80, 68, 70]));
    const att = await attachSubmissionFile(db, { assignmentId: id, actor: studentActor(studentA), fileId, nowMs: Date.now() });
    if (!att.ok) throw new Error("attach failed");

    const queue = await gradingQueue(db, { status: "submitted" });
    const item = queue.find((x) => x.submissionId === att.submission.id);
    expect(item).toBeTruthy();
    expect(item?.studentId).toBe(studentA.id);
    expect(item?.file?.byteSize).toBe(4);
    expect(item?.assignmentTitleEn).toBe("Queue HW");
  });
});
