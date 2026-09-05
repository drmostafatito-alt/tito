/**
 * Auth orchestration used by route actions AND integration tests.
 * Routes stay thin (SECURITY.md: validation + server decisions live here).
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type DB } from "../db/client.server";
import { passwordResetTokens, users } from "../db/schema";
import { checkRateLimit, clientIpOf, sha256Hex } from "../http/rate-limit.server";
import { logSecurityEvent } from "../security/events.server";
import { getSettings } from "../settings/service.server";
import { hashPassword, isCommonPassword, verifyPassword } from "./password.server";
import { createSession, hashToken, newOpaqueToken, revokeAllUserSessions, revokeSession } from "./session.server";
import { resolveDevice } from "./devices.server";
import { z } from "zod";

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "common_password"
  | "rate_limited"
  | "device_limit"
  | "device_change_limit"
  | "device_revoked"
  | "invalid_token"
  | "wrong_current_password"
  | "user_suspended";

export interface LoginSuccess {
  ok: true;
  user: { id: string; roleId: string; fullName: string };
  cookies: { name: string; value: string; maxAgeSeconds: number }[];
}
export interface Failure {
  ok: false;
  code: AuthErrorCode;
  retryAfterMs?: number;
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8).max(128);
const nameSchema = z.string().trim().min(2).max(120);

export async function registerUser(
  env: Env,
  input: { email: string; fullName: string; password: string },
  request: Request
): Promise<{ ok: true; userId: string } | Failure> {
  const db = getDb(env);
  const settings = await getSettings(db);
  const ip = clientIpOf(request) ?? "unknown";
  const ipHash = await sha256Hex(ip);

  const rl = await checkRateLimit(db, "register", ipHash, settings.security.rateLimits.registerPerHour, 3_600_000);
  if (!rl.ok) {
    await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "register" } });
    return { ok: false, code: "rate_limited", retryAfterMs: rl.retryAfterMs };
  }

  const email = emailSchema.safeParse(input.email);
  const fullName = nameSchema.safeParse(input.fullName);
  const password = passwordSchema.safeParse(input.password);
  if (!email.success || !fullName.success || !password.success) {
    return { ok: false, code: "weak_password" }; // field errors rendered client-side from zod map
  }
  if (isCommonPassword(input.password)) return { ok: false, code: "common_password" };

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.data))
    .limit(1);
  if (existing[0]) return { ok: false, code: "email_taken" };

  const now = Date.now();
  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: email.data,
    passwordHash: await hashPassword(input.password, env),
    fullName: fullName.data,
    roleId: "student",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await logSecurityEvent(db, { userId, type: "registration", ipHash });
  return { ok: true, userId };
}

export async function login(
  env: Env,
  input: { email: string; password: string },
  request: Request
): Promise<LoginSuccess | Failure> {
  const db = getDb(env);
  const settings = await getSettings(db);
  const ip = clientIpOf(request) ?? "unknown";
  const ipHash = await sha256Hex(ip);
  const emailHash = await sha256Hex(input.email.trim().toLowerCase());

  const rlIp = await checkRateLimit(db, "login", ipHash, settings.security.rateLimits.loginPerMinute, 60_000);
  const rlEmail = await checkRateLimit(db, "login-e", emailHash, settings.security.rateLimits.loginPerMinute * 2, 60_000);
  if (!rlIp.ok || !rlEmail.ok) {
    await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "login" } });
    return { ok: false, code: "rate_limited", retryAfterMs: rlIp.retryAfterMs || rlEmail.retryAfterMs };
  }

  const email = emailSchema.safeParse(input.email);
  const password = z.string().min(1).max(128).safeParse(input.password);
  if (!email.success || !password.success) return { ok: false, code: "invalid_credentials" };

  const found = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email.data), isNull(users.deletedAt)))
    .limit(1);
  const user = found[0];
  const verify = user ? await verifyPassword(input.password, user.passwordHash, env) : { valid: false, needsRehash: false };

  if (!user || !verify.valid) {
    await logSecurityEvent(db, {
      userId: user?.id ?? null,
      type: "login_failed",
      ipHash,
      metadata: { email: email.data.slice(0, 3) + "***" }, // never store full identifier
    });
    return { ok: false, code: "invalid_credentials" };
  }
  if (user.status !== "active") {
    await logSecurityEvent(db, { userId: user.id, type: "login_failed", ipHash, metadata: { reason: "suspended" } });
    return { ok: false, code: "user_suspended" };
  }

  if (verify.needsRehash) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.password, env), updatedAt: Date.now() })
      .where(eq(users.id, user.id));
  }

  const device = await resolveDevice(db, env, { request, userId: user.id, policy: settings.devices, ipHash });
  if (!device.ok) return { ok: false, code: device.errorCode! };

  const session = await createSession(db, env, {
    userId: user.id,
    deviceId: device.deviceId!,
    sessionDays: settings.security.sessionDays,
    ipHash,
    userAgentHash: await sha256Hex(request.headers.get("user-agent") ?? ""),
  });

  await db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id));
  await logSecurityEvent(db, { userId: user.id, type: "login_success", ipHash, metadata: { device: device.deviceId } });

  const cookies: LoginSuccess["cookies"] = [
    { name: "__edu_session", value: session.token, maxAgeSeconds: session.maxAgeSeconds },
  ];
  if (device.newDeviceKey) {
    cookies.push({ name: "__edu_dk", value: device.newDeviceKey, maxAgeSeconds: 400 * 86_400 });
  }

  return {
    ok: true,
    user: { id: user.id, roleId: user.roleId, fullName: user.fullName },
    cookies,
  };
}

export async function logout(db: DB, sessionId: string, userId: string, ipHash?: string | null): Promise<void> {
  await revokeSession(db, sessionId, "user_logout");
  await logSecurityEvent(db, { userId, type: "logout", ipHash });
}

export async function requestPasswordReset(
  env: Env,
  emailInput: string,
  request: Request
): Promise<{ ok: true; devToken?: string }> {
  const db = getDb(env);
  const settings = await getSettings(db);
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  const rl = await checkRateLimit(db, "forgot", ipHash, settings.security.rateLimits.forgotPerHour, 3_600_000);
  if (!rl.ok) return { ok: true }; // uniform response even when throttled

  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return { ok: true };

  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email.data), isNull(users.deletedAt)))
    .limit(1);
  const user = found[0];
  if (!user) return { ok: true }; // enumeration resistance: identical shape

  const token = newOpaqueToken();
  await db.insert(passwordResetTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: await hashToken(token, env),
    expiresAt: Date.now() + settings.security.resetTokenMinutes * 60_000,
    createdAt: Date.now(),
  });
  await logSecurityEvent(db, { userId: user.id, type: "password_reset_requested", ipHash });

  // Email delivery arrives in Phase 3+ (verification-gated). Until a channel exists,
  // the raw token is only exposed in non-production environments for testing.
  return { ok: true, devToken: env.ENVIRONMENT === "production" ? undefined : token };
}

export async function resetPassword(
  env: Env,
  input: { token: string; newPassword: string }
): Promise<{ ok: true } | Failure> {
  const db = getDb(env);
  const password = passwordSchema.safeParse(input.newPassword);
  if (!password.success) return { ok: false, code: "weak_password" };
  if (isCommonPassword(input.newPassword)) return { ok: false, code: "common_password" };

  const tokenHash = await hashToken(input.token, env);
  const found = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  const row = found[0];
  if (!row || row.usedAt || row.expiresAt <= Date.now()) return { ok: false, code: "invalid_token" };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.newPassword, env), updatedAt: Date.now() })
    .where(eq(users.id, row.userId));
  await db.update(passwordResetTokens).set({ usedAt: Date.now() }).where(eq(passwordResetTokens.id, row.id));
  await revokeAllUserSessions(db, row.userId, "password_reset");
  await logSecurityEvent(db, { userId: row.userId, type: "password_reset_completed" });
  return { ok: true };
}

export async function changePassword(
  env: Env,
  userId: string,
  input: { currentPassword: string; newPassword: string }
): Promise<{ ok: true } | Failure> {
  const db = getDb(env);
  const password = passwordSchema.safeParse(input.newPassword);
  if (!password.success) return { ok: false, code: "weak_password" };
  if (isCommonPassword(input.newPassword)) return { ok: false, code: "common_password" };

  const found = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = found[0];
  if (!user) return { ok: false, code: "invalid_credentials" };

  const verify = await verifyPassword(input.currentPassword, user.passwordHash, env);
  if (!verify.valid) return { ok: false, code: "wrong_current_password" };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.newPassword, env), updatedAt: Date.now() })
    .where(eq(users.id, userId));
  await revokeAllUserSessions(db, userId, "password_changed");
  await logSecurityEvent(db, { userId, type: "password_changed" });
  return { ok: true };
}
