/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import {
  chainForLesson,
  createAcademicYear,
  createCourse,
  createGrade,
  createLesson,
  createProgram,
  createSubject,
  createTerm,
  createUnit,
  termContainerFor,
} from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import {
  approveManualPayment,
  codesForOrder,
  confirmManualPayment,
  createOrder,
  createPricePlan,
  createProduct,
  generateActivationBatch,
  generateCodeForOrder,
  redeemActivationCode,
  setActivationCodeStatus,
} from "~server/commerce/service.server";
import { orderScopeView, scopeLinePairs } from "~server/commerce/order-scope.server";
import { paymentsSettingsSchema, type PaymentMethodSetting } from "~server/settings/schema";
import { activationCodes } from "~server/db/schema";
import { eq } from "drizzle-orm";

/**
 * The owner's content model on REAL D1:
 *   السنة الدراسية → الصف → المادة → الترم → الدرس → محتوى الدرس
 *
 * These tests pin the two rules the platform must never get wrong:
 *  1. STRICT SCOPE — a code/entitlement for «فلسفة ومنطق · الترم الأول» opens
 *     that term only: never الترم الثاني, never علم النفس, never another year.
 *  2. FULL-YEAR — an explicit full-year grant opens every term of that subject
 *     in that year, including containers published AFTER the grant.
 *
 * Plus: locked ≠ hidden (denied content is still resolved, never deleted),
 * draft never leaks, single-use codes are race-safe, and an order-scoped code
 * carries exactly the scope of the request it was issued for.
 */

