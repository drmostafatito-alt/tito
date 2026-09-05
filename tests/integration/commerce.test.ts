/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import {
  chainForLesson,
  createCourse, createGrade, createLesson, createProgram, createSubject, createUnit,
} from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { grantEntitlement } from "~server/entitlements/grant.server";
import { updateSettingsGroup } from "~server/settings/service.server";
import { normalizeCode } from "~server/commerce/money";
import { signMockWebhook } from "~server/payments/providers/mock.server";
import {
  CommerceReferenceError,
  CommerceStateError,
  CommerceValidationError,
  activationBatchDetail,
  approveManualPayment,
  archiveProduct,
  canCommerce,
  cancelOrder,
  cancelSubscription,
  confirmManualPayment,
  createDiscountCode,
  createGatewayPayment,
  createOrder,
  createPricePlan,
  createProduct,
  generateActivationBatch,
  orderDetailForStudent,
  ordersForStudent,
  pauseSubscription,
  processPaymentWebhook,
  publicProductBySlug,
  purchasableFor,
  redeemActivationCode,
  refundPayment,
  rejectManualPayment,
  renewSubscription,
  resumeSubscription,
  setActivationCodeStatus,
  setDiscountCodeActive,
  sweepExpiredOrders,
  sweepExpiredSubscriptions,
  unarchiveProduct,
  updateProduct,
} from "~server/commerce/service.server";
import {
  activationCodes,
  discountCodes,
  discountRedemptions,
  entitlements,
  events,
  orderItems,
  orders,
  paymentEvents,
  payments,
  pricePlans,
  productItems,
  products,
  refunds,
  subscriptions,
} from "~server/db/schema";
import { loader as checkoutLoader, action as checkoutAction } from "~/routes/student/checkout.$productSlug";
import { loader as ordersLoader } from "~/routes/student/orders";
import { loader as orderDetailLoader, action as orderDetailAction } from "~/routes/student/orders.$orderNumber";
import { action as activateAction } from "~/routes/student/activate";
import { loader as adminCommerceLoader, action as adminCommerceAction } from "~/routes/admin.commerce";
import { action as webhookAction } from "~/routes/webhooks.payments.$provider";
import { loader as coursePageLoader } from "~/routes/public.courses.$slug";

/**
 * Phase 6 commerce engine on REAL D1 + REAL route loaders/actions:
 * product/price lifecycle, server-side pricing (tamper-proof checkout), the
 * manual payment rail (order → instructions → submit → verify → grant),
 * fulfillment→entitlement→existing resolver integration, atomic activation
 * codes (race-safe), discounts, mock-gateway webhooks (signature, idempotent
 * inbox, amount mismatch), subscriptions, refunds/revocation, IDOR + RBAC.
 * Core invariant asserted throughout: PAYMENT NEVER GRANTS ACCESS DIRECTLY —
 * only verified payment / manual activation → entitlement → resolveAccess.
 */

