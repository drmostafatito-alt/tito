import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.server";
import { entitlements } from "../db/schema";
import { logAudit } from "../audit/log.server";

/**
 * Admin entitlement grants (ADR-009). Phase 5 adds purchase/subscription/
 * activation_code sources through the same table — never a parallel path.
 */

export const grantSchema = z.object({
  studentId: z.string().min(1),
  resourceType: z.enum(["subject", "course", "lesson"]),
  resourceId: z.string().min(1),
  /** days of validity; null = permanent */
  days: z.number().int().min(1).max(3650).nullable(),
  note: z.string().trim().max(500).optional(),
});

export async function grantEntitlement(
  db: DB,
  input: z.infer<typeof grantSchema>,
  actor: { userId: string; role: string }
) {
  const now = Date.now();
  const id = crypto.randomUUID();
  const row = {
    id,
    studentId: input.studentId,
    sourceType: "admin_grant" as const,
    sourceId: null,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    status: "active" as const,
    startsAt: now,
    expiresAt: input.days ? now + input.days * 86_400_000 : null,
    grantedAt: now,
    grantedBy: actor.userId,
    revokedAt: null,
    revokeReason: null,
    metadata: input.note ? { note: input.note } : null,
  };
  await db.insert(entitlements).values(row);
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "entitlement.granted", entityType: "entitlement", entityId: id, after: row,
  });
  return row;
}

export async function revokeEntitlement(
  db: DB,
  id: string,
  reason: string,
  actor: { userId: string; role: string }
): Promise<boolean> {
  const rows = await db.select().from(entitlements).where(eq(entitlements.id, id)).limit(1);
  const row = rows[0];
  if (!row) return false;
  await db
    .update(entitlements)
    .set({ status: "revoked", revokedAt: Date.now(), revokeReason: reason })
    .where(eq(entitlements.id, id));
  await logAudit(db, {
    actorUserId: actor.userId, actorRole: actor.role,
    action: "entitlement.revoked", entityType: "entitlement", entityId: id,
    before: { status: row.status }, after: { status: "revoked", reason },
  });
  return true;
}

export async function entitlementsForStudent(db: DB, studentId: string) {
  return db
    .select()
    .from(entitlements)
    .where(eq(entitlements.studentId, studentId))
    .orderBy(desc(entitlements.grantedAt));
}

export async function activeEntitlementsCount(db: DB) {
  const rows = await db
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(and(eq(entitlements.status, "active")));
  return rows.length;
}