const db = getDb(env);
const actor = { userId: "00000000-0000-4000-8000-000000000006", role: "super_admin", ipHash: "integration-test" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

let studentA: { id: string; cookie: string };
let studentB: { id: string; cookie: string };

let yearId: string;
let term1Id: string;
let term2Id: string;
let philosophyId: string;
let psychologyId: string;
let philT1: { course: { id: string }; paidLessonId: string; freeLessonId: string; draftLessonId: string };
let philT2: { course: { id: string }; paidLessonId: string };
let psychT1: { course: { id: string }; paidLessonId: string };

async function wipe() {
  for (const table of [
    "activation_code_redemptions", "activation_codes", "activation_code_batches",
    "discount_redemptions", "discount_codes",
    "subscription_events", "subscriptions",
    "refunds", "payment_events", "payments", "order_items", "orders",
    "price_plans", "product_items", "products",
    "entitlements", "events", "audit_logs", "rate_limit_counters",
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
    "terms", "academic_years",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function makeStudent(prefix: string) {
  const r = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${r}@test.local`;
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const req = () => new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
  const reg = await registerUser(env, { email, password: "Str0ngPass!x", fullName: "Scope Tester" }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed: " + JSON.stringify(loggedIn));
  return { id: reg.userId, cookie: loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

const paySettings = () =>
  paymentsSettingsSchema.parse({
    manualEnabled: true,
    manualInstructionsAr: "تعليمات سداد تجريبية — اتبع تعليمات الإدارة",
    manualInstructionsEn: "Test payment instructions — follow the admin's instructions",
    methods: [
      {
        id: "instapay", key: "instapay", enabled: true, labelAr: "إنستاباي", labelEn: "InstaPay",
        destination: "owner@instapay.test", accountNameAr: "", accountNameEn: "",
        instructionsAr: "", instructionsEn: "", sortOrder: 0,
      },
    ] as PaymentMethodSetting[],
    receiptWhatsappEnabled: true,
    receiptNoteAr: "",
    receiptNoteEn: "",
    orderTtlMinutes: 60,
    refundWindowDays: 7,
  });

/** One term container (subject + year + term) with a published unit + lessons. */
async function makeContainer(subjectId: string, termId: string, labelEn: string) {
  const course = await createCourse(
    db,
    {
      subjectId, academicYearId: yearId, termId,
      titleAr: `${labelEn}`, titleEn: labelEn, status: "published", visibility: "catalog",
      accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null,
      thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
    },
    actor
  );
  const unit = await createUnit(db, { courseId: course.id, titleAr: "الوحدة", titleEn: "Unit", status: "published", sortOrder: 0 }, actor);
  const lesson = (accessLevel: "entitled" | "authenticated", status: "published" | "draft", nameEn: string) =>
    createLesson(
      db,
      {
        unitId: unit.id, titleAr: nameEn, titleEn: nameEn, status, accessLevel,
        freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null,
        publishAt: null, expiresAt: null,
      },
      actor
    );
  const paid = await lesson("entitled", "published", `Paid ${labelEn}`);
  return { course, unitId: unit.id, paidLessonId: paid.id, extra: lesson };
}

async function verdictFor(studentId: string | null, lessonId: string) {
  const chain = await chainForLesson(db, lessonId);
  if (!chain) throw new Error("no chain for " + lessonId);
  return resolveContentAccess(db, { userId: studentId, roleRank: studentId ? 1 : 0 }, chain);
}

beforeEach(async () => {
  await wipe();
  studentA = await makeStudent("scope-a");
  studentB = await makeStudent("scope-b");

  const program = await createProgram(db, { titleAr: "الثانوية العامة", titleEn: "Thanawya", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
  const grade1 = await createGrade(db, { programId: program.id, titleAr: "الصف الأول الثانوي", titleEn: "Grade 1 Secondary", status: "published", sortOrder: 0 }, actor);
  const grade2 = await createGrade(db, { programId: program.id, titleAr: "الصف الثاني الثانوي", titleEn: "Grade 2 Secondary", status: "published", sortOrder: 1 }, actor);
  philosophyId = (await createSubject(db, { gradeId: grade1.id, titleAr: "فلسفة ومنطق", titleEn: "Philosophy & Logic", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor)).id;
  psychologyId = (await createSubject(db, { gradeId: grade2.id, titleAr: "علم النفس", titleEn: "Psychology", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor)).id;

  const year = await createAcademicYear(db, { titleAr: "2026/2027", titleEn: "2026/2027", startYear: 2026, endYear: 2027, isCurrent: true, status: "published", sortOrder: 0 }, actor);
  yearId = year.id;
  term1Id = (await createTerm(db, { titleAr: "الترم الأول", titleEn: "Term 1", status: "published", sortOrder: 0 }, actor)).id;
  term2Id = (await createTerm(db, { titleAr: "الترم الثاني", titleEn: "Term 2", status: "published", sortOrder: 1 }, actor)).id;

  const a = await makeContainer(philosophyId, term1Id, "Philosophy T1");
  const freeLesson = await a.extra("authenticated", "published", "Free Philosophy T1");
  const draftLesson = await a.extra("entitled", "draft", "Draft Philosophy T1");
  philT1 = { course: a.course, paidLessonId: a.paidLessonId, freeLessonId: freeLesson.id, draftLessonId: draftLesson.id };

  const b = await makeContainer(philosophyId, term2Id, "Philosophy T2");
  philT2 = { course: b.course, paidLessonId: b.paidLessonId };

  const c = await makeContainer(psychologyId, term1Id, "Psychology T1");
  psychT1 = { course: c.course, paidLessonId: c.paidLessonId };
});

describe("content model: Year → Grade → Subject → Term → Lesson", () => {
  it("stores the academic scope on the container and resolves it in the chain", async () => {
    const found = await termContainerFor(db, { subjectId: philosophyId, academicYearId: yearId, termId: term1Id });
    expect(found?.id).toBe(philT1.course.id);
    const chain = await chainForLesson(db, philT1.paidLessonId);
    expect(chain?.academicYearId).toBe(yearId);
    expect(chain?.termId).toBe(term1Id);
    expect(chain?.gradeId).toBeTruthy();
    expect(chain?.subjectId).toBe(philosophyId);
  });

  it("locked paid content is DENIED, never hidden from the resolver", async () => {
    // The lesson still resolves (it exists, it is published) — the student is
    // simply not entitled. Hiding it would be a different verdict entirely.
    expect(await verdictFor(studentA.id, philT1.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("free content is open to any registered student, no entitlement needed", async () => {
    expect(await verdictFor(studentA.id, philT1.freeLessonId)).toEqual({ allowed: true, reason: "authenticated" });
  });

  it("anonymous visitors never reach entitled or authenticated lessons", async () => {
    expect(await verdictFor(null, philT1.paidLessonId)).toEqual({ allowed: false, reason: "anon" });
    expect(await verdictFor(null, philT1.freeLessonId)).toEqual({ allowed: false, reason: "anon" });
  });

  it("draft lessons stay closed for students", async () => {
    expect(await verdictFor(studentA.id, philT1.draftLessonId)).toEqual({ allowed: false, reason: "not_published" });
  });
});

describe("term-scoped activation codes are exact", () => {
  it("opens only the term it was issued for — never another term or subject", async () => {
    const gen = await generateActivationBatch(
      db,
      {
        name: "فلسفة · ترم أول",
        count: 1,
        maxUses: 1,
        scope: { kind: "term", academicYearId: yearId, subjectId: philosophyId, termId: term1Id },
      },
      actor
    );
    const code = gen.codes[0];
    expect(code).toMatch(/^TITO-/);

    const redeemed = await redeemActivationCode(db, { studentId: studentA.id, code });
    expect(redeemed.ok).toBe(true);

    expect(await verdictFor(studentA.id, philT1.paidLessonId)).toEqual({ allowed: true, reason: "entitlement" });
    expect(await verdictFor(studentA.id, philT2.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });
    expect(await verdictFor(studentA.id, psychT1.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("is single-use by default: one winner, everyone else rejected", async () => {
    const gen = await generateActivationBatch(
      db,
      { name: "single-use", count: 1, maxUses: 1, scope: { kind: "term", academicYearId: yearId, subjectId: philosophyId, termId: term1Id } },
      actor
    );
    const code = gen.codes[0];
    expect((await redeemActivationCode(db, { studentId: studentA.id, code })).ok).toBe(true);
    // same student again → already redeemed (unique code_id + student_id)
    expect(await redeemActivationCode(db, { studentId: studentA.id, code })).toEqual({ ok: false, reason: "already_redeemed" });
    // another student → exhausted (the conditional claim is the race gate)
    expect(await redeemActivationCode(db, { studentId: studentB.id, code })).toEqual({ ok: false, reason: "exhausted" });
    expect(await verdictFor(studentB.id, philT1.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("a revoked code can no longer be redeemed", async () => {
    const gen = await generateActivationBatch(
      db,
      { name: "revocable", count: 1, maxUses: 5, scope: { kind: "term", academicYearId: yearId, subjectId: philosophyId, termId: term1Id } },
      actor
    );
    const rows = await db.select({ id: activationCodes.id }).from(activationCodes).where(eq(activationCodes.batchId, gen.batchId));
    await setActivationCodeStatus(db, rows[0].id, "revoked", actor);
    expect(await redeemActivationCode(db, { studentId: studentA.id, code: gen.codes[0] })).toEqual({ ok: false, reason: "revoked" });
  });

  it("rejects a scope that does not exist (no invented years/terms)", async () => {
    await expect(
      generateActivationBatch(
        db,
        { name: "bad", count: 1, maxUses: 1, scope: { kind: "term", academicYearId: yearId, subjectId: philosophyId, termId: crypto.randomUUID() } },
        actor
      )
    ).rejects.toBeTruthy();
    await expect(
      generateActivationBatch(
        db,
        { name: "bad2", count: 1, maxUses: 1, scope: { kind: "term", academicYearId: yearId, subjectId: philosophyId } },
        actor
      )
    ).rejects.toBeTruthy();
  });

  it("never stores the plaintext code — only a hash and a prefix", async () => {
    const gen = await generateActivationBatch(
      db,
      { name: "hashed", count: 2, maxUses: 1, scope: { kind: "full_year", academicYearId: yearId, subjectId: philosophyId } },
      actor
    );
    const rows = await db.select().from(activationCodes).where(eq(activationCodes.batchId, gen.batchId));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.prefix).toBe("TITO");
      expect(r.codeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(r)).not.toContain(gen.codes[0]);
      expect(JSON.stringify(r)).not.toContain(gen.codes[1]);
    }
  });
});

describe("full-year entitlements are explicit", () => {
  it("opens every term of that subject in that year — and nothing else", async () => {
    const gen = await generateActivationBatch(
      db,
      { name: "full year philosophy", count: 1, maxUses: 1, scope: { kind: "full_year", academicYearId: yearId, subjectId: philosophyId } },
      actor
    );
    expect((await redeemActivationCode(db, { studentId: studentA.id, code: gen.codes[0] })).ok).toBe(true);

    expect(await verdictFor(studentA.id, philT1.paidLessonId)).toEqual({ allowed: true, reason: "entitlement" });
    expect(await verdictFor(studentA.id, philT2.paidLessonId)).toEqual({ allowed: true, reason: "entitlement" });
    // NOT isSubscribed=true: another subject stays locked
    expect(await verdictFor(studentA.id, psychT1.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("keeps working for a term container published AFTER the grant", async () => {
    const gen = await generateActivationBatch(
      db,
      { name: "future-proof", count: 1, maxUses: 1, scope: { kind: "full_year", academicYearId: yearId, subjectId: philosophyId } },
      actor
    );
    expect((await redeemActivationCode(db, { studentId: studentA.id, code: gen.codes[0] })).ok).toBe(true);

    // The admin adds a new term + container later — no code change, no re-issue.
    const term3Id = (await createTerm(db, { titleAr: "الترم الصيفي", titleEn: "Summer Term", status: "published", sortOrder: 2 }, actor)).id;
    const later = await makeContainer(philosophyId, term3Id, "Philosophy Summer");
    expect(await verdictFor(studentA.id, later.paidLessonId)).toEqual({ allowed: true, reason: "entitlement" });
  });
});

describe("subscription request → approval → order-bound code", () => {
  it("grants nothing on submit, everything after approval, and issues a scoped code", async () => {
    const product = await createProduct(
      db,
      { kind: "course", nameAr: "فلسفة ومنطق — الترم الأول", nameEn: "Philosophy T1", items: [{ resourceType: "course", resourceId: philT1.course.id }], active: true },
      actor
    );
    const plan = await createPricePlan(db, product.id, { currency: "EGP", amountMinor: 15000, kind: "one_time", period: null, active: true }, actor);
    const settings = paySettings();

    // 1) the student creates the request and submits the manual payment
    const { order } = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: settings, source: "self" });
    expect(await verdictFor(studentA.id, philT1.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });

    const { paymentId } = await confirmManualPayment(db, {
      studentId: studentA.id,
      orderId: order.id,
      transferReference: "TX-123",
      methodId: "instapay",
      paymentsSettings: settings,
    });
    // claiming "I paid" grants nothing — admin approval is required
    expect(await verdictFor(studentA.id, philT1.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });

    // 2) the admin verifies the amount and approves
    const approved = await approveManualPayment(db, { paymentId, receivedAmountMinor: 15000, actor });
    expect(approved.ok).toBe(true);
    expect(await verdictFor(studentA.id, philT1.paidLessonId)).toEqual({ allowed: true, reason: "entitlement" });
    expect(await verdictFor(studentA.id, philT2.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });

    // 3) the admin issues a code bound to THAT order (e.g. to hand over on WhatsApp)
    const issued = await generateCodeForOrder(db, { orderId: order.id, actor, maxUses: 1 });
    expect(issued.codes[0]).toMatch(/^TITO-/);
    const listed = await codesForOrder(db, order.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].prefix).toBe("TITO");

    // another student redeeming it gets exactly this order's scope
    expect((await redeemActivationCode(db, { studentId: studentB.id, code: issued.codes[0] })).ok).toBe(true);
    expect(await verdictFor(studentB.id, philT1.paidLessonId)).toEqual({ allowed: true, reason: "entitlement" });
    expect(await verdictFor(studentB.id, psychT1.paidLessonId)).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("refuses to issue a code before the order is paid", async () => {
    const product = await createProduct(
      db,
      { kind: "course", nameAr: "علم النفس", nameEn: "Psychology T1", items: [{ resourceType: "course", resourceId: psychT1.course.id }], active: true },
      actor
    );
    const plan = await createPricePlan(db, product.id, { currency: "EGP", amountMinor: 20000, kind: "one_time", period: null, active: true }, actor);
    const { order } = await createOrder(db, { studentId: studentB.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings(), source: "self" });
    await expect(generateCodeForOrder(db, { orderId: order.id, actor })).rejects.toBeTruthy();
    expect(await codesForOrder(db, order.id)).toHaveLength(0);
  });

  it("describes the request scope from REAL rows (no placeholders)", async () => {
    const chain = await chainForLesson(db, philT1.paidLessonId);
    const view = await orderScopeView(db, {
      entitlementSpec: { grants: [{ resourceType: "course", resourceId: chain!.courseId }], recurring: false },
      titleSnapshotAr: "فلسفة ومنطق — الترم الأول",
      titleSnapshotEn: "Philosophy T1",
    });
    const pairs = scopeLinePairs(view);
    const ar = pairs.map((p) => p.title.ar);
    expect(ar).toContain("2026/2027");
    expect(ar).toContain("فلسفة ومنطق");
    expect(ar).toContain("الترم الأول");
    expect(view.grades.map((g) => g.ar)).toContain("الصف الأول الثانوي");
  });
});
