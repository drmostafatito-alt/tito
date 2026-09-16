import { describe, expect, it } from "vitest";
import {
  entitlementCovers,
  resolveAccess,
  scopeCovers,
  type ChainScope,
  type ContentRef,
  type EntitlementLike,
  type EntitlementScope,
} from "~server/entitlements/resolver.server";
import {
  PAYMENT_METHOD_LABELS,
  buildReceiptMessage,
  findPaymentMethod,
  isMethodConfigured,
  isValidWhatsAppNumber,
  visiblePaymentMethods,
  whatsAppDigits,
  whatsAppReceiptHref,
} from "~server/commerce/payment-methods";
import { paymentsSettingsSchema, type PaymentMethodSetting } from "~server/settings/schema";

/**
 * PART 18/19 — STRICT SERVER-SIDE SCOPE MATCHING + the manual-rail/WhatsApp
 * helpers that back it.
 *
 * The rule under test is the one the brief pins down hardest: a code for
 * «فلسفة ومنطق — الترم الأول» must NOT open علم النفس and must NOT open الترم
 * الثاني, while a full-year grant DOES open every term of that same subject/year.
 * Matching is by id only — never by title or slug — so renaming content can
 * never widen or narrow access.
 */

const NOW = 1_700_000_000_000;

// Real owner content model (ids stand in for the actual rows).
const YEAR_2026 = "11111111-1111-4111-8111-111111111111";
const GRADE_1SEC = "22222222-2222-4222-8222-222222222222";
const GRADE_2SEC = "33333333-3333-4333-8333-333333333333";
const SUBJECT_PHILOSOPHY = "44444444-4444-4444-8444-444444444444";
const SUBJECT_PSYCHOLOGY = "55555555-5555-4555-8555-555555555555";
const TERM_1 = "66666666-6666-4666-8666-666666666666";
const TERM_2 = "77777777-7777-4777-8777-777777777777";
const CONTAINER_PHIL_T1 = "88888888-8888-4888-8888-888888888888";
const UNIT_PHIL_T1 = "99999999-9999-4999-8999-999999999999";
const LESSON_PHIL_T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTAINER_PHIL_T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LESSON_PHIL_T2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LESSON_PSYCH_T1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** lesson → unit → term container → subject chain (the real ancestor shape). */
const chainOf = (lessonId: string, containerId: string, subjectId: string): ContentRef[] => [
  { type: "lesson", id: lessonId },
  { type: "unit", id: UNIT_PHIL_T1 },
  { type: "course", id: containerId },
  { type: "subject", id: subjectId },
];

const scopeOf = (over: Partial<EntitlementScope> = {}): EntitlementScope => ({
  kind: "term",
  academicYearId: YEAR_2026,
  subjectId: SUBJECT_PHILOSOPHY,
  gradeId: GRADE_1SEC,
  termId: TERM_1,
  ...over,
});

const entitled = (over: Partial<EntitlementLike> = {}): EntitlementLike => ({
  resourceType: "course",
  resourceId: CONTAINER_PHIL_T1,
  status: "active",
  expiresAt: null,
  ...over,
});

const PHIL_T1_CHAIN = chainOf(LESSON_PHIL_T1, CONTAINER_PHIL_T1, SUBJECT_PHILOSOPHY);
const PHIL_T1_SCOPE: ChainScope = { academicYearId: YEAR_2026, gradeId: GRADE_1SEC, termId: TERM_1 };
const PHIL_T2_SCOPE: ChainScope = { academicYearId: YEAR_2026, gradeId: GRADE_1SEC, termId: TERM_2 };
const PSYCH_T1_SCOPE: ChainScope = { academicYearId: YEAR_2026, gradeId: GRADE_2SEC, termId: TERM_1 };

const paidLesson = { accessLevel: "entitled" as const, status: "published" };
const student = { userId: "student-1", roleRank: 1 };

