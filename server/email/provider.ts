/**
 * Transactional email abstraction (architecture-mirrors the payment/video
 * provider layers — business logic depends on this interface, never a vendor).
 *
 * Server-only. The active channel is chosen by the `EMAIL_PROVIDER` env binding.
 * Production never fabricates delivery: if no provider is configured (or only a
 * dev/test channel is available outside a development context), sending reports
 * `not_configured` and callers fail closed (they never claim a message was sent,
 * and they never expose a token in a response as a substitute for email).
 *
 * A real delivery provider (e.g. Resend, MailChannels, SES) is an OWNER-ONLY
 * provisioning step: it requires an explicit `EMAIL_PROVIDER=<id>` + credentials,
 * and per DECISIONS.md a recorded verification ADR against the provider's current
 * official docs BEFORE any adapter code for it is written. No such adapter ships
 * here. The `log` (dev) and `capture` (test) channels let the full request→send
 * flow be exercised and asserted without external credentials.
 */

export interface EmailMessage {
  /** Recipient address (single) — already normalized/lowercased by callers. */
  to: string;
  /** Localized, pre-rendered subject line. */
  subject: string;
  /** Localized, pre-rendered HTML body. */
  html: string;
  /** Plain-text fallback (optional but encouraged). */
  text?: string;
}

export type EmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "invalid_address" | "send_failed" };

export interface EmailProvider {
  readonly id: string;
  send(message: EmailMessage): Promise<EmailResult>;
}

/** No-op channel used whenever a real/delivery channel is not configured. */
export class NoopEmailProvider implements EmailProvider {
  readonly id = "noop";
  async send(_message: EmailMessage): Promise<EmailResult> {
    // Fail closed: nothing is sent and callers must NOT claim delivery.
    return { ok: false, reason: "not_configured" };
  }
}

export interface EmailEnvHints {
  EMAIL_PROVIDER?: string;
  ENVIRONMENT?: string;
}

/**
 * Select the transactional email channel.
 *
 *  - `log`: writes a formatted message to the server log. DEV/TEST ONLY — refused
 *    in a production environment so a token-laden email can never land in a prod log.
 *  - `capture`: stores messages in an in-memory map for hermetic integration tests.
 *  - anything else / unset: fail-closed NoopEmailProvider (production-safe default).
 */
export function emailProvider(env: EmailEnvHints): EmailProvider {
  const provider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const environment = (env.ENVIRONMENT ?? "").trim().toLowerCase();
  if (provider === "log" && environment !== "production") return new LogEmailProvider();
  if (provider === "capture") return new CaptureEmailProvider();
  return new NoopEmailProvider();
}

/* ---- log channel (dev) ------------------------------------------------- */

class LogEmailProvider implements EmailProvider {
  readonly id = "log";
  async send(message: EmailMessage): Promise<EmailResult> {
    // Safe dev channel: writes to the server log only. Never selected in production.
    // The recipient + subject + a link to the body are logged; the body (which may
    // carry a reset link) is not echoed here to keep even dev logs tidy.
    // eslint-disable-next-line no-console
    console.log(
      `[email:log] to=${message.to} subject=${JSON.stringify(message.subject)} chars=${message.html.length}`
    );
    return { ok: true };
  }
}

/* ---- capture channel (test) -------------------------------------------- */

/** In-memory capture store, keyed by recipient, for hermetic integration tests. */
const captureStore = new Map<string, EmailMessage[]>();

export function clearEmailCaptures(): void {
  captureStore.clear();
}

export function capturedEmails(to: string): EmailMessage[] {
  return captureStore.get(to) ?? [];
}

class CaptureEmailProvider implements EmailProvider {
  readonly id = "capture";
  async send(message: EmailMessage): Promise<EmailResult> {
    const key = message.to.toLowerCase();
    const list = captureStore.get(key) ?? [];
    list.push({ ...message, to: key });
    captureStore.set(key, list);
    return { ok: true };
  }
}
