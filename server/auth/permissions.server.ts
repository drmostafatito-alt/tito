import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { rolePermissions } from "../db/schema";

/**
 * Phase 7 platform-administration permissions (FEATURE-SPEC §12).
 *
 * Same model as cms.*/

/** Permission ids seeded for the admin role by migration 0007 (super_admin rank-4 bypasses in code). */
export const PLATFORM_PERMISSIONS = [
  "users.read",
  "users.manage",
  "analytics.read",
  "security.read",
  "audit.read",
  "announcements.manage",
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/** rank>=4 bypass · rank<3 never · rank3 via role_permissions (the canCms/canCommerce pattern). */
export async function canPlatform(
  db: DB,
  auth: { user: { rank: number; roleId: string } } | null,
  permission: PlatformPermission
): Promise<boolean> {
  if (!auth) return false;
  if (auth.user.rank >= 4) return true;
  if (auth.user.rank < 3) return false;
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, auth.user.roleId), eq(rolePermissions.permission, permission)))
    .limit(1);
  return rows.length > 0;
}
