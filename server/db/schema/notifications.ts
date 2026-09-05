import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Announcements domain (Phase 7 — FEATURE-SPEC §9, DATABASE-SCHEMA "Platform" sketch).
 *
 * Design (ADR-025): announcements are the ONLY in-app notification producer in
 * v1 — the spec defines broadcasts with audience + publish/expiry windows and
 * an unread/mark-read inbox, and nothing else. Instead of fanning out a
 * generic `notifications` row per user at publish time (write amplification,
 * backfill problems for later registrations), visibility is computed lazily
 * from (status, windows, audience) and READ state is tracked per user in
 * `announcement_reads` (INSERT OR IGNORE — idempotent). Email/WhatsApp
 * channels stay verification-gated (PAYMENTS-style ADR discipline) — no
 * provider code exists.
 *
 * Bodies are PLAIN TEXT (rendered with whitespace preserved) — no rich text,
 * no HTML, nothing to sanitize; titles/bodies are length-capped by zod.
 */

export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    bodyAr: text("body_ar").notNull().default(""),
    bodyEn: text("body_en").notNull().default(""),
    /** Broadcast audience (FEATURE-SPEC §9 sketch). */
    audience: text("audience", { enum: ["all", "students", "teachers"] }).notNull().default("all"),
    /** draft → published → archived; unpublish returns to draft (non-destructive). */
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    /** Optional schedule: visible from max(publishedAt, publishAt); null = immediate on publish. */
    publishAt: integer("publish_at", { mode: "number" }),
    /** Optional visibility end; null = no expiry. */
    expiresAt: integer("expires_at", { mode: "number" }),
    /** When the admin pressed publish (null while never published). */
    publishedAt: integer("published_at", { mode: "number" }),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("announcements_status_publish_idx").on(t.status, t.publishAt)]
);

export const announcementReads = sqliteTable(
  "announcement_reads",
  {
    id: text("id").primaryKey(),
    announcementId: text("announcement_id")
      .notNull()
      .references(() => announcements.id),
    /** app-ref to users (ADR-017 cross-domain policy) */
    userId: text("user_id").notNull(),
    readAt: integer("read_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("announcement_reads_uidx").on(t.announcementId, t.userId),
    index("announcement_reads_user_idx").on(t.userId),
  ]
);