const db = getDb(env);
const actor = { userId: "00000000-0000-4000-8000-000000000006", role: "super_admin", ipHash: "integration-test" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

let studentA: { id: string; cookie: string };
let studentB: { id: string; cookie: string };
let subjectId: string;
let courseId1: string;
let courseSlug1: string;
let lessonId1: string;
let courseId2: string;
let courseSlug2: string;

async function wipe() {
  for (const table of [
    "activation_code_redemptions", "activation_codes", "activation_code_batches",
    "discount_redemptions", "discount_codes",
    "subscription_events", "subscriptions",
    "refunds", "payment_events", "payments", "order_items", "orders",
    "price_plans", "product_items", "products",
    "entitlements", "events", "audit_logs", "rate_limit_counters",
    "lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function makeStudent(prefix: string) {
  const r = crypto.randomUUID().slice(0, 8);
  const email = `${prefix}-${r}@test.local`;
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const req = () => new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } });
  const reg = await registerUser(env, { email, password: "Str0ngPass!x", fullName: "Commerce Tester" }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed: " + JSON.stringify(loggedIn));
  return { id: reg.userId, cookie: loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

const paySettings = () => ({
  manualEnabled: true,
  manualInstructionsAr: "حوالة إنستاباي إلى 01000000000",
  manualInstructionsEn: "Instapay transfer to 01000000000",
  orderTtlMinutes: 60,
  refundWindowDays: 7,
});

/** Published entitled course + lesson (the content a product will grant). */
async function makeCourse(slugEn: string) {
  const course = await createCourse(
    db,
    {
      subjectId, titleAr: `دورة ${slugEn}`, titleEn: `Course ${slugEn}`, status: "published",
      visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null,
      descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null,
    },
    actor
  );
  const unit = await createUnit(db, { courseId: course.id, titleAr: "وحدة", titleEn: "Unit", status: "published", sortOrder: 0 }, actor);
  const lesson = await createLesson(
    db,
    {
      unitId: unit.id, titleAr: "درس", titleEn: "Lesson", status: "published", accessLevel: "entitled",
      freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null,
    },
    actor
  );
  return { course, lesson };
}

/** Product (course kind, one_time EGP plan) ready for checkout. */
async function makeProduct(amountMinor = 10_000, opts: { kind?: "course" | "subject" | "bundle" | "subscription_plan"; resourceId?: string; resourceType?: "course" | "subject"; active?: boolean; period?: "monthly" | null } = {}) {
  const product = await createProduct(
    db,
    {
      kind: opts.kind ?? "course",
      nameAr: "منتج اختبار",
      nameEn: `Test Product ${crypto.randomUUID().slice(0, 6)}`,
      items: [{ resourceType: opts.resourceType ?? "course", resourceId: opts.resourceId ?? courseId1 }],
      active: opts.active ?? true,
    },
    actor
  );
  const plan = await createPricePlan(
    db,
    product.id,
    {
      currency: "EGP",
      amountMinor,
      kind: opts.period ? "recurring" : "one_time",
      period: opts.period ?? null,
      active: true,
    },
    actor
  );
  return { product, plan };
}

async function studentAccess(studentId: string): Promise<boolean> {
  const chain = await chainForLesson(db, lessonId1);
  if (!chain) throw new Error("no chain");
  const verdict = await resolveContentAccess(db, { userId: studentId, roleRank: 1 }, chain);
  return verdict.allowed;
}

async function entitlementCount(studentId: string): Promise<number> {
  const rows = await db.select({ id: entitlements.id }).from(entitlements).where(eq(entitlements.studentId, studentId));
  return rows.length;
}

async function eventCount(studentId: string, type: string, action?: string): Promise<number> {
  const rows = await db.select({ props: events.props }).from(events).where(and(eq(events.userId, studentId), eq(events.type, type)));
  if (action === undefined) return rows.length;
  return rows.filter((r) => (r.props as { action?: string } | null)?.action === action).length;
}

beforeEach(async () => {
  await wipe();
  await updateSettingsGroup(db, "payments", paySettings(), actor);

  studentA = await makeStudent("buy-a");
  studentB = await makeStudent("buy-b");

  const program = await createProgram(db, { titleAr: "ب", titleEn: "Commerce Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Commerce Grade", status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Commerce Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
  subjectId = subject.id;
  const c1 = await makeCourse("alpha");
  courseId1 = c1.course.id;
  courseSlug1 = c1.course.slug;
  lessonId1 = c1.lesson.id;
  const c2 = await makeCourse("beta");
  courseId2 = c2.course.id;
  courseSlug2 = c2.course.slug;
});

// request helpers -----------------------------------------------------------
const getUrl = (path: string, cookie?: string) =>
  new Request(`https://app.test${path}`, { headers: cookie ? { cookie, "user-agent": UA } : { "user-agent": UA } });
const postForm = (path: string, body: Record<string, string>, cookie: string, ip = "10.9.9.9") =>
  new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { cookie, "user-agent": UA, "cf-connecting-ip": ip, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
const callCheckoutAction = (req: Request, slug: string) =>
  checkoutAction({ context: routeCtx, request: req, params: { productSlug: slug } } as unknown as Parameters<typeof checkoutAction>[0]);
const callOrderDetailLoader = (req: Request, orderNumber: string) =>
  orderDetailLoader({ context: routeCtx, request: req, params: { orderNumber } } as unknown as Parameters<typeof orderDetailLoader>[0]);
const callOrderDetailAction = (req: Request, orderNumber: string) =>
  orderDetailAction({ context: routeCtx, request: req, params: { orderNumber } } as unknown as Parameters<typeof orderDetailAction>[0]);
const callActivateAction = (req: Request) =>
  activateAction({ context: routeCtx, request: req, params: {} } as unknown as Parameters<typeof activateAction>[0]);
const callAdminLoader = (req: Request) =>
  adminCommerceLoader({ context: routeCtx, request: req, params: {} } as unknown as Parameters<typeof adminCommerceLoader>[0]);
const callAdminAction = (req: Request) =>
  adminCommerceAction({ context: routeCtx, request: req, params: {} } as unknown as Parameters<typeof adminCommerceAction>[0]);
const callWebhookAction = (req: Request, provider: string) =>
  webhookAction({ context: routeCtx, request: req, params: { provider } } as unknown as Parameters<typeof webhookAction>[0]);
const callCoursePageLoader = (req: Request, slug: string) =>
  coursePageLoader({ context: routeCtx, request: req, params: { slug } } as unknown as Parameters<typeof coursePageLoader>[0]);

async function catchResponse(p: Promise<unknown>): Promise<Response> {
  try {
    const v = await p;
    if (v instanceof Response) return v;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  throw new Error("handler returned data, not a Response");
}

async function asJson(v: unknown): Promise<Record<string, unknown>> {
  if (v instanceof Response) return (await v.json()) as Record<string, unknown>;
  return v as Record<string, unknown>;
}

// ═══════════════════════════ PRODUCTS & PRICES ═══════════════════════════

describe("products (admin-managed, DB-driven)", () => {
  it("creates a product with items + audit trail; slug is generated", async () => {
    const { product } = await makeProduct();
    expect(product.slug).toMatch(/^[a-z0-9-]+$/);
    const items = await db.select().from(productItems).where(eq(productItems.productId, product.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.resourceType).toBe("course");
    const audits = (await db.run(sql`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'commerce.product.created'`)) as unknown as { results: { n: number }[] };
    expect(Number(audits.results[0]!.n)).toBeGreaterThan(0);
  });

  it("rejects bogus content references (no dangling products)", async () => {
    await expect(
      createProduct(
        db,
        { kind: "course", nameAr: "خ", nameEn: "Bad", items: [{ resourceType: "course", resourceId: "11111111-1111-4111-8111-111111111111" }], active: true },
        actor
      )
    ).rejects.toThrow(CommerceReferenceError);
  });

  it("enforces kind↔item binding (course product cannot carry a subject item)", async () => {
    await expect(
      createProduct(db, { kind: "course", nameAr: "خ", nameEn: "Mismatch", items: [{ resourceType: "subject", resourceId: subjectId }], active: true }, actor)
    ).rejects.toThrow(CommerceValidationError);
  });

  it("updates + archives + unarchives (archive blocks checkout, never deletes)", async () => {
    const { product } = await makeProduct();
    await updateProduct(db, product.id, { nameEn: "Renamed", active: false }, actor);
    let row = (await db.select().from(products).where(eq(products.id, product.id)))[0]!;
    expect(row.nameEn).toBe("Renamed");
    expect(row.active).toBe(false);
    await expect(createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: (await db.select({ id: pricePlans.id }).from(pricePlans).where(eq(pricePlans.productId, product.id)))[0]!.id, paymentsSettings: paySettings() })).rejects.toThrow(CommerceValidationError);
    await updateProduct(db, product.id, { active: true }, actor);
    await archiveProduct(db, product.id, actor);
    row = (await db.select().from(products).where(eq(products.id, product.id)))[0]!;
    expect(row.archivedAt).not.toBeNull();
    await unarchiveProduct(db, product.id, actor);
    row = (await db.select().from(products).where(eq(products.id, product.id)))[0]!;
    expect(row.archivedAt).toBeNull();
  });

  it("price plans: recurring only for subscription_plan products; promo needs a cheaper price + window", async () => {
    const { product } = await makeProduct();
    await expect(
      createPricePlan(db, product.id, { currency: "EGP", amountMinor: 5000, kind: "recurring", period: "monthly", active: true }, actor)
    ).rejects.toThrow(CommerceValidationError);
    await expect(
      createPricePlan(db, product.id, { currency: "EGP", amountMinor: 5000, promoPriceMinor: 6000, promoStartsAt: 1, promoEndsAt: 2, active: true }, actor)
    ).rejects.toThrow(); // zod refine
    const ok = await createPricePlan(db, product.id, { currency: "EGP", amountMinor: 5000, active: false }, actor);
    expect(ok.active).toBe(false); // created inactive until the admin flips it
  });
});

// ═══════════════════════════ CHECKOUT / ORDERS ═══════════════════════════

describe("checkout — server-side pricing, idempotency, entitlement guards", () => {
  it("creates order + frozen-spec item + pending manual payment with instructions snapshot", async () => {
    const { product, plan } = await makeProduct(12_345);
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    expect(r.reused).toBe(false);
    expect(r.order.status).toBe("pending");
    expect(r.order.totalMinor).toBe(12_345);
    expect(r.order.currency).toBe("EGP");
    expect(r.order.orderNumber).toMatch(/^EC-/);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, r.order.id));
    expect(items).toHaveLength(1);
    const spec = items[0]!.entitlementSpec as { grants: { resourceType: string; resourceId: string }[] };
    expect(spec.grants).toEqual([{ resourceType: "course", resourceId: courseId1 }]);
    const pays = await db.select().from(payments).where(eq(payments.orderId, r.order.id));
    expect(pays).toHaveLength(1);
    expect(pays[0]!.provider).toBe("manual");
    expect(pays[0]!.status).toBe("pending");
    const instr = pays[0]!.instructions as { reference: string; instructionsAr: string };
    expect(instr.reference).toBe(r.order.orderNumber);
    expect(instr.instructionsAr).toContain("إنستاباي");
    // an order alone grants NOTHING
    expect(await studentAccess(studentA.id)).toBe(false);
    expect(await entitlementCount(studentA.id)).toBe(0);
  });

  it("dedupes double submissions: same pending plan → same order reused, one payment row", async () => {
    const { product, plan } = await makeProduct();
    const first = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const second = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    expect(second.reused).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    const pays = await db.select({ id: payments.id }).from(payments).where(eq(payments.orderId, first.order.id));
    expect(pays).toHaveLength(1);
    const ordersAll = await db.select({ id: orders.id }).from(orders);
    expect(ordersAll).toHaveLength(1);
  });

  it("refuses when already entitled, plan inactive/mismatched, or the rail is off", async () => {
    const { product, plan } = await makeProduct();
    await grantEntitlement(db, { studentId: studentA.id, resourceType: "course", resourceId: courseId1, days: null }, actor);
    await expect(createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() })).rejects.toThrow(/already_entitled|already_subscribed/);

    const other = await makeProduct(9000, { resourceId: courseId2 });
    await expect(createOrder(db, { studentId: studentB.id, productId: product.id, pricePlanId: other.plan.id, paymentsSettings: paySettings() })).rejects.toThrow(CommerceValidationError); // plan of another product
    const { product: p3, plan: pl3 } = await makeProduct();
    await db.update(pricePlans).set({ active: false }).where(eq(pricePlans.id, pl3.id));
    await expect(createOrder(db, { studentId: studentB.id, productId: p3.id, pricePlanId: pl3.id, paymentsSettings: paySettings() })).rejects.toThrow(CommerceValidationError);
    await expect(createOrder(db, { studentId: studentB.id, productId: p3.id, pricePlanId: pl3.id, paymentsSettings: { ...paySettings(), manualEnabled: false } })).rejects.toThrow(/checkout_disabled/);
  });

  it("route: client-supplied amount/currency garbage is ignored — DB total is the server price", async () => {
    const { product, plan } = await makeProduct(25_000);
    const res = await callCheckoutAction(
      postForm(`/checkout/${product.slug}`, {
        _action: "create_order",
        pricePlanId: plan.id,
        // tampering attempts — none of these are read by the server
        amountMinor: "1",
        totalMinor: "1",
        currency: "USD",
        price: "0.01",
      }, studentA.cookie),
      product.slug
    );
    expect(res).toBeInstanceOf(Response);
    const loc = (res as Response).headers.get("location") ?? "";
    expect(loc).toMatch(/^\/orders\/EC-/);
    const created = (await db.select().from(orders))[0]!;
    expect(created.totalMinor).toBe(25_000);
    expect(created.currency).toBe("EGP");
    expect(created.studentId).toBe(studentA.id);
  });

  it("route: price plan of another product → price_unavailable, no order created", async () => {
    const { product } = await makeProduct();
    const other = await makeProduct(9000, { resourceId: courseId2 });
    const data = await asJson(await callCheckoutAction(
      postForm(`/checkout/${product.slug}`, { _action: "create_order", pricePlanId: other.plan.id }, studentA.cookie),
      product.slug
    ));
    expect(data.error).toBe("price_unavailable");
    expect(await db.select({ id: orders.id }).from(orders)).toHaveLength(0);
  });

  it("route: anonymous checkout is redirected to login", async () => {
    const { product } = await makeProduct();
    const res = await catchResponse(callCheckoutAction(
      new Request(`https://app.test/checkout/${product.slug}`, { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" }, body: "_action=create_order" }),
      product.slug
    ));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login?next=");
  });

  it("route: checkout loader exposes server-computed prices only", async () => {
    const { product, plan } = await makeProduct(15_000);
    const data = (await checkoutLoader({ context: routeCtx, request: getUrl(`/checkout/${product.slug}`, studentA.cookie), params: { productSlug: product.slug } } as unknown as Parameters<typeof checkoutLoader>[0])) as unknown as {
      plans: { id: string; effectiveMinor: number; currency: string }[];
    };
    expect(data.plans).toHaveLength(1);
    expect(data.plans[0]!.id).toBe(plan.id);
    expect(data.plans[0]!.effectiveMinor).toBe(15_000);
  });

  it("cancels a pending order; confirm after cancel is a state error", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    expect(await cancelOrder(db, { studentId: studentA.id, orderId: r.order.id })).toBe(true);
    const row = (await db.select().from(orders).where(eq(orders.id, r.order.id)))[0]!;
    expect(row.status).toBe("cancelled");
    const pays = await db.select().from(payments).where(eq(payments.orderId, r.order.id));
    expect(pays[0]!.status).toBe("cancelled");
    await expect(confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "TX1", paymentsSettings: paySettings() })).rejects.toThrow(CommerceStateError);
    // cancelling someone else's order is refused outright
    const p2 = await makeProduct(5000, { resourceId: courseId2 });
    const r2 = await createOrder(db, { studentId: studentA.id, productId: p2.product.id, pricePlanId: p2.plan.id, paymentsSettings: paySettings() });
    await expect(cancelOrder(db, { studentId: studentB.id, orderId: r2.order.id })).rejects.toThrow(CommerceReferenceError);
    const stillPending = (await db.select().from(orders).where(eq(orders.id, r2.order.id)))[0]!;
    expect(stillPending.status).toBe("pending");
  });

  it("sweep expires stale pending orders (PAYMENTS.md §4 TTL)", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    await db.run(sql`UPDATE orders SET created_at = created_at - 7200000 WHERE id = ${r.order.id}`);
    expect(await sweepExpiredOrders(db, 60)).toBe(1);
    const row = (await db.select().from(orders).where(eq(orders.id, r.order.id)))[0]!;
    expect(row.status).toBe("expired");
  });
});

