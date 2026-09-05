import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.server";
import { announcementReads, announcements } from "../db/schema";
import { logAudit } from "../audit/log.server";

/**
 * Announcements = the in-app notification system for v1 (ADR-025).
 *
 * FEATURE-SPEC §9: admins broadcast to audiences (all/students/teachers) with
 * publish + expiry windows; students get unread counts and mark-read. There is
 * NO fan-out table: visibility is computed lazily from (status, windows,
 * audience) and read state lives in announcement_reads (idempotent inserts).
 * Drafts/archived/expired/future-scheduled announcements NEVER reach users.
 * Email/WhatsApp channels remain verification-gated (no provider code).
 */

export const AUDIENCES = ["all", "students", "teachers"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];
export const ANNOUNCEMENTS_PAGE_SIZE = 20;

export const announcementInputSchema = z
  .object({
    titleAr: z.string().trim().min(1).max(200),
    titleEn: z.string().trim().min(1).max(200),
    bodyAr: z.string().trim().max(5000).default(""),
    bodyEn: z.string().trim().max(5000).default(""),
    audience: z.enum(AUDIENCES).default("all"),
    /** epoch ms or null; null = immediate on publish / never expires */
    publishAt: z.number().int().positive().nullable().default(null),
    expiresAt: z.number().int().positive().nullable().default(null),
  })
  .refine((v) => v.publishAt == null || v.expiresAt == null || v.expiresAt > v.publishAt, {
    message: "expires_before_publish",
    path: ["expiresAt"],
  });
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export type AnnActionResult = { ok: true; id?: string; changed?: number } | { ok: false; error: string };
type Actor = { userId: string; role: string };

export async function createAnnouncement(db: DB, input: AnnouncementInput, actor: Actor): Promise<AnnActionResult> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.insert(announcements).values({
    id,
    titleAr: input.titleAr,
    titleEn: input.titleEn,
    bodyAr: input.bodyAr,
    bodyEn: input.bodyEn,
    audience: input.audience,
    status: "draft",
    publishAt: input.publishAt,
    expiresAt: input.expiresAt,
    publishedAt: null,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "announcements.create",
    entityType: "announcement",
    entityId: id,
    after: { titleEn: input.titleEn, audience: input.audience },
  });
  return { ok: true, id };
}

async function loadRow(db: DB, id: string) {
  const rows = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Content/window edits — allowed while draft or published (audited with before/after). Archived is frozen. */
export async function updateAnnouncement(
  db: DB,
  id: string,
  patch: Partial<AnnouncementInput>,
  actor: Actor
): Promise<AnnActionResult> {
  const row = await loadRow(db, id);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "archived") return { ok: false, error: "archived" };
  const before = { titleAr: row.titleAr, titleEn: row.titleEn, bodyAr: row.bodyAr, bodyEn: row.bodyEn, audience: row.audience, publishAt: row.publishAt, expiresAt: row.expiresAt };
  const next = { ...before, ...patch };
  const parsed = announcementInputSchema.safeParse(next);
  if (!parsed.success) return { ok: false, error: "validation" };
  await db
    .update(announcements)
    .set({ ...parsed.data, updatedAt: Date.now() })
    .where(eq(announcements.id, id));
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "announcements.update",
    entityType: "announcement",
    entityId: id,
    before,
    after: parsed.data,
  });
  return { ok: true, changed: 1 };
}

export async function publishAnnouncement(db: DB, id: string, actor: Actor, nowMs: number = Date.now()): Promise<AnnActionResult> {
  const row = await loadRow(db, id);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "archived") return { ok: false, error: "archived" };
  if (row.status === "published") return { ok: true, changed: 0 }; // idempotent
  if (row.expiresAt != null && row.expiresAt <= nowMs) return { ok: false, error: "expires_past" };
  await db.update(announcements).set({ status: "published", publishedAt: nowMs, updatedAt: nowMs }).where(eq(announcements.id, id));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "announcements.publish", entityType: "announcement", entityId: id, after: { publishedAt: nowMs } });
  return { ok: true, changed: 1 };
}

/** Unpublish = back to draft (non-destructive; publishedAt kept as history). */
export async function unpublishAnnouncement(db: DB, id: string, actor: Actor): Promise<AnnActionResult> {
  const row = await loadRow(db, id);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "published") return { ok: true, changed: 0 };
  await db.update(announcements).set({ status: "draft", updatedAt: Date.now() }).where(eq(announcements.id, id));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "announcements.unpublish", entityType: "announcement", entityId: id, before: { status: "published" }, after: { status: "draft" } });
  return { ok: true, changed: 1 };
}

export async function archiveAnnouncement(db: DB, id: string, actor: Actor): Promise<AnnActionResult> {
  const row = await loadRow(db, id);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "archived") return { ok: true, changed: 0 };
  await db.update(announcements).set({ status: "archived", updatedAt: Date.now() }).where(eq(announcements.id, id));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "announcements.archive", entityType: "announcement", entityId: id, before: { status: row.status }, after: { status: "archived" } });
  return { ok: true, changed: 1 };
}

