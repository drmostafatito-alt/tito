import { and, desc, eq, gte, isNull, like, or, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import {
  devices,
  examAttempts,
  exams,
  lessonProgress,
  lessons,
  orders,
  securityEvents,
  sessions,
  users,
  videoProgress,
} from "../db/schema";
import { entitlementsForStudent } from "../entitlements/grant.server";
import { revokeAllUserSessions, revokeSession, ROLE_RANKS } from "../auth/session.server";
import { logAudit } from "../audit/log.server";
import { logSecurityEvent } from "../security/events.server";

/**
 * Phase 7 admin user management (FEATURE-SPEC §12 "Students", owner brief P7 §6-7).
 *
 * READ side never selects password_hash / token hashes / key hashes (P7 §17).
 * WRITE side: every mutation is server-authorized (rank + permission checked in
 * the route), audited, and idempotent where it makes sense.
 *
 * Rank discipline (P7 §7 — "low-privilege admin can NEVER escalate"):
 * - an actor can never act on a user whose rank >= the actor's rank
 *   (covers self-suspension, admin-vs-admin, and super-vs-super),
 * - role changes require rank >= 4 (super_admin) — enforced HERE as well as
 *   in the route, so no route wiring mistake can widen it,
 * - assigning/demoting super_admin has a last-super-admin lockout guard.
 */

export const USER_ROLES = ["student", "teacher", "admin", "super_admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USERS_PAGE_SIZE = 20;

export type Actor = { userId: string; role: string; rank: number };

export interface ListUsersFilter {
  q?: string;
  role?: UserRole | null;
  status?: UserStatus | null;
  page?: number;
}

/** Server-side search + filter + pagination (P7 §14). Deleted users are out of scope. */
export async function listUsers(db: DB, filter: ListUsersFilter) {
  const conds = [isNull(users.deletedAt)];
  const q = (filter.q ?? "").trim();
  if (q) {
    const pattern = `%${q}%`;
    conds.push(or(like(users.email, pattern), like(users.fullName, pattern))!);
  }
  if (filter.role && USER_ROLES.includes(filter.role)) conds.push(eq(users.roleId, filter.role));
  if (filter.status && USER_STATUSES.includes(filter.status)) conds.push(eq(users.status, filter.status));
  const where = and(...conds);

  const page = Math.max(1, filter.page ?? 1);
  const [total, rows] = await Promise.all([
    db.$count(users, where),
    db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        roleId: users.roleId,
        status: users.status,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(USERS_PAGE_SIZE)
      .offset((page - 1) * USERS_PAGE_SIZE),
  ]);
  return { total, page, pageSize: USERS_PAGE_SIZE, rows };
}

export interface UserAdminDetail {
  user: {
    id: string;
    email: string;
    fullName: string;
    roleId: string;
    status: string;
    localePref: string | null;
    createdAt: number;
    lastLoginAt: number | null;
  };
  counts: { activeEntitlements: number; devicesActive: number; sessionsActive: number; lessonsCompleted: number; videosWatched: number; attempts: number; orders: number };
  entitlements: Array<{ id: string; resourceType: string; resourceId: string | null; sourceType: string; status: string; startsAt: number; expiresAt: number | null; grantedAt: number; grantedBy: string | null; revokedAt: number | null; revokeReason: string | null }>;
  recentProgress: Array<{ lessonId: string; titleAr: string | null; titleEn: string | null; status: string; completedAt: number | null; lastActivityAt: number }>;
  recentAttempts: Array<{ id: string; examId: string; examTitleAr: string | null; examTitleEn: string | null; status: string; score: number | null; maxScore: number | null; passed: boolean | null; startedAt: number; submittedAt: number | null }>;
  recentOrders: Array<{ id: string; orderNumber: string; status: string; totalMinor: number; currency: string; createdAt: number }>;
  devicesList: Array<{ id: string; label: string; platform: string; status: string; firstSeenAt: number; lastSeenAt: number; revokedAt: number | null }>;
  activeSessions: Array<{ id: string; deviceLabel: string; createdAt: number; lastSeenAt: number; expiresAt: number }>;
  recentSecurity: Array<{ id: string; type: string; createdAt: number }>;
}

/** Batched detail aggregate (P7 §6) — NEVER selects password/token/key hashes. */
export async function userAdminDetail(db: DB, userId: string, nowMs: number = Date.now()): Promise<UserAdminDetail | null> {
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      roleId: users.roleId,
      status: users.status,
      localePref: users.localePref,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const u = userRows[0];
  if (!u || u.deletedAt) return null;

  const [ents, progressRows, attemptRows, orderRows, deviceRows, sessionRows, secRows, counts] = await Promise.all([
    entitlementsForStudent(db, userId),
    db
      .select({ lessonId: lessonProgress.lessonId, titleAr: lessons.titleAr, titleEn: lessons.titleEn, status: lessonProgress.status, completedAt: lessonProgress.completedAt, lastActivityAt: lessonProgress.lastActivityAt })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .where(eq(lessonProgress.studentId, userId))
      .orderBy(desc(lessonProgress.lastActivityAt))
      .limit(5),
    db
      .select({ id: examAttempts.id, examId: examAttempts.examId, examTitleAr: exams.titleAr, examTitleEn: exams.titleEn, status: examAttempts.status, score: examAttempts.score, maxScore: examAttempts.maxScore, passed: examAttempts.passed, startedAt: examAttempts.startedAt, submittedAt: examAttempts.submittedAt })
      .from(examAttempts)
      .innerJoin(exams, eq(exams.id, examAttempts.examId))
      .where(eq(examAttempts.studentId, userId))
      .orderBy(desc(examAttempts.startedAt))
      .limit(5),
    db
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, totalMinor: orders.totalMinor, currency: orders.currency, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.studentId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(5),
    db
      .select({ id: devices.id, label: devices.label, platform: devices.platform, status: devices.status, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt, revokedAt: devices.revokedAt })
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(desc(devices.lastSeenAt))
      .limit(10),
    db
      .select({ id: sessions.id, deviceLabel: devices.label, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(devices, eq(devices.id, sessions.deviceId))
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gte(sessions.expiresAt, nowMs)))
      .orderBy(desc(sessions.lastSeenAt))
      .limit(10),
    db
      .select({ id: securityEvents.id, type: securityEvents.type, createdAt: securityEvents.createdAt })
      .from(securityEvents)
      .where(eq(securityEvents.userId, userId))
      .orderBy(desc(securityEvents.createdAt))
      .limit(8),
    Promise.all([
      db.$count(lessonProgress, and(eq(lessonProgress.studentId, userId), eq(lessonProgress.status, "completed"))),
      db.$count(videoProgress, eq(videoProgress.studentId, userId)),
      db.$count(examAttempts, eq(examAttempts.studentId, userId)),
      db.$count(orders, eq(orders.studentId, userId)),
    ]),
  ]);

  const now = nowMs;
  const activeEnts = ents.filter((e) => e.status === "active" && e.startsAt <= now && (e.expiresAt === null || e.expiresAt > now));

  return {
    user: { id: u.id, email: u.email, fullName: u.fullName, roleId: u.roleId, status: u.status, localePref: u.localePref, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt },
    counts: {
      activeEntitlements: activeEnts.length,
      devicesActive: deviceRows.filter((d) => d.status === "active").length,
      sessionsActive: sessionRows.length,
      lessonsCompleted: counts[0],
      videosWatched: counts[1],
      attempts: counts[2],
      orders: counts[3],
    },
    entitlements: ents.map((e) => ({
      id: e.id,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      sourceType: e.sourceType,
      status: e.status,
      startsAt: e.startsAt,
      expiresAt: e.expiresAt,
      grantedAt: e.grantedAt,
      grantedBy: e.grantedBy ?? null,
      revokedAt: e.revokedAt ?? null,
      revokeReason: e.revokeReason ?? null,
    })),
    recentProgress: progressRows,
    recentAttempts: attemptRows,
    recentOrders: orderRows,
    devicesList: deviceRows,
    activeSessions: sessionRows,
    recentSecurity: secRows,
  };
}

export type AdminActionResult = { ok: true; changed?: number; sessionsRevoked?: number } | { ok: false; error: string };

async function loadTarget(db: DB, targetId: string) {
  const rows = await db
    .select({ id: users.id, roleId: users.roleId, status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1);
  return rows[0] ?? null;
}

/** Rank discipline shared by all user-targeted admin mutations. */
function rankGuard(actor: Actor, targetRoleId: string): string | null {
  const targetRank = ROLE_RANKS[targetRoleId] ?? 1;
  if (targetRank >= actor.rank) return "forbidden_rank"; // never act on peers/superiors (incl. self)
  return null;
}

/** Deactivate/activate a user (P7 §7). Suspension immediately revokes all sessions. */
export async function setUserStatus(db: DB, targetId: string, status: UserStatus, actor: Actor, nowMs: number = Date.now()): Promise<AdminActionResult> {
  if (!USER_STATUSES.includes(status)) return { ok: false, error: "bad_request" };
  const target = await loadTarget(db, targetId);
  if (!target || target.deletedAt) return { ok: false, error: "not_found" };
  if (target.id === actor.userId) return { ok: false, error: "self" };
  const denied = rankGuard(actor, target.roleId);
  if (denied) return { ok: false, error: denied };
  if (target.status === status) return { ok: true, changed: 0 }; // idempotent no-op

  await db.update(users).set({ status }).where(eq(users.id, targetId));
  let sessionsRevoked = 0;
  if (status === "suspended") {
    sessionsRevoked = await revokeAllUserSessions(db, targetId, "account_suspended");
    await logSecurityEvent(db, { userId: targetId, type: "sessions_revoked_all", metadata: { reason: "account_suspended", by: actor.userId } });
  }
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "users.status",
    entityType: "user",
    entityId: targetId,
    before: { status: target.status },
    after: { status, sessionsRevoked },
  });
  return { ok: true, changed: 1, sessionsRevoked };
}

/** Role management — super_admin only, enforced in the service (P7 §7/§15). */
export async function setUserRole(db: DB, targetId: string, roleId: UserRole, actor: Actor): Promise<AdminActionResult> {
  if (actor.rank < 4) return { ok: false, error: "forbidden" }; // hard rule, not route-dependent
  if (!USER_ROLES.includes(roleId)) return { ok: false, error: "bad_request" };
  const target = await loadTarget(db, targetId);
  if (!target || target.deletedAt) return { ok: false, error: "not_found" };
  if (target.id === actor.userId) return { ok: false, error: "self" };
  if (target.roleId === roleId) return { ok: true, changed: 0 };

  // lockout guard: never demote the LAST active super_admin
  if (target.roleId === "super_admin" && roleId !== "super_admin") {
    const supers = await db.$count(users, and(eq(users.roleId, "super_admin"), eq(users.status, "active"), isNull(users.deletedAt)));
    if (supers <= 1) return { ok: false, error: "last_super_admin" };
  }
  // delegating super_admin is itself a privileged grant — only rank 4 reaches here, and it is audited.
  await db.update(users).set({ roleId }).where(eq(users.id, targetId));
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "users.role",
    entityType: "user",
    entityId: targetId,
    before: { roleId: target.roleId },
    after: { roleId },
  });
  return { ok: true, changed: 1 };
}