// ═══════════════════════════ MANUAL PAYMENT RAIL ═══════════════════════════

describe("manual rail — submit evidence → admin verify → grant (never before)", () => {
  it("confirm moves pending→under_review WITHOUT granting anything", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "INSTA-555", note: "تم التحويل", paymentsSettings: paySettings() });
    const pay = (await db.select().from(payments).where(eq(payments.id, c.paymentId)))[0]!;
    expect(pay.status).toBe("under_review");
    const meta = pay.metadata as { evidence: { transferReference: string } };
    expect(meta.evidence.transferReference).toBe("INSTA-555");
    // THE core invariant: submitted reference ≠ access
    expect(await entitlementCount(studentA.id)).toBe(0);
    expect(await studentAccess(studentA.id)).toBe(false);
  });

  it("confirm is ownership-scoped and rejects empty references", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    await expect(confirmManualPayment(db, { studentId: studentB.id, orderId: r.order.id, transferReference: "X", paymentsSettings: paySettings() })).rejects.toThrow(CommerceReferenceError);
    await expect(confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "   ", paymentsSettings: paySettings() })).rejects.toThrow(CommerceValidationError);
  });

  it("approve with wrong amount → amount_mismatch, still no entitlement", async () => {
    const { product, plan } = await makeProduct(10_000);
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "TX", paymentsSettings: paySettings() });
    await expect(approveManualPayment(db, { paymentId: c.paymentId, receivedAmountMinor: 9_999, actor })).rejects.toThrow(CommerceValidationError);
    expect(await entitlementCount(studentA.id)).toBe(0);
  });

  it("approve with exact amount → paid + fulfilled + entitlement + resolver allows + exactly one purchase event", async () => {
    const { product, plan } = await makeProduct(10_000);
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "TX", paymentsSettings: paySettings() });
    const out = await approveManualPayment(db, { paymentId: c.paymentId, receivedAmountMinor: 10_000, actor });
    expect(out.alreadyProcessed).toBe(false);
    expect(out.grantedCount).toBe(1);
    const pay = (await db.select().from(payments).where(eq(payments.id, c.paymentId)))[0]!;
    expect(pay.status).toBe("paid");
    expect(pay.paidAt).not.toBeNull();
    const order = (await db.select().from(orders).where(eq(orders.id, r.order.id)))[0]!;
    expect(order.status).toBe("paid");
    const ent = await db.select().from(entitlements).where(eq(entitlements.studentId, studentA.id));
    expect(ent).toHaveLength(1);
    expect(ent[0]!.sourceType).toBe("order_item");
    expect(await studentAccess(studentA.id)).toBe(true); // ← existing resolver, no new authorization system
    expect(await eventCount(studentA.id, "purchase")).toBe(1);
  });

  it("approve is idempotent: replay grants nothing twice, no duplicate events/audit grants", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "TX", paymentsSettings: paySettings() });
    await approveManualPayment(db, { paymentId: c.paymentId, receivedAmountMinor: 10_000, actor });
    const again = await approveManualPayment(db, { paymentId: c.paymentId, receivedAmountMinor: 10_000, actor });
    expect(again.alreadyProcessed).toBe(true);
    expect(again.grantedCount).toBe(0);
    expect(await entitlementCount(studentA.id)).toBe(1);
    expect(await eventCount(studentA.id, "purchase")).toBe(1);
  });

  it("reject → failed, no entitlement; student may resubmit on a NEW payment row", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "BAD", paymentsSettings: paySettings() });
    expect(await rejectManualPayment(db, { paymentId: c.paymentId, reason: "reference not found in bank statement", actor })).toBe(true);
    expect(await entitlementCount(studentA.id)).toBe(0);
    expect(await studentAccess(studentA.id)).toBe(false);
    const c2 = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "GOOD", paymentsSettings: paySettings() });
    expect(c2.paymentId).not.toBe(c.paymentId);
    const pays = await db.select().from(payments).where(eq(payments.orderId, r.order.id));
    expect(pays).toHaveLength(2);
    const out = await approveManualPayment(db, { paymentId: c2.paymentId, receivedAmountMinor: 10_000, actor });
    expect(out.grantedCount).toBe(1);
  });

  it("approving without confirmation (still pending) is a state error — admin cannot skip the rail", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const pay = (await db.select().from(payments).where(eq(payments.orderId, r.order.id)))[0]!;
    await expect(approveManualPayment(db, { paymentId: pay.id, receivedAmountMinor: 10_000, actor })).rejects.toThrow(CommerceStateError);
  });

  it("fake paid: forcing order/payment rows to paid WITHOUT fulfillment grants no access (paid ≠ authorization)", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    await db.run(sql`UPDATE orders SET status = 'paid' WHERE id = ${r.order.id}`);
    await db.run(sql`UPDATE payments SET status = 'paid' WHERE order_id = ${r.order.id}`);
    expect(await entitlementCount(studentA.id)).toBe(0);
    expect(await studentAccess(studentA.id)).toBe(false); // resolver reads entitlements ONLY
  });

  it("route: student confirm + cancel flow end-to-end through the order page action", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const ok = await asJson(await callOrderDetailAction(
      postForm(`/orders/${r.order.orderNumber}`, { _action: "confirm_payment", transferReference: "TX-77", note: "" }, studentA.cookie),
      r.order.orderNumber
    ));
    expect(ok.ok).toBe(true);
    expect(await entitlementCount(studentA.id)).toBe(0); // still nothing granted
    // IDOR: student B cannot even see the order (404-shaped)
    const res = await catchResponse(callOrderDetailLoader(getUrl(`/orders/${r.order.orderNumber}`, studentB.cookie), r.order.orderNumber));
    expect(res.status).toBe(404);
    const resAct = await catchResponse(callOrderDetailAction(
      postForm(`/orders/${r.order.orderNumber}`, { _action: "cancel_order" }, studentB.cookie),
      r.order.orderNumber
    ));
    expect(resAct.status).toBe(404);
  });

  it("service: orderDetailForStudent is null for non-owners; orders list is scoped", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    expect(await orderDetailForStudent(db, r.order.orderNumber, studentB.id)).toBeNull();
    expect(await orderDetailForStudent(db, r.order.orderNumber, studentA.id)).not.toBeNull();
    const listA = await ordersForStudent(db, studentA.id, 60);
    expect(listA).toHaveLength(1);
    const listB = await ordersForStudent(db, studentB.id, 60);
    expect(listB).toHaveLength(0);
  });
});