describe("scopeCovers — term grants are exact (fail-closed)", () => {
  it("opens the lesson it was issued for", () => {
    expect(scopeCovers(scopeOf(), PHIL_T1_CHAIN, PHIL_T1_SCOPE)).toBe(true);
  });

  it("never opens another TERM of the same subject", () => {
    const t2Chain = chainOf(LESSON_PHIL_T2, CONTAINER_PHIL_T2, SUBJECT_PHILOSOPHY);
    expect(scopeCovers(scopeOf(), t2Chain, PHIL_T2_SCOPE)).toBe(false);
  });

  it("never opens another SUBJECT (Philosophy ≠ Psychology)", () => {
    const psychChain = chainOf(LESSON_PSYCH_T1, CONTAINER_PHIL_T1, SUBJECT_PSYCHOLOGY);
    expect(scopeCovers(scopeOf({ subjectId: SUBJECT_PHILOSOPHY }), psychChain, PSYCH_T1_SCOPE)).toBe(false);
  });

  it("never opens another ACADEMIC YEAR", () => {
    expect(scopeCovers(scopeOf(), PHIL_T1_CHAIN, { ...PHIL_T1_SCOPE, academicYearId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })).toBe(false);
  });

  it("never opens another GRADE when the grant narrowed by grade", () => {
    expect(scopeCovers(scopeOf(), PHIL_T1_CHAIN, { ...PHIL_T1_SCOPE, gradeId: GRADE_2SEC })).toBe(false);
  });

  it("a term grant without a termId covers nothing", () => {
    expect(scopeCovers(scopeOf({ termId: null }), PHIL_T1_CHAIN, PHIL_T1_SCOPE)).toBe(false);
  });

  it("fails closed when the node has no resolvable academic scope", () => {
    expect(scopeCovers(scopeOf(), PHIL_T1_CHAIN, null)).toBe(false);
    expect(scopeCovers(scopeOf(), PHIL_T1_CHAIN, {})).toBe(false);
  });

  it("fails closed when the chain has no subject ancestor", () => {
    const orphan: ContentRef[] = [{ type: "lesson", id: LESSON_PHIL_T1 }];
    expect(scopeCovers(scopeOf(), orphan, PHIL_T1_SCOPE)).toBe(false);
  });

  it("fails closed when the entitlement carries no scope", () => {
    expect(scopeCovers(null, PHIL_T1_CHAIN, PHIL_T1_SCOPE)).toBe(false);
  });
});

describe("scopeCovers — full-year grants (PART 19)", () => {
  const fullYear = scopeOf({ kind: "full_year", termId: null });

  it("opens term 1 and term 2 of the same subject/year", () => {
    expect(scopeCovers(fullYear, PHIL_T1_CHAIN, PHIL_T1_SCOPE)).toBe(true);
    expect(scopeCovers(fullYear, chainOf(LESSON_PHIL_T2, CONTAINER_PHIL_T2, SUBJECT_PHILOSOPHY), PHIL_T2_SCOPE)).toBe(true);
  });

  it("also opens a term container published AFTER the grant (no termId in scope)", () => {
    expect(scopeCovers(fullYear, PHIL_T1_CHAIN, { academicYearId: YEAR_2026, gradeId: GRADE_1SEC, termId: null })).toBe(true);
  });

  it("is NOT a blanket isSubscribed — other subjects still denied", () => {
    expect(scopeCovers(fullYear, chainOf(LESSON_PSYCH_T1, CONTAINER_PHIL_T1, SUBJECT_PSYCHOLOGY), PSYCH_T1_SCOPE)).toBe(false);
  });

  it("is NOT a blanket isSubscribed — other years still denied", () => {
    expect(scopeCovers(fullYear, PHIL_T1_CHAIN, { ...PHIL_T1_SCOPE, academicYearId: "ffffffff-ffff-4fff-8fff-ffffffffffff" })).toBe(false);
  });

  it("an unknown scope kind covers nothing", () => {
    const malformed = { ...fullYear, kind: "everything" } as unknown as EntitlementScope;
    expect(scopeCovers(malformed, PHIL_T1_CHAIN, PHIL_T1_SCOPE)).toBe(false);
  });
});

