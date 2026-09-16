/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { courses, subjects } from "~server/db/schema";
import {
  chainsForStudyView,
  contentKindForFileKind,
  createAcademicYear,
  createCourse,
  createGrade,
  createLesson,
  createLessonItem,
  createProgram,
  createSubject,
  createTerm,
  createUnit,
  lessonContentSummaries,
  studyHub,
  subjectStudyView,
} from "~server/content/service.server";
import { chainRefsOf, chainScopeOf, entitlementsFor } from "~server/entitlements/access.server";
import { resolveAccess } from "~server/entitlements/resolver.server";
import { registerUser } from "~server/auth/service.server";
import { insertFile } from "~server/files/storage.server";
import { registerMockVideo } from "~server/video/service.server";
import {
  createPricePlan,
  createProduct,
  generateActivationBatch,
  purchasableFor,
  redeemActivationCode,
} from "~server/commerce/service.server";

/**
 * STUDENT CONTENT EXPERIENCE — the listing data layer on REAL D1.
 *
 * What this pins (the promises the lesson list makes to a student):
 *   1. the hub lists only subjects with PUBLISHED term containers, and carries
 *      real term/lesson/free-lesson counts + the real academic years;
 *   2. the subject view is ترم → دروس with draft rows and unpublished containers
 *      excluded (drafts never reach a student page);
 *   3. a paid lesson WITHOUT a grant is still returned (locked ≠ hidden) and the
 *      resolver verdict is what the UI renders;
 *   4. the same student WITH a term-scoped activation code gets `allowed` for
 *      that term only — never the other term, never the other subject;
 *   5. the material summary (فيديو / PDF / تدريبات) is derived from real
 *      lesson_items rows — an empty lesson claims nothing, and no lesson borrows
 *      another lesson's materials;
 *   6. the price shown on a locked term comes from a real product + price plan.
 */

const db = getDb(env);
const actor = { userId: "00000000-0000-4000-8000-0000000000aa", role: "super_admin", ipHash: "integration-test" };
const UA = "Mozilla/5.0 (Linux; Android 14)";

let yearId: string;
let term1Id: string;
let term2Id: string;
let philosophyId: string;
let philosophySlug: string;
let psychologyId: string;
let philosophyT1ContainerId: string;
let philosophyT1PaidLessonId: string;
let philosophyT1FreeLessonId: string;
let psychologySlug: string;

