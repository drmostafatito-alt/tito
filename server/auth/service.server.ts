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
import { burnPasswordVerification, hashPassword, isCommonPassword, verifyPassword } from "./password.server";
import {
  createSession,
  DEVICE_COOKIE,
  hashToken,
  newOpaqueToken,
  revokeSession,
  SESSION_COOKIE,
} from "./session.server";
import { resolveDevice } from "./devices.server";
import { brandFromNames, sendPasswordResetEmail, sendWelcomeEmail } from "../email/service.server";
import { claimTransactionalEmailBudget } from "../email/budget.server";
import type { EmailLocale } from "../email/templates";
import { applicationOrigin } from "../http/origin.server";
import { isResetTokenShape } from "./reset-cookie.server";
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
  request: Request,
  defer?: DeferBackgroundTask
): Promise<{ ok: true; userId: string } | Failure> {
  const db = getDb(env);
  const settings = await getSettings(db);
  const ip = clientIpOf(request) ?? "unknown";
  const ipHash = await sha256Hex(ip, env.SESSION_PEPPER);

  const rl = await checkRateLimit(db, "register", ipHash, settings.security.rateLimits.registerPerHour, 3_600_000);
  if (!rl.ok) {
    if (rl.newlyBlocked) {
      await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "register" } });
    }
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

  // Welcome delivery starts only AFTER commit and never delays the browser when
  // the route supplies waitUntil. A duplicate registration stops above, and the
  // global budget keeps all transactional categories under the free allowance.
  const deliverWelcome = async (): Promise<void> => {
    try {
      if (!(await claimTransactionalEmailBudget(db, { category: "welcome" }))) return;
      const brand = brandFromNames(
        settings.platform.nameAr,
        settings.platform.nameEn,
        settings.platform.supportEmail
      );
      await sendWelcomeEmail(env, {
        to: email.data,
        locale: "ar",
        brand,
        name: fullName.data,
      });
    } catch {
      // Registration is committed; provider failures are intentionally non-fatal.
    }
  };
  if (defer) defer(deliverWelcome());
  else await deliverWelcome();

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
  const ipHash = await sha256Hex(ip, env.SESSION_PEPPER);
  const emailHash = await sha256Hex(input.email.trim().toLowerCase().slice(0, 254), env.SESSION_PEPPER);

  const rlIp = await checkRateLimit(db, "login", ipHash, settings.security.rateLimits.loginPerMinute, 60_000);
  if (!rlIp.ok) {
    if (rlIp.newlyBlocked) {
      await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "login" } });
    }
    return { ok: false, code: "rate_limited", retryAfterMs: rlIp.retryAfterMs };
  }
  // Only touch the identifier bucket while this source IP remains admitted. A
  // blocked bot rotating random addresses cannot create one new D1 row/request.
  const rlEmail = await checkRateLimit(db, "login-e", emailHash, settings.security.rateLimits.loginPerMinute * 2, 60_000);
  if (!rlEmail.ok) {
    if (rlEmail.newlyBlocked) {
      await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "login" } });
    }
    return { ok: false, code: "rate_limited", retryAfterMs: rlEmail.retryAfterMs };
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
  let verify = { valid: false, needsRehash: false };
  if (user) verify = await verifyPassword(input.password, user.passwordHash, env);
  else await burnPasswordVerification(input.password, env);

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
    userAgentHash: await sha256Hex(request.headers.get("user-agent") ?? "", env.SESSION_PEPPER),
  });

  await db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id));
  await logSecurityEvent(db, { userId: user.id, type: "login_success", ipHash, metadata: { device: device.deviceId } });

  const cookies: LoginSuccess["cookies"] = [
    { name: SESSION_COOKIE, value: session.token, maxAgeSeconds: session.maxAgeSeconds },
  ];
  if (device.newDeviceKey) {
    cookies.push({ name: DEVICE_COOKIE, value: device.newDeviceKey, maxAgeSeconds: 400 * 86_400 });
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

export type DeferBackgroundTask = (task: Promise<unknown>) => void;

const FORGOT_RESPONSE_FLOOR_MS = 250;

async function waitForForgotResponseFloor(startedAt: number): Promise<void> {
  const remaining = FORGOT_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
}

/**
 * Enumeration-safe forgot-password request. The public result is deliberately
 * constant-shaped; delivery happens in waitUntil when the route supplies it.
 */
export async function requestPasswordReset(
  env: Env,
  emailInput: string,
  request: Request,
  defer?: DeferBackgroundTask
): Promise<{ ok: true }> {
  const startedAt = Date.now();
  const db = getDb(env);
  const settings = await getSettings(db);
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER);
  const normalizedBucketEmail = emailInput.trim().toLowerCase().slice(0, 254);
  const emailHash = await sha256Hex(normalizedBucketEmail, env.SESSION_PEPPER);

  const ipLimit = await checkRateLimit(
    db,
    "forgot-ip",
    ipHash,
    settings.security.rateLimits.forgotPerHour,
    3_600_000
  );
  if (!ipLimit.ok) {
    await waitForForgotResponseFloor(startedAt);
    return { ok: true };
  }
  const accountLimit = await checkRateLimit(
    db,
    "forgot-account",
    emailHash,
    settings.security.rateLimits.forgotPerAccountHour,
    3_600_000
  );
  if (!accountLimit.ok) {
    await waitForForgotResponseFloor(startedAt);
    return { ok: true };
  }

  const email = emailSchema.safeParse(emailInput);
  if (!email.success) {
    await waitForForgotResponseFloor(startedAt);
    return { ok: true };
  }

  const found = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, localePref: users.localePref })
    .from(users)
    .where(and(eq(users.email, email.data), isNull(users.deletedAt)))
    .limit(1);
  const user = found[0];
  if (!user) {
    await waitForForgotResponseFloor(startedAt);
    return { ok: true };
  }

  // Preserve room under Resend Free's owner-confirmed 100/day allowance. This
  // counter is consumed only for real accounts so arbitrary unknown addresses
  // cannot exhaust the delivery budget.
  const deliveryBudget = await checkRateLimit(
    db,
    "forgot-delivery",
    "global",
    settings.security.rateLimits.resetEmailsPerDay,
    86_400_000
  );
  if (!deliveryBudget.ok) {
    await waitForForgotResponseFloor(startedAt);
    return { ok: true };
  }

  const token = newOpaqueToken();
  const tokenHash = await hashToken(token, env);
  const now = Date.now();
  const expiresAt = now + settings.security.resetTokenMinutes * 60_000;

  // D1 batch is transactional. Invalidating old rows and inserting the new row
  // in one transaction, together with the partial unique index, guarantees one
  // active reset token per account even under concurrent requests.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`
    ).bind(now, user.id),
    env.DB.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(crypto.randomUUID(), user.id, tokenHash, expiresAt, now),
  ]);
  await logSecurityEvent(db, { userId: user.id, type: "password_reset_requested", ipHash });

  const deliver = async (): Promise<void> => {
    let sent = false;
    try {
      const origin = applicationOrigin(env, request);
      if (origin && (await claimTransactionalEmailBudget(db, { category: "password_reset" }))) {
        const locale: EmailLocale = user.localePref === "en" ? "en" : "ar";
        const brand = brandFromNames(
          settings.platform.nameAr,
          settings.platform.nameEn,
          settings.platform.supportEmail
        );
        sent = await sendPasswordResetEmail(env, {
          to: user.email,
          locale,
          brand,
          name: user.fullName,
          // Fragments never reach HTTP/edge logs or Referer headers. The reset
          // page exchanges this transient value for an HttpOnly cookie.
          resetUrl: `${origin}/reset-password#token=${encodeURIComponent(token)}`,
          expiresMinutes: settings.security.resetTokenMinutes,
        });
      }
    } catch {
      sent = false;
    }
    if (!sent) {
      // Do not leave an invisible bearer credential active when delivery failed
      // or production email/origin configuration is incomplete.
      await db
        .update(passwordResetTokens)
        .set({ usedAt: Date.now() })
        .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)));
    }
  };

  if (defer) defer(deliver());
  else await deliver();

  await waitForForgotResponseFloor(startedAt);
  return { ok: true };
}

