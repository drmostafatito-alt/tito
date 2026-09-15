/**
 * Self-service account EMAIL CHANGE with out-of-band verification.
 *
 * Security posture (mirrors the password-reset discipline):
 *  - Issuance requires fresh current-password reauthentication; a stolen session
 *    alone cannot pivot through email change into password recovery takeover.
 *  - New email is bound to a single-use, expiring, HASHED verification token.
 *  - The account email only changes after the token is redeemed by whoever
 *    controls the NEW mailbox — preventing takeover by typo or race.
 *  - Enumeration-safe request: if the new address already belongs to another
 *    active account we send nothing and reply with the SAME generic success,
 *    so the caller cannot learn ownership through a distinct error.
 *  - Ownership is re-checked atomically at completion (guards the tiny window
 *    where the new address becomes taken between request and verify).
 *  - Rate-limited per user; every request + completion is audited/logged.
 *
 * Email delivery is via server/email (EMAiL_PROVIDER). When no channel is
 * configured the request still succeeds generically and no confirmation is sent —
 * a real delivery provider is an OWNER-ONLY provisioning step (never invented
 * here, never claimed live).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.server";
import { emailChangeTokens, users } from "../db/schema";
import { checkRateLimit, clientIpOf, sha256Hex } from "../http/rate-limit.server";
import { logSecurityEvent } from "../security/events.server";
import { getSettings } from "../settings/service.server";
import { hashToken, newOpaqueToken } from "../auth/session.server";
import { logAudit } from "../audit/log.server";
import { brandFromNames, sendEmailChangeVerification } from "../email/service.server";
import { applicationOrigin } from "../http/origin.server";
import { claimTransactionalEmailBudget } from "../email/budget.server";
import { verifyPassword } from "../auth/password.server";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const EMAIL_CHANGE_RESPONSE_FLOOR_MS = 250;

async function waitForEmailChangeFloor(startedAt: number): Promise<void> {
  const remaining = EMAIL_CHANGE_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
}

export type EmailChangeRequestResult =
  | { ok: true }
  | { ok: false; code: "rate_limited" | "invalid" | "same_email" | "wrong_password" };

export async function requestEmailChange(
  env: Env,
  db: DB,
  opts: { userId: string },
  newEmailInput: string,
  currentPasswordInput: string,
  request: Request,
  defer?: (task: Promise<unknown>) => void
): Promise<EmailChangeRequestResult> {
  const startedAt = Date.now();
  const parsed = emailSchema.safeParse(newEmailInput);
  if (!parsed.success) return { ok: false, code: "invalid" };
  if (currentPasswordInput.length < 1 || currentPasswordInput.length > 128) {
    return { ok: false, code: "wrong_password" };
  }

  const settings = await getSettings(db);
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER);
  // Rate limit per user (keyed by id-hash) — bounded independent of IP.
  const userKey = await sha256Hex(opts.userId, env.SESSION_PEPPER);
  const rl = await checkRateLimit(db, "email-change", userKey, settings.security.rateLimits.emailChangePerHour, 3_600_000);
  if (!rl.ok) {
    if (rl.newlyBlocked) {
      await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "email-change", userId: opts.userId } });
    }
    return { ok: false, code: "rate_limited" };
  }

  const me = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      fullName: users.fullName,
      localePref: users.localePref,
    })
    .from(users)
    .where(eq(users.id, opts.userId))
    .limit(1);
  const self = me[0];
  if (!self) return { ok: false, code: "invalid" };

  // Email change can become full account takeover (change address, then invoke
  // password recovery), so possession of a session alone is insufficient. A
  // fresh current-password proof is required and bounded by the per-user rate
  // limit above. The password is never logged or persisted.
  const password = await verifyPassword(currentPasswordInput, self.passwordHash, env);
  if (!password.valid) {
    await logSecurityEvent(db, {
      userId: opts.userId,
      type: "email_change_reauth_failed",
      ipHash,
    });
    return { ok: false, code: "wrong_password" };
  }

  const newEmail = parsed.data;
  if (newEmail === self.email) return { ok: false, code: "same_email" };

  // Enumeration-safe: if owned by another active account, no token, generic ok.
  const taken = await db.select({ id: users.id }).from(users).where(and(eq(users.email, newEmail), isNull(users.deletedAt))).limit(1);
  if (taken[0]) {
    // Preserve the generic response without leaving a previously issued link
    // live after the account owner has submitted a newer change request.
    await db.delete(emailChangeTokens).where(eq(emailChangeTokens.userId, opts.userId));
    await waitForEmailChangeFloor(startedAt);
    return { ok: true };
  }

  const token = newOpaqueToken();
  const tokenHash = await hashToken(token, env);
  const now = Date.now();
  const expiresAt = now + settings.security.resetTokenMinutes * 60_000;
  // Only one outstanding request per account. D1 batches are transactional, so
  // concurrent issuance cannot leave a delete/insert gap or two live links.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM email_change_tokens WHERE user_id = ?`).bind(opts.userId),
    env.DB
      .prepare(
        `INSERT INTO email_change_tokens (id, user_id, new_email, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), opts.userId, newEmail, tokenHash, expiresAt, now),
  ]);
  await logSecurityEvent(db, { userId: opts.userId, type: "email_change_requested", ipHash, metadata: { targetEmail: newEmail } });

  const deliverVerification = async (): Promise<void> => {
    const originBase = applicationOrigin(env, request);
    const locale = self.localePref === "en" ? "en" : "ar";
    let delivered = false;
    if (originBase) {
      try {
        if (await claimTransactionalEmailBudget(db, { category: "email_change" })) {
          delivered = await sendEmailChangeVerification(env, {
            to: newEmail,
            locale,
            brand: brandFromNames(
              settings.platform.nameAr,
              settings.platform.nameEn,
              settings.platform.supportEmail
            ),
            name: self.fullName,
            // Fragments never reach HTTP access logs or Referer headers. The
            // landing page removes it immediately and exchanges it by POST.
            verifyUrl: `${originBase}/verify-email-change#token=${encodeURIComponent(token)}`,
            expiresMinutes: settings.security.resetTokenMinutes,
          });
        }
      } catch {
        delivered = false;
      }
    }
    if (!delivered) {
      await db
        .update(emailChangeTokens)
        .set({ usedAt: Date.now() })
        .where(and(eq(emailChangeTokens.tokenHash, tokenHash), isNull(emailChangeTokens.usedAt)));
    }
  };
  if (defer) defer(deliverVerification());
  else await deliverVerification();
  await waitForEmailChangeFloor(startedAt);
  return { ok: true };
}

export type EmailChangeVerifyResult =
  | { ok: true; email: string }
  | { ok: false; code: "invalid_token" };

/**
 * Redeem a verification token. Atomic single-use claim; then, only if the new
 * address is still free, update the account email and stamp verifiedAt. Any
 * mismatch (used/expired/token now taken) returns invalid_token generically.
 */
