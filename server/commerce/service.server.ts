import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import type { DB } from "../db/client.server";
import {
  activationCodeBatches,
  activationCodeRedemptions,
  activationCodes,
  discountCodes,
  discountRedemptions,
  entitlements,
  events,
  orderItems,
  orders,
  paymentEvents,
  payments,
  rolePermissions,
  pricePlans,
  productItems,
  products,
  refunds,
  subscriptionEvents,
  subscriptions,
  users,
  files,
} from "../db/schema";
import type { PaymentsSettings } from "../settings/schema";
import { logAudit } from "../audit/log.server";
import { getNode, slugify } from "../content/service.server";
import { sha256Hex } from "../http/rate-limit.server";
import { paymentProviderRegistry } from "../payments/provider";
import {
  DAY_MS,
  calcDiscountMinor,
  generateActivationCode,
  normalizeCode,
} from "./money";

/**
 * Commerce engine (Phase 6 — FEATURE-SPEC §7, PAYMENTS.md, ADR-007/023).
 *
 * The critical principle: PAYMENT NEVER AUTHORIZES ACCESS DIRECTLY. Access
 * comes only from: verified payment (admin approval or signature-verified
 * webhook) / activation-code redemption → entitlement grant rows → the
 * EXISTING entitlement resolver (ADR-009). This service creates grants in the
 * unified `entitlements` table — never a parallel access system.
 *
 * Money: integer minor units everywhere; prices are re-read server-side at
 * order time; client-supplied amounts are never consulted.
 *
 * Idempotency discipline (mirrors ADR-022 submission claims):
 *  - fulfillment: conditional UPDATE claim on payments.status — double approval
 *    or webhook replay never double-grants (exactly-once `purchase` event);
 *  - webhook inbox: UNIQUE provider_event_id — replays are recorded, not reprocessed;
 *  - activation redemption: conditional use_count decrement + UNIQUE(code_id, student_id);
 *  - discount use: conditional used_count increment with per-user subquery guard;
 *  - checkout: pending-order dedupe (same student+product+plan within TTL).
 *
 * Integrity policy (ADR-017): cross-domain references (users/content/files/
 * entitlements) are validated app-layer before write; within-domain FKs are real.
 */

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const now = () => Date.now();

export class CommerceValidationError extends Error {
  constructor(public readonly reason: string, message?: string) {
    super(message ?? `commerce validation failed: ${reason}`);
    this.name = "CommerceValidationError";
  }
}

export class CommerceReferenceError extends Error {
  constructor(public readonly field: string, public readonly referenceId: string) {
    super(`reference not found: ${field}=${referenceId}`);
    this.name = "CommerceReferenceError";
  }
}

export class CommerceStateError extends Error {
  constructor(public readonly reason: string) {
    super(`illegal commerce state transition: ${reason}`);
    this.name = "CommerceStateError";
  }
}

// ---------------------------------------------------------------------------
// Permissions (mirrors the CMS/assessment model — role_permissions TEXT rows)
// ---------------------------------------------------------------------------

export const COMMERCE_PERMISSIONS = [
  "commerce.read",
  "commerce.products",
  "commerce.orders",
  "commerce.payments",
  "commerce.refunds",
  "commerce.codes",
  "commerce.discounts",
] as const;
export type CommercePermission = (typeof COMMERCE_PERMISSIONS)[number];

/** rank 4 (super_admin) bypasses; rank 3 needs an explicit role_permissions row. */
export async function canCommerce(
  db: DB,
  auth: { user: { rank: number; roleId: string } } | null,
  permission: CommercePermission
): Promise<boolean> {
  if (!auth) return false;
  if (auth.user.rank >= 4) return true;
  if (auth.user.rank < 3) return false;
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, auth.user.roleId), eq(rolePermissions.permission, permission)))
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// State machines (PAYMENTS.md §2 — illegal jumps rejected)
// ---------------------------------------------------------------------------

export const PAYMENT_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["under_review", "paid", "failed", "cancelled", "expired"],
  under_review: ["paid", "failed"],
  paid: ["refunded", "partially_refunded"],
  failed: [],
  cancelled: [],
  expired: [],
  refunded: [],
  partially_refunded: ["refunded"],
};

export const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["paid", "cancelled", "expired", "failed"],
  awaiting_payment: ["paid", "cancelled", "expired", "failed"],
  paid: ["refunded", "partially_refunded"],
  cancelled: [],
  expired: [],
  failed: [],
  refunded: [],
  partially_refunded: ["refunded"],
};

export function canTransition(map: Record<string, readonly string[]>, from: string, to: string): boolean {
  return (map[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// Shared zod contracts
// ---------------------------------------------------------------------------

const grantSchema = z.object({
  resourceType: z.enum(["subject", "course", "lesson"]),
  resourceId: uuid,
});

/** product_items convey subjects/courses only (DATABASE-SCHEMA Commerce sketch). */
const productItemSchema = z.object({
  resourceType: z.enum(["subject", "course"]),
  resourceId: uuid,
});

/** Frozen at purchase; fulfillment expands it into concrete entitlement rows (ADR-023). */
export const entitlementSpecSchema = z.object({
  grants: z.array(grantSchema).min(1).max(50),
  durationDays: z.number().int().min(1).max(3650).nullish(),
  fixedExpiresAt: z.number().int().positive().nullish(),
  recurring: z.boolean().optional(),
});
export type EntitlementSpec = z.infer<typeof entitlementSpecSchema>;

export const productInputSchema = z.object({
  kind: z.enum(["course", "subject", "bundle", "subscription_plan"]),
  slug: z.string().trim().min(1).max(120).optional(),
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  descriptionAr: z.string().trim().max(5000).optional(),
  descriptionEn: z.string().trim().max(5000).optional(),
  thumbnailFileId: z.string().trim().max(36).optional(),
  items: z.array(productItemSchema).min(1).max(50),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const pricePlanInputSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/, "currency must be 3 uppercase letters").default("EGP"),
    amountMinor: z.number().int().min(0).max(100_000_000_00),
    kind: z.enum(["one_time", "recurring"]).default("one_time"),
    period: z.enum(["monthly", "term", "annual", "custom", "fixed_date"]).nullish(),
    periodDays: z.number().int().min(1).max(3650).nullish(),
    fixedEndsAt: z.number().int().positive().nullish(),
    labelAr: z.string().trim().max(120).nullish(),
    labelEn: z.string().trim().max(120).nullish(),
    compareAtMinor: z.number().int().min(0).max(100_000_000_00).nullish(),
    promoPriceMinor: z.number().int().min(0).max(100_000_000_00).nullish(),
    promoStartsAt: z.number().int().positive().nullish(),
    promoEndsAt: z.number().int().positive().nullish(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .refine((v) => v.kind !== "recurring" || v.period != null, { message: "recurring plans require a period" })
  .refine((v) => v.period !== "custom" && v.period !== "term" || (v.periodDays ?? 0) > 0, {
    message: "term/custom periods require periodDays",
  })
  .refine((v) => v.period !== "fixed_date" || (v.fixedEndsAt ?? 0) > 0, {
    message: "fixed_date periods require fixedEndsAt",
  })
  .refine(
    (v) =>
      v.promoPriceMinor === null || v.promoPriceMinor === undefined ||
      (v.promoStartsAt !== null && v.promoStartsAt !== undefined && v.promoEndsAt !== null && v.promoEndsAt !== undefined && v.promoEndsAt > v.promoStartsAt),
    { message: "promo pricing requires a promo window" }
  )
  .refine(
    (v) => v.promoPriceMinor === null || v.promoPriceMinor === undefined || v.promoPriceMinor < v.amountMinor,
    { message: "promo price must be below the base amount" }
  );

export interface ActorCtx {
  userId: string;
  role: string;
  ipHash?: string;
}

type ProductRow = typeof products.$inferSelect;
type PricePlanRow = typeof pricePlans.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function validateItemsForKind(kind: string, items: { resourceType: string }[]): void {
  if (kind === "course") {
    if (items.length !== 1 || items[0].resourceType !== "course") {
      throw new CommerceValidationError("course_product_needs_one_course");
    }
  } else if (kind === "subject") {
    if (items.length !== 1 || items[0].resourceType !== "subject") {
      throw new CommerceValidationError("subject_product_needs_one_subject");
    }
  }
}

async function assertItemRefs(db: DB, items: { resourceType: "subject" | "course"; resourceId: string }[]) {
  for (const item of items) {
    const node = await getNode(db, item.resourceType, item.resourceId);
    if (!node) throw new CommerceReferenceError(`items.${item.resourceType}Id`, item.resourceId);
  }
}

async function assertThumbnailRef(db: DB, fileId: string | null | undefined) {
  if (!fileId) return;
  const rows = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.visibility, "public")))
    .limit(1);
  if (rows.length === 0) throw new CommerceReferenceError("thumbnailFileId", fileId);
}

async function uniqueProductSlug(db: DB, base: string): Promise<string> {
  let slug = base;
  let n = 2;
  for (;;) {
    const rows = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug)).limit(1);
    if (rows.length === 0) return slug;
    slug = `${base}-${n++}`;
    if (n > 500) throw new CommerceValidationError("slug_unavailable");
  }
}

export async function createProduct(db: DB, input: z.infer<typeof productInputSchema>, actor: ActorCtx): Promise<ProductRow> {
  validateItemsForKind(input.kind, input.items);
  await assertItemRefs(db, input.items);
  await assertThumbnailRef(db, input.thumbnailFileId);
  const ts = now();
  const id = crypto.randomUUID();
  const slug = await uniqueProductSlug(db, input.slug ? slugify(input.slug) : slugify(input.nameEn || input.nameAr));
  const row = {
    id,
    kind: input.kind,
    slug,
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    descriptionAr: input.descriptionAr ?? "",
    descriptionEn: input.descriptionEn ?? "",
    thumbnailFileId: input.thumbnailFileId || null,
    active: input.active ?? false,
    archivedAt: null,
    sortOrder: input.sortOrder ?? 0,
    metadata: input.metadata ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.insert(products).values(row);
  await db.insert(productItems).values(
    input.items.map((it, i) => ({
      id: crypto.randomUUID(),
      productId: id,
      resourceType: it.resourceType,
      resourceId: it.resourceId,
      sortOrder: i,
      createdAt: ts,
    }))
  );
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.product.created", entityType: "product", entityId: id,
    after: { ...row, items: input.items }, ipHash: actor.ipHash,
  });
  return row;
}

export async function getProduct(db: DB, id: string): Promise<ProductRow | undefined> {
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return rows[0];
}

export async function getProductBySlug(db: DB, slug: string): Promise<ProductRow | undefined> {
  const rows = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  return rows[0];
}

export async function productItemsOf(db: DB, productId: string) {
  return db
    .select()
    .from(productItems)
    .where(eq(productItems.productId, productId))
    .orderBy(asc(productItems.sortOrder));
}

