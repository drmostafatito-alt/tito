import { and, eq, or, inArray } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { entitlements } from "../db/schema";
import type { AccessVerdict, ContentRef, EntitlementLike } from "./resolver.server";
import { resolveAccess } from "./resolver.server";
import type { ChainRow } from "../content/service.server";

/**
 * DB-backed access resolution — the ONE entry point routes use (ARCHITECTURE §7).
 * Loads the student's entitlement rows, builds the ancestry chain, delegates to
 * the pure resolver. UI renders the verdict; it never computes access.
 */

export interface SubjectInfo {
  userId: string | null;
  roleRank: number; // 0 anon, 1 student, 2 teacher, 3 admin, 4 super_admin
}

/**
 * Loads the student's entitlement rows covering any of `resourceIds` (or a plan).
 * Exported (W9) so batch callers can fetch entitlements ONCE for many chains
 * instead of once per chain — the pure resolver still decides every verdict.
 */
export async function entitlementsFor(db: DB, studentId: string, resourceIds: string[]): Promise<EntitlementLike[]> {
  const conditions = [
    eq(entitlements.studentId, studentId),
    inArray(entitlements.status, ["active", "expired", "revoked"]),
  ];
  const rows = await db
    .select()
    .from(entitlements)
    .where(and(...conditions, or(inArray(entitlements.resourceId, resourceIds), eq(entitlements.resourceType, "plan"))));
  return rows.map((r) => ({
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    status: r.status,
    expiresAt: r.expiresAt,
  }));
}

export function chainRefsOf(chain: ChainRow): ContentRef[] {
  const refs: ContentRef[] = [];
  if (chain.lessonId) refs.push({ type: "lesson", id: chain.lessonId });
  if (chain.unitId) refs.push({ type: "unit", id: chain.unitId });
  if (chain.courseId) refs.push({ type: "course", id: chain.courseId });
  if (chain.subjectId) refs.push({ type: "subject", id: chain.subjectId });
  return refs;
}

/** Lesson/course/subject access verdict for a viewer. */
export async function resolveContentAccess(
  db: DB,
  subject: SubjectInfo,
  chain: ChainRow
): Promise<AccessVerdict> {
  const refs = chainRefsOf(chain);
  const grants = subject.userId
    ? await entitlementsFor(db, subject.userId, refs.map((r) => r.id))
    : [];
  return resolveAccess({
    subject,
    resource: {
      accessLevel: chain.accessLevel,
      status: chain.status,
      publishAt: chain.publishAt,
      expiresAt: chain.expiresAt,
      freePreview: chain.freePreview,
    },
    chain: refs,
    entitlements: grants,
  });
}
