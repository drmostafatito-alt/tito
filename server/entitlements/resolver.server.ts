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

export interface ContentRef {
  type: ContentResourceType;
  id: string;
}

export interface EntitlementLike {
  resourceType: EntitlementResourceType;
  resourceId: string | null;
  status: "active" | "expired" | "revoked";
  expiresAt: number | null; // null = permanent
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
      const match = entitlements.find((e) => entitlementCovers(e, chain, now));
      if (!match) return { allowed: false, reason: "no_entitlement" };
      return { allowed: true, reason: "entitlement" };
    }
  }
}

/** An entitlement covers a node when it targets the node itself, an ancestor, or a plan/product. */
export function entitlementCovers(
  entitlement: EntitlementLike,
  chain: ContentRef[],
  now: number
): boolean {
  if (entitlement.status !== "active") return false;
  if (entitlement.expiresAt !== null && entitlement.expiresAt <= now) return false;

  if (entitlement.resourceType === "plan" || entitlement.resourceType === "product") {
    // plan/product coverage is resolved to concrete resources by the caller
    // (Phase 2 content service expands product_items). Here: no direct coverage.
    return false;
  }
  return chain.some(
    (ref) => ref.type === entitlement.resourceType && ref.id === entitlement.resourceId
  );
}