/** Force-logout: revoke every live session of a user (FEATURE-SPEC §8 admin security center). */
export async function forceLogoutUser(db: DB, targetId: string, actor: Actor): Promise<AdminActionResult> {
  const target = await loadTarget(db, targetId);
  if (!target || target.deletedAt) return { ok: false, error: "not_found" };
  const denied = rankGuard(actor, target.roleId);
  if (denied) return { ok: false, error: denied };
  const changed = await revokeAllUserSessions(db, targetId, "admin_force_logout");
  await logSecurityEvent(db, { userId: targetId, type: "sessions_revoked_all", metadata: { reason: "admin_force_logout", by: actor.userId } });
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "users.force_logout",
    entityType: "user",
    entityId: targetId,
    after: { sessionsRevoked: changed },
  });
  return { ok: true, changed };
}

/** "Reset device list" (FEATURE-SPEC §8): revoke devices + their sessions so re-enrollment is needed. */
export async function resetUserDevices(db: DB, targetId: string, actor: Actor, nowMs: number = Date.now()): Promise<AdminActionResult> {
  const target = await loadTarget(db, targetId);
  if (!target || target.deletedAt) return { ok: false, error: "not_found" };
  const denied = rankGuard(actor, target.roleId);
  if (denied) return { ok: false, error: denied };
  const res = await db
    .update(devices)
    .set({ status: "revoked", revokedAt: nowMs })
    .where(and(eq(devices.userId, targetId), eq(devices.status, "active")));
  const sessionsRevoked = await revokeAllUserSessions(db, targetId, "device_list_reset");
  await logSecurityEvent(db, { userId: targetId, type: "device_evicted", metadata: { reason: "device_list_reset", by: actor.userId } });
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "users.devices_reset",
    entityType: "user",
    entityId: targetId,
    after: { devicesRevoked: res.meta.changes ?? 0, sessionsRevoked },
  });
  return { ok: true, changed: res.meta.changes ?? 0 };
}