// ═══════════════════════════ REFUND / REVOCATION ═══════════════════════════

describe("refunds — immutable history, access revoked via the existing resolver", () => {
  it("refund: paid→refunded, entitlement revoked, resolver denies, history kept, idempotent replay", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "TX", paymentsSettings: paySettings() });
    await approveManualPayment(db, { paymentId: c.paymentId, receivedAmountMinor: 10_000, actor });
    expect(await studentAccess(studentA.id)).toBe(true);

    expect(await refundPayment(db, { paymentId: c.paymentId, reason: "student request", actor, refundWindowDays: 7 })).toBe(true);
    const pay = (await db.select().from(payments).where(eq(payments.id, c.paymentId)))[0]!;
    expect(pay.status).toBe("refunded");
    const order = (await db.select().from(orders).where(eq(orders.id, r.order.id)))[0]!;
    expect(order.status).toBe("refunded");
    const refundRows = await db.select().from(refunds);
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0]!.amountMinor).toBe(10_000);
    const ent = (await db.select().from(entitlements).where(eq(entitlements.studentId, studentA.id)))[0]!;
    expect(ent.revokedAt).not.toBeNull();
    expect(ent.revokeReason).toContain("refund:");
    expect(await studentAccess(studentA.id)).toBe(false); // revoked → denied by the SAME resolver
    // purchase history is NEVER deleted
    expect(await eventCount(studentA.id, "purchase", "refunded")).toBe(1);
    // idempotent replay
    expect(await refundPayment(db, { paymentId: c.paymentId, reason: "student request", actor, refundWindowDays: 7 })).toBe(true);
    expect(await db.select({ id: refunds.id }).from(refunds)).toHaveLength(1);
  });

  it("refund window enforced: outside window → refund_window_closed", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "TX", paymentsSettings: paySettings() });
    await approveManualPayment(db, { paymentId: c.paymentId, receivedAmountMinor: 10_000, actor });
    await db.run(sql`UPDATE payments SET paid_at = paid_at - ${10 * 86_400_000} WHERE id = ${c.paymentId}`);
    await expect(refundPayment(db, { paymentId: c.paymentId, reason: "late", actor, refundWindowDays: 7 })).rejects.toThrow(CommerceValidationError);
    // window 0 = unlimited
    expect(await refundPayment(db, { paymentId: c.paymentId, reason: "late but allowed", actor, refundWindowDays: 0 })).toBe(true);
  });

  it("refunding a non-paid payment is a state error", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const pay = (await db.select().from(payments).where(eq(payments.orderId, r.order.id)))[0]!;
    await expect(refundPayment(db, { paymentId: pay.id, reason: "x", actor, refundWindowDays: 0 })).rejects.toThrow(CommerceStateError);
  });
});