export interface ProductUpdatePatch {
  nameAr?: string;
  nameEn?: string;
  descriptionAr?: string;
  descriptionEn?: string;
  thumbnailFileId?: string | null;
  active?: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
  items?: { resourceType: "subject" | "course"; resourceId: string }[];
}

export async function updateProduct(db: DB, id: string, patch: ProductUpdatePatch, actor: ActorCtx): Promise<boolean> {
  const product = await getProduct(db, id);
  if (!product) throw new CommerceReferenceError("productId", id);
  if (product.archivedAt !== null) throw new CommerceStateError("product_archived");
  const before = { ...product };
  if (patch.thumbnailFileId !== undefined) await assertThumbnailRef(db, patch.thumbnailFileId);
  if (patch.items) {
    validateItemsForKind(product.kind, patch.items);
    await assertItemRefs(db, patch.items);
  }
  const set: Record<string, unknown> = { updatedAt: now() };
  for (const k of ["nameAr", "nameEn", "descriptionAr", "descriptionEn", "thumbnailFileId", "active", "sortOrder", "metadata"] as const) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  await db.update(products).set(set).where(eq(products.id, id));
  if (patch.items) {
    await db.delete(productItems).where(eq(productItems.productId, id));
    await db.insert(productItems).values(
      patch.items.map((it, i) => ({
        id: crypto.randomUUID(),
        productId: id,
        resourceType: it.resourceType,
        resourceId: it.resourceId,
        sortOrder: i,
        createdAt: now(),
      }))
    );
  }
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.product.updated", entityType: "product", entityId: id,
    before, after: { ...set, items: patch.items ?? undefined }, ipHash: actor.ipHash,
  });
  return true;
}

/** Non-destructive archive: history (orders/items) intact; checkout refuses archived. */
export async function archiveProduct(db: DB, id: string, actor: ActorCtx): Promise<boolean> {
  const product = await getProduct(db, id);
  if (!product) throw new CommerceReferenceError("productId", id);
  if (product.archivedAt !== null) return true;
  await db.update(products).set({ archivedAt: now(), active: false, updatedAt: now() }).where(eq(products.id, id));
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.product.archived", entityType: "product", entityId: id,
    before: { active: product.active }, after: { archived: true }, ipHash: actor.ipHash,
  });
  return true;
}

export async function unarchiveProduct(db: DB, id: string, actor: ActorCtx): Promise<boolean> {
  const product = await getProduct(db, id);
  if (!product) throw new CommerceReferenceError("productId", id);
  if (product.archivedAt === null) return true;
  await db.update(products).set({ archivedAt: null, updatedAt: now() }).where(eq(products.id, id));
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.product.unarchived", entityType: "product", entityId: id,
    before: { archived: true }, after: { archived: false, active: product.active }, ipHash: actor.ipHash,
  });
  return true;
}

export async function listProductsAdmin(
  db: DB,
  filter: { q?: string; kind?: string; state?: "all" | "active" | "inactive" | "archived"; page?: number }
) {
  const perPage = 20;
  const page = Math.max(1, filter.page ?? 1);
  const conditions = [];
  if (filter.kind && filter.kind !== "all") conditions.push(eq(products.kind, filter.kind as "course"));
  if (filter.state === "active") conditions.push(eq(products.active, true), isNull(products.archivedAt));
  if (filter.state === "inactive") conditions.push(eq(products.active, false), isNull(products.archivedAt));
  if (filter.state === "archived") conditions.push(sql`${products.archivedAt} IS NOT NULL`);
  if (filter.q) {
    const like = `%${filter.q}%`;
    conditions.push(or(sql`${products.nameAr} LIKE ${like}`, sql`${products.nameEn} LIKE ${like}`, sql`${products.slug} LIKE ${like}`)!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(desc(products.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  return { rows, page, perPage };
}

// ---------------------------------------------------------------------------
// Price plans
// ---------------------------------------------------------------------------

export async function createPricePlan(
  db: DB,
  productId: string,
  input: z.input<typeof pricePlanInputSchema>,
  actor: ActorCtx
): Promise<PricePlanRow> {
  const product = await getProduct(db, productId);
  if (!product) throw new CommerceReferenceError("productId", productId);
  if (product.archivedAt !== null) throw new CommerceStateError("product_archived");
  const parsed = pricePlanInputSchema.parse(input);
  if (parsed.kind === "recurring" && product.kind !== "subscription_plan") {
    throw new CommerceValidationError("recurring_requires_subscription_plan_product");
  }
  const ts = now();
  const row = {
    id: crypto.randomUUID(),
    productId,
    currency: parsed.currency,
    amountMinor: parsed.amountMinor,
    kind: parsed.kind,
    period: parsed.period ?? null,
    periodDays: parsed.periodDays ?? null,
    fixedEndsAt: parsed.fixedEndsAt ?? null,
    labelAr: parsed.labelAr ?? null,
    labelEn: parsed.labelEn ?? null,
    compareAtMinor: parsed.compareAtMinor ?? null,
    promoPriceMinor: parsed.promoPriceMinor ?? null,
    promoStartsAt: parsed.promoStartsAt ?? null,
    promoEndsAt: parsed.promoEndsAt ?? null,
    active: parsed.active ?? false,
    sortOrder: parsed.sortOrder ?? 0,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.insert(pricePlans).values(row);
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.price.created", entityType: "price_plan", entityId: row.id,
    after: row, ipHash: actor.ipHash,
  });
  return row;
}

export async function getPricePlan(db: DB, id: string): Promise<PricePlanRow | undefined> {
  const rows = await db.select().from(pricePlans).where(eq(pricePlans.id, id)).limit(1);
  return rows[0];
}

export async function pricePlansForProduct(db: DB, productId: string, opts: { activeOnly?: boolean } = {}) {
  const conditions = [eq(pricePlans.productId, productId)];
  if (opts.activeOnly) conditions.push(eq(pricePlans.active, true));
  return db
    .select()
    .from(pricePlans)
    .where(and(...conditions))
    .orderBy(asc(pricePlans.sortOrder), asc(pricePlans.createdAt));
}

export async function updatePricePlan(
  db: DB,
  id: string,
  patch: Partial<Omit<z.infer<typeof pricePlanInputSchema>, "kind">> & { active?: boolean },
  actor: ActorCtx
): Promise<boolean> {
  const plan = await getPricePlan(db, id);
  if (!plan) throw new CommerceReferenceError("pricePlanId", id);
  const merged = {
    currency: patch.currency ?? plan.currency,
    amountMinor: patch.amountMinor ?? plan.amountMinor,
    kind: plan.kind,
    period: patch.period !== undefined ? patch.period : plan.period,
    periodDays: patch.periodDays !== undefined ? patch.periodDays : plan.periodDays,
    fixedEndsAt: patch.fixedEndsAt !== undefined ? patch.fixedEndsAt : plan.fixedEndsAt,
    labelAr: patch.labelAr !== undefined ? patch.labelAr : plan.labelAr,
    labelEn: patch.labelEn !== undefined ? patch.labelEn : plan.labelEn,
    compareAtMinor: patch.compareAtMinor !== undefined ? patch.compareAtMinor : plan.compareAtMinor,
    promoPriceMinor: patch.promoPriceMinor !== undefined ? patch.promoPriceMinor : plan.promoPriceMinor,
    promoStartsAt: patch.promoStartsAt !== undefined ? patch.promoStartsAt : plan.promoStartsAt,
    promoEndsAt: patch.promoEndsAt !== undefined ? patch.promoEndsAt : plan.promoEndsAt,
    active: patch.active ?? plan.active,
    sortOrder: patch.sortOrder ?? plan.sortOrder,
  };
  // full revalidation of the merged state (partial patches must not smuggle invalid combos)
  const parsed = pricePlanInputSchema.parse(merged);
  const { kind: _kind, ...rest } = parsed;
  await db.update(pricePlans).set({ ...rest, updatedAt: now() }).where(eq(pricePlans.id, id));
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.price.updated", entityType: "price_plan", entityId: id,
    before: plan, after: { ...rest }, ipHash: actor.ipHash,
  });
  return true;
}

/** The server-side price truth: promo window evaluated against the server clock. */
export function effectivePriceMinor(plan: PricePlanRow, nowMs: number): number {
  if (
    plan.promoPriceMinor !== null &&
    plan.promoStartsAt !== null &&
    plan.promoEndsAt !== null &&
    nowMs >= plan.promoStartsAt &&
    nowMs < plan.promoEndsAt
  ) {
    return plan.promoPriceMinor;
  }
  return plan.amountMinor;
}

/** Period end for recurring/duration plans (fixed day counts — no calendar math). */
export function periodEndMs(plan: PricePlanRow, fromMs: number): number {
  switch (plan.period) {
    case "monthly":
      return fromMs + 30 * DAY_MS;
    case "annual":
      return fromMs + 365 * DAY_MS;
    case "term":
    case "custom":
      if (!plan.periodDays) throw new CommerceValidationError("period_days_missing");
      return fromMs + plan.periodDays * DAY_MS;
    case "fixed_date":
      if (!plan.fixedEndsAt) throw new CommerceValidationError("fixed_ends_at_missing");
      return plan.fixedEndsAt;
    default:
      throw new CommerceValidationError("period_required_for_recurring");
  }
}

// ---------------------------------------------------------------------------
// Entitlement spec (frozen at purchase — ADR-023)
// ---------------------------------------------------------------------------

export async function buildEntitlementSpec(
  db: DB,
  product: ProductRow,
  plan: PricePlanRow,
  opts: { requirePublished?: boolean } = {}
): Promise<EntitlementSpec> {
  const items = await productItemsOf(db, product.id);
  if (items.length === 0) throw new CommerceValidationError("product_has_no_items");
  const grants: { resourceType: "subject" | "course" | "lesson"; resourceId: string }[] = [];
  for (const item of items) {
    const node = await getNode(db, item.resourceType, item.resourceId);
    if (!node) throw new CommerceReferenceError(`product_items.${item.resourceType}`, item.resourceId);
    if (opts.requirePublished !== false && (node as { status?: string }).status !== "published") {
      throw new CommerceValidationError("content_unavailable");
    }
    grants.push({ resourceType: item.resourceType, resourceId: item.resourceId });
  }
  const durationDays =
    plan.kind === "one_time" && (plan.period === "custom" || plan.period === "term") && plan.periodDays
      ? plan.periodDays
      : null;
  const fixedExpiresAt = plan.period === "fixed_date" && plan.fixedEndsAt ? plan.fixedEndsAt : null;
  return entitlementSpecSchema.parse({
    grants,
    durationDays,
    fixedExpiresAt,
    recurring: plan.kind === "recurring",
  });
}

// ---------------------------------------------------------------------------
// Discount codes
// ---------------------------------------------------------------------------

export const discountCreateSchema = z
  .object({
    code: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9_-]+$/, "letters, digits, dash, underscore"),
    type: z.enum(["percent", "fixed"]),
    value: z.number().int().min(1),
    maxUses: z.number().int().min(1).max(1_000_000).nullish(),
    perUserLimit: z.number().int().min(1).max(1000).nullish(),
    minOrderMinor: z.number().int().min(0).nullish(),
    appliesToProductIds: z.array(uuid).max(200).nullish(),
    startsAt: z.number().int().positive().nullish(),
    endsAt: z.number().int().positive().nullish(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.type !== "percent" || v.value <= 100, { message: "percent value must be ≤ 100" })
  .refine((v) => !v.endsAt || !v.startsAt || v.endsAt > v.startsAt, { message: "window must end after it starts" });

export async function createDiscountCode(
  db: DB,
  input: z.infer<typeof discountCreateSchema>,
  actor: ActorCtx
): Promise<{ id: string; prefix: string }> {
  const normalized = normalizeCode(input.code);
  if (normalized.length < 4) throw new CommerceValidationError("code_too_short");
  const codeHash = await sha256Hex(normalized);
  const existing = await db.select({ id: discountCodes.id }).from(discountCodes).where(eq(discountCodes.codeHash, codeHash)).limit(1);
  if (existing.length) throw new CommerceValidationError("duplicate_code");
  const ts = now();
  const id = crypto.randomUUID();
  const row = {
    id,
    codeHash,
    prefix: normalized.slice(0, 4),
    type: input.type,
    value: input.value,
    maxUses: input.maxUses ?? null,
    usedCount: 0,
    perUserLimit: input.perUserLimit ?? null,
    minOrderMinor: input.minOrderMinor ?? null,
    appliesTo: input.appliesToProductIds ? { productIds: input.appliesToProductIds } : null,
    startsAt: input.startsAt ?? ts,
    endsAt: input.endsAt ?? null,
    active: input.active ?? true,
    createdBy: actor.userId,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.insert(discountCodes).values(row);
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.discount.created", entityType: "discount_code", entityId: id,
    // plaintext code is never logged — hash + prefix only
    after: { ...row, codeHash: `${row.codeHash.slice(0, 12)}…` }, ipHash: actor.ipHash,
  });
  return { id, prefix: row.prefix };
}