export async function validateResetToken(
  env: Env,
  token: string,
  now = Date.now()
): Promise<{ valid: true; userId: string; expiresAt: number } | { valid: false }> {
  if (!isResetTokenShape(token)) return { valid: false };
  const db = getDb(env);
  const tokenHash = await hashToken(token, env);
  const rows = await db
    .select({ userId: passwordResetTokens.userId, expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        isNull(users.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  return row && row.expiresAt > now
    ? { valid: true, userId: row.userId, expiresAt: row.expiresAt }
    : { valid: false };
}

/** Rate-limited server validation used by the fragment-to-cookie exchange. */
export async function exchangeResetToken(
  env: Env,
  token: string,
  request: Request
): Promise<{ ok: true } | Failure> {
  const db = getDb(env);
  const settings = await getSettings(db);
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER);
  const ipLimit = await checkRateLimit(
    db,
    "reset-attempt-ip",
    ipHash,
    settings.security.rateLimits.resetAttemptsPer15Minutes,
    15 * 60_000
  );
  if (!ipLimit.ok) {
    if (ipLimit.newlyBlocked) {
      await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "password_reset" } });
    }
    return { ok: false, code: "rate_limited", retryAfterMs: ipLimit.retryAfterMs };
  }
  const tokenBucket = await sha256Hex(String(token).slice(0, 128), env.SESSION_PEPPER);
  const tokenLimit = await checkRateLimit(
    db,
    "reset-attempt-token",
    tokenBucket,
    settings.security.rateLimits.resetAttemptsPer15Minutes,
    15 * 60_000
  );
  if (!tokenLimit.ok) {
    if (tokenLimit.newlyBlocked) {
      await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "password_reset" } });
    }
    return { ok: false, code: "rate_limited", retryAfterMs: tokenLimit.retryAfterMs };
  }
  const verdict = await validateResetToken(env, token);
  return verdict.valid ? { ok: true } : { ok: false, code: "invalid_token" };
}