// ═══════════════════════════ ACTIVATION CODES ═══════════════════════════

describe("activation codes — hashed, atomic, race-safe, single-use", () => {
  it("batch generation stores ONLY hashes + prefix; plaintext returned once", async () => {
    const { product } = await makeProduct();
    const gen = await generateActivationBatch(db, { name: "دفعة أولى", count: 5, maxUses: 1, productId: product.id }, actor);
    expect(gen.codes).toHaveLength(5);
    expect(new Set(gen.codes).size).toBe(5);
    const rows = await db.select().from(activationCodes);
    expect(rows).toHaveLength(5);
    const dump = JSON.stringify(rows);
    for (const code of gen.codes) expect(dump).not.toContain(code); // plaintext never persisted
    expect(rows[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.prefix.length).toBeGreaterThan(0);
    expect(rows[0]!.status).toBe("active");
    expect(rows[0]!.maxUses).toBe(1);
  });

  it("valid redemption grants through the entitlement table; resolver allows", async () => {
    const { product } = await makeProduct();
    const gen = await generateActivationBatch(db, { name: "b", count: 2, maxUses: 1, productId: product.id }, actor);
    const out = await redeemActivationCode(db, { studentId: studentA.id, code: gen.codes[0]! });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.grantsCount).toBe(1);
    expect(await entitlementCount(studentA.id)).toBe(1);
    expect(await studentAccess(studentA.id)).toBe(true);
    expect(await eventCount(studentA.id, "activation_redeem")).toBe(1);
    const rows = await db.select().from(activationCodes);
    expect(rows[0]!.useCount).toBe(1);
    const redemptions = await db.select().from((await import("~server/db/schema")).activationCodeRedemptions);
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]!.studentId).toBe(studentA.id);
    expect(redemptions[0]!.entitlementId).not.toBeNull();
  });

  it("rejects invalid, disabled, expired, exhausted and double redemption with precise reasons", async () => {
    const { product } = await makeProduct();
    const gen = await generateActivationBatch(db, { name: "b", count: 4, maxUses: 1, productId: product.id }, actor);
    const [c0, c1, c2, c3] = gen.codes as [string, string, string, string];

    expect(await redeemActivationCode(db, { studentId: studentA.id, code: "EDU-XXXX-XXXX-XXXX" })).toEqual({ ok: false, reason: "invalid" });

    const all = await db.select().from(activationCodes).orderBy(desc(activationCodes.createdAt));
    const h1 = await hashOf(c1);
    await setActivationCodeStatus(db, all.find((r) => r.codeHash === h1)!.id, "disabled", actor);
    expect(await redeemActivationCode(db, { studentId: studentA.id, code: c1 })).toEqual({ ok: false, reason: "disabled" });

    await db.run(sql`UPDATE activation_codes SET expires_at = 1 WHERE code_hash = ${await hashOf(c2)}`);
    expect(await redeemActivationCode(db, { studentId: studentA.id, code: c2 })).toEqual({ ok: false, reason: "expired" });

    expect((await redeemActivationCode(db, { studentId: studentA.id, code: c0 })).ok).toBe(true);
    // same student again → already_redeemed (unique code+student), entitlements unchanged
    expect(await redeemActivationCode(db, { studentId: studentA.id, code: c0 })).toEqual({ ok: false, reason: "already_redeemed" });
    expect(await entitlementCount(studentA.id)).toBe(1);
    // a different student → exhausted (maxUses 1)
    expect(await redeemActivationCode(db, { studentId: studentB.id, code: c0 })).toEqual({ ok: false, reason: "exhausted" });
    expect(await entitlementCount(studentB.id)).toBe(0);

    // multi-use code: two distinct students OK, third exhausted
    const multi = await generateActivationBatch(db, { name: "m", count: 1, maxUses: 2, productId: product.id }, actor);
    expect((await redeemActivationCode(db, { studentId: studentB.id, code: multi.codes[0]! })).ok).toBe(true);
    const studentC = await makeStudent("buy-c");
    expect((await redeemActivationCode(db, { studentId: studentC.id, code: multi.codes[0]! })).ok).toBe(true);
    const studentD = await makeStudent("buy-d");
    expect(await redeemActivationCode(db, { studentId: studentD.id, code: multi.codes[0]! })).toEqual({ ok: false, reason: "exhausted" });
    void c3;
  });

  it("CONCURRENT race: two students redeem one single-use code → exactly one wins, one entitlement set", async () => {
    const { product } = await makeProduct();
    const gen = await generateActivationBatch(db, { name: "race", count: 1, maxUses: 1, productId: product.id }, actor);
    const code = gen.codes[0]!;
    const [ra, rb] = await Promise.all([
      redeemActivationCode(db, { studentId: studentA.id, code }),
      redeemActivationCode(db, { studentId: studentB.id, code }),
    ]);
    const winners = [ra, rb].filter((r) => r.ok);
    const losers = [ra, rb].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as { reason: string }).reason).toMatch(/exhausted|already_redeemed/);
    const rows = await db.select().from(activationCodes);
    expect(rows[0]!.useCount).toBe(1); // no double-spend even though both raced
    const entA = await entitlementCount(studentA.id);
    const entB = await entitlementCount(studentB.id);
    expect(entA + entB).toBe(1); // exactly one grant set in the whole system
    expect(await studentAccess(studentA.id)).toBe(entA === 1);
    expect(await studentAccess(studentB.id)).toBe(entB === 1);
  });

  it("route: redemption through /activate with student cookie; garbage → invalid", async () => {
    const { product } = await makeProduct();
    const gen = await generateActivationBatch(db, { name: "b", count: 1, maxUses: 1, productId: product.id }, actor);
    const bad = await asJson(await callActivateAction(postForm("/activate", { _action: "redeem", code: "EDU-0000-0000-0000" }, studentA.cookie)));
    expect(bad.error).toBe("invalid");
    const good = await asJson(await callActivateAction(postForm("/activate", { _action: "redeem", code: gen.codes[0]! }, studentA.cookie)));
    expect(good.ok).toBe(true);
    expect(good.grants).toBe(1);
    expect(await studentAccess(studentA.id)).toBe(true);
  });

  it("admin batch detail exposes hashes/status/uses only — never plaintext", async () => {
    const { product } = await makeProduct();
    const gen = await generateActivationBatch(db, { name: "b", count: 3, maxUses: 1, productId: product.id }, actor);
    const detail = await activationBatchDetail(db, gen.batchId);
    expect(detail.batch.name).toBe("b");
    expect(detail.codes).toHaveLength(3);
    expect(detail.redemptions).toHaveLength(0);
    const dump = JSON.stringify(detail.codes);
    for (const code of gen.codes) expect(dump).not.toContain(code);
    expect(dump).not.toContain("codeHash"); // the admin detail view doesn't even leak hashes
  });
});

