import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Commerce domain (Phase 6 — FEATURE-SPEC §7, PAYMENTS.md, DATABASE-SCHEMA "Commerce").
 *
 * Money is ALWAYS integer minor units (piasters for EGP) — never floats. Prices
 * are server-read at order time; clients never supply amounts. Entitlements are
 * granted ONLY inside the verified-fulfillment transaction (admin approval or
 * signature-verified webhook) — a redirect/success page grants nothing.
 *
 * Integrity policy mirrors ADR-017/019/021: within-domain references are real
 * FKs (all tables created in this migration); cross-domain references (users,
 * entitlements, content nodes, files) are plain TEXT + app-layer guards in
 * server/commerce/service.server.ts (CommerceReferenceError on invalid refs).
 */

// ---------------------------------------------------------------------------
// Products & pricing
// ---------------------------------------------------------------------------

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["course", "subject", "bundle", "subscription_plan"] }).notNull(),
    slug: text("slug").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionAr: text("description_ar").notNull().default(""),
    descriptionEn: text("description_en").notNull().default(""),
    /** public image (app-ref to files, visibility=public — ADR-017) */
    thumbnailFileId: text("thumbnail_file_id"),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    /** non-destructive archive; archived products never checkout, history intact */
    archivedAt: integer("archived_at", { mode: "number" }),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("products_slug_uidx").on(t.slug),
    index("products_kind_active_idx").on(t.kind, t.active, t.sortOrder),
  ]
);

/** Bundle/plan composition: which content resources a product conveys (app-refs to subjects/courses). */
export const productItems = sqliteTable(
  "product_items",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    resourceType: text("resource_type", { enum: ["subject", "course"] }).notNull(),
    resourceId: text("resource_id").notNull(),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("product_items_uidx").on(t.productId, t.resourceType, t.resourceId),
    index("product_items_resource_idx").on(t.resourceType, t.resourceId),
  ]
);

export const pricePlans = sqliteTable(
  "price_plans",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    currency: text("currency").notNull().default("EGP"),
    /** integer minor units (piasters for EGP) — never floats */
    amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
    kind: text("kind", { enum: ["one_time", "recurring"] }).notNull().default("one_time"),
    /** recurring/duration semantics; null = plain one-time perpetual purchase */
    period: text("period", { enum: ["monthly", "term", "annual", "custom", "fixed_date"] }),
    /** days for term/custom periods */
    periodDays: integer("period_days", { mode: "number" }),
    /** absolute end for period=fixed_date (ms epoch) */
    fixedEndsAt: integer("fixed_ends_at", { mode: "number" }),
    labelAr: text("label_ar"),
    labelEn: text("label_en"),
    /** display-only "was" price (minor units) */
    compareAtMinor: integer("compare_at_minor", { mode: "number" }),
    /** promo price within the promo window (server-evaluated; minor units) */
    promoPriceMinor: integer("promo_price_minor", { mode: "number" }),
    promoStartsAt: integer("promo_starts_at", { mode: "number" }),
    promoEndsAt: integer("promo_ends_at", { mode: "number" }),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("price_plans_product_idx").on(t.productId, t.active, t.sortOrder)]
);