export async function resetPassword(
  env: Env,
  input: { token: string; newPassword: string },
  request?: Request
): Promise<{ ok: true } | Failure> {
  const db = getDb(env);
  const settings = await getSettings(db);

  if (request) {
    const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER);
    const ipLimit = await checkRateLimit(
      db,
      "reset-attempt-ip",
      ipHash,
      settings.security.rateLimits.resetAttemptsPer15Minutes,
      15 * 60_000
    );
    if (!ipLimit.ok) {
      if (ipLimit.newlyBlocked) {
        await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "password_reset" } });
      }
      return { ok: false, code: "rate_limited", retryAfterMs: ipLimit.retryAfterMs };
    }
    const tokenBucket = await sha256Hex(String(input.token).slice(0, 128), env.SESSION_PEPPER);
    const tokenLimit = await checkRateLimit(
      db,
      "reset-attempt-token",
      tokenBucket,
      settings.security.rateLimits.resetAttemptsPer15Minutes,
      15 * 60_000
    );
    if (!tokenLimit.ok) {
      if (tokenLimit.newlyBlocked) {
        await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "password_reset" } });
      }
      return { ok: false, code: "rate_limited", retryAfterMs: tokenLimit.retryAfterMs };
    }
  }

  if (!isResetTokenShape(input.token)) return { ok: false, code: "invalid_token" };
  const password = passwordSchema.safeParse(input.newPassword);
  if (!password.success) return { ok: false, code: "weak_password" };
  if (isCommonPassword(input.newPassword)) return { ok: false, code: "common_password" };

  const now = Date.now();
  const tokenHash = await hashToken(input.token, env);
  const tokenRows = await db
    .select({ userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .innerJoin(users, eq(users.id, passwordResetTokens.userId))
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        isNull(users.deletedAt)
      )
    )
    .limit(1);
  const userId = tokenRows[0]?.userId;
  if (!userId) return { ok: false, code: "invalid_token" };

  const nextHash = await hashPassword(input.newPassword, env);
  const validitySql =
    `EXISTS (SELECT 1 FROM password_reset_tokens
             WHERE token_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?)`;

  // Every security-critical mutation is in one D1 transaction. If password
  // update, session revocation, or token claim fails, D1 rolls the whole batch
  // back and the token remains usable rather than being silently consumed.
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET password_hash = ?, updated_at = ?
       WHERE id = ? AND ${validitySql}`
    ).bind(nextHash, now, userId, tokenHash, userId, now),
    env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?, revoked_reason = 'password_reset'
       WHERE user_id = ? AND revoked_at IS NULL AND ${validitySql}`
    ).bind(now, userId, tokenHash, userId, now),
    env.DB.prepare(
      `UPDATE password_reset_tokens SET used_at = ?
       WHERE token_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?`
    ).bind(now, tokenHash, userId, now),
  ]);

  const passwordChanged = Number(results[0]?.meta?.changes ?? 0) === 1;
  const tokenClaimed = Number(results[2]?.meta?.changes ?? 0) === 1;
  if (!passwordChanged || !tokenClaimed) return { ok: false, code: "invalid_token" };

  await logSecurityEvent(db, { userId, type: "password_reset_completed" });
  return { ok: true };
}

export async function changePassword(
  env: Env,
  userId: string,
  input: { currentPassword: string; newPassword: string },
  request: Request
): Promise<{ ok: true } | Failure> {
  const db = getDb(env);
  const settings = await getSettings(db);
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER);
  const [userLimit, ipLimit] = await Promise.all([
    checkRateLimit(
      db,
      "password-change-user",
      userId,
      settings.security.rateLimits.resetAttemptsPer15Minutes,
      15 * 60_000
    ),
    checkRateLimit(
      db,
      "password-change-ip",
      ipHash,
      settings.security.rateLimits.resetAttemptsPer15Minutes,
      15 * 60_000
    ),
  ]);
  if (!userLimit.ok || !ipLimit.ok) {
    if (userLimit.newlyBlocked || ipLimit.newlyBlocked) {
      await logSecurityEvent(db, {
        userId,
        type: "rate_limited",
        ipHash,
        metadata: { bucket: "password_change" },
      });
    }
    return {
      ok: false,
      code: "rate_limited",
      retryAfterMs: Math.max(userLimit.retryAfterMs, ipLimit.retryAfterMs),
    };
  }

  const password = passwordSchema.safeParse(input.newPassword);
  if (!password.success) return { ok: false, code: "weak_password" };
  if (isCommonPassword(input.newPassword)) return { ok: false, code: "common_password" };

  const found = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = found[0];
  if (!user) return { ok: false, code: "invalid_credentials" };

  const verify = await verifyPassword(input.currentPassword, user.passwordHash, env);
  if (!verify.valid) return { ok: false, code: "wrong_current_password" };

  const now = Date.now();
  const nextHash = await hashPassword(input.newPassword, env);
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(nextHash, now, userId),
    env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?, revoked_reason = 'password_changed' WHERE user_id = ? AND revoked_at IS NULL`
    ).bind(now, userId),
  ]);
  await logSecurityEvent(db, { userId, type: "password_changed" });
  return { ok: true };
}
