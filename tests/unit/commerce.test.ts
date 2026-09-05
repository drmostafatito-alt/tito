import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  calcDiscountMinor,
  formatMinorUnits,
  formatMoney,
  generateActivationCode,
  normalizeCode,
} from "~server/commerce/money";
import {
  CommerceValidationError,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  activationBatchSchema,
  canTransition,
  discountCreateSchema,
  effectivePriceMinor,
  entitlementSpecSchema,
  periodEndMs,
  pricePlanInputSchema,
  productInputSchema,
  validateItemsForKind,
} from "~server/commerce/service.server";
import type { pricePlans } from "~server/db/schema";

/**
 * Phase 6 pure-function units: integer money math (no floats ever), the
 * PAYMENTS.md §2 state machines, promo/period evaluation, code generation
 * entropy hygiene, and the checkout input contracts.
 */

type PricePlanRow = typeof pricePlans.$inferSelect;

function plan(overrides: Partial<PricePlanRow>): PricePlanRow {
  return {
    id: "p1",
    productId: "prod1",
    currency: "EGP",
    amountMinor: 10_000,
    kind: "one_time",
    period: null,
    periodDays: null,
    fixedEndsAt: null,
    labelAr: null,
    labelEn: null,
    compareAtMinor: null,
    promoPriceMinor: null,
    promoStartsAt: null,
    promoEndsAt: null,
    active: true,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as PricePlanRow;
}

describe("money — integer minor units only", () => {
  it("formats minor units with integer arithmetic", () => {
    expect(formatMinorUnits(0)).toBe("0.00");
    expect(formatMinorUnits(5)).toBe("0.05");
    expect(formatMinorUnits(99)).toBe("0.99");
    expect(formatMinorUnits(100)).toBe("1.00");
    expect(formatMinorUnits(1000)).toBe("10.00"); // 1000 = 10.00 EGP (brief §4)
    expect(formatMinorUnits(123456)).toBe("1234.56");
    expect(formatMinorUnits(-1234)).toBe("-12.34");
  });

  it("never produces the 0.1+0.2 float artifact", () => {
    // 10 + 20 minor units is exactly 30 — no representation error anywhere
    expect(formatMinorUnits(10 + 20)).toBe("0.30");
    expect(formatMoney(10 + 20, "EGP")).toBe("0.30 EGP");
  });

  it("computes percent discounts with floor (integer math)", () => {
    expect(calcDiscountMinor(10_000, "percent", 10)).toBe(1000);
    expect(calcDiscountMinor(999, "percent", 15)).toBe(149); // 149.85 floors
    expect(calcDiscountMinor(10_000, "percent", 100)).toBe(10_000);
    expect(calcDiscountMinor(10_000, "percent", 0)).toBe(0);
  });

  it("clamps fixed discounts at the subtotal and never goes negative", () => {
    expect(calcDiscountMinor(500, "fixed", 1000)).toBe(500);
    expect(calcDiscountMinor(5000, "fixed", 1000)).toBe(1000);
    expect(calcDiscountMinor(5000, "fixed", -100)).toBe(0);
    expect(calcDiscountMinor(5000, "percent", 250)).toBe(5000); // percent clamped to 100
  });
});

describe("PAYMENTS.md §2 state machines", () => {
  it("allows the documented manual-rail path", () => {
    expect(canTransition(PAYMENT_TRANSITIONS, "pending", "under_review")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "under_review", "paid")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "under_review", "failed")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "pending", "paid")).toBe(true); // gateway path
  });

  it("rejects illegal jumps", () => {
    expect(canTransition(PAYMENT_TRANSITIONS, "expired", "paid")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "failed", "paid")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "paid", "under_review")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "refunded", "paid")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "under_review", "pending")).toBe(false);
  });

  it("allows refund transitions from paid only", () => {
    expect(canTransition(PAYMENT_TRANSITIONS, "paid", "refunded")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "paid", "partially_refunded")).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, "pending", "refunded")).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, "pending", "paid")).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, "cancelled", "paid")).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, "paid", "refunded")).toBe(true);
  });
});

describe("server-side price evaluation", () => {
  const now = 1_800_000_000_000;

  it("uses the base amount without a promo", () => {
    expect(effectivePriceMinor(plan({ amountMinor: 5000 }), now)).toBe(5000);
  });

  it("applies promo only strictly inside the window", () => {
    const promo = plan({
      amountMinor: 5000,
      promoPriceMinor: 4000,
      promoStartsAt: now - DAY_MS,
      promoEndsAt: now + DAY_MS,
    });
    expect(effectivePriceMinor(promo, now)).toBe(4000);
    // before window / after window / at the exact end boundary → base amount
    expect(effectivePriceMinor(promo, now - 2 * DAY_MS)).toBe(5000);
    expect(effectivePriceMinor(promo, now + 2 * DAY_MS)).toBe(5000);
    expect(effectivePriceMinor(promo, now + DAY_MS)).toBe(5000);
  });

  it("computes period ends with fixed day counts", () => {
    expect(periodEndMs(plan({ kind: "recurring", period: "monthly" }), now)).toBe(now + 30 * DAY_MS);
    expect(periodEndMs(plan({ kind: "recurring", period: "annual" }), now)).toBe(now + 365 * DAY_MS);
    expect(periodEndMs(plan({ kind: "recurring", period: "term", periodDays: 120 }), now)).toBe(now + 120 * DAY_MS);
    expect(periodEndMs(plan({ kind: "recurring", period: "custom", periodDays: 45 }), now)).toBe(now + 45 * DAY_MS);
    const fixed = now + 90 * DAY_MS;
    expect(periodEndMs(plan({ kind: "recurring", period: "fixed_date", fixedEndsAt: fixed }), now)).toBe(fixed);
  });

  it("refuses recurring plans without a usable period", () => {
    expect(() => periodEndMs(plan({ kind: "recurring", period: null }), now)).toThrow(CommerceValidationError);
    expect(() => periodEndMs(plan({ kind: "recurring", period: "custom", periodDays: null }), now)).toThrow(CommerceValidationError);
  });
});

