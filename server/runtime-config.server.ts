import { validEmailSender, validResendApiKey } from "./email/provider";
import { parseAppOrigin } from "./http/origin.server";

export type RuntimeConfigEnv = {
  ENVIRONMENT?: string;
  APP_ORIGIN?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  SESSION_PEPPER?: string;
  FILE_URL_SECRET?: string;
  MUX_TOKEN_ID?: string;
  MUX_TOKEN_SECRET?: string;
  MUX_SIGNING_KEY_ID?: string;
  MUX_SIGNING_PRIVATE_KEY?: string;
  MUX_PLAYBACK_RESTRICTION_ID?: string;
  AUTH_PBKDF2_ITERATIONS?: string;
  MOCK_VIDEO_SECRET?: string;
  MOCK_PAYMENTS_SECRET?: string;
};

const PLACEHOLDER = /(?:placeholder|replace(?:[-_ ]?me)?|changeme|example|dummy|your[-_ ])/i;

function strongSecret(value: string | undefined, minLength = 32): boolean {
  const raw = (value ?? "").trim();
  return raw.length >= minLength && raw.length <= 8_192 && !PLACEHOLDER.test(raw);
}

function realProductionOrigin(value: string | undefined): boolean {
  const origin = parseAppOrigin(value, false);
  if (!origin) return false;
  const host = new URL(origin).hostname.toLowerCase();
  return (
    host !== "localhost" &&
    host !== "example.com" &&
    host !== "example.org" &&
    host !== "example.net" &&
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) &&
    !host.startsWith("[") &&
    !host.endsWith(".localhost") &&
    !host.endsWith(".local") &&
    !host.endsWith(".test") &&
    !host.endsWith(".example")
  );
}

/**
 * Runtime backstop for dashboard drift and bypassed deployment scripts.
 * Unknown environments are production-like and fail closed; only explicit
 * development/test modes may run without real production credentials.
 * Returned strings are field names/reasons only and never contain secret values.
 */
export function productionRuntimeConfigErrors(env: RuntimeConfigEnv): string[] {
  const environment = (env.ENVIRONMENT ?? "").trim().toLowerCase();
  if (environment === "development" || environment === "test") return [];

  const errors: string[] = [];
  if (environment !== "production") errors.push("ENVIRONMENT");
  if (!realProductionOrigin(env.APP_ORIGIN)) errors.push("APP_ORIGIN");
  if ((env.EMAIL_PROVIDER ?? "").trim().toLowerCase() !== "resend") errors.push("EMAIL_PROVIDER");
  if (!validEmailSender((env.EMAIL_FROM ?? "").trim())) errors.push("EMAIL_FROM");
  if (!validResendApiKey((env.RESEND_API_KEY ?? "").trim())) errors.push("RESEND_API_KEY");
  if (!strongSecret(env.SESSION_PEPPER)) errors.push("SESSION_PEPPER");
  if (!strongSecret(env.FILE_URL_SECRET)) errors.push("FILE_URL_SECRET");
  if (
    strongSecret(env.SESSION_PEPPER) &&
    strongSecret(env.FILE_URL_SECRET) &&
    env.SESSION_PEPPER === env.FILE_URL_SECRET
  ) {
    errors.push("SECRET_REUSE");
  }
  if (!strongSecret(env.MUX_TOKEN_ID, 6)) errors.push("MUX_TOKEN_ID");
  if (!strongSecret(env.MUX_TOKEN_SECRET, 20)) errors.push("MUX_TOKEN_SECRET");
  if (!strongSecret(env.MUX_SIGNING_KEY_ID, 6)) errors.push("MUX_SIGNING_KEY_ID");
  if (!strongSecret(env.MUX_SIGNING_PRIVATE_KEY, 64)) errors.push("MUX_SIGNING_PRIVATE_KEY");
  if (!strongSecret(env.MUX_PLAYBACK_RESTRICTION_ID, 6)) errors.push("MUX_PLAYBACK_RESTRICTION_ID");
  if ((env.MOCK_VIDEO_SECRET ?? "").trim()) errors.push("MOCK_VIDEO_SECRET");
  if ((env.MOCK_PAYMENTS_SECRET ?? "").trim()) errors.push("MOCK_PAYMENTS_SECRET");

  const iterations = Number(env.AUTH_PBKDF2_ITERATIONS);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
    errors.push("AUTH_PBKDF2_ITERATIONS");
  }
  return errors;
}