async function hashOf(code: string): Promise<string> {
  const { sha256Hex } = await import("~server/http/rate-limit.server");
  return sha256Hex(normalizeCode(code));
}

// ═══════════════════════════ DISCOUNTS ═══════════════════════════

describe("discount codes — hashed storage, server-side limits", () => {
  it("percent discount: total = subtotal − floor(pct); redemption recorded; used_count up", async () => {
    const { product, plan } = await makeProduct(10_000);
    const d = await createDiscountCode(db, { code: "WELCOME10", type: "percent", value: 15, maxUses: 10, perUserLimit: 1, minOrderMinor: null, startsAt: null, endsAt: null, active: true }, actor);
    const rows = await db.select().from(discountCodes);
    expect(rows[0]!.codeHash).not.toContain("WELCOME10");
    expect(rows[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.prefix).toBe("WELC"); // normalized prefix kept for admin search
    expect(rows[0]!.id).toBe(d.id);

    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, discountCode: "welcome-10", paymentsSettings: paySettings() }); // normalization: case/dash-insensitive
    expect(r.discountMinor).toBe(1500); // floor(10000 * 15%)
    expect(r.order.subtotalMinor).toBe(10_000);
    expect(r.order.totalMinor).toBe(8500);
    const redemptions = await db.select().from(discountRedemptions);
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]!.orderId).toBe(r.order.id);
  });

  it("unknown code → generic discount_invalid (no existence oracle); inactive code same", async () => {
    const { product, plan } = await makeProduct();
    await expect(createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, discountCode: "NOPE123", paymentsSettings: paySettings() })).rejects.toThrow(/discount_invalid/);
    const d = await createDiscountCode(db, { code: "HIDDEN99", type: "percent", value: 10, maxUses: 5, perUserLimit: 1, minOrderMinor: null, startsAt: null, endsAt: null, active: false }, actor);
    await expect(createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, discountCode: "HIDDEN99", paymentsSettings: paySettings() })).rejects.toThrow(/discount_invalid/);
    await setDiscountCodeActive(db, d.id, true, actor);
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, discountCode: "HIDDEN99", paymentsSettings: paySettings() });
    expect(r.discountMinor).toBe(1000);
  });

  it("limits: max_uses exhausted, per-user limit, min order", async () => {
    const p1 = await makeProduct(10_000);
    const p2 = await makeProduct(10_000, { resourceId: courseId2 });
    await createDiscountCode(db, { code: "ONCE123", type: "fixed", value: 500, maxUses: 1, perUserLimit: 1, minOrderMinor: null, startsAt: null, endsAt: null, active: true }, actor);
    const r1 = await createOrder(db, { studentId: studentA.id, productId: p1.product.id, pricePlanId: p1.plan.id, discountCode: "ONCE123", paymentsSettings: paySettings() });
    expect(r1.discountMinor).toBe(500);
    await expect(createOrder(db, { studentId: studentB.id, productId: p2.product.id, pricePlanId: p2.plan.id, discountCode: "ONCE123", paymentsSettings: paySettings() })).rejects.toThrow(/discount_exhausted/);

    await createDiscountCode(db, { code: "PERUSER", type: "fixed", value: 300, maxUses: 100, perUserLimit: 1, minOrderMinor: null, startsAt: null, endsAt: null, active: true }, actor);
    const p3 = await makeProduct(10_000, { resourceId: courseId2 });
    const rA = await createOrder(db, { studentId: studentA.id, productId: p3.product.id, pricePlanId: p3.plan.id, discountCode: "PERUSER", paymentsSettings: paySettings() });
    expect(rA.discountMinor).toBe(300);
    const p4 = await makeProduct(10_000, { resourceId: courseId2 });
    await expect(createOrder(db, { studentId: studentA.id, productId: p4.product.id, pricePlanId: p4.plan.id, discountCode: "PERUSER", paymentsSettings: paySettings() })).rejects.toThrow(/discount_user_limit/);

    await createDiscountCode(db, { code: "MINORD1", type: "fixed", value: 5000, maxUses: 100, perUserLimit: 5, minOrderMinor: 50_000, startsAt: null, endsAt: null, active: true }, actor);
    await expect(createOrder(db, { studentId: studentB.id, productId: p1.product.id, pricePlanId: p1.plan.id, discountCode: "MINORD1", paymentsSettings: paySettings() })).rejects.toThrow(/discount_min_order|already/);
  });
});

// ═══════════════════════════ GATEWAY WEBHOOKS (MOCK) ═══════════════════════════

const SECRET = env.MOCK_PAYMENTS_SECRET as string;

function webhookRequest(body: object, signature: string | null) {
  const raw = JSON.stringify(body);
  return {
    raw,
    req: new Request("https://app.test/webhooks/payments/mock", {
      method: "POST",
      headers: signature === null ? { "content-type": "application/json" } : { "content-type": "application/json", "x-mock-signature": signature },
      body: raw,
    }),
  };
}