export async function listAnnouncementsAdmin(db: DB, filter: { status?: AnnouncementStatus | null; page?: number } = {}) {
  const where = filter.status && ANNOUNCEMENT_STATUSES.includes(filter.status) ? eq(announcements.status, filter.status) : undefined;
  const page = Math.max(1, filter.page ?? 1);
  const [total, rows] = await Promise.all([
    db.$count(announcements, where),
    db
      .select()
      .from(announcements)
      .where(where)
      .orderBy(desc(announcements.updatedAt))
      .limit(ANNOUNCEMENTS_PAGE_SIZE)
      .offset((page - 1) * ANNOUNCEMENTS_PAGE_SIZE),
  ]);
  return { total, page, pageSize: ANNOUNCEMENTS_PAGE_SIZE, rows };
}

// ---------------------------------------------------------------------------
// Student side

/** Audience match is role-based per the spec sketch; admins only ever match "all". */
function audienceCond(roleId: string) {
  if (roleId === "student") return sql`${announcements.audience} IN ('all', 'students')`;
  if (roleId === "teacher") return sql`${announcements.audience} IN ('all', 'teachers')`;
  return eq(announcements.audience, "all");
}

function visibleWhere(roleId: string, nowMs: number) {
  return and(
    eq(announcements.status, "published"),
    sql`(${announcements.publishAt} IS NULL OR ${announcements.publishAt} <= ${nowMs})`,
    sql`(${announcements.expiresAt} IS NULL OR ${announcements.expiresAt} > ${nowMs})`,
    audienceCond(roleId)
  );
}

export interface VisibleAnnouncement {
  id: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  audience: Audience;
  publishAt: number | null;
  expiresAt: number | null;
  publishedAt: number | null;
  createdAt: number;
  readAt: number | null;
}

/** Published + in-window + audience-matched announcements for ONE user, with read state. */
export async function visibleAnnouncements(
  db: DB,
  user: { id: string; roleId: string },
  nowMs: number = Date.now(),
  limit = 50
): Promise<VisibleAnnouncement[]> {
  const rows = await db
    .select({ a: announcements, readAt: announcementReads.readAt })
    .from(announcements)
    .leftJoin(announcementReads, and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, user.id)))
    .where(visibleWhere(user.roleId, nowMs))
    .orderBy(desc(sql`COALESCE(${announcements.publishAt}, ${announcements.publishedAt}, ${announcements.createdAt})`))
    .limit(limit);
  return rows.map((r) => ({
    id: r.a.id,
    titleAr: r.a.titleAr,
    titleEn: r.a.titleEn,
    bodyAr: r.a.bodyAr,
    bodyEn: r.a.bodyEn,
    audience: r.a.audience,
    publishAt: r.a.publishAt,
    expiresAt: r.a.expiresAt,
    publishedAt: r.a.publishedAt,
    createdAt: r.a.createdAt,
    readAt: r.readAt ?? null,
  }));
}

export async function unreadAnnouncementsCount(db: DB, user: { id: string; roleId: string }, nowMs: number = Date.now()): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(announcements)
    .leftJoin(announcementReads, and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, user.id)))
    .where(and(visibleWhere(user.roleId, nowMs), isNull(announcementReads.readAt)));
  return Number(rows[0]?.n ?? 0);
}

/** Mark one announcement read — only if it is actually visible to this user (no blind writes). Idempotent. */
export async function markAnnouncementRead(db: DB, announcementId: string, user: { id: string; roleId: string }, nowMs: number = Date.now()): Promise<boolean> {
  const rows = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(and(eq(announcements.id, announcementId), visibleWhere(user.roleId, nowMs)))
    .limit(1);
  if (!rows.length) return false;
  await db
    .insert(announcementReads)
    .values({ id: crypto.randomUUID(), announcementId, userId: user.id, readAt: nowMs })
    .onConflictDoNothing({ target: [announcementReads.announcementId, announcementReads.userId] });
  return true;
}

export async function markAllAnnouncementsRead(db: DB, user: { id: string; roleId: string }, nowMs: number = Date.now()): Promise<number> {
  const rows = await db
    .select({ id: announcements.id })
    .from(announcements)
    .leftJoin(announcementReads, and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, user.id)))
    .where(and(visibleWhere(user.roleId, nowMs), isNull(announcementReads.readAt)))
    .limit(100);
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  await db
    .insert(announcementReads)
    .values(ids.map((id) => ({ id: crypto.randomUUID(), announcementId: id, userId: user.id, readAt: nowMs })))
    .onConflictDoNothing({ target: [announcementReads.announcementId, announcementReads.userId] });
  return ids.length;
}

/** Admin-side preview guard used by tests/routes: is a row visible to a role right now? */
export function isVisibleToRole(status: string, audience: string, roleId: string, publishAt: number | null, expiresAt: number | null, nowMs: number): boolean {
  if (status !== "published") return false;
  if (publishAt != null && publishAt > nowMs) return false;
  if (expiresAt != null && expiresAt <= nowMs) return false;
  if (audience === "all") return true;
  if (audience === "students") return roleId === "student";
  if (audience === "teachers") return roleId === "teacher";
  return false;
}
