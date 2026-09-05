import { z } from "zod";
import { hmacSha256Hex, timingSafeEqualHex } from "../../crypto/hmac.server";
import type {
  CheckoutResult,
  PaymentProvider,
  PaymentStatusSnapshot,
  WebhookParseResult,
} from "../provider";

/**
 * MOCK gateway adapter — TEST-ONLY (PAYMENTS.md §3: no production adapter
 * exists before a verification ADR). Registered exclusively when the
 * MOCK_PAYMENTS_SECRET binding is present (integration tests / local dev);
 * production never binds it, so this adapter — and its webhook path — is
 * inert there. It exists to exercise the FULL gateway discipline end to end:
 * createCheckout → provider reference → signed webhook → signature check →
 * idempotent inbox processing → verified fulfillment. Forged/unsigned
 * webhooks are rejected and recorded with signature_valid=0.
 *
 * Webhook contract (simulated provider):
 *   POST /webhooks/payments/mock
 *   header  x-mock-signature: hex HMAC-SHA256(secret, rawBody)
 *   body    { provider_event_id, type: "payment.paid" | "payment.failed",
 *             reference, amount_minor, currency }
 */

export const MOCK_PROVIDER_ID = "mock";

const webhookBodySchema = z.object({
  provider_event_id: z.string().min(1).max(120),
  type: z.enum(["payment.paid", "payment.failed"]),
  reference: z.string().min(1).max(120),
  amount_minor: z.number().int().min(0),
  currency: z.string().length(3).optional(),
});

export async function signMockWebhook(secret: string, rawBody: string): Promise<string> {
  return hmacSha256Hex(secret, rawBody);
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = MOCK_PROVIDER_ID;

  constructor(private env: { MOCK_PAYMENTS_SECRET?: string }) {}

  private secret(): string {
    const secret = this.env.MOCK_PAYMENTS_SECRET;
    if (!secret) throw new Error("MOCK_PAYMENTS_SECRET not set");
    return secret;
  }

  async createCheckout(ctx: {
    order: { orderNumber: string; totalMinor: number };
    returnUrl: string;
  }): Promise<CheckoutResult> {
    // The simulated gateway "accepts" the order and returns its own reference
    // (a real gateway would return a redirect URL to its hosted checkout).
    return {
      kind: "reference",
      reference: `mockpay_${ctx.order.orderNumber}_${crypto.randomUUID().slice(0, 8)}`,
    };
  }

  async verifyAndParseWebhook(request: Request, rawBody: string): Promise<WebhookParseResult> {
    const signature = request.headers.get("x-mock-signature") ?? "";
    const expected = await signMockWebhook(this.secret(), rawBody);
    if (!timingSafeEqualHex(signature.toLowerCase(), expected)) {
      return {
        valid: false,
        providerEventId: null,
        eventType: "unknown",
        reference: null,
        amountMinor: null,
        currency: null,
        payload: { rejected: "invalid_signature" },
        reason: "invalid_signature",
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return {
        valid: false,
        providerEventId: null,
        eventType: "unknown",
        reference: null,
        amountMinor: null,
        currency: null,
        payload: { rejected: "invalid_json" },
        reason: "invalid_json",
      };
    }
    const parsed = webhookBodySchema.safeParse(json);
    if (!parsed.success) {
      return {
        valid: false,
        providerEventId: null,
        eventType: "unknown",
        reference: null,
        amountMinor: null,
        currency: null,
        payload: { rejected: "invalid_payload" },
        reason: "invalid_payload",
      };
    }
    const b = parsed.data;
    return {
      valid: true,
      providerEventId: b.provider_event_id,
      eventType: b.type,
      reference: b.reference,
      amountMinor: b.amount_minor,
      currency: b.currency ?? null,
      // sanitized: the validated fields only — never the raw provider blob
      payload: { type: b.type, reference: b.reference, amountMinor: b.amount_minor, currency: b.currency ?? null },
    };
  }

  async fetchRemoteStatus(_reference: string): Promise<PaymentStatusSnapshot> {
    // The mock keeps no remote state — reconciliation reports unknown and the
    // app-side TTL sweep handles expiry (PAYMENTS.md §4).
    return { status: "unknown", checkedAt: Date.now() };
  }
}
