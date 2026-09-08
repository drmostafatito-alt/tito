import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { rolePermissions } from "../db/schema";
import { logAudit } from "../audit/log.server";
import { canPlatform } from "../auth/permissions.server";
import { ASSESSMENT_PERMISSIONS, type AssessmentPermission } from "../assessment/service.server";

/**
 * Teacher-role administration (FEATURE-SPEC §1 roles / §12 Teachers · §5
 * question-bank "teachers author, admins publish").
 *
 * A teacher (rank 2) is only allowed to author inside the question bank /
 * exams when the platform operator grants the *teacher role* the relevant
 * assessment.* permission through the `role_permissions` table. That grant is
 * deliberately role-scoped (not per-user) and restricted here to a hard-coded
 * authoring allowlist so a grant can NEVER escalate a teacher into
 * billing/payment, user-administration, security or system permissions.
 */

/** The only permissions that may ever be granted to the teacher role. */
export const TEACHER_PERMISSIONS: readonly AssessmentPermission[] = [...ASSESSMENT_PERMISSIONS];

/** Human-facing metadata for the permission matrix (used by the admin UI). */
export interface TeacherPermissionDescriptor {
  permission: AssessmentPermission;
  labelEn: string;
  labelAr: string;
  /** Authoring actions granted by default when enabling "teacher authoring". */
  authoring: boolean;
}

export const TEACHER_PERMISSION_DESCRIPTORS: readonly TeacherPermissionDescriptor[] = [
  { permission: "assessment.read", labelEn: "View question bank & exams", labelAr: "عرض بنك الأسئلة والاختبارات", authoring: true },
  { permission: "assessment.create", labelEn: "Create questions & exams", labelAr: "إنشاء أسئلة واختبارات", authoring: true },
  { permission: "assessment.edit", labelEn: "Edit questions & exams", labelAr: "تعديل الأسئلة والاختبارات", authoring: true },
  { permission: "assessment.publish", labelEn: "Publish questions & exams", labelAr: "نشر الأسئلة والاختبارات", authoring: false },
  { permission: "assessment.delete", labelEn: "Delete questions & exams", labelAr: "حذف الأسئلة والاختبارات", authoring: false },
  { permission: "assessment.grade", labelEn: "Grade attempts & essays", labelAr: "تصحيح المحاولات والمقالات", authoring: false },
];

export class TeacherAdminError extends Error {
  constructor(
    public readonly code: "denied" | "bad_permission",
    message: string
  ) {
    super(message);
    this.name = "TeacherAdminError";
  }
}

type RankSubject = { rank: number; roleId: string };

/** Can this actor read the Teachers section? rank>=3 admin with users.read. */
export async function canViewTeachers(
  db: DB,
  subject: RankSubject | null
): Promise<boolean> {
  if (!subject) return false;
  if (subject.rank >= 4) return true;
  if (subject.rank < 3) return false;
  return canPlatform(db, { user: subject }, "users.read");
}

/** Can this actor edit the teacher permission matrix? super_admin, or admin with users.manage. */
export async function canManageTeachers(
  db: DB,
  subject: RankSubject | null
): Promise<boolean> {
  if (!subject) return false;
  if (subject.rank >= 4) return true;
  if (subject.rank < 3) return false;
  return canPlatform(db, { user: subject }, "users.manage");
}

/** Whether the given permission string is grantable to the teacher role. */
export function isTeacherGrantable(permission: string): permission is AssessmentPermission {
  return (TEACHER_PERMISSIONS as readonly string[]).includes(permission);
}

export interface MatrixRow extends TeacherPermissionDescriptor {
  granted: boolean;
}

/** Current teacher-role matrix: every authorable permission + granted flag. */
export async function teacherPermissionMatrix(db: DB): Promise<MatrixRow[]> {
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, "teacher"));
  const granted = new Set(rows.map((r) => r.permission));
  return TEACHER_PERMISSION_DESCRIPTORS.map((d) => ({ ...d, granted: granted.has(d.permission) }));
}

export type SetTeacherPermissionResult =
  | { ok: true; permission: AssessmentPermission; granted: boolean }
  | { ok: false; code: "denied" | "bad_permission" };

export interface TeacherActor {
  userId: string;
  role: string;
  rank: number;
  roleId: string;
  ipHash?: string | null;
}

/**
 * Grant or revoke an authoring permission on the teacher role. Restricted to
 * `TEACHER_PERMISSIONS` (never billing/payment/user-admin/security/system) and
 * only callable by a super_admin or an admin holding `users.manage`.
 */
export async function setTeacherPermission(
  db: DB,
  actor: TeacherActor,
  permission: string,
  granted: boolean,
  now: number = Date.now()
): Promise<SetTeacherPermissionResult> {
  if (!(await canManageTeachers(db, actor))) return { ok: false, code: "denied" };
  if (!isTeacherGrantable(permission)) return { ok: false, code: "bad_permission" };

  if (granted) {
    await db
      .insert(rolePermissions)
      .values({ roleId: "teacher", permission, grantedAt: now })
      .onConflictDoNothing();
  } else {
    await db
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, "teacher"), eq(rolePermissions.permission, permission)));
  }
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: granted ? "rbac.teacher.grant" : "rbac.teacher.revoke",
    entityType: "role",
    entityId: "teacher",
    after: { permission, granted },
    ipHash: actor.ipHash ?? null,
  });
  return { ok: true, permission, granted };
}