describe("code hygiene", () => {
  it("normalizes codes case/dash/space-insensitively", () => {
    expect(normalizeCode(" edu-abcd-1234 ")).toBe("EDUABCD1234");
    expect(normalizeCode("EDU ABCD 1234")).toBe("EDUABCD1234");
    expect(normalizeCode("edu_abcd_1234!")).toBe("EDUABCD1234");
  });

  it("generates unique, unambiguous, well-shaped codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const code = generateActivationCode();
      expect(code).toMatch(/^EDU-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      expect(code).not.toMatch(/[01ILO]/); // no ambiguous glyphs
      seen.add(code);
    }
    expect(seen.size).toBe(300); // crypto-random: no collisions in 300 draws
  });
});

describe("input contracts", () => {
  it("rejects malformed entitlement specs", () => {
    expect(entitlementSpecSchema.safeParse({ grants: [] }).success).toBe(false);
    expect(
      entitlementSpecSchema.safeParse({ grants: [{ resourceType: "course", resourceId: "not-a-uuid" }] }).success
    ).toBe(false);
    expect(
      entitlementSpecSchema.safeParse({
        grants: [{ resourceType: "course", resourceId: "11111111-1111-4111-8111-111111111111" }],
        durationDays: null,
        fixedExpiresAt: null,
      }).success
    ).toBe(true);
  });

  it("enforces price-plan consistency rules", () => {
    const base = { currency: "EGP", amountMinor: 10_000 };
    expect(pricePlanInputSchema.safeParse({ ...base, kind: "recurring" }).success).toBe(false); // no period
    expect(pricePlanInputSchema.safeParse({ ...base, kind: "recurring", period: "monthly" }).success).toBe(true);
    expect(pricePlanInputSchema.safeParse({ ...base, period: "custom" }).success).toBe(false); // no periodDays
    expect(pricePlanInputSchema.safeParse({ ...base, period: "custom", periodDays: 90 }).success).toBe(true);
    expect(pricePlanInputSchema.safeParse({ ...base, period: "fixed_date" }).success).toBe(false); // no fixedEndsAt
    expect(pricePlanInputSchema.safeParse({ ...base, period: "fixed_date", fixedEndsAt: Date.now() + DAY_MS }).success).toBe(true);
    // promo needs a window and must be cheaper
    expect(pricePlanInputSchema.safeParse({ ...base, promoPriceMinor: 9000 }).success).toBe(false);
    expect(
      pricePlanInputSchema.safeParse({
        ...base, promoPriceMinor: 9000, promoStartsAt: 1000, promoEndsAt: 2000,
      }).success
    ).toBe(true);
    expect(
      pricePlanInputSchema.safeParse({
        ...base, promoPriceMinor: 11_000, promoStartsAt: 1000, promoEndsAt: 2000,
      }).success
    ).toBe(false);
    // floats are structurally rejected — money is integer minor units
    expect(pricePlanInputSchema.safeParse({ ...base, amountMinor: 10.5 }).success).toBe(false);
  });

  it("binds product kinds to their content items (service validator)", () => {
    const course = { resourceType: "course" };
    const subject = { resourceType: "subject" };
    expect(() => validateItemsForKind("course", [course])).not.toThrow();
    expect(() => validateItemsForKind("course", [subject])).toThrow(CommerceValidationError);
    expect(() => validateItemsForKind("subject", [subject])).not.toThrow();
    expect(() => validateItemsForKind("subject", [course])).toThrow(CommerceValidationError);
    expect(() => validateItemsForKind("bundle", [course, subject])).not.toThrow();
    expect(() => validateItemsForKind("subscription_plan", [subject])).not.toThrow();
    // zod still enforces the item shape
    expect(
      productInputSchema.safeParse({ kind: "bundle", nameAr: "ك", nameEn: "C", items: [] }).success
    ).toBe(false);
  });

  it("validates discount code inputs", () => {
    expect(discountCreateSchema.safeParse({ code: "AB", type: "percent", value: 10 }).success).toBe(false); // too short
    expect(discountCreateSchema.safeParse({ code: "WELCOME", type: "percent", value: 150 }).success).toBe(false); // >100%
    expect(discountCreateSchema.safeParse({ code: "WELCOME", type: "percent", value: 15 }).success).toBe(true);
    expect(discountCreateSchema.safeParse({ code: "WELCOME!", type: "fixed", value: 500 }).success).toBe(false); // charset
    expect(
      discountCreateSchema.safeParse({ code: "WIN", type: "fixed", value: 500, startsAt: 2000, endsAt: 1000 }).success
    ).toBe(false); // inverted window
  });

  it("requires a binding target for activation batches", () => {
    expect(activationBatchSchema.safeParse({ name: "b", count: 5, maxUses: 1 }).success).toBe(false);
    expect(
      activationBatchSchema.safeParse({
        name: "b",
        count: 5,
        maxUses: 1,
        grants: [{ resourceType: "course", resourceId: "11111111-1111-4111-8111-111111111111" }],
      }).success
    ).toBe(true);
    expect(activationBatchSchema.safeParse({ name: "b", count: 5000, maxUses: 1 }).success).toBe(false); // count cap
  });
});