export async function setDiscountCodeActive(db: DB, id: string, active: boolean, actor: ActorCtx): Promise<boolean> {
  const rows = await db.select().from(discountCodes).where(eq(discountCodes.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new CommerceReferenceError("discountCodeId", id);
  await db.update(discountCodes).set({ active, updatedAt: now() }).where(eq(discountCodes.id, id));
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: active ? "commerce.discount.activated" : "commerce.discount.deactivated",
    entityType: "discount_code", entityId: id,
    before: { active: row.active }, after: { active }, ipHash: actor.ipHash,
  });
  return true;
}

export async function listDiscountCodesAdmin(db: DB) {
  return db.select().from(discountCodes).orderBy(desc(discountCodes.createdAt)).limit(100);
}

export interface DiscountVerdict {
  codeId: string;
  discountMinor: number;
}

/**
 * Validates + CLAIMS one use of a discount code (conditional increment with a
 * per-user subquery guard — a single statement, so concurrent checkouts cannot
 * exceed max_uses). The claim is compensated by the caller if the order insert
 * fails afterwards.
 */
export async function claimDiscountForOrder(
  db: DB,
  codeInput: string,
  ctx: { studentId: string; subtotalMinor: number; productId: string; nowMs: number }
): Promise<DiscountVerdict> {
  const normalized = normalizeCode(codeInput);
  if (!normalized) throw new CommerceValidationError("discount_invalid");
  const codeHash = await sha256Hex(normalized);
  const rows = await db.select().from(discountCodes).where(eq(discountCodes.codeHash, codeHash)).limit(1);
  const code = rows[0];
  // generic reason for unknown/inactive codes — no existence oracle for guesses
  if (!code || !code.active) throw new CommerceValidationError("discount_invalid");
  if (ctx.nowMs < code.startsAt || (code.endsAt !== null && ctx.nowMs >= code.endsAt)) {
    throw new CommerceValidationError("discount_invalid");
  }
  if (code.minOrderMinor !== null && ctx.subtotalMinor < code.minOrderMinor) {
    throw new CommerceValidationError("discount_min_order");
  }
  const applies = code.appliesTo as { productIds?: string[] } | null;
  if (applies?.productIds && !applies.productIds.includes(ctx.productId)) {
    throw new CommerceValidationError("discount_invalid");
  }
  const claim = await db
    .update(discountCodes)
    .set({ usedCount: sql`used_count + 1`, updatedAt: ctx.nowMs })
    .where(
      and(
        eq(discountCodes.id, code.id),
        eq(discountCodes.active, true),
        sql`(max_uses IS NULL OR used_count < max_uses)`,
        sql`(per_user_limit IS NULL OR (SELECT COUNT(*) FROM ${discountRedemptions} WHERE code_id = ${code.id} AND student_id = ${ctx.studentId}) < per_user_limit)`
      )
    )
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) {
    const perUser = await db
      .select({ id: discountRedemptions.id })
      .from(discountRedemptions)
      .where(and(eq(discountRedemptions.codeId, code.id), eq(discountRedemptions.studentId, ctx.studentId)));
    throw new CommerceValidationError(
      code.perUserLimit !== null && perUser.length >= code.perUserLimit ? "discount_user_limit" : "discount_exhausted"
    );
  }
  return { codeId: code.id, discountMinor: calcDiscountMinor(ctx.subtotalMinor, code.type, code.value) };
}

export async function releaseDiscountClaim(db: DB, codeId: string): Promise<void> {
  await db
    .update(discountCodes)
    .set({ usedCount: sql`CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END`, updatedAt: now() })
    .where(eq(discountCodes.id, codeId));
}

// ---------------------------------------------------------------------------
// Orders & checkout
// ---------------------------------------------------------------------------

function generateOrderNumber(): string {
  const t = Date.now().toString(36).toUpperCase();
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const rand = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `EC-${t}-${rand}`;
}

export interface CreateOrderInput {
  studentId: string;
  productSlug?: string;
  productId?: string;
  pricePlanId: string;
  discountCode?: string | null;
  paymentsSettings: PaymentsSettings;
  source?: "self" | "admin";
  createdBy?: string | null;
  nowMs?: number;
}

export interface CreateOrderResult {
  order: OrderRow;
  reused: boolean;
  discountMinor: number;
}

/**
 * Checkout core (PAYMENTS.md §1): server re-reads product/price; the client
 * NEVER supplies amounts. Creates order + item (frozen entitlement spec) +
 * pending manual payment (instructions snapshot) in one batch. Deduplicates
 * double submissions by reusing a live pending order for the same plan.
 */
export async function createOrder(db: DB, input: CreateOrderInput): Promise<CreateOrderResult> {
  const nowMs = input.nowMs ?? now();
  if (!input.paymentsSettings.manualEnabled) throw new CommerceValidationError("checkout_disabled");

  const product = input.productId
    ? await getProduct(db, input.productId)
    : input.productSlug
      ? await getProductBySlug(db, input.productSlug)
      : undefined;
  if (!product || !product.active || product.archivedAt !== null) {
    throw new CommerceValidationError("product_unavailable");
  }
  const plan = await getPricePlan(db, input.pricePlanId);
  if (!plan || plan.productId !== product.id || !plan.active) {
    throw new CommerceValidationError("price_unavailable");
  }
  const spec = await buildEntitlementSpec(db, product, plan, { requirePublished: true });

  // business rule: don't sell what the student already has
  const existing = await db
    .select()
    .from(entitlements)
    .where(
      and(
        eq(entitlements.studentId, input.studentId),
        eq(entitlements.status, "active"),
        inArray(entitlements.resourceId, spec.grants.map((g) => g.resourceId))
      )
    );
  if (existing.some((e) => e.expiresAt === null || e.expiresAt > nowMs)) {
    throw new CommerceValidationError("already_entitled");
  }
  if (spec.recurring) {
    const liveSub = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .innerJoin(pricePlans, eq(pricePlans.id, subscriptions.pricePlanId))
      .where(
        and(
          eq(subscriptions.studentId, input.studentId),
          eq(pricePlans.productId, product.id),
          inArray(subscriptions.status, ["active", "paused"])
        )
      )
      .limit(1);
    if (liveSub.length) throw new CommerceValidationError("already_subscribed");
  }

  // idempotent checkout: reuse a live pending order for the same product+plan
  const ttlMs = input.paymentsSettings.orderTtlMinutes * 60_000;
  const pendingOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.studentId, input.studentId),
        eq(orders.status, "pending"),
        eq(orders.source, input.source ?? "self"),
        sql`${orders.createdAt} > ${nowMs - ttlMs}`
      )
    )
    .orderBy(desc(orders.createdAt))
    .limit(10);
  if (pendingOrders.length) {
    const pendingItems = await db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, pendingOrders.map((o) => o.id)));
    for (const o of pendingOrders) {
      const items = pendingItems.filter((i) => i.orderId === o.id);
      if (items.length === 1 && items[0].productId === product.id && items[0].pricePlanId === plan.id) {
        return { order: o, reused: true, discountMinor: o.discountMinor };
      }
    }
  }

  // server-side pricing — the ONLY price truth
  const unitPriceMinor = effectivePriceMinor(plan, nowMs);
  const subtotalMinor = unitPriceMinor; // qty 1 in v1 (single-product checkout)
  let discountMinor = 0;
  let discountCodeId: string | null = null;
  if (input.discountCode && normalizeCode(input.discountCode)) {
    const verdict = await claimDiscountForOrder(db, input.discountCode, {
      studentId: input.studentId,
      subtotalMinor,
      productId: product.id,
      nowMs,
    });
    discountCodeId = verdict.codeId;
    discountMinor = verdict.discountMinor;
  }
  const totalMinor = Math.max(0, subtotalMinor - discountMinor);

  const orderId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const titleEn = product.nameEn;

  try {
    for (let attempt = 0; ; attempt++) {
      const orderNumber = generateOrderNumber();
      try {
        await db.batch([
          db.insert(orders).values({
            id: orderId,
            orderNumber,
            studentId: input.studentId,
            status: "pending",
            currency: plan.currency,
            subtotalMinor,
            discountMinor,
            totalMinor,
            discountCodeId,
            source: input.source ?? "self",
            createdBy: input.createdBy ?? null,
            createdAt: nowMs,
            updatedAt: nowMs,
          }),
          db.insert(orderItems).values({
            id: itemId,
            orderId,
            productId: product.id,
            pricePlanId: plan.id,
            titleSnapshotAr: product.nameAr,
            titleSnapshotEn: titleEn,
            unitPriceMinor,
            entitlementSpec: spec as unknown as Record<string, unknown>,
            createdAt: nowMs,
          }),
          db.insert(payments).values({
            id: paymentId,
            orderId,
            provider: "manual",
            method: null,
            amountMinor: totalMinor,
            currency: plan.currency,
            status: "pending",
            reference: null,
            instructions: {
              reference: orderNumber,
              instructionsAr: input.paymentsSettings.manualInstructionsAr,
              instructionsEn: input.paymentsSettings.manualInstructionsEn,
              generatedAt: nowMs,
            },
            reviewedBy: null,
            reviewedAt: null,
            paidAt: null,
            idempotencyKey: null,
            metadata: null,
            createdAt: nowMs,
            updatedAt: nowMs,
          }),
          ...(discountCodeId
            ? [
                db.insert(discountRedemptions).values({
                  id: crypto.randomUUID(),
                  codeId: discountCodeId,
                  orderId,
                  studentId: input.studentId,
                  amountMinor: discountMinor,
                  createdAt: nowMs,
                }),
              ]
            : []),
        ]);
        const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        await logAudit(db, {
          actorUserId: input.createdBy ?? input.studentId,
          actorRole: (input.source ?? "self") === "admin" ? "admin" : "student",
          action: "commerce.order.created", entityType: "order", entityId: orderId,
          after: { orderNumber, productId: product.id, pricePlanId: plan.id, totalMinor, currency: plan.currency, discountMinor },
        });
        return { order: orderRows[0], reused: false, discountMinor };
      } catch (err) {
        // order_number collision (astronomically rare) → retry with a fresh number
        if (attempt < 2 && String((err as Error)?.message ?? "").includes("UNIQUE") && String((err as Error)?.message ?? "").includes("order_number")) {
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    // compensate the discount claim — the order never materialized
    if (discountCodeId) await releaseDiscountClaim(db, discountCodeId);
    throw err;
  }
}

export async function getOrder(db: DB, id: string): Promise<OrderRow | undefined> {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return rows[0];
}

export async function getOrderByNumber(db: DB, orderNumber: string): Promise<OrderRow | undefined> {
  const rows = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  return rows[0];
}

export async function orderItemsOf(db: DB, orderId: string): Promise<OrderItemRow[]> {
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt));
}