// ---------------------------------------------------------------------------
// Orders & payments
// ---------------------------------------------------------------------------

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    /** human-facing number; doubles as the manual-rail payment reference (PAYMENTS.md §3) */
    orderNumber: text("order_number").notNull(),
    /** app-ref to users (ADR-017) */
    studentId: text("student_id").notNull(),
    status: text("status", {
      enum: ["pending", "awaiting_payment", "paid", "cancelled", "expired", "failed", "refunded", "partially_refunded"],
    }).notNull().default("pending"),
    currency: text("currency").notNull().default("EGP"),
    subtotalMinor: integer("subtotal_minor", { mode: "number" }).notNull(),
    discountMinor: integer("discount_minor", { mode: "number" }).notNull().default(0),
    totalMinor: integer("total_minor", { mode: "number" }).notNull(),
    /** in-domain FK; null when no code applied */
    discountCodeId: text("discount_code_id"),
    source: text("source", { enum: ["self", "admin", "manual"] }).notNull().default("self"),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("orders_number_uidx").on(t.orderNumber),
    index("orders_student_idx").on(t.studentId, t.status, t.createdAt),
    index("orders_status_created_idx").on(t.status, t.createdAt),
  ]
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    productId: text("product_id").notNull(),
    pricePlanId: text("price_plan_id").notNull(),
    /** frozen display titles at purchase time (history never rewrites) */
    titleSnapshotAr: text("title_snapshot_ar").notNull(),
    titleSnapshotEn: text("title_snapshot_en").notNull(),
    unitPriceMinor: integer("unit_price_minor", { mode: "number" }).notNull(),
    /**
     * Frozen at purchase: the exact grants this item conveys
     * ({ grants: [{resourceType, resourceId}], durationDays, fixedExpiresAt }).
     * Fulfillment expands this spec into concrete entitlement rows — price or
     * product-composition changes later never rewrite purchase history.
     */
    entitlementSpec: text("entitlement_spec", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)]
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    /** manual | mock (test-only) | paymob | fawry | stripe (gateways after verification ADR) */
    provider: text("provider").notNull().default("manual"),
    method: text("method"),
    amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("EGP"),
    status: text("status", {
      enum: ["pending", "under_review", "paid", "failed", "cancelled", "expired", "refunded", "partially_refunded"],
    }).notNull().default("pending"),
    /** gateway tx id / manual transfer reference (evidence) */
    reference: text("reference"),
    /** manual rail: frozen instructions snapshot shown to the student */
    instructions: text("instructions", { mode: "json" }).$type<Record<string, unknown>>(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: integer("reviewed_at", { mode: "number" }),
    paidAt: integer("paid_at", { mode: "number" }),
    idempotencyKey: text("idempotency_key"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("payments_idem_uidx").on(t.idempotencyKey),
    index("payments_order_idx").on(t.orderId),
    index("payments_provider_ref_idx").on(t.provider, t.reference),
    index("payments_status_idx").on(t.status, t.createdAt),
  ]
);

/** Webhook inbox: raw sanitized payloads, signature validity, idempotent processing by provider_event_id. */
export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id"),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    providerEventId: text("provider_event_id"),
    signatureValid: integer("signature_valid", { mode: "boolean" }).notNull().default(false),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    receivedAt: integer("received_at", { mode: "number" }).notNull(),
    processedAt: integer("processed_at", { mode: "number" }),
    processingResult: text("processing_result"),
  },
  (t) => [
    uniqueIndex("payment_events_provider_uidx").on(t.providerEventId),
    index("payment_events_provider_idx").on(t.provider, t.receivedAt),
  ]
);

export const refunds = sqliteTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
    reason: text("reason").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("refunds_payment_idx").on(t.paymentId)]
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    /** app-ref to users (ADR-017) */
    studentId: text("student_id").notNull(),
    pricePlanId: text("price_plan_id")
      .notNull()
      .references(() => pricePlans.id),
    /** frozen plan description at purchase (name/currency/amount/period/items) */
    planSnapshot: text("plan_snapshot", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    status: text("status", { enum: ["pending", "active", "paused", "cancelled", "expired"] })
      .notNull()
      .default("pending"),
    startedAt: integer("started_at", { mode: "number" }),
    currentPeriodStart: integer("current_period_start", { mode: "number" }),
    currentPeriodEnd: integer("current_period_end", { mode: "number" }),
    /** fixed end (period=fixed_date plans) */
    expiresAt: integer("expires_at", { mode: "number" }),
    autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(false),
    cancelledAt: integer("cancelled_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("subscriptions_student_idx").on(t.studentId, t.status),
    index("subscriptions_sweep_idx").on(t.status, t.currentPeriodEnd),
  ]
);

