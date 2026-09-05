import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Unified entitlement grants (ADR-009). One row = one grant covering a resource
 * (subject/course/lesson), a bundle `product`, or a `plan` (subscription product,
 * resource_id NULL). Sources grow over phases: admin_grant now; purchase/subscription/
 * activation_code in Phase 5. All access decisions flow through the resolver — never UI.
 */
export const entitlements = sqliteTable(
  "entitlements",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull(),
    sourceType: text("source_type", {
      enum: ["order_item", "subscription", "activation_code", "admin_grant", "trial", "import"],
    }).notNull(),
    sourceId: text("source_id"),
    resourceType: text("resource_type", {
      enum: ["subject", "course", "lesson", "product", "plan"],
    }).notNull(),
    resourceId: text("resource_id"),
    status: text("status", { enum: ["active", "expired", "revoked"] }).notNull().default("active"),
    startsAt: integer("starts_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }), // NULL = permanent
    grantedAt: integer("granted_at", { mode: "number" }).notNull(),
    grantedBy: text("granted_by"),
    revokedAt: integer("revoked_at", { mode: "number" }),
    revokeReason: text("revoke_reason"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [
    index("entitlements_lookup_idx").on(
      t.studentId,
      t.resourceType,
      t.resourceId,
      t.status
    ),
    index("entitlements_expiry_idx").on(t.expiresAt),
  ]
);