export async function paymentsOf(db: DB, orderId: string): Promise<PaymentRow[]> {
  return db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt));
}

export async function getPayment(db: DB, id: string): Promise<PaymentRow | undefined> {
  const rows = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Manual rail (PAYMENTS.md §3): confirm → under_review → admin approve/reject
// ---------------------------------------------------------------------------

export async function confirmManualPayment(
  db: DB,
  opts: {
    studentId: string;
    orderId: string;
    transferReference: string;
    note?: string | null;
    paymentsSettings: PaymentsSettings;
    nowMs?: number;
  }
): Promise<{ paymentId: string }> {
  const nowMs = opts.nowMs ?? now();
  const order = await getOrder(db, opts.orderId);
  if (!order || order.studentId !== opts.studentId) throw new CommerceReferenceError("orderId", opts.orderId);
  if (order.status !== "pending") throw new CommerceStateError("order_not_pending");
  if (!opts.transferReference.trim()) throw new CommerceValidationError("transfer_reference_required");

  const existing = await paymentsOf(db, order.id);
  let payment = existing[0]; // newest first
  if (!payment) throw new CommerceStateError("payment_missing");
  if (payment.status === "failed" || payment.status === "expired" || payment.status === "cancelled") {
    // a rejected/expired attempt never blocks a retry: open a NEW payment row (1:N per PAYMENTS.md §1)
    const retryId = crypto.randomUUID();
    await db.insert(payments).values({
      id: retryId,
      orderId: order.id,
      provider: "manual",
      method: null,
      amountMinor: order.totalMinor,
      currency: order.currency,
      status: "pending",
      reference: null,
      instructions: {
        reference: order.orderNumber,
        instructionsAr: opts.paymentsSettings.manualInstructionsAr,
        instructionsEn: opts.paymentsSettings.manualInstructionsEn,
        generatedAt: nowMs,
      },
      reviewedBy: null,
      reviewedAt: null,
      paidAt: null,
      idempotencyKey: null,
      metadata: null,
      createdAt: nowMs,
      updatedAt: nowMs,
    });
    payment = (await getPayment(db, retryId))!;
  }
  if (payment.status !== "pending") throw new CommerceStateError("payment_not_pending");

  const claim = await db
    .update(payments)
    .set({
      status: "under_review",
      updatedAt: nowMs,
      metadata: {
        ...(payment.metadata ?? {}),
        evidence: { transferReference: opts.transferReference.trim().slice(0, 200), note: (opts.note ?? "").slice(0, 500) || null, confirmedAt: nowMs },
      },
    })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")))
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) throw new CommerceStateError("payment_not_pending");
  await logAudit(db, {
    actorUserId: opts.studentId, actorRole: "student",
    action: "commerce.payment.confirmed", entityType: "payment", entityId: payment.id,
    before: { status: "pending" }, after: { status: "under_review" },
  });
  return { paymentId: payment.id };
}

export async function cancelOrder(db: DB, opts: { studentId: string; orderId: string; nowMs?: number }): Promise<boolean> {
  const nowMs = opts.nowMs ?? now();
  const order = await getOrder(db, opts.orderId);
  if (!order || order.studentId !== opts.studentId) throw new CommerceReferenceError("orderId", opts.orderId);
  if (order.status !== "pending") throw new CommerceStateError("order_not_pending");
  const claim = await db
    .update(orders)
    .set({ status: "cancelled", updatedAt: nowMs })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) throw new CommerceStateError("order_not_pending");
  await db
    .update(payments)
    .set({ status: "cancelled", updatedAt: nowMs })
    .where(and(eq(payments.orderId, order.id), eq(payments.status, "pending")));
  return true;
}

// ---------------------------------------------------------------------------
// Fulfillment — the ONLY path that grants entitlements from a purchase
// ---------------------------------------------------------------------------

export interface FulfillResult {
  ok: true;
  alreadyProcessed: boolean;
  grantedCount: number;
  subscriptionId: string | null;
}

/**
 * Verified-payment fulfillment (PAYMENTS.md §1: ONE transaction). Claims the
 * payment atomically (pending/under_review → paid); only the claim winner
 * writes grants, so double approval / webhook replay / double submit produce
 * exactly ONE set of entitlements and ONE `purchase` event.
 */
async function fulfillPaid(
  db: DB,
  opts: { payment: PaymentRow; expectedFrom: ("pending" | "under_review")[]; actor: ActorCtx | null; via: "admin" | "webhook"; nowMs: number }
): Promise<FulfillResult> {
  const { payment, nowMs } = opts;
  const order = await getOrder(db, payment.orderId);
  if (!order) throw new CommerceReferenceError("orderId", payment.orderId);
  if (payment.amountMinor !== order.totalMinor) throw new CommerceValidationError("amount_mismatch");
  if (!canTransition(PAYMENT_TRANSITIONS, payment.status, "paid")) {
    if (payment.status === "paid" || payment.status === "refunded") {
      return { ok: true, alreadyProcessed: true, grantedCount: 0, subscriptionId: null };
    }
    throw new CommerceStateError(`${payment.status}_to_paid`);
  }

  const claim = await db
    .update(payments)
    .set({
      status: "paid",
      paidAt: nowMs,
      reviewedBy: opts.actor?.userId ?? null,
      reviewedAt: nowMs,
      updatedAt: nowMs,
      metadata: { ...(payment.metadata ?? {}), fulfilledVia: opts.via },
    })
    .where(and(eq(payments.id, payment.id), inArray(payments.status, opts.expectedFrom)))
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) {
    // lost the race — the winner already fulfilled; never re-grant
    return { ok: true, alreadyProcessed: true, grantedCount: 0, subscriptionId: null };
  }

  const items = await orderItemsOf(db, order.id);
  const writes: BatchItem<"sqlite">[] = [];
  writes.push(
    db
      .update(orders)
      .set({ status: "paid", updatedAt: nowMs })
      .where(and(eq(orders.id, order.id), inArray(orders.status, ["pending", "awaiting_payment"])))
  );

  const grantRows: (typeof entitlements.$inferInsert)[] = [];
  let subscriptionId: string | null = null;

  for (const item of items) {
    const spec = entitlementSpecSchema.parse(item.entitlementSpec);
    if (spec.recurring) {
      const plan = await getPricePlan(db, item.pricePlanId);
      if (!plan) throw new CommerceReferenceError("pricePlanId", item.pricePlanId);
      subscriptionId = crypto.randomUUID();
      const periodEnd = spec.fixedExpiresAt ?? periodEndMs(plan, nowMs);
      writes.push(
        db.insert(subscriptions).values({
          id: subscriptionId,
          studentId: order.studentId,
          pricePlanId: plan.id,
          planSnapshot: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            productId: item.productId,
            titleAr: item.titleSnapshotAr,
            titleEn: item.titleSnapshotEn,
            currency: order.currency,
            amountMinor: item.unitPriceMinor,
            period: plan.period,
            periodDays: plan.periodDays,
            fixedEndsAt: plan.fixedEndsAt,
          },
          status: "active",
          startedAt: nowMs,
          currentPeriodStart: nowMs,
          currentPeriodEnd: periodEnd,
          expiresAt: plan.period === "fixed_date" ? plan.fixedEndsAt : null,
          autoRenew: false,
          cancelledAt: null,
          createdAt: nowMs,
          updatedAt: nowMs,
        }),
        db.insert(subscriptionEvents).values({
          id: crypto.randomUUID(),
          subscriptionId,
          type: "created",
          at: nowMs,
          by: opts.actor?.userId ?? "system",
          metadata: { orderId: order.id, via: opts.via },
        })
      );
      for (const g of spec.grants) {
        grantRows.push({
          id: crypto.randomUUID(),
          studentId: order.studentId,
          sourceType: "subscription",
          sourceId: subscriptionId,
          resourceType: g.resourceType,
          resourceId: g.resourceId,
          status: "active",
          startsAt: nowMs,
          expiresAt: periodEnd,
          grantedAt: nowMs,
          grantedBy: opts.actor?.userId ?? null,
          revokedAt: null,
          revokeReason: null,
          metadata: { orderId: order.id, productId: item.productId },
        });
      }
    } else {
      const expiresAt = spec.fixedExpiresAt ?? (spec.durationDays ? nowMs + spec.durationDays * DAY_MS : null);
      for (const g of spec.grants) {
        grantRows.push({
          id: crypto.randomUUID(),
          studentId: order.studentId,
          sourceType: "order_item",
          sourceId: item.id,
          resourceType: g.resourceType,
          resourceId: g.resourceId,
          status: "active",
          startsAt: nowMs,
          expiresAt,
          grantedAt: nowMs,
          grantedBy: opts.actor?.userId ?? null,
          revokedAt: null,
          revokeReason: null,
          metadata: { orderId: order.id, productId: item.productId },
        });
      }
    }
  }

  if (grantRows.length === 0) throw new CommerceValidationError("nothing_to_grant");
  writes.push(db.insert(entitlements).values(grantRows));
  writes.push(
    db.insert(events).values({
      id: crypto.randomUUID(),
      type: "purchase",
      userId: order.studentId,
      resourceType: "order",
      resourceId: order.id,
      props: { orderNumber: order.orderNumber, amountMinor: order.totalMinor, currency: order.currency, items: items.length, action: "paid" },
      createdAt: nowMs,
    })
  );
  if (subscriptionId) {
    writes.push(
      db.insert(events).values({
        id: crypto.randomUUID(),
        type: "subscription_created",
        userId: order.studentId,
        resourceType: "subscription",
        resourceId: subscriptionId,
        props: { orderId: order.id },
        createdAt: nowMs,
      })
    );
  }

  await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return { ok: true, alreadyProcessed: false, grantedCount: grantRows.length, subscriptionId };
}