async function wipe() {
  for (const table of [
    "activation_code_redemptions", "activation_codes", "activation_code_batches",
    "subscription_events", "subscriptions",
    "refunds", "payment_events", "payments", "order_items", "orders",
    "price_plans", "product_items", "products",
    "entitlements", "events", "audit_logs", "rate_limit_counters", "sessions", "devices",
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "terms", "academic_years", "videos", "files",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function makeStudent(prefix: string) {
  const r = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${r}@test.local`;
  const req = () =>
    new Request("https://app.test/login", {
      method: "POST",
      headers: { "user-agent": UA, "cf-connecting-ip": `10.9.${parseInt(r.slice(0, 2), 16) % 240}.9` },
    });
  const reg = await registerUser(env, { email, password: "Str0ngPass!x", fullName: "Study Tester" }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  return reg.userId;
}

/** Verdicts exactly the way the /study routes compute them (same service calls). */
async function listingFor(userId: string | null, subjectSlug: string) {
  const view = await subjectStudyView(db, subjectSlug);
  if (!view) throw new Error("no study view for " + subjectSlug);
  const chains = chainsForStudyView(view);
  const refs = [...new Set([...chains.values()].flatMap((c) => chainRefsOf(c).map((r) => r.id)))];
  const grants = userId ? await entitlementsFor(db, userId, refs, { scopeSubjectId: view.subject.id }) : [];
  const verdicts = new Map<string, { allowed: boolean; reason: string }>();
  for (const [lessonId, chain] of chains) {
    verdicts.set(
      lessonId,
      resolveAccess({
        subject: { userId, roleRank: userId ? 1 : 0 },
        resource: {
          accessLevel: chain.accessLevel,
          status: chain.status,
          publishAt: chain.publishAt,
          expiresAt: chain.expiresAt,
          freePreview: chain.freePreview,
        },
        chain: chainRefsOf(chain),
        entitlements: grants,
        chainScope: chainScopeOf(chain),
      })
    );
  }
  return { view, verdicts };
}

const lessonOf = (view: NonNullable<Awaited<ReturnType<typeof subjectStudyView>>>, titleEn: string) =>
  view.years.flatMap((y) => y.terms.flatMap((t) => t.lessons)).find((l) => l.titleEn === titleEn)!;

beforeEach(async () => {
  await wipe();

  const program = await createProgram(db, { titleAr: "المرحلة الثانوية", titleEn: "Secondary", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
  const grade1 = await createGrade(db, { programId: program.id, titleAr: "الصف الأول الثانوي", titleEn: "Grade 1 Secondary", status: "published", sortOrder: 0 }, actor);
  const grade2 = await createGrade(db, { programId: program.id, titleAr: "الصف الثاني الثانوي", titleEn: "Grade 2 Secondary", status: "published", sortOrder: 1 }, actor);

  const philosophy = await createSubject(db, { gradeId: grade1.id, titleAr: "فلسفة ومنطق", titleEn: "Philosophy", status: "published", sortOrder: 0, descriptionAr: "مادة الفلسفة والمنطق", descriptionEn: "Philosophy", thumbnailFileId: null }, actor);
  philosophyId = philosophy.id;
  philosophySlug = philosophy.slug;
  const psychology = await createSubject(db, { gradeId: grade2.id, titleAr: "علم النفس", titleEn: "Psychology", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null }, actor);
  psychologyId = psychology.id;
  psychologySlug = psychology.slug;

  const year = await createAcademicYear(db, { titleAr: "2026/2027", titleEn: "2026/2027", startYear: 2026, endYear: 2027, isCurrent: true, status: "published", sortOrder: 0 }, actor);
  yearId = year.id;
  term1Id = (await createTerm(db, { titleAr: "الترم الأول", titleEn: "Term 1", status: "published", sortOrder: 0 }, actor)).id;
  term2Id = (await createTerm(db, { titleAr: "الترم الثاني", titleEn: "Term 2", status: "published", sortOrder: 1 }, actor)).id;

  // real registry rows for the materials — nothing fabricated
  const pdfId = await insertFile(db, { r2Key: `private/pdf/${crypto.randomUUID()}/falsafa-notes.pdf`, bucket: "PRIVATE_FILES", kind: "pdf", originalFilename: "falsafa-notes.pdf", mime: "application/pdf", byteSize: 512_000, checksumSha256: "a".repeat(64), visibility: "private", downloadAllowed: true });
  const docId = await insertFile(db, { r2Key: `private/doc/${crypto.randomUUID()}/tadribat.docx`, bucket: "PRIVATE_FILES", kind: "doc", originalFilename: "tadribat.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: 64_000, checksumSha256: "b".repeat(64), visibility: "private", downloadAllowed: true });
  const video = await registerMockVideo(db, { durationSeconds: 900 });

  // ---- philosophy · term 1: 1 free + 2 paid + 1 draft, with real materials ---
  const c1 = await createCourse(db, {
    subjectId: philosophyId, academicYearId: yearId, termId: term1Id,
    titleAr: "فلسفة ومنطق — الترم الأول", titleEn: "Philosophy T1", status: "published",
    visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null,
    thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
  }, actor);
  philosophyT1ContainerId = c1.id;
  const u1 = await createUnit(db, { courseId: c1.id, titleAr: "الدروس", titleEn: "Lessons", status: "published", sortOrder: 0 }, actor);
  const free = await createLesson(db, { unitId: u1.id, titleAr: "معنى التفكير الإنساني وتطبيقاته", titleEn: "Meaning of thinking", status: "published", accessLevel: "public", freePreview: false, sortOrder: 0, descriptionAr: "درس تعريفي", descriptionEn: "Intro", publishAt: null, expiresAt: null }, actor);
  philosophyT1FreeLessonId = free.id;
  const paidA = await createLesson(db, { unitId: u1.id, titleAr: "الفلسفة والدين والعلم", titleEn: "Philosophy and science", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 1, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  philosophyT1PaidLessonId = paidA.id;
  await createLesson(db, { unitId: u1.id, titleAr: "التفكير الناقد", titleEn: "Critical thinking", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 2, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  await createLesson(db, { unitId: u1.id, titleAr: "درس مسودة", titleEn: "Draft lesson", status: "draft", accessLevel: "entitled", freePreview: false, sortOrder: 3, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  await createLessonItem(db, { lessonId: free.id, itemType: "video", videoId: video.id, required: true, sortOrder: 0 }, actor);
  await createLessonItem(db, { lessonId: free.id, itemType: "file", fileId: pdfId, required: true, sortOrder: 1 }, actor);
  await createLessonItem(db, { lessonId: paidA.id, itemType: "link", linkUrl: "https://docs.google.com/forms/d/e/1FAIpQLSdAbcdefghijklmnop/viewform?embedded=true", required: false, sortOrder: 0 }, actor);
  await createLessonItem(db, { lessonId: paidA.id, itemType: "file", fileId: docId, required: true, sortOrder: 1 }, actor);
  // "Critical thinking" deliberately has NO material — the list must claim none

  // ---- philosophy · term 2 (paid only, no materials) ------------------------
  const c2 = await createCourse(db, {
    subjectId: philosophyId, academicYearId: yearId, termId: term2Id,
    titleAr: "فلسفة ومنطق — الترم الثاني", titleEn: "Philosophy T2", status: "published",
    visibility: "catalog", accessLevel: "entitled", sortOrder: 1, descriptionAr: null, descriptionEn: null,
    thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
  }, actor);
  const u2 = await createUnit(db, { courseId: c2.id, titleAr: "الدروس", titleEn: "Lessons", status: "published", sortOrder: 0 }, actor);
  await createLesson(db, { unitId: u2.id, titleAr: "المنطق: التصورات", titleEn: "Logic concepts", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);

  // ---- psychology · term 1 (free for signed-in students) --------------------
  const c3 = await createCourse(db, {
    subjectId: psychologyId, academicYearId: yearId, termId: term1Id,
    titleAr: "علم النفس — الترم الأول", titleEn: "Psychology T1", status: "published",
    visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null,
    thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
  }, actor);
  const u3 = await createUnit(db, { courseId: c3.id, titleAr: "الدروس", titleEn: "Lessons", status: "published", sortOrder: 0 }, actor);
  await createLesson(db, { unitId: u3.id, titleAr: "علم النفس ومجالاته", titleEn: "Psychology fields", status: "published", accessLevel: "authenticated", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);

  // ---- a real subscription offer for philosophy · term 1 --------------------
  const product = await createProduct(db, { kind: "course", nameAr: "اشتراك فلسفة الترم الأول", nameEn: "Philosophy T1 subscription", items: [{ resourceType: "course", resourceId: c1.id }], active: true }, actor);
  await createPricePlan(db, product.id, { currency: "EGP", amountMinor: 25000, kind: "one_time", period: null, active: true }, actor);
});

describe("study hub (المحتوى التعليمي)", () => {
  it("lists published subjects with real counts and the real academic year", async () => {
    const hub = await studyHub(db);
    const philosophy = hub.find((s) => s.slug === philosophySlug)!;
    expect(philosophy.titleAr).toBe("فلسفة ومنطق");
    expect(philosophy.gradeTitleAr).toBe("الصف الأول الثانوي");
    expect(philosophy.programTitleAr).toBe("المرحلة الثانوية");
    expect(philosophy.termCount).toBe(2);
    expect(philosophy.lessonCount).toBe(4); // published only — the draft is not counted
    expect(philosophy.freeLessonCount).toBe(1);
    expect(philosophy.years.map((y) => y.titleAr)).toEqual(["2026/2027"]);

    const psychology = hub.find((s) => s.slug === psychologySlug)!;
    expect(psychology.gradeTitleAr).toBe("الصف الثاني الثانوي");
    expect(psychology.termCount).toBe(1);
    expect(psychology.lessonCount).toBe(1);
    expect(psychology.freeLessonCount).toBe(1); // authenticated = free for a registered student
  });

  it("drops a subject entirely once its last term container is unpublished", async () => {
    await db.update(courses).set({ status: "draft" }).where(eq(courses.id, philosophyT1ContainerId));
    const hub = await studyHub(db);
    const philosophy = hub.find((s) => s.slug === philosophySlug)!;
    expect(philosophy.termCount).toBe(1); // only the still-published term 2
    expect(philosophy.lessonCount).toBe(1);
    expect(philosophy.freeLessonCount).toBe(0);
    expect(philosophy.years).toHaveLength(1); // year scope follows the LIVE containers
  });
});

describe("subject study view (سنة → ترم → دروس)", () => {
  it("groups terms under their academic year and never leaks drafts", async () => {
    const view = (await subjectStudyView(db, philosophySlug))!;
    expect(view.grade?.titleAr).toBe("الصف الأول الثانوي");
    expect(view.years).toHaveLength(1);
    expect(view.years[0].titleAr).toBe("2026/2027");
    expect(view.years[0].terms.map((t) => t.term.titleAr)).toEqual(["الترم الأول", "الترم الثاني"]);
    const t1 = view.years[0].terms[0];
    expect(t1.term.academicYearTitleAr).toBe("2026/2027");
    expect(t1.lessons.map((l) => l.titleEn)).toEqual(["Meaning of thinking", "Philosophy and science", "Critical thinking"]);
    expect(t1.lessons.every((l) => l.status === "published")).toBe(true);
  });

  it("returns null for a subject that is not published", async () => {
    await db.update(subjects).set({ status: "draft" }).where(eq(subjects.slug, philosophySlug));
    expect(await subjectStudyView(db, philosophySlug)).toBeNull();
  });

  it("keeps the sibling lesson in the OTHER term when one container is unpublished", async () => {
    await db.update(courses).set({ status: "draft" }).where(eq(courses.id, philosophyT1ContainerId));
    const view = (await subjectStudyView(db, philosophySlug))!;
    expect(view.years[0].terms.map((t) => t.term.titleAr)).toEqual(["الترم الثاني"]);
  });
});

describe("lesson materials (فيديو · PDF · تدريبات) come from real items", () => {
  it("summarizes each lesson's OWN materials, in canonical order", async () => {
    const view = (await subjectStudyView(db, philosophySlug))!;
    const free = lessonOf(view, "Meaning of thinking");
    const paidA = lessonOf(view, "Philosophy and science");
    const paidB = lessonOf(view, "Critical thinking");

    expect(free.contentKinds).toEqual(["video", "pdf"]);
    expect(free.itemCount).toBe(2);
    expect(paidA.contentKinds).toEqual(["doc", "practice"]);
    expect(paidA.itemCount).toBe(2);
    expect(paidB.contentKinds).toEqual([]);
    expect(paidB.itemCount).toBe(0);
  });

  it("never surfaces a legacy internal-exam item to a student", async () => {
    const view = (await subjectStudyView(db, philosophySlug))!;
    const free = lessonOf(view, "Meaning of thinking");
    await createLessonItem(db, { lessonId: free.id, itemType: "exam", examId: crypto.randomUUID(), required: true, sortOrder: 9 }, actor);
    const summaries = await lessonContentSummaries(db, [free.id]);
    expect(summaries.get(free.id)!.kinds).toEqual(["video", "pdf"]);
    expect(summaries.get(free.id)!.itemCount).toBe(2);
  });

  it("maps stored file kinds to the student vocabulary (unknown → ملف)", () => {
    expect(contentKindForFileKind("pdf")).toBe("pdf");
    expect(contentKindForFileKind("doc")).toBe("doc");
    expect(contentKindForFileKind("image")).toBe("image");
    expect(contentKindForFileKind("audio")).toBe("audio");
    expect(contentKindForFileKind("archive")).toBe("archive");
    expect(contentKindForFileKind(null)).toBe("file");
    expect(contentKindForFileKind("something-else")).toBe("file");
  });

  it("returns an empty map for no lessons (no query, no phantom rows)", async () => {
    expect((await lessonContentSummaries(db, [])).size).toBe(0);
  });
});

describe("free / paid verdicts on the listing", () => {
  it("anonymous: the public lesson is open, paid lessons are LISTED but denied (locked ≠ hidden)", async () => {
    const { view, verdicts } = await listingFor(null, philosophySlug);
    expect(view.years[0].terms[0].lessons).toHaveLength(3);
    // accessLevel "public" = free for everyone (no account needed)
    expect(verdicts.get(philosophyT1FreeLessonId)).toEqual({ allowed: true, reason: "public" });
    // accessLevel "entitled" = paid: denied to an anonymous visitor, still listed
    expect(verdicts.get(philosophyT1PaidLessonId)).toEqual({ allowed: false, reason: "anon" });
  });

  it("anonymous: a free-for-registered lesson asks for sign-in instead of failing silently", async () => {
    const { verdicts } = await listingFor(null, psychologySlug);
    const psyLessonId = [...verdicts.keys()][0];
    expect(verdicts.get(psyLessonId)).toEqual({ allowed: false, reason: "anon" });
  });

  it("signed-in without a grant: free lesson opens, paid lessons stay locked", async () => {
    const studentId = await makeStudent("study-locked");
    const { view, verdicts } = await listingFor(studentId, philosophySlug);
    expect(verdicts.get(philosophyT1FreeLessonId)).toEqual({ allowed: true, reason: "public" });
    expect(verdicts.get(philosophyT1PaidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });
    // the locked list still exposes the real term the CTA refers to
    expect(view.years[0].terms[0].term.titleAr).toBe("الترم الأول");
  });

  it("a TERM-scoped activation code opens exactly that term — not the other term, not the other subject", async () => {
    const studentId = await makeStudent("study-scoped");
    const before = await listingFor(studentId, philosophySlug);
    expect(before.verdicts.get(philosophyT1PaidLessonId)!.allowed).toBe(false);

    // the exact flow the locked-lesson CTA leads to: "إدخال كود التفعيل"
    const gen = await generateActivationBatch(
      db,
      { name: "فلسفة · الترم الأول", count: 1, maxUses: 1, scope: { kind: "term", academicYearId: yearId, subjectId: philosophyId, termId: term1Id } },
      actor
    );
    expect((await redeemActivationCode(db, { studentId, code: gen.codes[0] })).ok).toBe(true);

    const after = await listingFor(studentId, philosophySlug);
    expect(after.verdicts.get(philosophyT1PaidLessonId)!.allowed).toBe(true);
    const t2Lesson = after.view.years[0].terms[1].lessons[0];
    expect(after.verdicts.get(t2Lesson.id)!.allowed).toBe(false); // الترم الثاني stays locked

    const psychology = await listingFor(studentId, psychologySlug);
    const psyLesson = psychology.view.years[0].terms[0].lessons[0];
    expect(psychology.verdicts.get(psyLesson.id)!.reason).not.toBe("entitlement");
  });
});

describe("subscription offer shown on a locked term", () => {
  it("resolves the real product + effective price for this exact scope", async () => {
    const offer = await purchasableFor(db, { type: "course", id: philosophyT1ContainerId, subjectId: philosophyId });
    expect(offer).not.toBeNull();
    expect(offer!.minPriceMinor).toBe(25000);
    expect(offer!.currency).toBe("EGP");
    expect(offer!.productSlug).toBeTruthy();
  });
});
