/**
 * PaymentProvider abstraction (PAYMENTS.md §3 — the ONLY gateway contract).
 * Server-only; provider SDK/HTTP calls live exclusively inside adapters.
 * Business logic (server/commerce) depends on this interface — never on a
 * vendor name. Per ADR-007 + PAYMENTS.md §6, NO production gateway adapter
 * exists until its verification row is filled (docs, Egypt availability,
 * webhook signature scheme, refunds). The `mock` adapter is test-only: it is
 * registered exclusively when the MOCK_PAYMENTS_SECRET binding is present
 * (integration tests / local dev), exactly like the mock video provider.
 */

export interface CheckoutOrderCtx {
  orderId: string;
  orderNumber: string;
  totalMinor: number;
  currency: string;
  /** display title of the first item (provider-side description) */
  titleEn: string;
}

export interface CheckoutResult {
  kind: "redirect" | "reference";
  /** kind=redirect: provider-hosted checkout URL */
  url?: string;
  /** kind=reference: provider/generated reference the student pays against */
  reference?: string;
}

export interface WebhookParseResult {
  /** signature verified AND payload structurally valid */
  valid: boolean;
  providerEventId: string | null;
  eventType: string;
  /** provider transaction reference to match against payments.reference */
  reference: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** sanitized payload for payment_events storage (no card data, ever) */
  payload: Record<string, unknown>;
  reason?: string;
}

export interface PaymentStatusSnapshot {
  status: "paid" | "pending" | "failed" | "unknown";
  amountMinor?: number;
  checkedAt: number;
}

export interface RefundResult {
  ok: boolean;
  providerRefundId?: string;
  reason?: string;
}

import { ManualPaymentProvider } from "./providers/manual.server";
import { MockPaymentProvider } from "./providers/mock.server";

export interface PaymentProvider {
  readonly id: string;

  /** Initiate a checkout with the provider (gateways). Manual rail returns its reference. */
  createCheckout(ctx: { order: CheckoutOrderCtx; returnUrl: string }): Promise<CheckoutResult>;

  /**
   * THE webhook security boundary: verifies the signature over the RAW body
   * before any parse. Never trusts unsigned/invalid payloads (SECURITY.md §9).
   */
  verifyAndParseWebhook(request: Request, rawBody: string): Promise<WebhookParseResult>;

  /** Server-side reconciliation of a pending payment (PAYMENTS.md §4 sweep). */
  fetchRemoteStatus(reference: string): Promise<PaymentStatusSnapshot>;

  refund?(reference: string, amountMinor: number): Promise<RefundResult>;
}

/** Provider adapters that can be selected for a checkout/webhook by id. */
export function paymentProviderRegistry(env: {
  MOCK_PAYMENTS_SECRET?: string;
}): Record<string, PaymentProvider> {
  const registry: Record<string, PaymentProvider> = {
    // The manual rail is always available (PAYMENTS.md §3 — the v1 production rail).
    manual: new ManualPaymentProvider(),
  };
  // The mock gateway exists ONLY when its test secret is bound — production
  // deployments never bind it, so /webhooks/payments/mock is inert (404).
  // Same discipline as the mock video provider (ADR-006 pattern).
  if (env.MOCK_PAYMENTS_SECRET) {
    registry.mock = new MockPaymentProvider(env);
  }
  return registry;
}