/** Admin approval of a manual payment (PAYMENTS.md §3): amount must match the server-computed total. */
export async function approveManualPayment(
  db: DB,
  opts: { paymentId: string; receivedAmountMinor: number; actor: ActorCtx; nowMs?: number }
): Promise<FulfillResult> {
  const nowMs = opts.nowMs ?? now();
  const payment = await getPayment(db, opts.paymentId);
  if (!payment) throw new CommerceReferenceError("paymentId", opts.paymentId);
  const order = await getOrder(db, payment.orderId);
  if (!order) throw new CommerceReferenceError("orderId", payment.orderId);
  if (payment.status === "paid") {
    return { ok: true, alreadyProcessed: true, grantedCount: 0, subscriptionId: null };
  }
  if (payment.status !== "under_review") throw new CommerceStateError(`${payment.status}_not_reviewable`);
  if (opts.receivedAmountMinor !== order.totalMinor) {
    throw new CommerceValidationError("amount_mismatch");
  }
  const result = await fulfillPaid(db, { payment, expectedFrom: ["under_review"], actor: opts.actor, via: "admin", nowMs });
  if (!result.alreadyProcessed) {
    await logAudit(db, {
      actorUserId: opts.actor.userId, actorRole: opts.actor.role,
      action: "commerce.payment.approved", entityType: "payment", entityId: payment.id,
      before: { status: "under_review" }, after: { status: "paid", amountMinor: payment.amountMinor, granted: result.grantedCount },
      ipHash: opts.actor.ipHash,
    });
  }
  return result;
}

export async function rejectManualPayment(
  db: DB,
  opts: { paymentId: string; reason: string; actor: ActorCtx; nowMs?: number }
): Promise<boolean> {
  const nowMs = opts.nowMs ?? now();
  const payment = await getPayment(db, opts.paymentId);
  if (!payment) throw new CommerceReferenceError("paymentId", opts.paymentId);
  if (payment.status !== "under_review") throw new CommerceStateError(`${payment.status}_not_reviewable`);
  const claim = await db
    .update(payments)
    .set({
      status: "failed",
      reviewedBy: opts.actor.userId,
      reviewedAt: nowMs,
      updatedAt: nowMs,
      metadata: { ...(payment.metadata ?? {}), rejection: { reason: opts.reason.slice(0, 500), at: nowMs } },
    })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "under_review")))
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) throw new CommerceStateError("already_reviewed");
  await logAudit(db, {
    actorUserId: opts.actor.userId, actorRole: opts.actor.role,
    action: "commerce.payment.rejected", entityType: "payment", entityId: payment.id,
    before: { status: "under_review" }, after: { status: "failed", reason: opts.reason.slice(0, 500) },
    ipHash: opts.actor.ipHash,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Refunds & revocation (immutable history — never deletes the purchase)
// ---------------------------------------------------------------------------

export async function refundPayment(
  db: DB,
  opts: { paymentId: string; reason: string; actor: ActorCtx; refundWindowDays: number; nowMs?: number }
): Promise<boolean> {
  const nowMs = opts.nowMs ?? now();
  const payment = await getPayment(db, opts.paymentId);
  if (!payment) throw new CommerceReferenceError("paymentId", opts.paymentId);
  if (payment.status === "refunded") return true; // idempotent replay
  if (payment.status !== "paid") throw new CommerceStateError(`${payment.status}_not_refundable`);
  if (opts.refundWindowDays > 0 && payment.paidAt !== null && nowMs - payment.paidAt > opts.refundWindowDays * DAY_MS) {
    throw new CommerceValidationError("refund_window_closed");
  }
  const order = await getOrder(db, payment.orderId);
  if (!order) throw new CommerceReferenceError("orderId", payment.orderId);

  const claim = await db
    .update(payments)
    .set({ status: "refunded", updatedAt: nowMs, metadata: { ...(payment.metadata ?? {}), refund: { reason: opts.reason.slice(0, 500), at: nowMs, by: opts.actor.userId } } })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "paid")))
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) return true; // lost race — winner already refunded

  const items = await orderItemsOf(db, order.id);
  const subs = await db
    .select()
    .from(subscriptions)
    .where(sql`json_extract(${subscriptions.planSnapshot}, '$.orderId') = ${order.id}`);

  const writes: BatchItem<"sqlite">[] = [];
  writes.push(
    db.insert(refunds).values({
      id: crypto.randomUUID(),
      paymentId: payment.id,
      amountMinor: payment.amountMinor, // v1: full refunds only (partial reserved in schema)
      reason: opts.reason.slice(0, 500),
      createdBy: opts.actor.userId,
      createdAt: nowMs,
    }),
    db
      .update(orders)
      .set({ status: "refunded", updatedAt: nowMs })
      .where(and(eq(orders.id, order.id), eq(orders.status, "paid")))
  );

  // revoke every grant sourced from this order (history stays — status flips)
  const itemIds = items.map((i) => i.id);
  if (itemIds.length) {
    writes.push(
      db
        .update(entitlements)
        .set({ status: "revoked", revokedAt: nowMs, revokeReason: `refund:${payment.id}` })
        .where(and(eq(entitlements.sourceType, "order_item"), inArray(entitlements.sourceId, itemIds), inArray(entitlements.status, ["active", "expired"])))
    );
  }
  for (const sub of subs) {
    writes.push(
      db
        .update(entitlements)
        .set({ status: "revoked", revokedAt: nowMs, revokeReason: `refund:${payment.id}` })
        .where(and(eq(entitlements.sourceType, "subscription"), eq(entitlements.sourceId, sub.id), inArray(entitlements.status, ["active", "expired"]))),
      db.update(subscriptions).set({ status: "cancelled", cancelledAt: nowMs, updatedAt: nowMs }).where(eq(subscriptions.id, sub.id)),
      db.insert(subscriptionEvents).values({
        id: crypto.randomUUID(), subscriptionId: sub.id, type: "refunded", at: nowMs, by: opts.actor.userId,
        metadata: { paymentId: payment.id },
      })
    );
  }
  writes.push(
    db.insert(events).values({
      id: crypto.randomUUID(),
      type: "purchase",
      userId: order.studentId,
      resourceType: "order",
      resourceId: order.id,
      props: { orderNumber: order.orderNumber, amountMinor: payment.amountMinor, currency: order.currency, action: "refunded" },
      createdAt: nowMs,
    })
  );
  await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  await logAudit(db, {
    actorUserId: opts.actor.userId, actorRole: opts.actor.role,
    action: "commerce.payment.refunded", entityType: "payment", entityId: payment.id,
    before: { status: "paid" }, after: { status: "refunded", amountMinor: payment.amountMinor, reason: opts.reason.slice(0, 500) },
    ipHash: opts.actor.ipHash,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Webhook inbox (PAYMENTS.md §4) — signature-first, idempotent by provider_event_id
// ---------------------------------------------------------------------------

export interface WebhookOutcome {
  status: number;
  result: "unknown_provider" | "rejected" | "duplicate" | "fulfilled" | "amount_mismatch_flagged" | "failed_marked" | "payment_not_found" | "ignored";
  detail?: string;
}

export async function processPaymentWebhook(
  db: DB,
  env: { MOCK_PAYMENTS_SECRET?: string },
  opts: { providerId: string; request: Request; rawBody: string; nowMs?: number }
): Promise<WebhookOutcome> {
  const nowMs = opts.nowMs ?? now();
  const provider = paymentProviderRegistry(env)[opts.providerId];
  if (!provider) return { status: 404, result: "unknown_provider" };

  const parsed = await provider.verifyAndParseWebhook(opts.request, opts.rawBody);
  const inboxId = crypto.randomUUID();

  if (parsed.providerEventId) {
    const inserted = await db
      .insert(paymentEvents)
      .values({
        id: inboxId,
        paymentId: null,
        provider: opts.providerId,
        eventType: parsed.eventType,
        providerEventId: parsed.providerEventId,
        signatureValid: parsed.valid,
        payload: parsed.payload,
        receivedAt: nowMs,
        processedAt: null,
        processingResult: null,
      })
      .onConflictDoNothing({ target: paymentEvents.providerEventId })
      .run();
    const insertedChanges = (inserted as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
    if (insertedChanges === 0) {
      // provider retry of an already-recorded event — acknowledged, never reprocessed
      return { status: 200, result: "duplicate" };
    }
  } else {
    await db.insert(paymentEvents).values({
      id: inboxId,
      paymentId: null,
      provider: opts.providerId,
      eventType: parsed.eventType,
      providerEventId: null,
      signatureValid: parsed.valid,
      payload: parsed.payload,
      receivedAt: nowMs,
      processedAt: null,
      processingResult: null,
    });
  }

  const markProcessed = async (result: string, paymentId: string | null) => {
    await db
      .update(paymentEvents)
      .set({ processedAt: now(), processingResult: result, paymentId })
      .where(eq(paymentEvents.id, inboxId));
  };

  if (!parsed.valid) {
    await markProcessed(`rejected:${parsed.reason ?? "invalid"}`, null);
    return { status: 400, result: "rejected", detail: parsed.reason };
  }

  const paymentRows = parsed.reference
    ? await db
        .select()
        .from(payments)
        .where(and(eq(payments.provider, opts.providerId), eq(payments.reference, parsed.reference)))
        .limit(1)
    : [];
  const payment = paymentRows[0];
  if (!payment) {
    await markProcessed("payment_not_found", null);
    return { status: 200, result: "payment_not_found" };
  }
  const order = await getOrder(db, payment.orderId);
  if (!order) {
    await markProcessed("order_not_found", payment.id);
    return { status: 200, result: "payment_not_found" };
  }

  if (parsed.eventType === "payment.paid") {
    if (parsed.amountMinor !== null && parsed.amountMinor !== order.totalMinor) {
      // mismatch → flag for admin review, NEVER auto-fulfill (PAYMENTS.md §4)
      if (payment.status === "pending") {
        await db
          .update(payments)
          .set({ status: "under_review", updatedAt: nowMs, metadata: { ...(payment.metadata ?? {}), mismatch: { webhookAmountMinor: parsed.amountMinor, orderTotalMinor: order.totalMinor } } })
          .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      }
      await markProcessed("amount_mismatch_flagged", payment.id);
      return { status: 200, result: "amount_mismatch_flagged" };
    }
    const outcome = await fulfillPaid(db, { payment, expectedFrom: ["pending"], actor: null, via: "webhook", nowMs });
    await markProcessed(outcome.alreadyProcessed ? "ignored:already_paid" : "fulfilled", payment.id);
    return { status: 200, result: "fulfilled" };
  }
  if (parsed.eventType === "payment.failed") {
    await db
      .update(payments)
      .set({ status: "failed", updatedAt: nowMs })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
    await markProcessed("failed_marked", payment.id);
    return { status: 200, result: "failed_marked" };
  }
  await markProcessed(`ignored:${parsed.eventType}`, payment.id);
  return { status: 200, result: "ignored" };
}

/**
 * Test-only gateway checkout initiation (exercises the full webhook discipline
 * with the mock adapter). Not exposed by any UI — production gateways ship
 * only after their PAYMENTS.md §6 verification row is filled.
 */
export async function createGatewayPayment(
  db: DB,
  env: { MOCK_PAYMENTS_SECRET?: string },
  opts: { orderId: string; providerId: string; returnUrl: string; nowMs?: number }
): Promise<PaymentRow> {
  const nowMs = opts.nowMs ?? now();
  const provider = paymentProviderRegistry(env)[opts.providerId];
  if (!provider) throw new CommerceReferenceError("provider", opts.providerId);
  const order = await getOrder(db, opts.orderId);
  if (!order) throw new CommerceReferenceError("orderId", opts.orderId);
  if (order.status !== "pending") throw new CommerceStateError("order_not_pending");
  const items = await orderItemsOf(db, order.id);
  const checkout = await provider.createCheckout({
    order: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalMinor: order.totalMinor,
      currency: order.currency,
      titleEn: items[0]?.titleSnapshotEn ?? "order",
    },
    returnUrl: opts.returnUrl,
  });
  const id = crypto.randomUUID();
  await db.insert(payments).values({
    id,
    orderId: order.id,
    provider: opts.providerId,
    method: null,
    amountMinor: order.totalMinor,
    currency: order.currency,
    status: "pending",
    reference: checkout.reference ?? null,
    instructions: null,
    reviewedBy: null,
    reviewedAt: null,
    paidAt: null,
    idempotencyKey: null,
    metadata: checkout.url ? { redirectUrl: checkout.url } : null,
    createdAt: nowMs,
    updatedAt: nowMs,
  });
  return (await getPayment(db, id))!;
}

// ---------------------------------------------------------------------------
// Activation codes (PAYMENTS.md §3 — hashed storage, atomic single-use)
// ---------------------------------------------------------------------------

export const activationBatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    note: z.string().trim().max(500).nullish(),
    count: z.number().int().min(1).max(500),
    productId: uuid.nullish(),
    grants: z.array(grantSchema).max(50).optional(),
    durationDays: z.number().int().min(1).max(3650).nullish(),
    fixedExpiresAt: z.number().int().positive().nullish(),
    maxUses: z.number().int().min(1).max(1000).default(1),
    expiresAt: z.number().int().positive().nullish(),
  })
  .refine((v) => v.productId || (v.grants && v.grants.length > 0), { message: "productId or grants required" });

