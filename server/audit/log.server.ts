import type { DB } from "../db/client.server";
import { auditLogs } from "../db/schema";

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipHash?: string | null;
}

/** Append-only privileged-action trail (SECURITY.md §12). */
export async function logAudit(db: DB, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ipHash: entry.ipHash ?? null,
    createdAt: Date.now(),
  });
}
