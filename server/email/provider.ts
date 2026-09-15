/**
 * Server-only transactional-email adapters.
 *
 * Production uses Resend's HTTPS API through native fetch (Workers-compatible,
 * no Node SDK). Development/test transports are strict allowlists and can never
 * be selected by an unknown, preview, or production environment.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type EmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "invalid_address" | "send_failed" };

export interface EmailProvider {
  readonly id: string;
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface EmailEnvHints {
  EMAIL_PROVIDER?: string;
  ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

const SIMPLE_EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

function validRecipient(value: string): boolean {
  return value.length <= 254 && SIMPLE_EMAIL_RE.test(value);
}

export function validEmailSender(value: string): boolean {
  if (!value || value.length > 320 || /[\r\n\0]/.test(value)) return false;
  const angle = value.match(/<([^<>]+)>\s*$/);
  return validRecipient((angle?.[1] ?? value).trim());
}

export function validResendApiKey(value: string): boolean {
  return (
    /^re_[A-Za-z0-9_-]{21,197}$/.test(value) &&
    !/(?:fake|placeholder|replace|example|test[_-]?key)/i.test(value)
  );
}

export class NoopEmailProvider implements EmailProvider {
  readonly id = "noop";
  async send(_message: EmailMessage): Promise<EmailResult> {
    return { ok: false, reason: "not_configured" };
  }
}

/** Native-fetch Resend adapter. Error responses are intentionally never echoed. */
export class ResendEmailProvider implements EmailProvider {
  readonly id = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string
  ) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    if (!validRecipient(message.to) || !message.subject || !message.html) {
      return { ok: false, reason: "invalid_address" };
    }
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text ?? "",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok ? { ok: true } : { ok: false, reason: "send_failed" };
    } catch {
      // Never expose fetch errors: intermediaries can include request headers.
      return { ok: false, reason: "send_failed" };
    }
  }
}

/**
 * Select a channel fail-closed.
 * - resend: only when both server-only credentials are structurally valid
 * - log: explicit development only
 * - capture: explicit test only
 */
export function emailProvider(env: EmailEnvHints): EmailProvider {
  const provider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const environment = (env.ENVIRONMENT ?? "").trim().toLowerCase();

  if (provider === "resend") {
    const apiKey = (env.RESEND_API_KEY ?? "").trim();
    const from = (env.EMAIL_FROM ?? "").trim();
    if (validResendApiKey(apiKey) && validEmailSender(from)) {
      return new ResendEmailProvider(apiKey, from);
    }
    return new NoopEmailProvider();
  }
  if (provider === "log" && environment === "development") return new LogEmailProvider();
  if (provider === "capture" && environment === "test") return new CaptureEmailProvider();
  return new NoopEmailProvider();
}

class LogEmailProvider implements EmailProvider {
  readonly id = "log";
  async send(message: EmailMessage): Promise<EmailResult> {
    // Do not print body, recipient, or subject: any of them may contain private
    // account data. This channel is only a local delivery signal.
    console.info(`[email:log] accepted chars=${message.html.length}`);
    return { ok: true };
  }
}

/** In-memory test capture; never selectable outside ENVIRONMENT=test. */
const captureStore = new Map<string, EmailMessage[]>();

export function clearEmailCaptures(): void {
  captureStore.clear();
}

export function capturedEmails(to: string): EmailMessage[] {
  return (captureStore.get(to.toLowerCase()) ?? []).map((message) => ({ ...message }));
}

class CaptureEmailProvider implements EmailProvider {
  readonly id = "capture";
  async send(message: EmailMessage): Promise<EmailResult> {
    if (!validRecipient(message.to)) return { ok: false, reason: "invalid_address" };
    const key = message.to.toLowerCase();
    const list = captureStore.get(key) ?? [];
    list.push({ ...message, to: key });
    captureStore.set(key, list);
    return { ok: true };
  }
}
