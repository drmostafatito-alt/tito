import { and, desc, eq, like, or } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { auditLogs, users } from "../db/schema";

/**
 * Audit-log VIEWER (P7 §13): read-only queries over the existing append-only
 * audit_logs table. There is deliberately NO update/delete path anywhere —
 * the UI cannot modify or remove entries, and this module only SELECTs.
 */

export const AUDIT_PAGE_SIZE = 30;

export interface AuditLogRow {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: number;
}

export async function listAuditLogs(db: DB, filter: { q?: string; entityType?: string | null; page?: number } = {}) {
  const conds = [];
  const q = (filter.q ?? "").trim();
  if (q) {
    const pattern = `%${q}%`;
    conds.push(or(like(auditLogs.action, pattern), like(auditLogs.entityId, pattern))!);
  }
  if (filter.entityType) conds.push(eq(auditLogs.entityType, filter.entityType));
  const where = conds.length ? and(...conds) : undefined;
  const page = Math.max(1, filter.page ?? 1);

  const [total, rows] = await Promise.all([
    db.$count(auditLogs, where),
    db
      .select({
        id: auditLogs.id,
        actorUserId: auditLogs.actorUserId,
        actorEmail: users.email,
        actorRole: auditLogs.actorRole,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        before: auditLogs.before,
        after: auditLogs.after,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE),
  ]);
  return { total, page, pageSize: AUDIT_PAGE_SIZE, rows: rows as AuditLogRow[] };
}

/** Distinct entity types currently present — powers the viewer's filter dropdown (one indexed-ish scan, cached per request). */
export async function auditEntityTypes(db: DB): Promise<string[]> {
  const rows = await db.selectDistinct({ entityType: auditLogs.entityType }).from(auditLogs).limit(50);
  return rows.map((r) => r.entityType).sort();
}