describe("webhooks — signature-verified, idempotent, no fulfillment before verification", () => {
  it("signed payment.paid webhook fulfills exactly once; inbox records signature_valid=1", async () => {
    const { product, plan } = await makeProduct(20_000);
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const pay = await createGatewayPayment(db, env, { orderId: r.order.id, providerId: "mock", returnUrl: "https://app.test/orders" });
    expect(pay.provider).toBe("mock");
    expect(pay.reference).toMatch(/^mockpay_/);

    const body = { provider_event_id: "evt_1", type: "payment.paid", reference: pay.reference, amount_minor: 20_000, currency: "EGP" };
    const { req, raw } = webhookRequest(body, await signMockWebhook(SECRET, JSON.stringify(body)));
    const out = await processPaymentWebhook(db, env, { providerId: "mock", request: req, rawBody: raw });
    expect(out).toEqual({ status: 200, result: "fulfilled" });
    const row = (await db.select().from(payments).where(eq(payments.id, pay.id)))[0]!;
    expect(row.status).toBe("paid");
    expect(await entitlementCount(studentA.id)).toBe(1);
    expect(await studentAccess(studentA.id)).toBe(true);
    const inbox = await db.select().from(paymentEvents);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.signatureValid).toBe(true);
    expect(inbox[0]!.processedAt).not.toBeNull();
    expect(inbox[0]!.processingResult).toBe("fulfilled");
  });

  it("forged signature → 400 rejected, recorded signature_valid=0, NO entitlement", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const pay = await createGatewayPayment(db, env, { orderId: r.order.id, providerId: "mock", returnUrl: "https://app.test/orders" });
    const body = { provider_event_id: "evt_forged", type: "payment.paid", reference: pay.reference, amount_minor: 10_000 };
    const { req, raw } = webhookRequest(body, "deadbeef".repeat(8));
    const out = await processPaymentWebhook(db, env, { providerId: "mock", request: req, rawBody: raw });
    expect(out.status).toBe(400);
    expect(out.result).toBe("rejected");
    expect(await entitlementCount(studentA.id)).toBe(0);
    const inbox = await db.select().from(paymentEvents);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.signatureValid).toBe(false);
    expect(inbox[0]!.processingResult).toBe("rejected:invalid_signature");
  });

  it("replayed provider_event_id → duplicate, provider-ack 200, fulfillment stays single", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const pay = await createGatewayPayment(db, env, { orderId: r.order.id, providerId: "mock", returnUrl: "https://app.test/orders" });
    const body = { provider_event_id: "evt_replay", type: "payment.paid", reference: pay.reference, amount_minor: 10_000 };
    const sig = await signMockWebhook(SECRET, JSON.stringify(body));
    const first = webhookRequest(body, sig);
    expect((await processPaymentWebhook(db, env, { providerId: "mock", request: first.req, rawBody: first.raw })).result).toBe("fulfilled");
    const second = webhookRequest(body, sig);
    const out2 = await processPaymentWebhook(db, env, { providerId: "mock", request: second.req, rawBody: second.raw });
    expect(out2).toEqual({ status: 200, result: "duplicate" });
    expect(await entitlementCount(studentA.id)).toBe(1);
    expect(await eventCount(studentA.id, "purchase")).toBe(1);
    expect(await db.select({ id: paymentEvents.id }).from(paymentEvents)).toHaveLength(1); // inbox unique on provider_event_id
  });

  it("amount mismatch on a signed webhook → flagged under_review, NEVER auto-fulfilled", async () => {
    const { product, plan } = await makeProduct(10_000);
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const pay = await createGatewayPayment(db, env, { orderId: r.order.id, providerId: "mock", returnUrl: "https://app.test/orders" });
    const body = { provider_event_id: "evt_short", type: "payment.paid", reference: pay.reference, amount_minor: 5_000 };
    const { req, raw } = webhookRequest(body, await signMockWebhook(SECRET, JSON.stringify(body)));
    const out = await processPaymentWebhook(db, env, { providerId: "mock", request: req, rawBody: raw });
    expect(out.result).toBe("amount_mismatch_flagged");
    const row = (await db.select().from(payments).where(eq(payments.id, pay.id)))[0]!;
    expect(row.status).toBe("under_review");
    expect(await entitlementCount(studentA.id)).toBe(0);
    expect(await studentAccess(studentA.id)).toBe(false);
  });

  it("payment.failed webhook marks the pending payment failed (retryable via new attempt)", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const pay = await createGatewayPayment(db, env, { orderId: r.order.id, providerId: "mock", returnUrl: "https://app.test/orders" });
    const body = { provider_event_id: "evt_fail", type: "payment.failed", reference: pay.reference, amount_minor: 10_000 };
    const { req, raw } = webhookRequest(body, await signMockWebhook(SECRET, JSON.stringify(body)));
    const out = await processPaymentWebhook(db, env, { providerId: "mock", request: req, rawBody: raw });
    expect(out.result).toBe("failed_marked");
    const row = (await db.select().from(payments).where(eq(payments.id, pay.id)))[0]!;
    expect(row.status).toBe("failed");
    expect(await entitlementCount(studentA.id)).toBe(0);
  });

  it("unknown provider → 404; route-level forged webhook → 400 JSON", async () => {
    const out = await processPaymentWebhook(db, env, { providerId: "paypal", request: webhookRequest({}, null).req, rawBody: "{}" });
    expect(out.status).toBe(404);
    const body = { provider_event_id: "evt_x", type: "payment.paid", reference: "whatever", amount_minor: 1 };
    const { req } = webhookRequest(body, "00".repeat(32));
    const res = await callWebhookAction(req, "mock");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { result: string };
    expect(json.result).toBe("rejected");
    // GET is not allowed on the webhook route
    const get = await callWebhookAction(new Request("https://app.test/webhooks/payments/mock"), "mock");
    expect(get.status).toBe(405);
  });
});

// ═══════════════════════════ SUBSCRIPTIONS ═══════════════════════════

describe("subscriptions — recurring plan purchase, renew, pause/resume, cancel, expiry sweep", () => {
  async function buySubscription(student: { id: string }) {
    const { product, plan } = await makeProduct(5000, { kind: "subscription_plan", period: "monthly" });
    const r = await createOrder(db, { studentId: student.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: student.id, orderId: r.order.id, transferReference: "SUB-TX", paymentsSettings: paySettings() });
    const out = await approveManualPayment(db, { paymentId: c.paymentId, receivedAmountMinor: 5000, actor });
    expect(out.subscriptionId).not.toBeNull();
    return { product, plan, order: r.order, subscriptionId: out.subscriptionId! };
  }

  it("purchase creates an active subscription + expiring entitlement + subscription_created event", async () => {
    const { subscriptionId } = await buySubscription(studentA);
    const sub = (await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0]!;
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodEnd! - sub.currentPeriodStart!).toBe(30 * 86_400_000);
    const ent = (await db.select().from(entitlements).where(eq(entitlements.studentId, studentA.id)))[0]!;
    expect(ent.sourceType).toBe("subscription");
    expect(ent.expiresAt).toBe(sub.currentPeriodEnd);
    expect(await studentAccess(studentA.id)).toBe(true);
    expect(await eventCount(studentA.id, "subscription_created")).toBe(1);
  });

  it("already_subscribed guard blocks a second active plan purchase", async () => {
    await buySubscription(studentA);
    const { product, plan } = await makeProduct(6000, { kind: "subscription_plan", period: "monthly" });
    await expect(createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() })).rejects.toThrow(/already_subscribed|already_entitled/);
  });

  it("renew extends the period and the entitlement expiry", async () => {
    const { subscriptionId } = await buySubscription(studentA);
    const before = (await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0]!;
    expect(await renewSubscription(db, subscriptionId, actor)).toBe(true);
    const after = (await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0]!;
    expect(after.currentPeriodEnd! - before.currentPeriodEnd!).toBe(30 * 86_400_000);
    const ent = (await db.select().from(entitlements).where(eq(entitlements.studentId, studentA.id)))[0]!;
    expect(ent.expiresAt).toBe(after.currentPeriodEnd);
  });

  it("cancel keeps access until period end; pause revokes immediately; resume restores", async () => {
    const { subscriptionId } = await buySubscription(studentA);
    expect(await cancelSubscription(db, subscriptionId, actor)).toBe(true);
    expect(await studentAccess(studentA.id)).toBe(true); // cancelled ≠ cut off mid-period
    await expect(resumeSubscription(db, subscriptionId, actor)).rejects.toThrow(CommerceStateError); // cancelled is terminal

    const sub2 = await buySubscription(studentB);
    expect(await pauseSubscription(db, sub2.subscriptionId, actor)).toBe(true);
    const entB = (await db.select().from(entitlements).where(eq(entitlements.studentId, studentB.id)))[0]!;
    expect(entB.revokedAt).not.toBeNull();
    expect(await studentAccess(studentB.id)).toBe(false);
    expect(await resumeSubscription(db, sub2.subscriptionId, actor)).toBe(true);
    const entB2 = (await db.select().from(entitlements).where(eq(entitlements.studentId, studentB.id)))[0]!;
    expect(entB2.revokedAt).toBeNull();
    expect(await studentAccess(studentB.id)).toBe(true);
  });

  it("expiry sweep: period end in the past → expired, entitlement revoked, resolver denies", async () => {
    const { subscriptionId } = await buySubscription(studentA);
    await db.run(sql`UPDATE subscriptions SET current_period_end = current_period_end - ${31 * 86_400_000} WHERE id = ${subscriptionId}`);
    expect(await sweepExpiredSubscriptions(db)).toBe(1);
    const sub = (await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0]!;
    expect(sub.status).toBe("expired");
    expect(await studentAccess(studentA.id)).toBe(false); // expired → denied (brief §5)
  });

  it("refunding the subscription payment revokes the entitlement and cancels the subscription", async () => {
    const { subscriptionId, order } = await buySubscription(studentA);
    const pay = (await db.select().from(payments).where(eq(payments.orderId, order.id)))[0]!;
    expect(await refundPayment(db, { paymentId: pay.id, reason: "chargeback", actor, refundWindowDays: 0 })).toBe(true);
    const sub = (await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0]!;
    expect(sub.status).toBe("cancelled");
    expect(await studentAccess(studentA.id)).toBe(false);
  });
});