export interface GeneratedBatch {
  batchId: string;
  /** PLAINTEXT codes — returned once, never stored, never re-readable */
  codes: string[];
}

export async function generateActivationBatch(
  db: DB,
  input: z.infer<typeof activationBatchSchema>,
  actor: ActorCtx
): Promise<GeneratedBatch> {
  let grants: { resourceType: "subject" | "course" | "lesson"; resourceId: string }[];
  let productId: string | null = null;
  if (input.productId) {
    const product = await getProduct(db, input.productId);
    if (!product) throw new CommerceReferenceError("productId", input.productId);
    if (product.archivedAt !== null) throw new CommerceStateError("product_archived");
    productId = product.id;
    const items = await productItemsOf(db, product.id);
    if (items.length === 0) throw new CommerceValidationError("product_has_no_items");
    grants = items.map((i) => ({ resourceType: i.resourceType, resourceId: i.resourceId }));
    await assertItemRefs(db, grants.filter((g) => g.resourceType !== "lesson") as { resourceType: "subject" | "course"; resourceId: string }[]);
  } else {
    grants = input.grants!;
    await assertItemRefs(db, grants.filter((g) => g.resourceType !== "lesson") as { resourceType: "subject" | "course"; resourceId: string }[]);
    for (const g of grants.filter((x) => x.resourceType === "lesson")) {
      const node = await getNode(db, "lesson", g.resourceId);
      if (!node) throw new CommerceReferenceError("grants.lessonId", g.resourceId);
    }
  }
  const spec = entitlementSpecSchema.parse({
    grants,
    durationDays: input.durationDays ?? null,
    fixedExpiresAt: input.fixedExpiresAt ?? null,
  });

  const ts = now();
  const batchId = crypto.randomUUID();
  await db.insert(activationCodeBatches).values({
    id: batchId,
    name: input.name,
    note: input.note ?? null,
    spec: spec as unknown as Record<string, unknown>,
    count: input.count,
    createdBy: actor.userId,
    createdAt: ts,
  });

  const plaintext: string[] = [];
  const rows: (typeof activationCodes.$inferInsert)[] = [];
  const seen = new Set<string>();
  while (rows.length < input.count) {
    const code = generateActivationCode();
    const normalized = normalizeCode(code);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push({
      id: crypto.randomUUID(),
      batchId,
      codeHash: await sha256Hex(normalized),
      prefix: normalized.slice(0, 4),
      productId,
      entitlementSpec: spec as unknown as Record<string, unknown>,
      maxUses: input.maxUses,
      useCount: 0,
      status: "active",
      expiresAt: input.expiresAt ?? null,
      createdBy: actor.userId,
      createdAt: ts,
      updatedAt: ts,
    });
    plaintext.push(code);
  }
  // chunked inserts (D1 binding limits) — generation is an admin one-shot
  for (let i = 0; i < rows.length; i += 8) {
    await db.insert(activationCodes).values(rows.slice(i, i + 8));
  }
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.batch.created", entityType: "activation_batch", entityId: batchId,
    // plaintext codes are NEVER logged
    after: { name: input.name, count: input.count, maxUses: input.maxUses, productId, spec },
    ipHash: actor.ipHash,
  });
  return { batchId, codes: plaintext };
}

export type RedeemErrorReason =
  | "invalid"
  | "disabled"
  | "revoked"
  | "exhausted"
  | "expired"
  | "already_redeemed";

export interface RedeemResult {
  ok: true;
  entitlementIds: string[];
  grantsCount: number;
}

/**
 * Atomic redemption: pre-checks give precise reasons; the conditional
 * use_count decrement is the race gate (two students, one single-use code →
 * exactly one winner); UNIQUE(code_id, student_id) is the per-student DB
 * invariant. A same-student double-submit that slips past the pre-check is
 * caught by the unique index and the claim is compensated.
 */
export async function redeemActivationCode(
  db: DB,
  opts: { studentId: string; code: string; ipHash?: string | null; nowMs?: number }
): Promise<RedeemResult | { ok: false; reason: RedeemErrorReason }> {
  const nowMs = opts.nowMs ?? now();
  const normalized = normalizeCode(opts.code);
  if (normalized.length < 8) return { ok: false, reason: "invalid" };
  const codeHash = await sha256Hex(normalized);
  const rows = await db.select().from(activationCodes).where(eq(activationCodes.codeHash, codeHash)).limit(1);
  const code = rows[0];
  if (!code) return { ok: false, reason: "invalid" };

  const prior = await db
    .select({ id: activationCodeRedemptions.id })
    .from(activationCodeRedemptions)
    .where(and(eq(activationCodeRedemptions.codeId, code.id), eq(activationCodeRedemptions.studentId, opts.studentId)))
    .limit(1);
  if (prior.length) return { ok: false, reason: "already_redeemed" };

  if (code.status === "disabled") return { ok: false, reason: "disabled" };
  if (code.status === "revoked") return { ok: false, reason: "revoked" };
  if (code.status === "exhausted" || code.useCount >= code.maxUses) return { ok: false, reason: "exhausted" };
  if (code.expiresAt !== null && code.expiresAt <= nowMs) return { ok: false, reason: "expired" };

  const claim = await db
    .update(activationCodes)
    .set({
      useCount: sql`use_count + 1`,
      status: sql`CASE WHEN use_count + 1 >= max_uses THEN 'exhausted' ELSE status END`,
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(activationCodes.id, code.id),
        eq(activationCodes.status, "active"),
        sql`use_count < max_uses`,
        sql`(expires_at IS NULL OR expires_at > ${nowMs})`
      )
    )
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) {
    const fresh = await db.select().from(activationCodes).where(eq(activationCodes.id, code.id)).limit(1);
    const f = fresh[0];
    if (!f || f.status === "disabled") return { ok: false, reason: "disabled" };
    if (f.status === "revoked") return { ok: false, reason: "revoked" };
    if (f.expiresAt !== null && f.expiresAt <= nowMs) return { ok: false, reason: "expired" };
    return { ok: false, reason: "exhausted" };
  }

  const spec = entitlementSpecSchema.parse(code.entitlementSpec);
  const entitlementIds: string[] = [];
  const grantRows = spec.grants.map((g) => {
    const id = crypto.randomUUID();
    entitlementIds.push(id);
    return {
      id,
      studentId: opts.studentId,
      sourceType: "activation_code" as const,
      sourceId: code.id,
      resourceType: g.resourceType,
      resourceId: g.resourceId,
      status: "active" as const,
      startsAt: nowMs,
      expiresAt: spec.fixedExpiresAt ?? (spec.durationDays ? nowMs + spec.durationDays * DAY_MS : null),
      grantedAt: nowMs,
      grantedBy: null,
      revokedAt: null,
      revokeReason: null,
      metadata: { batchId: code.batchId, codePrefix: code.prefix },
    };
  });

  try {
    await db.batch([
      db.insert(activationCodeRedemptions).values({
        id: crypto.randomUUID(),
        codeId: code.id,
        studentId: opts.studentId,
        entitlementId: entitlementIds[0] ?? null,
        createdAt: nowMs,
        ipHash: opts.ipHash ?? null,
      }),
      db.insert(entitlements).values(grantRows),
      db.insert(events).values({
        id: crypto.randomUUID(),
        type: "activation_redeem",
        userId: opts.studentId,
        resourceType: "activation_code",
        resourceId: code.id,
        props: { grants: grantRows.length },
        createdAt: nowMs,
      }),
    ]);
  } catch (err) {
    const msg = String((err as Error)?.message ?? "");
    if (msg.includes("UNIQUE") && msg.includes("activation_redemptions_code_student_uidx")) {
      // same-student race loser: give the claimed use back, report idempotently
      await db
        .update(activationCodes)
        .set({
          useCount: sql`CASE WHEN use_count > 0 THEN use_count - 1 ELSE 0 END`,
          status: sql`CASE WHEN status = 'exhausted' AND use_count - 1 < max_uses THEN 'active' ELSE status END`,
          updatedAt: nowMs,
        })
        .where(eq(activationCodes.id, code.id));
      return { ok: false, reason: "already_redeemed" };
    }
    throw err;
  }
  return { ok: true, entitlementIds, grantsCount: grantRows.length };
}

