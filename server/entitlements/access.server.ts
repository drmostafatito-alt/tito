import { and, eq, or, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { entitlements } from "../db/schema";
import type { AccessVerdict, ChainScope, ContentRef, EntitlementLike, EntitlementScope } from "./resolver.server";
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
 * Reads the academic scope stored on an entitlement. Fail-closed: a malformed or
 * partial scope is treated as NO scope, so a corrupt metadata blob can never
 * widen access — it can only fall back to plain resource-id matching.
 */
export function scopeFromMetadata(metadata: unknown): EntitlementScope | null {
  const raw = (metadata ?? null) as { scope?: unknown } | null;
  const scope = raw?.scope as Partial<EntitlementScope> | undefined;
  if (!scope || typeof scope !== "object") return null;
  if (scope.kind !== "term" && scope.kind !== "full_year") return null;
  if (typeof scope.academicYearId !== "string" || !scope.academicYearId) return null;
  if (typeof scope.subjectId !== "string" || !scope.subjectId) return null;
  if (scope.kind === "term" && (typeof scope.termId !== "string" || !scope.termId)) return null;
  return {
    kind: scope.kind,
    academicYearId: scope.academicYearId,
    subjectId: scope.subjectId,
    gradeId: typeof scope.gradeId === "string" && scope.gradeId ? scope.gradeId : null,
    termId: typeof scope.termId === "string" && scope.termId ? scope.termId : null,
  };
}

/**
 * Loads the student's entitlement rows covering any of `resourceIds` (or a plan).
 * Exported (W9) so batch callers can fetch entitlements ONCE for many chains
 * instead of once per chain — the pure resolver still decides every verdict.
 *
 * `scopeSubjectId` additionally pulls rows carrying an academic scope for that
 * subject: a FULL-YEAR grant is stored against the term containers that existed
 * when it was issued, so a term published later would otherwise never be loaded
 * (and the explicit full-year rule could never fire).
 */
export async function entitlementsFor(
  db: DB,
  studentId: string,
  resourceIds: string[],
  opts: { scopeSubjectId?: string | null } = {}
): Promise<EntitlementLike[]> {
  const conditions = [
    eq(entitlements.studentId, studentId),
    inArray(entitlements.status, ["active", "expired", "revoked"]),
  ];
  const matchers = [
    resourceIds.length > 0 ? inArray(entitlements.resourceId, resourceIds) : null,
    eq(entitlements.resourceType, "plan"),
    opts.scopeSubjectId
      ? sql`json_extract(${entitlements.metadata}, '$.scope.subjectId') = ${opts.scopeSubjectId}`
      : null,
  ].filter((m) => m !== null);
  if (matchers.length === 0) return [];
  const rows = await db
    .select()
    .from(entitlements)
    .where(and(...conditions, or(...matchers)));
  return rows.map((r) => ({
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    status: r.status,
    expiresAt: r.expiresAt,
    scope: scopeFromMetadata(r.metadata),
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

/** Academic scope of a chain (ids only — the resolver never compares strings). */
export function chainScopeOf(chain: ChainRow): ChainScope {
  return {
    academicYearId: chain.academicYearId ?? null,
    gradeId: chain.gradeId ?? null,
    termId: chain.termId ?? null,
  };
}

/** Lesson/course/subject access verdict for a viewer. */
export async function resolveContentAccess(
  db: DB,
  subject: SubjectInfo,
  chain: ChainRow
): Promise<AccessVerdict> {
  const refs = chainRefsOf(chain);
  const grants = subject.userId
    ? await entitlementsFor(db, subject.userId, refs.map((r) => r.id), { scopeSubjectId: chain.subjectId ?? null })
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
    chainScope: chainScopeOf(chain),
  });
}
