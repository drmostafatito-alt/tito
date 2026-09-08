/**
 * High-level transactional email sender (server-only). Builds branded, localized
 * messages via templates.ts and dispatches them through the provider selected by
 * `EMAIL_PROVIDER`. Callers pass the resolved DB + env and an explicit locale.
 *
 * These helpers NEVER throw to signal a delivery problem and NEVER claim delivery
 * when the channel is not configured — they return a boolean that the caller may
 * ignore (the product flow must stay generic and functional regardless). This is
 * the boundary where "code complete" ends and "real provider provisioning" begins:
 * an OWNER must set EMAIL_PROVIDER + credentials + a from-address for production.
 */
import { emailProvider, type EmailResult } from "./provider";
import { resetPasswordEmail, welcomeEmail, emailChangeVerificationEmail, type EmailBrand, type EmailLocale } from "./templates";

export interface EmailEnv {
  EMAIL_PROVIDER?: string;
  ENVIRONMENT?: string;
}

export function brandFromNames(nameAr?: string | null, nameEn?: string | null, supportEmail?: string | null): EmailBrand {
  return {
    nameAr: nameAr ?? "د/ مصطفى تيتو",
    nameEn: nameEn ?? "Dr Mostafa Tito",
    supportEmail: supportEmail ?? null,
  };
}

function send(env: EmailEnv, message: { to: string; subject: string; html: string; text: string }): Promise<EmailResult> {
  return emailProvider(env).send({ to: message.to, subject: message.subject, html: message.html, text: message.text });
}

/** True when a delivery channel other than the fail-closed noop is configured. */
export function emailDeliveryConfigured(env: EmailEnv): boolean {
  return emailProvider(env).id !== "noop";
}

/** Send the password-reset email. Returns true only if a provider delivered it. */
export async function sendPasswordResetEmail(env: EmailEnv, input: {
  to: string;
  locale: EmailLocale;
  brand: EmailBrand;
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}): Promise<boolean> {
  const built = resetPasswordEmail(input);
  const res = await send(env, { to: input.to, ...built });
  return res.ok;
}

/** Send the welcome email after a committed registration. Returns true only if delivered. */
export async function sendWelcomeEmail(env: EmailEnv, input: {
  to: string;
  locale: EmailLocale;
  brand: EmailBrand;
  name: string;
}): Promise<boolean> {
  const built = welcomeEmail(input);
  const res = await send(env, { to: input.to, ...built });
  return res.ok;
}

/** Send the email-change verification email. Returns true only if delivered. */
export async function sendEmailChangeVerification(env: EmailEnv, input: {
  to: string;
  locale: EmailLocale;
  brand: EmailBrand;
  name: string;
  verifyUrl: string;
  expiresMinutes: number;
}): Promise<boolean> {
  const built = emailChangeVerificationEmail(input);
  const res = await send(env, { to: input.to, ...built });
  return res.ok;
}