export async function completeEmailChange(env: Env, db: DB, token: string): Promise<EmailChangeVerifyResult> {
  // Avoid hashing/querying attacker-controlled unbounded input. Tokens produced
  // by newOpaqueToken() are 32-byte unpadded base64url strings (43 characters).
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, code: "invalid_token" };
  const now = Date.now();
  const tokenHash = await hashToken(token, env);
  const pending = await db
    .select({ userId: emailChangeTokens.userId, newEmail: emailChangeTokens.newEmail })
    .from(emailChangeTokens)
    .where(
      and(
        eq(emailChangeTokens.tokenHash, tokenHash),
        isNull(emailChangeTokens.usedAt),
        sql`${emailChangeTokens.expiresAt} > ${now}`
      )
    )
    .limit(1);
  const claim = pending[0];
  if (!claim) return { ok: false, code: "invalid_token" };

  const newEmail = claim.newEmail.toLowerCase();
  const before = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, claim.userId))
    .limit(1);

  try {
    // The ownership check, email update, token consumption and session
    // revocation commit or roll back together. The second statement consumes a
    // valid link even when ownership changed, while success is verified below.
    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE users
           SET email = ?, updated_at = ?
           WHERE id = ?
             AND NOT EXISTS (
               SELECT 1 FROM users
               WHERE email = ? AND deleted_at IS NULL AND id <> ?
             )
             AND EXISTS (
               SELECT 1 FROM email_change_tokens
               WHERE token_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?
             )`
        )
        .bind(newEmail, now, claim.userId, newEmail, claim.userId, tokenHash, claim.userId, now),
      env.DB
        .prepare(
          `UPDATE email_change_tokens
           SET used_at = ?
           WHERE token_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?`
        )
        .bind(now, tokenHash, claim.userId, now),
      env.DB
        .prepare(
          `UPDATE sessions
           SET revoked_at = ?, revoked_reason = 'email_changed'
           WHERE user_id = ? AND revoked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM users WHERE id = ? AND email = ?
             )`
        )
        .bind(now, claim.userId, claim.userId, newEmail),
    ]);
  } catch {
    return { ok: false, code: "invalid_token" };
  }

  const [consumed, changed] = await Promise.all([
    db
      .select({ usedAt: emailChangeTokens.usedAt })
      .from(emailChangeTokens)
      .where(eq(emailChangeTokens.tokenHash, tokenHash))
      .limit(1),
    db.select({ email: users.email }).from(users).where(eq(users.id, claim.userId)).limit(1),
  ]);
  if (consumed[0]?.usedAt !== now || changed[0]?.email !== newEmail) {
    return { ok: false, code: "invalid_token" };
  }

  if (before[0]?.email !== newEmail) {
    await logAudit(db, {
      actorUserId: claim.userId,
      action: "users.email_change.verified",
      entityType: "user",
      entityId: claim.userId,
      before: { email: before[0]?.email ?? null },
      after: { email: newEmail },
    });
  }
  await logSecurityEvent(db, { userId: claim.userId, type: "email_changed", metadata: { newEmail } });
  return { ok: true, email: newEmail };
}
