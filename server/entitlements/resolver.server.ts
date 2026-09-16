/**
 * The single resource-access decision point (ADR-009, ARCHITECTURE §7).
 * Pure function — exhaustively unit-tested (TEST-PLAN §3). UI renders the verdict;
 * it never computes access. Content domains (Phase 2+) call this with real rows.
 */

export type AccessLevel = "public" | "authenticated" | "entitled";

export type ContentResourceType =
  | "program"
  | "grade"
  | "subject"
  | "course"
  | "unit"
  | "lesson"
  | "item";

export type EntitlementResourceType = "subject" | "course" | "lesson" | "product" | "plan";

/**
 * Academic scope carried by an entitlement (owner content model:
 * Year → Grade → Subject → Term). Everything here is an **id** — the coverage
 * rules below compare ids literally and never match on titles, slugs or any
 * other string, so renaming a term can never widen or narrow access.
 *
 * - `term`      — one term of one subject in one academic year.
 * - `full_year` — every term the admin scoped for that subject in that year,
 *                 including term containers published AFTER the grant (the rule
 *                 is evaluated against the node's own year/subject ids).
 */
export interface EntitlementScope {
  kind: "term" | "full_year";
  academicYearId: string;
  subjectId: string;
  /** optional narrowing; a subject belongs to exactly one grade in this schema */
  gradeId?: string | null;
  /** required for `kind: "term"`, ignored for `full_year` */
  termId?: string | null;
}

export interface ContentRef {
  type: ContentResourceType;
  id: string;
}

export interface EntitlementLike {
  resourceType: EntitlementResourceType;
  resourceId: string | null;
  status: "active" | "expired" | "revoked";
  expiresAt: number | null; // null = permanent
  /** academic scope, when the grant was issued with one */
  scope?: EntitlementScope | null;
}

/** Academic scope of the node being opened (ids only). */
export interface ChainScope {
  academicYearId?: string | null;
  gradeId?: string | null;
  termId?: string | null;
}

export interface ResourceAccessState {
  accessLevel: AccessLevel;
  /** draft | published | archived (only published is visible) */
  status: string;
  publishAt?: number | null;
  expiresAt?: number | null;
  /** lessons may be flagged free-preview for logged-in users */
  freePreview?: boolean;
}

export interface SubjectCtx {
  userId: string | null;
  roleRank: number; // 0 anon, 1 student, 2 teacher, 3 admin, 4 super_admin
}

export type AllowReason =
  | "admin"
  | "public"
  | "authenticated"
  | "free_preview"
  | "entitlement";

export type DenyReason =
  | "not_published"
  | "scheduled"
  | "content_expired"
  | "anon"
  | "no_entitlement"
  | "entitlement_inactive"
  | "entitlement_expired";

export type AccessVerdict = { allowed: true; reason: AllowReason } | { allowed: false; reason: DenyReason };

export function resolveAccess(input: {
  subject: SubjectCtx;
  resource: ResourceAccessState;
  /** the target content node + its ancestor chain, e.g. [lesson, unit, course, subject] */
  chain: ContentRef[];
  entitlements: EntitlementLike[];
  /** academic scope of the node (year/grade/term ids) — enables the explicit full-year rule */
  chainScope?: ChainScope | null;
  now?: number;
}): AccessVerdict {
  const now = input.now ?? Date.now();
  const { subject, resource, chain, entitlements } = input;

  // Admins bypass content gating (but not content lifecycle — draft stays hidden).
  if (resource.status !== "published") return { allowed: false, reason: "not_published" };
  if (resource.publishAt !== undefined && resource.publishAt !== null && resource.publishAt > now) {
    return { allowed: false, reason: "scheduled" };
  }
  if (resource.expiresAt !== undefined && resource.expiresAt !== null && resource.expiresAt <= now) {
    return { allowed: false, reason: "content_expired" };
  }
  if (subject.roleRank >= 3) return { allowed: true, reason: "admin" };

  switch (resource.accessLevel) {
    case "public":
      return { allowed: true, reason: "public" };
    case "authenticated":
      return subject.userId ? { allowed: true, reason: "authenticated" } : { allowed: false, reason: "anon" };
    case "entitled": {
      if (!subject.userId) return { allowed: false, reason: "anon" };
      if (resource.freePreview) return { allowed: true, reason: "free_preview" };
      const match = entitlements.find((e) => entitlementCovers(e, chain, now, input.chainScope ?? null));
      if (!match) return { allowed: false, reason: "no_entitlement" };
      return { allowed: true, reason: "entitlement" };
    }
  }
}

/** An entitlement covers a node when it targets the node itself, an ancestor, a plan/product, or its academic scope. */
export function entitlementCovers(
  entitlement: EntitlementLike,
  chain: ContentRef[],
  now: number,
  chainScope?: ChainScope | null
): boolean {
  if (entitlement.status !== "active") return false;
  if (entitlement.expiresAt !== null && entitlement.expiresAt <= now) return false;

  if (entitlement.resourceType === "plan" || entitlement.resourceType === "product") {
    // plan/product coverage is resolved to concrete resources by the caller
    // (Phase 2 content service expands product_items). Here: no direct coverage.
    return false;
  }
  if (scopeCovers(entitlement.scope ?? null, chain, chainScope ?? null)) return true;
  return chain.some(
    (ref) => ref.type === entitlement.resourceType && ref.id === entitlement.resourceId
  );
}

/**
 * EXPLICIT academic-scope coverage (PART 18/19). Id comparison only:
 *
 *  - `term`      → opens a node ONLY inside the same year + subject + term.
 *                  Philosophy Term 1 never opens Philosophy Term 2, and never
 *                  opens Psychology — different ids, no match.
 *  - `full_year` → opens any node of the same year + subject, whichever term it
 *                  sits in (so a full-year code keeps working for terms the admin
 *                  publishes later). It is NOT "isSubscribed = true": the subject
 *                  and the year must both match.
 */
export function scopeCovers(
  scope: EntitlementScope | null,
  chain: ContentRef[],
  chainScope: ChainScope | null
): boolean {
  if (!scope || !chainScope) return false;
  const subjectRef = chain.find((r) => r.type === "subject");
  if (!subjectRef) return false;
  if (scope.subjectId !== subjectRef.id) return false;
  if (!scope.academicYearId || chainScope.academicYearId !== scope.academicYearId) return false;
  if (scope.gradeId && chainScope.gradeId && scope.gradeId !== chainScope.gradeId) return false;
  if (scope.kind === "term") {
    return Boolean(scope.termId) && chainScope.termId === scope.termId;
  }
  return scope.kind === "full_year";
}