export async function setActivationCodeStatus(
  db: DB,
  id: string,
  status: "active" | "disabled" | "revoked",
  actor: ActorCtx
): Promise<boolean> {
  const rows = await db.select().from(activationCodes).where(eq(activationCodes.id, id)).limit(1);
  const code = rows[0];
  if (!code) throw new CommerceReferenceError("codeId", id);
  if (code.status === "revoked") throw new CommerceStateError("code_revoked_terminal");
  if (status === "active" && code.status !== "disabled") throw new CommerceStateError("only_disabled_codes_reactivate");
  if (code.status === "exhausted" && status === "active") throw new CommerceStateError("exhausted_code");
  await db.update(activationCodes).set({ status, updatedAt: now() }).where(eq(activationCodes.id, id));
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: `commerce.code.${status === "active" ? "enabled" : status}`, entityType: "activation_code", entityId: id,
    before: { status: code.status }, after: { status }, ipHash: actor.ipHash,
  });
  return true;
}

export async function listActivationBatchesAdmin(db: DB) {
  const batches = await db.select().from(activationCodeBatches).orderBy(desc(activationCodeBatches.createdAt)).limit(50);
  if (!batches.length) return [];
  const codes = await db
    .select({
      batchId: activationCodes.batchId,
      total: sql<number>`COUNT(*)`,
      used: sql<number>`SUM(use_count)`,
      active: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
    })
    .from(activationCodes)
    .where(inArray(activationCodes.batchId, batches.map((b) => b.id)))
    .groupBy(activationCodes.batchId);
  const stats = new Map(codes.map((c) => [c.batchId, c]));
  return batches.map((b) => ({ ...b, stats: stats.get(b.id) ?? { total: 0, used: 0, active: 0 } }));
}

export async function activationBatchDetail(db: DB, batchId: string) {
  const batchRows = await db.select().from(activationCodeBatches).where(eq(activationCodeBatches.id, batchId)).limit(1);
  const batch = batchRows[0];
  if (!batch) throw new CommerceReferenceError("batchId", batchId);
  const codes = await db
    .select({
      id: activationCodes.id,
      prefix: activationCodes.prefix,
      status: activationCodes.status,
      useCount: activationCodes.useCount,
      maxUses: activationCodes.maxUses,
      expiresAt: activationCodes.expiresAt,
      createdAt: activationCodes.createdAt,
    })
    .from(activationCodes)
    .where(eq(activationCodes.batchId, batchId))
    .orderBy(asc(activationCodes.createdAt))
    .limit(500);
  const redemptions = await db
    .select({
      id: activationCodeRedemptions.id,
      codeId: activationCodeRedemptions.codeId,
      studentEmail: users.email,
      entitlementId: activationCodeRedemptions.entitlementId,
      createdAt: activationCodeRedemptions.createdAt,
    })
    .from(activationCodeRedemptions)
    .leftJoin(users, eq(users.id, activationCodeRedemptions.studentId))
    .where(inArray(activationCodeRedemptions.codeId, codes.map((c) => c.id)))
    .orderBy(desc(activationCodeRedemptions.createdAt))
    .limit(200);
  return { batch, codes, redemptions };
}

// ---------------------------------------------------------------------------
// Subscriptions (server-driven status; renew manual v1; cancel keeps access)
// ---------------------------------------------------------------------------

export async function subscriptionsForStudent(db: DB, studentId: string) {
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.studentId, studentId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(50);
}

export async function getSubscription(db: DB, id: string): Promise<SubscriptionRow | undefined> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  return rows[0];
}

function snapshotPeriodMs(snapshot: Record<string, unknown>, nowMs: number): number | null {
  const period = snapshot.period as string | null;
  switch (period) {
    case "monthly":
      return 30 * DAY_MS;
    case "annual":
      return 365 * DAY_MS;
    case "term":
    case "custom": {
      const days = snapshot.periodDays as number | null;
      return days ? days * DAY_MS : null;
    }
    case "fixed_date": {
      const end = snapshot.fixedEndsAt as number | null;
      return end && end > nowMs ? end - nowMs : null;
    }
    default:
      return null;
  }
}

export async function renewSubscription(db: DB, id: string, actor: ActorCtx, nowMs = now()): Promise<boolean> {
  const sub = await getSubscription(db, id);
  if (!sub) throw new CommerceReferenceError("subscriptionId", id);
  if (!["active", "cancelled", "expired", "paused"].includes(sub.status)) throw new CommerceStateError(`${sub.status}_not_renewable`);
  const snapshot = (sub.planSnapshot ?? {}) as Record<string, unknown>;
  const periodMs = snapshotPeriodMs(snapshot, nowMs);
  if (!periodMs) throw new CommerceValidationError("renew_not_supported_for_plan");
  const base = Math.max(sub.currentPeriodEnd ?? nowMs, nowMs);
  const newEnd = base + periodMs;
  await db.batch([
    db
      .update(subscriptions)
      .set({ status: "active", currentPeriodStart: base, currentPeriodEnd: newEnd, cancelledAt: null, updatedAt: nowMs })
      .where(eq(subscriptions.id, id)),
    db
      .update(entitlements)
      .set({ status: "active", expiresAt: newEnd, revokedAt: null, revokeReason: null })
      .where(and(eq(entitlements.sourceType, "subscription"), eq(entitlements.sourceId, id))),
    db.insert(subscriptionEvents).values({
      id: crypto.randomUUID(), subscriptionId: id, type: "renewed", at: nowMs, by: actor.userId,
      metadata: { currentPeriodEnd: newEnd },
    }),
    db.insert(events).values({
      id: crypto.randomUUID(), type: "subscription_renewed", userId: sub.studentId,
      resourceType: "subscription", resourceId: id, props: { currentPeriodEnd: newEnd }, createdAt: nowMs,
    }),
  ]);
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.subscription.renewed", entityType: "subscription", entityId: id,
    before: { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd }, after: { status: "active", currentPeriodEnd: newEnd },
    ipHash: actor.ipHash,
  });
  return true;
}

/** Cancel keeps access until the period end (FEATURE-SPEC §7) — entitlements untouched. */
export async function cancelSubscription(
  db: DB,
  id: string,
  actor: { userId: string; role: string; ipHash?: string },
  nowMs = now()
): Promise<boolean> {
  const sub = await getSubscription(db, id);
  if (!sub) throw new CommerceReferenceError("subscriptionId", id);
  if (sub.status === "cancelled") return true;
  if (!["active", "paused"].includes(sub.status)) throw new CommerceStateError(`${sub.status}_not_cancellable`);
  const claim = await db
    .update(subscriptions)
    .set({ status: "cancelled", cancelledAt: nowMs, autoRenew: false, updatedAt: nowMs })
    .where(and(eq(subscriptions.id, id), inArray(subscriptions.status, ["active", "paused"])))
    .run();
  const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (changes === 0) throw new CommerceStateError("already_changed");
  if (sub.status === "paused") {
    // paused entitlements were revoked — a cancel from pause restores them for the remaining period
    await db
      .update(entitlements)
      .set({ status: "active", revokedAt: null, revokeReason: null })
      .where(and(eq(entitlements.sourceType, "subscription"), eq(entitlements.sourceId, id), eq(entitlements.revokeReason, "subscription_paused")));
  }
  await db.batch([
    db.insert(subscriptionEvents).values({
      id: crypto.randomUUID(), subscriptionId: id, type: "cancelled", at: nowMs, by: actor.userId, metadata: null,
    }),
    db.insert(events).values({
      id: crypto.randomUUID(), type: "subscription_cancelled", userId: sub.studentId,
      resourceType: "subscription", resourceId: id, props: { accessUntil: sub.currentPeriodEnd }, createdAt: nowMs,
    }),
  ]);
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.subscription.cancelled", entityType: "subscription", entityId: id,
    before: { status: sub.status }, after: { status: "cancelled", accessUntil: sub.currentPeriodEnd }, ipHash: actor.ipHash,
  });
  return true;
}

export async function pauseSubscription(db: DB, id: string, actor: ActorCtx, nowMs = now()): Promise<boolean> {
  const sub = await getSubscription(db, id);
  if (!sub) throw new CommerceReferenceError("subscriptionId", id);
  if (sub.status !== "active") throw new CommerceStateError(`${sub.status}_not_pausable`);
  await db.batch([
    db.update(subscriptions).set({ status: "paused", updatedAt: nowMs }).where(and(eq(subscriptions.id, id), eq(subscriptions.status, "active"))),
    db
      .update(entitlements)
      .set({ status: "revoked", revokedAt: nowMs, revokeReason: "subscription_paused" })
      .where(and(eq(entitlements.sourceType, "subscription"), eq(entitlements.sourceId, id), eq(entitlements.status, "active"))),
    db.insert(subscriptionEvents).values({
      id: crypto.randomUUID(), subscriptionId: id, type: "paused", at: nowMs, by: actor.userId, metadata: null,
    }),
    db.insert(events).values({
      id: crypto.randomUUID(), type: "subscription_paused", userId: sub.studentId,
      resourceType: "subscription", resourceId: id, props: null, createdAt: nowMs,
    }),
  ]);
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.subscription.paused", entityType: "subscription", entityId: id,
    before: { status: sub.status }, after: { status: "paused" }, ipHash: actor.ipHash,
  });
  return true;
}

export async function resumeSubscription(db: DB, id: string, actor: ActorCtx, nowMs = now()): Promise<boolean> {
  const sub = await getSubscription(db, id);
  if (!sub) throw new CommerceReferenceError("subscriptionId", id);
  if (sub.status !== "paused") throw new CommerceStateError(`${sub.status}_not_resumable`);
  if (sub.currentPeriodEnd !== null && sub.currentPeriodEnd <= nowMs) throw new CommerceStateError("period_already_over");
  await db.batch([
    db.update(subscriptions).set({ status: "active", updatedAt: nowMs }).where(and(eq(subscriptions.id, id), eq(subscriptions.status, "paused"))),
    db
      .update(entitlements)
      .set({ status: "active", revokedAt: null, revokeReason: null })
      .where(and(eq(entitlements.sourceType, "subscription"), eq(entitlements.sourceId, id), eq(entitlements.revokeReason, "subscription_paused"))),
    db.insert(subscriptionEvents).values({
      id: crypto.randomUUID(), subscriptionId: id, type: "resumed", at: nowMs, by: actor.userId, metadata: null,
    }),
    db.insert(events).values({
      id: crypto.randomUUID(), type: "subscription_resumed", userId: sub.studentId,
      resourceType: "subscription", resourceId: id, props: null, createdAt: nowMs,
    }),
  ]);
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "commerce.subscription.resumed", entityType: "subscription", entityId: id,
    before: { status: sub.status }, after: { status: "active" }, ipHash: actor.ipHash,
  });
  return true;
}