describe("entitlementCovers / resolveAccess — scope is honoured end to end", () => {
  it("a term-scoped entitlement covers the lesson through its scope", () => {
    expect(entitlementCovers(entitled({ scope: scopeOf() }), PHIL_T1_CHAIN, NOW, PHIL_T1_SCOPE)).toBe(true);
  });

  it("inactive / expired entitlements never cover, scope or not", () => {
    expect(entitlementCovers(entitled({ status: "revoked", scope: scopeOf() }), PHIL_T1_CHAIN, NOW, PHIL_T1_SCOPE)).toBe(false);
    expect(entitlementCovers(entitled({ expiresAt: NOW - 1, scope: scopeOf() }), PHIL_T1_CHAIN, NOW, PHIL_T1_SCOPE)).toBe(false);
  });

  it("paid Philosophy T1 lesson: allowed with the right scope, denied for T2", () => {
    const ents = [entitled({ resourceId: null, scope: scopeOf() })];
    expect(
      resolveAccess({ subject: student, resource: paidLesson, chain: PHIL_T1_CHAIN, entitlements: ents, chainScope: PHIL_T1_SCOPE, now: NOW })
    ).toEqual({ allowed: true, reason: "entitlement" });
    expect(
      resolveAccess({
        subject: student,
        resource: paidLesson,
        chain: chainOf(LESSON_PHIL_T2, CONTAINER_PHIL_T2, SUBJECT_PHILOSOPHY),
        entitlements: ents,
        chainScope: PHIL_T2_SCOPE,
        now: NOW,
      })
    ).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("denies Psychology to a Philosophy-only grant", () => {
    expect(
      resolveAccess({
        subject: student,
        resource: paidLesson,
        chain: chainOf(LESSON_PSYCH_T1, CONTAINER_PHIL_T1, SUBJECT_PSYCHOLOGY),
        entitlements: [entitled({ resourceId: null, scope: scopeOf() })],
        chainScope: PSYCH_T1_SCOPE,
        now: NOW,
      })
    ).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("free/authenticated content stays open without any entitlement", () => {
    expect(
      resolveAccess({ subject: student, resource: { accessLevel: "authenticated", status: "published" }, chain: PHIL_T1_CHAIN, entitlements: [], chainScope: PHIL_T1_SCOPE, now: NOW })
    ).toEqual({ allowed: true, reason: "authenticated" });
  });

  it("anonymous users never reach entitled content", () => {
    expect(
      resolveAccess({ subject: { userId: null, roleRank: 0 }, resource: paidLesson, chain: PHIL_T1_CHAIN, entitlements: [entitled({ scope: scopeOf() })], chainScope: PHIL_T1_SCOPE, now: NOW })
    ).toEqual({ allowed: false, reason: "anon" });
  });

  it("free-preview lessons stay visible while locked content is denied", () => {
    expect(
      resolveAccess({ subject: student, resource: { ...paidLesson, freePreview: true }, chain: chainOf(LESSON_PHIL_T2, CONTAINER_PHIL_T2, SUBJECT_PHILOSOPHY), entitlements: [], chainScope: PHIL_T2_SCOPE, now: NOW })
    ).toEqual({ allowed: true, reason: "free_preview" });
  });
});

// ---------------------------------------------------------------------------
// Manual payment rails — nothing is hardcoded, nothing fake is ever shown
// ---------------------------------------------------------------------------

const rail = (over: Partial<PaymentMethodSetting> = {}): PaymentMethodSetting => ({
  id: "instapay",
  key: "instapay",
  enabled: true,
  labelAr: "",
  labelEn: "",
  destination: "",
  accountNameAr: "",
  accountNameEn: "",
  instructionsAr: "",
  instructionsEn: "",
  sortOrder: 0,
  ...over,
});

describe("payment method visibility (PART 12)", () => {
  it("ships every rail DISABLED and EMPTY — no invented numbers", () => {
    const defaults = paymentsSettingsSchema.parse({});
    expect(defaults.methods.map((m) => m.key)).toEqual(["instapay", "vodafone_cash", "etisalat_cash"]);
    expect(defaults.methods.every((m) => m.enabled === false)).toBe(true);
    expect(defaults.methods.every((m) => m.destination === "")).toBe(true);
    expect(visiblePaymentMethods(defaults.methods)).toEqual([]);
  });

  it("a rail is visible only when enabled AND has a destination", () => {
    expect(isMethodConfigured(rail({ enabled: true, destination: "" }))).toBe(false);
    expect(isMethodConfigured(rail({ enabled: false, destination: "01000000000" }))).toBe(false);
    expect(isMethodConfigured(rail({ enabled: true, destination: "01000000000" }))).toBe(true);
    expect(isMethodConfigured(rail({ enabled: true, destination: "   " }))).toBe(false);
  });

  it("falls back to the rail's own name when the owner left labels empty", () => {
    const [m] = visiblePaymentMethods([rail({ enabled: true, destination: "mostafa@instapay" })]);
    expect(m.labelAr).toBe(PAYMENT_METHOD_LABELS.instapay.ar);
    expect(m.labelEn).toBe(PAYMENT_METHOD_LABELS.instapay.en);
    expect(m.destination).toBe("mostafa@instapay");
  });

  it("respects the admin's sort order and hides unconfigured rails", () => {
    const list = visiblePaymentMethods([
      rail({ id: "a", key: "instapay", enabled: true, destination: "x", sortOrder: 2 }),
      rail({ id: "b", key: "vodafone_cash", enabled: true, destination: "y", sortOrder: 1 }),
      rail({ id: "c", key: "etisalat_cash", enabled: false, destination: "z", sortOrder: 0 }),
    ]);
    expect(list.map((m) => m.key)).toEqual(["vodafone_cash", "instapay"]);
  });

  it("findPaymentMethod re-validates server-side by id or key, else null", () => {
    const methods = [rail({ id: "instapay", enabled: true, destination: "x" })];
    expect(findPaymentMethod(methods, "instapay")?.key).toBe("instapay");
    expect(findPaymentMethod(methods, "vodafone_cash")).toBeNull();
    expect(findPaymentMethod(methods, "")).toBeNull();
    expect(findPaymentMethod(methods, "__proto__")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WhatsApp receipt hand-off — click-to-chat only, never an automation claim
// ---------------------------------------------------------------------------

describe("WhatsApp receipt hand-off (PART 13)", () => {
  it("normalises numbers to digits and validates plausibility", () => {
    expect(whatsAppDigits("+20 100-123-4567")).toBe("201001234567");
    expect(isValidWhatsAppNumber("+20 100-123-4567")).toBe(true);
    expect(isValidWhatsAppNumber("")).toBe(false);
    expect(isValidWhatsAppNumber("12345")).toBe(false);
    expect(isValidWhatsAppNumber("1".repeat(16))).toBe(false);
  });

  it("builds a click-to-chat link with the encoded templated message", () => {
    const msg = buildReceiptMessage({
      locale: "ar",
      studentName: "أحمد",
      studentEmail: "ahmed@example.com",
      orderNumber: "ORD-1",
      amount: "150.00",
      currency: "EGP",
      scopeLines: ["السنة الدراسية: 2026/2027", "المادة: فلسفة ومنطق", "الترم: الترم الأول"],
      planLabel: "اشتراك الترم",
      methodLabel: "إنستاباي",
      note: "يرجى إرسال صورة التحويل",
    });
    const href = whatsAppReceiptHref("+20 100 123 4567", msg);
    expect(href).not.toBeNull();
    expect(href!.startsWith("https://wa.me/201001234567?text=")).toBe(true);
    const text = decodeURIComponent(href!.split("?text=")[1]);
    expect(text).toContain("ORD-1");
    expect(text).toContain("150.00 EGP");
    expect(text).toContain("فلسفة ومنطق");
    expect(text).toContain("الترم الأول");
    expect(text).toContain("إنستاباي");
    expect(text).toContain("يرجى إرسال صورة التحويل");
    // the student attaches the receipt themselves — no automation claim
    expect(text).toContain("سأرفق صورة الإيصال");
  });

  it("builds the English variant from the same real order data", () => {
    const msg = buildReceiptMessage({
      locale: "en",
      studentName: "Ahmed",
      studentEmail: "ahmed@example.com",
      orderNumber: "ORD-2",
      amount: "300.00",
      currency: "EGP",
      scopeLines: ["Subject: Philosophy & Logic", "Term: Term 1"],
      planLabel: null,
      methodLabel: "Vodafone Cash",
    });
    expect(msg).toContain("Order number: ORD-2");
    expect(msg).toContain("Amount: 300.00 EGP");
    expect(msg).toContain("Payment method: Vodafone Cash");
    expect(msg).not.toContain("Plan:");
  });

  it("yields NO link when the owner has not configured a WhatsApp number", () => {
    expect(whatsAppReceiptHref("", "hello")).toBeNull();
    expect(whatsAppReceiptHref("   ", "hello")).toBeNull();
    expect(whatsAppReceiptHref("123", "hello")).toBeNull();
  });

  it("never emits a link to a bare wa.me with an empty message", () => {
    expect(whatsAppReceiptHref("+201001234567", "   ")).toBe("https://wa.me/201001234567");
  });

  it("keeps the manual channel honest — no API, no webhook wording", () => {
    const msg = buildReceiptMessage({
      locale: "ar",
      studentName: "أحمد",
      studentEmail: "a@b.c",
      orderNumber: "ORD-3",
      amount: "10.00",
      currency: "EGP",
      scopeLines: [],
      planLabel: null,
      methodLabel: "إنستاباي",
    });
    for (const banned of ["تم الاستلام", "automatically", "webhook", "API"]) {
      expect(msg).not.toContain(banned);
    }
  });
});
