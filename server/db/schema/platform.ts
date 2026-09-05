import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Typed settings groups. Values are JSON documents validated by Zod on read AND write
 * (server/settings/schema.ts). Keys are group names, e.g. `platform`, `devices`.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

/** Immutable trail of privileged mutations (before/after diffs). */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(), // dot.separated, e.g. 'settings.updated'
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: text("before", { mode: "json" }),
    after: text("after", { mode: "json" }),
    ipHash: text("ip_hash"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_actor_idx").on(t.actorUserId, t.createdAt),
    index("audit_created_idx").on(t.createdAt),
  ]
);