// ═══════════════════════════ RBAC / ROUTES / CATALOG ═══════════════════════════

describe("RBAC + catalog integration", () => {
  it("students are redirected away from the admin commerce hub (loader + action)", async () => {
    const res = await catchResponse(callAdminLoader(getUrl("/admin/commerce", studentA.cookie)));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/dashboard?error=forbidden");
    const act = await catchResponse(callAdminAction(postForm("/admin/commerce", { _action: "approve_payment", paymentId: "x", receivedAmount: "1" }, studentA.cookie)));
    expect(act.status).toBe(302);
  });

  it("anonymous is redirected to login on the admin hub", async () => {
    const res = await catchResponse(callAdminLoader(getUrl("/admin/commerce")));
    expect(res.headers.get("location")).toContain("/login?next=");
  });

  it("promoted admin passes requireRole; canCommerce gates rank-3 by permission rows", async () => {
    await db.run(sql`UPDATE users SET role_id = 'admin' WHERE id = ${studentB.id}`);
    const res = await callAdminLoader(getUrl("/admin/commerce", studentB.cookie));
    expect(res).not.toBeInstanceOf(Response); // loader data, not a redirect

    // rank 3 (admin) needs the seeded commerce.* permissions
    expect(await canCommerce(db, { user: { rank: 3, roleId: "admin" } }, "commerce.products")).toBe(true);
    await db.run(sql`DELETE FROM role_permissions WHERE permission LIKE 'commerce.%'`);
    expect(await canCommerce(db, { user: { rank: 3, roleId: "admin" } }, "commerce.products")).toBe(false);
    // rank 4 bypasses permission rows entirely
    expect(await canCommerce(db, { user: { rank: 4, roleId: "super_admin" } }, "commerce.products")).toBe(true);
    // students never hold commerce permissions
    expect(await canCommerce(db, { user: { rank: 1, roleId: "student" } }, "commerce.read")).toBe(false);
    await db.run(sql`UPDATE users SET role_id = 'student' WHERE id = ${studentB.id}`);
  });

  it("admin hub action with student cookie never mutates (approve_payment denied at guard)", async () => {
    const { product, plan } = await makeProduct();
    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "TX", paymentsSettings: paySettings() });
    await catchResponse(callAdminAction(postForm("/admin/commerce", { _action: "approve_payment", paymentId: c.paymentId, receivedAmount: "10000" }, studentA.cookie)));
    const pay = (await db.select().from(payments).where(eq(payments.id, c.paymentId)))[0]!;
    expect(pay.status).toBe("under_review"); // NOT paid — the student cannot verify their own payment
    expect(await entitlementCount(studentA.id)).toBe(0);
  });

  it("publicProductBySlug hides archived/inactive products and applies promo windows server-side", async () => {
    const { product } = await makeProduct(10_000);
    const nowMs = Date.now();
    await createPricePlan(db, product.id, { currency: "EGP", amountMinor: 10_000, promoPriceMinor: 7_500, promoStartsAt: nowMs - 1000, promoEndsAt: nowMs + 86_400_000, active: true, sortOrder: 1 }, actor);
    const view = await publicProductBySlug(db, product.slug);
    expect(view).not.toBeNull();
    const promoPlan = view!.plans.find((p) => p.effectiveMinor === 7500);
    expect(promoPlan).toBeDefined();
    await archiveProduct(db, product.id, actor);
    expect(await publicProductBySlug(db, product.slug)).toBeNull();
  });

  it("purchasableFor: direct course match, subject-level match, and null when unpurchasable", async () => {
    expect(await purchasableFor(db, { type: "course", id: courseId1 })).toBeNull();
    const { product } = await makeProduct(8000);
    const direct = await purchasableFor(db, { type: "course", id: courseId1 });
    expect(direct?.productSlug).toBe(product.slug);
    expect(direct?.minPriceMinor).toBe(8000);
    // course2 has no product, but its SUBJECT does → subject-level product covers it
    const subjProduct = await makeProduct(20_000, { kind: "subject", resourceType: "subject", resourceId: subjectId });
    const viaSubject = await purchasableFor(db, { type: "course", id: courseId2, subjectId });
    expect(viaSubject?.productSlug).toBe(subjProduct.product.slug);
  });

  it("course page CTA: locked + purchasable → buyOption; after purchase → gone", async () => {
    const { product, plan } = await makeProduct(9000);
    const locked = (await callCoursePageLoader(getUrl(`/courses/${courseSlug1}`, studentA.cookie), courseSlug1)) as { buyOption: { productSlug: string; minPriceMinor: number } | null };
    expect(locked.buyOption?.productSlug).toBe(product.slug);
    expect(locked.buyOption?.minPriceMinor).toBe(9000);

    const r = await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const c = await confirmManualPayment(db, { studentId: studentA.id, orderId: r.order.id, transferReference: "TX", paymentsSettings: paySettings() });
    await approveManualPayment(db, { paymentId: c.paymentId, receivedAmountMinor: 9000, actor });
    const unlocked = (await callCoursePageLoader(getUrl(`/courses/${courseSlug1}`, studentA.cookie), courseSlug1)) as { buyOption: unknown; verdict: { allowed: boolean } };
    expect(unlocked.verdict.allowed).toBe(true);
    expect(unlocked.buyOption).toBeNull();
  });

  it("orders list route is login-gated and owner-scoped", async () => {
    const anon = await catchResponse(ordersLoader({ context: routeCtx, request: getUrl("/orders"), params: {} } as unknown as Parameters<typeof ordersLoader>[0]));
    expect(anon.status).toBe(302);
    const { product, plan } = await makeProduct();
    await createOrder(db, { studentId: studentA.id, productId: product.id, pricePlanId: plan.id, paymentsSettings: paySettings() });
    const dataA = (await ordersLoader({ context: routeCtx, request: getUrl("/orders", studentA.cookie), params: {} } as unknown as Parameters<typeof ordersLoader>[0])) as { orders: unknown[] };
    expect(dataA.orders).toHaveLength(1);
    const dataB = (await ordersLoader({ context: routeCtx, request: getUrl("/orders", studentB.cookie), params: {} } as unknown as Parameters<typeof ordersLoader>[0])) as { orders: unknown[] };
    expect(dataB.orders).toHaveLength(0);
  });
});