/** Revoke ONE session from the security center (P7 §7 — "revoke sessions/devices if architecture supports"). */
export async function revokeSessionAdmin(db: DB, sessionId: string, actor: Actor): Promise<AdminActionResult> {
  const rows = await db
    .select({ id: sessions.id, userId: sessions.userId, revokedAt: sessions.revokedAt, roleId: users.roleId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const s = rows[0];
  if (!s) return { ok: false, error: "not_found" };
  if (s.userId === actor.userId) return { ok: false, error: "self" };
  const denied = rankGuard(actor, s.roleId);
  if (denied) return { ok: false, error: denied };
  if (s.revokedAt) return { ok: true, changed: 0 }; // idempotent
  await revokeSession(db, sessionId, "admin_revoke");
  await logSecurityEvent(db, { userId: s.userId, type: "session_revoked", metadata: { by: actor.userId } });
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "users.session_revoke",
    entityType: "session",
    entityId: sessionId,
    after: { userId: s.userId },
  });
  return { ok: true, changed: 1 };
}

// ---------------------------------------------------------------------------
// Security center queries (read side; mutations above)

export const SECURITY_PAGE_SIZE = 25;
export const SECURITY_EVENT_TYPES = [
  "login_success",
  "login_failed",
  "logout",
  "device_added",
  "device_evicted",
  "device_limit_block",
  "device_change_limit_block",
  "device_revoked_login",
  "password_reset_requested",
  "password_reset_completed",
  "password_changed",
  "sessions_revoked_all",
  "session_revoked",
  "rate_limited",
  "permission_denied",
  "registration",
  "profile_updated",
] as const;
export type SecurityEventTypeFilter = (typeof SECURITY_EVENT_TYPES)[number];