/**
 * Sweep-on-touch expiry (same pattern as exam attempts — no Workers cron in
 * this deployment): subscriptions past their period end flip to expired and
 * their entitlements expire with them; the resolver then denies access.
 */
export async function sweepExpiredSubscriptions(db: DB, nowMs = now()): Promise<number> {
  const due = await db
    .select({ id: subscriptions.id, studentId: subscriptions.studentId, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, ["active", "cancelled", "paused"]), lt(subscriptions.currentPeriodEnd, nowMs)))
    .limit(100);
  if (!due.length) return 0;
  const ids = due.map((s) => s.id);
  const writes: BatchItem<"sqlite">[] = [
    db.update(subscriptions).set({ status: "expired", updatedAt: nowMs }).where(and(inArray(subscriptions.id, ids), inArray(subscriptions.status, ["active", "cancelled", "paused"]))),
    db
      .update(entitlements)
      .set({ status: "expired" })
      .where(and(eq(entitlements.sourceType, "subscription"), inArray(entitlements.sourceId, ids), eq(entitlements.status, "active"))),
  ];
  for (const s of due) {
    writes.push(
      db.insert(subscriptionEvents).values({
        id: crypto.randomUUID(), subscriptionId: s.id, type: "expired", at: nowMs, by: "system",
        metadata: { currentPeriodEnd: s.currentPeriodEnd },
      }),
      db.insert(events).values({
        id: crypto.randomUUID(), type: "subscription_expired", userId: s.studentId,
        resourceType: "subscription", resourceId: s.id, props: null, createdAt: nowMs,
      })
    );
  }
  await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return due.length;
}

/** Pending orders/payments older than the TTL auto-expire (PAYMENTS.md §4). Sweep-on-touch. */
export async function sweepExpiredOrders(db: DB, ttlMinutes: number, nowMs = now()): Promise<number> {
  const cutoff = nowMs - ttlMinutes * 60_000;
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending"), lt(orders.createdAt, cutoff)))
    .limit(100);
  if (!due.length) return 0;
  const ids = due.map((o) => o.id);
  await db.batch([
    db.update(orders).set({ status: "expired", updatedAt: nowMs }).where(and(inArray(orders.id, ids), eq(orders.status, "pending"))),
    db.update(payments).set({ status: "expired", updatedAt: nowMs }).where(and(inArray(payments.orderId, ids), eq(payments.status, "pending"))),
  ]);
  return due.length;
}

// ---------------------------------------------------------------------------
// Read models (student + admin) — IDOR-safe by construction
// ---------------------------------------------------------------------------

export interface OrderDetailView {
  order: OrderRow;
  items: (OrderItemRow & { spec: EntitlementSpec })[];
  payments: PaymentRow[];
  studentEmail?: string;
}

async function orderDetailView(db: DB, order: OrderRow, opts: { includeStudent?: boolean } = {}): Promise<OrderDetailView> {
  const [itemRows, paymentRows] = await Promise.all([orderItemsOf(db, order.id), paymentsOf(db, order.id)]);
  const items = itemRows.map((i) => ({ ...i, spec: entitlementSpecSchema.parse(i.entitlementSpec) }));
  let studentEmail: string | undefined;
  if (opts.includeStudent) {
    const u = await db.select({ email: users.email }).from(users).where(eq(users.id, order.studentId)).limit(1);
    studentEmail = u[0]?.email;
  }
  return { order, items, payments: paymentRows, studentEmail };
}

/** Student order list (ownership-scoped; sweeps first so states are always truthful). */
export async function ordersForStudent(db: DB, studentId: string, ttlMinutes: number) {
  await sweepExpiredOrders(db, ttlMinutes);
  await sweepExpiredSubscriptions(db);
  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.studentId, studentId))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  if (!orderRows.length) return [];
  const [itemRows, paymentRows] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderRows.map((o) => o.id))),
    db.select().from(payments).where(inArray(payments.orderId, orderRows.map((o) => o.id))).orderBy(desc(payments.createdAt)),
  ]);
  return orderRows.map((o) => ({
    order: o,
    items: itemRows.filter((i) => i.orderId === o.id),
    payments: paymentRows.filter((p) => p.orderId === o.id),
  }));
}

/** Student order detail by order number; null when missing OR owned by someone else (404-shaped). */
export async function orderDetailForStudent(db: DB, orderNumber: string, studentId: string): Promise<OrderDetailView | null> {
  const order = await getOrderByNumber(db, orderNumber);
  if (!order || order.studentId !== studentId) return null;
  return orderDetailView(db, order);
}

export async function orderDetailForAdmin(db: DB, orderId: string): Promise<OrderDetailView | null> {
  const order = await getOrder(db, orderId);
  if (!order) return null;
  return orderDetailView(db, order, { includeStudent: true });
}

export async function listOrdersAdmin(
  db: DB,
  filter: { status?: string; q?: string; page?: number }
) {
  const perPage = 20;
  const page = Math.max(1, filter.page ?? 1);
  const conditions = [];
  if (filter.status && filter.status !== "all") conditions.push(eq(orders.status, filter.status as "pending"));
  if (filter.q) {
    const like = `%${filter.q}%`;
    const studentIds = await db.select({ id: users.id }).from(users).where(sql`${users.email} LIKE ${like}`).limit(50);
    conditions.push(
      or(sql`${orders.orderNumber} LIKE ${like}`, studentIds.length ? inArray(orders.studentId, studentIds.map((s) => s.id)) : undefined)
    );
  }
  const rows = await db
    .select({
      id: orders.id, orderNumber: orders.orderNumber, studentId: orders.studentId, studentEmail: users.email,
      status: orders.status, currency: orders.currency, totalMinor: orders.totalMinor, source: orders.source, createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.studentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  return { rows, page, perPage };
}

export async function listPaymentsAdmin(db: DB, filter: { status?: string; page?: number }) {
  const perPage = 20;
  const page = Math.max(1, filter.page ?? 1);
  const conditions = [];
  if (filter.status && filter.status !== "all") conditions.push(eq(payments.status, filter.status as "pending"));
  const rows = await db
    .select({
      id: payments.id, orderId: payments.orderId, orderNumber: orders.orderNumber, studentEmail: users.email,
      provider: payments.provider, amountMinor: payments.amountMinor, currency: payments.currency,
      status: payments.status, reference: payments.reference, reviewedAt: payments.reviewedAt,
      paidAt: payments.paidAt, createdAt: payments.createdAt, metadata: payments.metadata,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(users, eq(users.id, orders.studentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  return { rows, page, perPage };
}

export async function listSubscriptionsAdmin(db: DB, filter: { status?: string; page?: number }) {
  const perPage = 20;
  const page = Math.max(1, filter.page ?? 1);
  const conditions = [];
  if (filter.status && filter.status !== "all") conditions.push(eq(subscriptions.status, filter.status as "active"));
  const rows = await db
    .select({
      id: subscriptions.id, studentId: subscriptions.studentId, studentEmail: users.email,
      status: subscriptions.status, planSnapshot: subscriptions.planSnapshot,
      currentPeriodStart: subscriptions.currentPeriodStart, currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelledAt: subscriptions.cancelledAt, createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .leftJoin(users, eq(users.id, subscriptions.studentId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(subscriptions.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  return { rows, page, perPage };
}

// ---------------------------------------------------------------------------
// Public product views + catalog CTA integration
// ---------------------------------------------------------------------------

export interface PublicProductView {
  product: ProductRow;
  items: { resourceType: string; resourceId: string }[];
  plans: (PricePlanRow & { effectiveMinor: number })[];
  thumbnailUrl: string | null;
}

export async function publicProductBySlug(db: DB, slug: string, nowMs = now()): Promise<PublicProductView | null> {
  const product = await getProductBySlug(db, slug);
  if (!product || !product.active || product.archivedAt !== null) return null;
  const [items, planRows] = await Promise.all([productItemsOf(db, product.id), pricePlansForProduct(db, product.id, { activeOnly: true })]);
  let thumbnailUrl: string | null = null;
  if (product.thumbnailFileId) thumbnailUrl = `/files/${product.thumbnailFileId}`;
  return {
    product,
    items: items.map((i) => ({ resourceType: i.resourceType, resourceId: i.resourceId })),
    plans: planRows.map((p) => ({ ...p, effectiveMinor: effectivePriceMinor(p, nowMs) })),
    thumbnailUrl,
  };
}

/**
 * Catalog CTA hook: the purchasable product (if any) covering a content node —
 * direct match, or (for courses) via a subject-level product. Returns the slug
 * + cheapest effective price so catalog pages can render a real buy link.
 */
export async function purchasableFor(
  db: DB,
  resource: { type: "course" | "subject"; id: string; subjectId?: string | null },
  nowMs = now()
): Promise<{ productSlug: string; productNameAr: string; productNameEn: string; minPriceMinor: number; currency: string; kind: string } | null> {
  const matchConditions = [
    and(eq(productItems.resourceType, resource.type), eq(productItems.resourceId, resource.id)),
  ];
  if (resource.type === "course" && resource.subjectId) {
    matchConditions.push(and(eq(productItems.resourceType, "subject"), eq(productItems.resourceId, resource.subjectId)));
  }
  const itemRows = await db
    .select({ productId: productItems.productId })
    .from(productItems)
    .where(or(...matchConditions));
  if (!itemRows.length) return null;
  const productIds = [...new Set(itemRows.map((r) => r.productId))];
  const productRows = await db
    .select()
    .from(products)
    .where(and(inArray(products.id, productIds), eq(products.active, true), isNull(products.archivedAt)));
  if (!productRows.length) return null;
  const planRows = await db
    .select()
    .from(pricePlans)
    .where(and(inArray(pricePlans.productId, productRows.map((p) => p.id)), eq(pricePlans.active, true)));
  if (!planRows.length) return null;
  // cheapest currently-effective plan wins the CTA
  let best: { product: ProductRow; minor: number; plan: PricePlanRow } | null = null;
  for (const plan of planRows) {
    const product = productRows.find((p) => p.id === plan.productId);
    if (!product) continue;
    const minor = effectivePriceMinor(plan, nowMs);
    if (!best || minor < best.minor) best = { product, minor, plan };
  }
  if (!best) return null;
  return {
    productSlug: best.product.slug,
    productNameAr: best.product.nameAr,
    productNameEn: best.product.nameEn,
    minPriceMinor: best.minor,
    currency: best.plan.currency,
    kind: best.product.kind,
  };
}
