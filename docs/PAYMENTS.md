# Payments

> Status: **Phase 0 design.** Decision (ADR-007): **manual rail + activation codes first**.
> Gateway adapters (Paymob / Fawry / Stripe) ship only in Phase 6 **after** a verification ADR
> confirming current official API, Egypt availability, webhooks, signature scheme, and refunds.

## 1. Model

```
Cart/CTA → Order (pending)  ──►  Checkout via rail
   Order ◄── 1:N ── Payments (each: provider, status, reference)
   Verified "paid" (webhook OR admin approval) ──► ONE transaction:
        payments.status=paid, paid_at · order.status=paid · entitlements created (order_items spec)
        · subscription row (if plan) · events · notifications
```

Orders and Payments are separate: one order may have several payment attempts (failed card, then manual transfer). Entitlements are **never** created outside the verified transaction. Redirect/success pages grant nothing.

## 2. Payment states (state machine, enforced)

`pending → under_review → paid` (manual) · `pending → paid` (gateway webhook) · `pending → failed | cancelled | expired` · `paid → refunded | partially_refunded`. Illegal jumps are rejected by validation. Refunds adjust entitlements per policy (revoke if within window / keep if spent-time rule — admin-configurable).

## 3. Rails

### Manual (v1, Phase 6)
Student picks product → order created → payment `pending` shows **admin-configured instructions** (settings `payments.manual`: bank/Instapay/wallet details + reference code = order number) → student confirms submission → `under_review` → admin reviews evidence (screenshot/transfer ref) → approve (amount must match server-computed total) → transaction grants. Every step audited; approve requires admin role.

### Activation codes (v1, Phase 6)
Hashed storage; batches; `max_uses` (default 1) / single-use enforced by transactional redemption (`UNIQUE(code_id, student_id)` + conditional decrement); product/duration binding via `entitlement_spec`; disable/revoke + usage history in admin. Redemption from logged-in students only, rate-limited.

### Gateways (Phase 6+, verification-gated)
Candidates: **Paymob**, **Fawry** (Egypt-native), **Stripe** (only if owner's entity is in a supported country — to be confirmed). Verification record required per `DECISIONS.md`: official docs links, webhook signature scheme, sandbox availability, refund API, merchant onboarding prerequisites. Until recorded, no adapter code exists — and the interface below is the only contract:

```ts
interface PaymentProvider {
  readonly id: string;
  createCheckout(ctx: { order: Order; plan: PricePlan; returnUrl: string })
    : Promise<{ kind: 'redirect'; url: string } | { kind:'reference'; reference: string }>;
  verifyAndParseWebhook(request: Request): Promise<WebhookResult>; // signature-checked, provider_event_id
  fetchRemoteStatus(reference: string): Promise<PaymentStatusSnapshot>;  // server-side reconciliation
  refund?(reference: string, amountMinor: number): Promise<RefundResult>;
}
```

## 4. Records & reconciliation

`payments` (full state trail) · `payment_events` (webhook inbox: raw sanitized payload, signature validity, idempotent processing by `provider_event_id`) · `refunds` · daily reconciliation job (Phase 6): gateway `fetchRemoteStatus` sweep for `pending` payments older than TTL → auto-expire; mismatches flagged for admin (`under_review`). No card numbers/CVV ever stored — gateway-only.

## 5. Security requirements (details in SECURITY.md §9)

Signature verification before parsing; replay protection; amount taken from server-side order (never client); idempotency keys; admin approval audited; state machine validation; rate limits on checkout & code redemption.

## 6. Verification log (fill at Phase 6, one row per provider)

**Phase 6 outcome (2026-09-05):** NO real gateway was verified or integrated — per the verification gate above, no adapter code exists for any candidate. The production rails are **manual transfer** (live) and **activation codes** (live). A `mock` adapter (`server/payments/providers/mock.server.ts`, registered ONLY when the `MOCK_PAYMENTS_SECRET` binding is present — never in production) exercises the full gateway discipline in tests/dev: createCheckout → provider reference → HMAC-signed webhook → signature verification → idempotent `provider_event_id` inbox → verified fulfillment. The `PaymentProvider` interface below is the sole contract a future verified gateway must satisfy (ADR-024).

| Provider | Docs verified (date+links) | Egypt | Webhooks | Signature | Refunds | Decision |
|---|---|---|---|---|---|---|
| Paymob | — | — | — | — | — | pending |
| Fawry | — | — | — | — | — | pending |
| Stripe | — | — | — | — | — | pending (entity constraint) |