/** Security events feed with optional type/user-email filters + pagination. */
export async function listSecurityEvents(db: DB, filter: { type?: string | null; q?: string; page?: number }) {
  const conds = [];
  if (filter.type && (SECURITY_EVENT_TYPES as readonly string[]).includes(filter.type)) conds.push(eq(securityEvents.type, filter.type as SecurityEventTypeFilter));
  const q = (filter.q ?? "").trim();
  if (q) conds.push(like(users.email, `%${q}%`));
  const where = conds.length ? and(...conds) : undefined;
  const page = Math.max(1, filter.page ?? 1);
  const [totalRows, rows] = await Promise.all([
    // count must go through the SAME join (the q filter references users.email)
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(securityEvents)
      .leftJoin(users, eq(users.id, securityEvents.userId))
      .where(where),
    db
      .select({
        id: securityEvents.id,
        type: securityEvents.type,
        createdAt: securityEvents.createdAt,
        userId: securityEvents.userId,
        userEmail: users.email,
        userRole: users.roleId,
      })
      .from(securityEvents)
      .leftJoin(users, eq(users.id, securityEvents.userId))
      .where(where)
      .orderBy(desc(securityEvents.createdAt))
      .limit(SECURITY_PAGE_SIZE)
      .offset((page - 1) * SECURITY_PAGE_SIZE),
  ]);
  return { total: Number(totalRows[0]?.n ?? 0), page, pageSize: SECURITY_PAGE_SIZE, rows };
}

/** Live sessions across the platform (security center). No token hashes leave the server. */
export async function listActiveSessions(db: DB, page = 1, nowMs: number = Date.now()) {
  const where = and(isNull(sessions.revokedAt), gte(sessions.expiresAt, nowMs));
  const p = Math.max(1, page);
  const [total, rows] = await Promise.all([
    db.$count(sessions, where),
    db
      .select({
        id: sessions.id,
        userId: sessions.userId,
        userEmail: users.email,
        userRole: users.roleId,
        deviceLabel: devices.label,
        devicePlatform: devices.platform,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(devices, eq(devices.id, sessions.deviceId))
      .where(where)
      .orderBy(desc(sessions.lastSeenAt))
      .limit(SECURITY_PAGE_SIZE)
      .offset((p - 1) * SECURITY_PAGE_SIZE),
  ]);
  return { total, page: p, pageSize: SECURITY_PAGE_SIZE, rows };
}
