import type {
  CheckoutResult,
  PaymentProvider,
  PaymentStatusSnapshot,
  WebhookParseResult,
} from "../provider";

/**
 * Manual rail adapter (PAYMENTS.md §3 — the v1 production rail). The flow is
 * app-internal (no external API): checkout creates the pending payment with
 * the admin-configured instructions snapshot; the student confirms with a
 * transfer reference; an admin approves/rejects. This adapter exists so the
 * manual rail participates in the SAME provider contract as future gateways —
 * it has no webhooks and no remote status, and says so explicitly.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly id = "manual";

  async createCheckout(ctx: {
    order: { orderNumber: string };
    returnUrl: string;
  }): Promise<CheckoutResult> {
    // The reference the student pays against IS the order number (PAYMENTS.md §3).
    return { kind: "reference", reference: ctx.order.orderNumber };
  }

  async verifyAndParseWebhook(_request: Request, _rawBody: string): Promise<WebhookParseResult> {
    return {
      valid: false,
      providerEventId: null,
      eventType: "unknown",
      reference: null,
      amountMinor: null,
      currency: null,
      payload: { rejected: "manual_rail_has_no_webhooks" },
      reason: "not_supported",
    };
  }

  async fetchRemoteStatus(_reference: string): Promise<PaymentStatusSnapshot> {
    // No remote side to reconcile with — the app-side TTL sweep handles expiry.
    return { status: "unknown", checkedAt: Date.now() };
  }
}
