import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { devices, sessions, users } from "../db/schema";
import { sha256Hex } from "../http/rate-limit.server";
import { parseCookieHeader, serializeCookie } from "./cookies.server";

export const SESSION_COOKIE = "__edu_session";
export const DEVICE_COOKIE = "__edu_dk";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roleId: string;
  rank: number;
  localePref: string;
}

export interface AuthContext {
  user: AuthUser;
  session: { id: string; expiresAt: number };
  device: { id: string; label: string; platform: string };
}

export function newOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string, env: Env): Promise<string> {
  return sha256Hex(token, env.SESSION_PEPPER ?? "");
}

export async function createSession(
  db: DB,
  env: Env,
  opts: { userId: string; deviceId: string; sessionDays: number; ipHash?: string | null; userAgentHash?: string | null }
): Promise<{ token: string; expiresAt: number; maxAgeSeconds: number }> {
  const token = newOpaqueToken();
  const now = Date.now();
  const expiresAt = now + opts.sessionDays * 86_400_000;
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId: opts.userId,
    deviceId: opts.deviceId,
    tokenHash: await hashToken(token, env),
    ipHash: opts.ipHash ?? null,
    userAgentHash: opts.userAgentHash ?? null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return { token, expiresAt, maxAgeSeconds: Math.floor((expiresAt - now) / 1000) };
}

/**
 * Resolve the caller from the session cookie. Returns null when missing/invalid.
 * Sliding expiry: when past half-life, the expiry is extended and a fresh cookie
 * header is returned for the route to set.
 */
export async function resolveAuth(
  db: DB,
  env: Env,
  request: Request
): Promise<{ auth: AuthContext | null; refreshCookie?: string }> {
  const token = parseCookieHeader(request.headers.get("cookie")).get(SESSION_COOKIE);
  if (!token) return { auth: null };

  const tokenHash = await hashToken(token, env);
  const rows = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        roleId: users.roleId,
        localePref: users.localePref,
        status: users.status,
        deletedAt: users.deletedAt,
      },
      device: { id: devices.id, label: devices.label, platform: devices.platform, status: devices.status },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(devices, eq(devices.id, sessions.deviceId))
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .limit(1);

  const row = rows[0];
  const now = Date.now();
  if (!row || row.session.expiresAt <= now || row.session.revokedAt) return { auth: null };
  if (row.user.status !== "active" || row.user.deletedAt) return { auth: null };
  if (row.device.status !== "active") return { auth: null };

  // role rank via subquery-free lookup
  const rank = ROLE_RANKS[row.user.roleId] ?? 1;

  let refreshCookie: string | undefined;
  const halfLife = (row.session.expiresAt - row.session.createdAt) / 2;
  if (now - row.session.lastSeenAt > halfLife) {
    // H2 (Phase 8): extend by the session's ORIGINAL lifetime, not a hardcoded
    // 30d floor — this honors the configured `security.sessionDays` that was in
    // force when the session was created (and future config changes take effect
    // on next login, as expected).
    const sessionLifetimeMs = row.session.expiresAt - row.session.createdAt;
    const newExpiry = now + sessionLifetimeMs;
    await db.update(sessions).set({ lastSeenAt: now, expiresAt: newExpiry }).where(eq(sessions.id, row.session.id));
    refreshCookie = serializeCookie(SESSION_COOKIE, token, {
      maxAgeSeconds: Math.floor((newExpiry - now) / 1000),
    });
  } else if (now - row.session.lastSeenAt > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
  }

  return {
    auth: {
      user: {
        id: row.user.id,
        email: row.user.email,
        fullName: row.user.fullName,
        roleId: row.user.roleId,
        rank,
        localePref: row.user.localePref,
      },
      session: { id: row.session.id, expiresAt: row.session.expiresAt },
      device: { id: row.device.id, label: row.device.label, platform: row.device.platform },
    },
    refreshCookie,
  };
}

export const ROLE_RANKS: Record<string, number> = {
  student: 1,
  teacher: 2,
  admin: 3,
  super_admin: 4,
};

export async function revokeSession(db: DB, sessionId: string, reason: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: Date.now(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeAllUserSessions(db: DB, userId: string, reason: string): Promise<number> {
  const res = await db.run(sql`UPDATE sessions SET revoked_at = ${Date.now()}, revoked_reason = ${reason}
     WHERE user_id = ${userId} AND revoked_at IS NULL`);
  return res.meta.changes ?? 0;
}

/** Housekeeping (called opportunistically): purge long-expired sessions. */
export async function purgeExpiredSessions(db: DB): Promise<void> {
  const cutoff = Date.now() - 90 * 86_400_000;
  await db.delete(sessions).where(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)));
}