export const subscriptionEvents = sqliteTable(
  "subscription_events",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    type: text("type").notNull(),
    at: integer("at", { mode: "number" }).notNull(),
    by: text("by"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("subscription_events_sub_idx").on(t.subscriptionId, t.at)]
);

// ---------------------------------------------------------------------------
// Discount & activation codes (hashed storage; prefix kept for admin search)
// ---------------------------------------------------------------------------

export const discountCodes = sqliteTable(
  "discount_codes",
  {
    id: text("id").primaryKey(),
    /** sha-256 of the normalized code — plaintext is never stored */
    codeHash: text("code_hash").notNull(),
    prefix: text("prefix").notNull().default(""),
    type: text("type", { enum: ["percent", "fixed"] }).notNull(),
    /** percent: 1-100 integer; fixed: minor units */
    value: integer("value", { mode: "number" }).notNull(),
    maxUses: integer("max_uses", { mode: "number" }),
    usedCount: integer("used_count", { mode: "number" }).notNull().default(0),
    perUserLimit: integer("per_user_limit", { mode: "number" }),
    minOrderMinor: integer("min_order_minor", { mode: "number" }),
    /** null = all products; else { productIds: string[] } */
    appliesTo: text("applies_to", { mode: "json" }).$type<Record<string, unknown>>(),
    startsAt: integer("starts_at", { mode: "number" }).notNull(),
    endsAt: integer("ends_at", { mode: "number" }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("discount_codes_hash_uidx").on(t.codeHash)]
);

export const discountRedemptions = sqliteTable(
  "discount_redemptions",
  {
    id: text("id").primaryKey(),
    codeId: text("code_id")
      .notNull()
      .references(() => discountCodes.id),
    orderId: text("order_id").notNull(),
    studentId: text("student_id").notNull(),
    amountMinor: integer("amount_minor", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("discount_redemptions_code_student_idx").on(t.codeId, t.studentId),
    index("discount_redemptions_order_idx").on(t.orderId),
  ]
);

export const activationCodeBatches = sqliteTable("activation_code_batches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  note: text("note"),
  /** template spec the codes were generated from (frozen per code as well) */
  spec: text("spec", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  count: integer("count", { mode: "number" }).notNull(),
  createdBy: text("created_by"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const activationCodes = sqliteTable(
  "activation_codes",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").references(() => activationCodeBatches.id),
    /** sha-256 of the normalized code — plaintext shown once at generation */
    codeHash: text("code_hash").notNull(),
    prefix: text("prefix").notNull().default(""),
    productId: text("product_id"),
    /** frozen grant spec: { grants: [{resourceType, resourceId}], durationDays, fixedExpiresAt } */
    entitlementSpec: text("entitlement_spec", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    maxUses: integer("max_uses", { mode: "number" }).notNull().default(1),
    useCount: integer("use_count", { mode: "number" }).notNull().default(0),
    status: text("status", { enum: ["active", "disabled", "revoked", "exhausted"] }).notNull().default("active"),
    /** redeem-by deadline (null = no code-level expiry) */
    expiresAt: integer("expires_at", { mode: "number" }),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("activation_codes_hash_uidx").on(t.codeHash),
    index("activation_codes_batch_idx").on(t.batchId),
    index("activation_codes_status_idx").on(t.status),
  ]
);

export const activationCodeRedemptions = sqliteTable(
  "activation_code_redemptions",
  {
    id: text("id").primaryKey(),
    codeId: text("code_id")
      .notNull()
      .references(() => activationCodes.id),
    studentId: text("student_id").notNull(),
    /** app-ref to entitlements (primary grant row — ADR-017) */
    entitlementId: text("entitlement_id"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    ipHash: text("ip_hash"),
  },
  (t) => [
    // single-use per student is a DB invariant, not an app convention
    uniqueIndex("activation_redemptions_code_student_uidx").on(t.codeId, t.studentId),
    index("activation_redemptions_student_idx").on(t.studentId),
  ]
);
