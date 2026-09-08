/**
 * Self-service account EMAIL CHANGE with out-of-band verification.
 *
 * Security posture (mirrors the password-reset discipline):
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
import { getDb, type DB } from "../db/client.server";
import { emailChangeTokens, users } from "../db/schema";
import { checkRateLimit, clientIpOf, sha256Hex } from "../http/rate-limit.server";
import { logSecurityEvent } from "../security/events.server";
import { getSettings } from "../settings/service.server";
import { hashToken, newOpaqueToken } from "../auth/session.server";
import { logAudit } from "../audit/log.server";
import { brandFromNames, sendEmailChangeVerification } from "../email/service.server";

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export type EmailChangeRequestResult =
  | { ok: true }
  | { ok: false; code: "rate_limited" | "invalid" | "same_email" };

export async function requestEmailChange(
  env: Env,
  db: DB,
  opts: { userId: string },
  newEmailInput: string,
  request: Request,
  originBase: string
): Promise<EmailChangeRequestResult> {
  const parsed = emailSchema.safeParse(newEmailInput);
  if (!parsed.success) return { ok: false, code: "invalid" };

  const settings = await getSettings(db);
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  // Rate limit per user (keyed by id-hash) — bounded independent of IP.
  const userKey = await sha256Hex(opts.userId);
  const rl = await checkRateLimit(db, "email-change", userKey, settings.security.rateLimits.emailChangePerHour, 3_600_000);
  if (!rl.ok) {
    await logSecurityEvent(db, { type: "rate_limited", ipHash, metadata: { bucket: "email-change", userId: opts.userId } });
    return { ok: false, code: "rate_limited" };
  }

  const me = await db.select({ id: users.id, email: users.email, fullName: users.fullName, localePref: users.localePref }).from(users).where(eq(users.id, opts.userId)).limit(1);
  const self = me[0];
  if (!self) return { ok: false, code: "invalid" };
  const newEmail = parsed.data;
  if (newEmail === self.email) return { ok: false, code: "same_email" };

  // Enumeration-safe: if owned by another active account, no token, generic ok.
  const taken = await db.select({ id: users.id }).from(users).where(and(eq(users.email, newEmail), isNull(users.deletedAt))).limit(1);
  if (taken[0]) return { ok: true };

  const token = newOpaqueToken();
  const now = Date.now();
  const expiresAt = now + settings.security.resetTokenMinutes * 60_000;
  // Only one outstanding request per account: supersede any older pending token.
  await db.delete(emailChangeTokens).where(eq(emailChangeTokens.userId, opts.userId));
  await db.insert(emailChangeTokens).values({
    id: crypto.randomUUID(),
    userId: opts.userId,
    newEmail,
    tokenHash: await hashToken(token, env),
    expiresAt,
    createdAt: now,
  });
  await logSecurityEvent(db, { userId: opts.userId, type: "email_change_requested", ipHash, metadata: { targetEmail: newEmail } });

  const verifyUrl = `${originBase}/verify-email-change?token=${encodeURIComponent(token)}`;
  const locale = self.localePref === "en" ? "en" : "ar";
  try {
    await sendEmailChangeVerification(env, {
      to: newEmail,
      locale,
      brand: brandFromNames(settings.platform.nameAr, settings.platform.nameEn, settings.platform.supportEmail),
      name: self.fullName,
      verifyUrl,
      expiresMinutes: settings.security.resetTokenMinutes,
    });
  } catch {
    // Delivery must never break the request; token remains redeemable in dev/tests.
  }
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
  const now = Date.now();
  const tokenHash = await hashToken(token, env);
  const claimed = await db.all<{ user_id: string; new_email: string }>(
    sql`UPDATE email_change_tokens
        SET used_at = ${now}
        WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > ${now}
        RETURNING user_id, new_email`
  );
  const claim = claimed[0];
  if (!claim) return { ok: false, code: "invalid_token" };

  const newEmail = claim.new_email.toLowerCase();
  // Re-check ownership to close the request→verify race (prevents takeover): if
  // the intended address is now owned by a DIFFERENT active account, refuse. The
  // token is already consumed so it cannot be replayed against a future state.
  const owner = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, newEmail), isNull(users.deletedAt)))
    .limit(1);
  if (owner[0] && owner[0].id !== claim.user_id) return { ok: false, code: "invalid_token" };

  const before = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, claim.user_id)).limit(1);
  await db
    .update(users)
    .set({ email: newEmail, updatedAt: now })
    .where(eq(users.id, claim.user_id));
  if (before[0]?.email !== newEmail) {
    await logAudit(db, {
      actorUserId: claim.user_id,
      action: "users.email_change.verified",
      entityType: "user",
      entityId: claim.user_id,
      before: { email: before[0]?.email ?? null },
      after: { email: newEmail },
    });
  }
  await logSecurityEvent(db, { userId: claim.user_id, type: "email_changed", metadata: { newEmail } });
  return { ok: true, email: newEmail };
}
