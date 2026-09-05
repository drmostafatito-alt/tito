# Phase 6 Report — Commerce Engine

**Date:** 2026-09-05 · **Branch:** `main` · **Code commit:** `7cc2e44` (report commit follows)
**Verdict: DELIVERED.** `npm run verify` = PASS · cold smoke = **229/229** · fresh-DB migrations = 7/7 · no `git push` (sandbox rule).

The full completion journey runs end-to-end on the real worker runtime:
**Student → Login → Browse Product → Select Price → Checkout → Create Order → Payment Verification (manual rail) / Activation Code → Fulfillment → Entitlement Grant → Course Unlock → Access** — and the failure path **Rejected payment → No fulfillment → Still locked**. Both are asserted in integration tests AND in the live HTTP smoke (§16).

---

## 1. Implementation summary

| Area | What shipped |
|---|---|
| Schema | Migration `0006_flowery_tempest` — 15 commerce tables, unique guards, indexes, 7 `commerce.*` permission rows (additive only) |
| Engine | `server/commerce/service.server.ts` (~2,300 lines): products/prices, checkout, orders, manual rail, fulfillment, webhooks, refunds, activation codes, discounts, subscriptions, TTL sweeps, read models |
| Money | `server/commerce/money.ts` — pure, float-free integer minor units; code alphabet/generation |
| Providers | `server/payments/provider.ts` (interface + env-gated registry), `providers/manual.server.ts` (always on), `providers/mock.server.ts` (TEST-ONLY, bound by `MOCK_PAYMENTS_SECRET`) |
| Settings | `payments` group (manualEnabled, localized instructions, orderTtlMinutes, refundWindowDays) + super_admin UI in `/admin/appearance` system tab |
| Student routes | `/products/:slug` (public), `/checkout/:productSlug`, `/orders`, `/orders/:orderNumber`, `/activate`; buy CTAs on course + subject catalog pages |
| Admin routes | `/admin/commerce` (6-tab hub: products/orders/payments/subscriptions/codes/discounts), `/admin/commerce/products/:id`, `/admin/commerce/orders/:id`, `/admin/commerce/batches/:id` |
| Webhook | `POST /webhooks/payments/:provider` (resource route; GET 405, >64 KB 413, unknown provider 404, forged signature 400) |
| i18n | `commerce.*` (~90 keys) + `commerceAdmin.*` (~150 keys), ar+en parity (tsc-enforced); new `et()` fallback helper for dynamic error keys |
| Ops scripts | seed (+demo product/instructions), smoke (+§16, 36 checks), readiness gate (+commerce scans, perms floor 15→22) |

## 2. Reused architecture (nothing rebuilt)

- **Authorization:** purchases/activations write rows into the EXISTING `entitlements` table; access is decided ONLY by the existing `resolveContentAccess()` (ADR-009). No second entitlement system, no frontend access logic. Refund/pause/expiry revoke entitlement rows — every gate in Phases 2–5 honors it automatically.
- **RBAC/audit:** `requireRole` + `role_permissions` (`canCommerce`, rank≥4 bypass — the CMS/assessment model); `logAudit` with before/after on every admin commerce mutation.
- **Provider abstraction:** the VideoProvider pattern (ADR-007) applied to payments — registry keyed by env, vendor-neutral domain.
- **Idempotency discipline:** Phase 5's conditional-UPDATE claim pattern (compare-and-set + `meta.changes`) reused for payment/order transitions, fulfillment, discount claims and code redemption.
- **Infra:** settings groups (zod, audited), rate limiter (`checkout`, `payment_confirm`, `code_redeem` buckets), `sha256Hex`/HMAC helpers, resource-route discipline for the webhook, sweep-on-touch instead of cron (P5 pattern), `db.batch` single-roundtrip writes.

## 3. Products & pricing (DB-driven, nothing hardcoded)

- Products: kind `course|subject|bundle|subscription_plan`, bilingual names/descriptions, optional public thumbnail (validated app-ref), `active` + non-destructive `archived_at`, sort, metadata. Kind↔item binding enforced (course product = exactly one course item, etc.); content refs validated against real nodes (`CommerceReferenceError`); catalog edits never rewrite sold history (specs frozen per order item / per code).
- Prices: `amount_minor` INTEGER + separate `currency` (default EGP); `one_time|recurring` (recurring only on `subscription_plan` products); compare-at (display-only) and promo price with a server-evaluated window (`effectivePriceMinor` — boundary-exact, tested). Plans are created inactive until the admin activates them.
- Display: `/products/:slug` renders plans/prices from the DB; catalog CTAs resolve via `purchasableFor` (direct product or subject-level product covering a course; cheapest effective plan wins). Promo math, totals, discounts — all server-computed.

## 4. Orders & purchases

- Lifecycle: `created(pending) → paid → fulfilled` with `cancelled / expired / refunded / partially_refunded / failed` states; PAYMENTS.md §2 machines encoded as data (`PAYMENT_TRANSITIONS`/`ORDER_TRANSITIONS`) — illegal jumps throw.
- Every order links student, product (snapshot titles), price plan, currency, server-read amount, provider, provider/transfer reference, status, timestamps. One order → N payment attempts (rejected/expired attempts never block a retry; each retry is a NEW payment row).
- Checkout guards: authenticated; product active & unarchived; plan active & belongs to the product; content available (published nodes); `already_entitled` / `already_subscribed`; pending-order dedupe within TTL (double submit reuses the live order — one payment row); checkout rate-limited.
- Order numbers `EC-<base36>-<rand>` (UNIQUE, collision-retried); stale pending orders expire via `sweepExpiredOrders` (settings TTL, run on-touch in student loaders).

## 5. Payment provider abstraction & rails

- `PaymentProvider` = `createCheckout / verifyAndParseWebhook / fetchRemoteStatus / refund?` (the PAYMENTS.md contract). Domain code never references a vendor; no provider secret can reach the frontend.
- **Manual rail (production default, live):** order → pending payment with FROZEN instructions snapshot (reference = order number + localized admin-configured instructions from `settings.payments`) → student submits transfer reference (claim `pending→under_review`, evidence into `metadata`) → admin approves with the EXACT server total (`amount_mismatch` otherwise) or rejects with reason (→ `failed`; student may resubmit). Authenticated, authorized (`commerce.payments`), audited, idempotent at every step. **Submitting a reference grants nothing** (asserted in tests + smoke).
- **Mock gateway (tests/dev only):** registered solely when `MOCK_PAYMENTS_SECRET` is bound (integration tests, local `.dev.vars`); production never binds it ⇒ adapter inert, webhook path 404. It exercises the full gateway discipline: checkout reference → HMAC-signed webhook → verify → inbox → fulfill/flag.
- **No real gateway adapter exists** — none verified; PAYMENTS.md §6 log updated (ADR-024). Adding one later = one adapter file + registry entry + verification row.

## 6. Activation codes

- Generation: batches (≤500) bound to a product (frozen item grants) or direct grants, optional duration/expiry; codes `EDU-XXXX-XXXX-XXXX` from crypto RNG over a 31-char ambiguity-free alphabet (rejection-sampled); stored as SHA-256 of the normalized code + short prefix; **plaintext returned/displayed exactly once, never persisted or logged**.
- Redemption: logged-in students only, rate-limited; normalization (case/dash/space-insensitive); precise rejection reasons (`invalid / already_redeemed / disabled / revoked / exhausted / expired`); ATOMIC claim: conditional `use_count+1` UPDATE (`WHERE active ∧ use_count<max ∧ expiry-ok`, exhaustion folded into a CASE) + `UNIQUE(code_id, student_id)`; a unique-catch compensates `use_count−1`. **Concurrent race tested: two redeemers, one single-use code ⇒ exactly one winner, one grant set, `use_count=1`.**
- Admin: batch list/detail (uses/status/expiry per code + redemption history — the detail view leaks neither plaintext nor hashes), per-code disable/revoke/enable with terminal-state guards.

## 7. Entitlement integration (the critical requirement)

`fulfillPaid` is the ONLY grant path: conditional payment claim (`changes==0` ⇒ idempotent no-op) → one `db.batch`: order→paid, entitlement rows (`source_type order_item|subscription`; expiry = fixed date, plan period, or perpetual), subscription row for recurring plans (`plan_snapshot` embeds `orderId`), exactly-once `purchase` event. Tested matrix:

| Scenario | Result |
|---|---|
| No purchase → lesson | **Denied** (resolver) |
| Verified payment (admin approve / signed webhook) | **Allowed** — same `resolveContentAccess()` |
| Refund → entitlement revoked | **Denied** again; history kept |
| Subscription pause / period expiry sweep | **Denied** (revoked / expired) |
| Forced-SQL "fake paid" without fulfillment | **Denied** — paid status alone ≠ authorization |
| Double approve / webhook replay / double redeem | Exactly **one** grant, one event |

Grants are server-side only; redemption/approval UI is display of the resolver's verdicts.

## 8. Security (brief §16 — all explicitly tested)

- **Price tampering:** checkout parses `pricePlanId` only; amounts/currency fields are never read (route-level test posts `amountMinor=1&currency=USD` → DB order = server price; smoke asserts the same over HTTP).
- **Product tampering:** plan of another product / inactive plan → `price_unavailable`; archived/inactive product → `product_unavailable`.
- **Order IDOR:** `orderDetailForStudent` returns null for non-owners → loader/action 404-shaped (tested for both).
- **Fake paid:** forced `status='paid'` SQL yields NO entitlement (resolver reads entitlements only).
- **Webhook forgery:** signature verified BEFORE parsing; invalid → 400 + `signature_valid=0` inbox row; replay → 200 `duplicate` (UNIQUE provider_event_id); amount mismatch → flagged `under_review`, never auto-fulfilled; unknown provider → 404.
- **Activation race:** one-winner test (above).
- **Privilege separation:** students cannot verify payments, create products, alter prices or grant entitlements — `requireRole(3)` + `canCommerce` on every admin loader/action (route-level tests: student POSTs to approve → redirect, payment untouched); self-approval blocked in smoke.
- Discounts: hashed storage, generic `discount_invalid` (no existence oracle). Codes: hashed, no plaintext after generation. No card data anywhere (manual rail + gateway-reference model). Rate limits on checkout/confirm/redeem. Every admin mutation audited.

## 9. Database & migrations

- Existing schema checked first; the reserved `Commerce (P6)` block implemented as specified. `0006_flowery_tempest` is **additive** (no DROP/RENAME/destructive statement), identical in `drizzle/` + `migrations/` (+ manifest regenerated), with the permission seed appended (idempotent `INSERT OR IGNORE`).
- Uniqueness where duplication must be impossible: `orders.order_number`, `payment_events(provider, provider_event_id)`, `activation_codes.code_hash`, `discount_codes.code_hash`, `activation_code_redemptions(code_id, student_id)`, `product_items(product_id, resource_type, resource_id)`.
- Cross-domain refs (users/content/files) stay app-layer guarded per ADR-017; within-domain refs are real FKs.
- **Fresh-DB tested:** isolated `--persist-to /tmp` run applies all 7 entries ✅; integration suite re-applies all migrations to a cold DB every run.

## 10. Tests

- **Unit 94/94** (+18 `tests/unit/commerce.test.ts`): integer money (incl. the 0.1+0.2 artifact), floor/clamp discount math, both state machines (legal + illegal jumps), promo-window boundaries, period-end math, code normalization + 300-draw uniqueness/charset, all input contracts (entitlement spec, price plan consistency incl. float rejection, product kind binding, discount, batch).
- **Integration 152/152** (+56 `tests/integration/commerce.test.ts`, real D1 + real route loaders/actions): products/prices lifecycle & validation · checkout (server totals, frozen spec, instructions snapshot, dedupe, guards, route-level tampering, anon redirect) · manual rail (confirm grants nothing, ownership, mismatch, approve→grant→resolver, idempotent replay, reject→retry-new-row, fake-paid forgery, cancel, TTL sweep) · refunds (revoke→deny, window, idempotent, history) · activation codes (hash-only storage, all rejection reasons, **concurrent race**, route redeem, detail leaks nothing) · discounts (percent floor + redemptions, no oracle, limits) · webhooks (signed fulfill, forged 400, replay duplicate, mismatch flagged, failed event, unknown provider, route 405/400) · subscriptions (create/renew/cancel-keeps-access/pause-resume/expiry/refund) · RBAC+IDOR+catalog (hub redirect, canCommerce rows/bypass, order scoping, publicProductBySlug, purchasableFor, course-page CTA appears/disappears).

## 11. Full verify

`npm run verify` (lint:imports + tsc + unit + integration + production build) — **exit 0**: module boundaries clean, tsc 0 errors, unit 94/94, integration 152/152, client+SSR build green (only the pre-existing INEFFECTIVE_DYNAMIC_IMPORT note from Phase 5).

## 12. Smoke (live `wrangler dev`, cold seeded DB, fresh cookie jars)

**229/229** — all 193 Phase 1–5 regressions still green, + §16 (36 checks): admin hub → create product (course target) → create active plan (25000 minor = 250.00 EGP) → fresh buyer: RBAC redirect → locked course page shows buy CTA with the cheapest server-read price → product page 200 → checkout with tamper fields → 302 `/orders/EC-…` → order shows SERVER total 250.00 EGP (no `0.01`/`USD`) + reference = order number → pending order grants NO access → confirm → under_review → STILL no access → duplicate confirm rejected → admin queue shows order + evidence → wrong amount → `amount_mismatch`, nothing granted → exact approve → saved → replayed approve → alreadyProcessed → **lesson UNLOCKED via the same resolver** → CTA gone → my-orders lists it. Failure path: fresh student starts locked → checkout → confirm → admin **rejects** → still locked → self-approve blocked. Codes: batch generated (plaintext once) → redeem → unlocked → replay `already_redeemed` → fabricated code `invalid`. Webhook: GET 405, forged signature 400. Rate-limit section remains LAST.

## 13. Production safety

- No real payments, credentials or transactions anywhere: the only gateway is the binding-gated mock (inert without `MOCK_PAYMENTS_SECRET`); tests/smoke use the manual rail and the mock in isolation.
- No production data deletion; no destructive migration; no DB resets beyond local `.wrangler`/tmp state.
- Readiness gate hardened: demo/smoke products, mock-provider payments, demo-account orders and smoke code batches are deploy-blocking; verified BOTH directions (smoked dev DB → 6 FAIL exit 1 with the new commerce scans firing: demoOrders=2, demoBatches=1; fresh DB → commerce scans pass, only the 4 expected bootstrap checks fail). Admin permission floor now 22.
- `MOCK_PAYMENTS_SECRET` documented in `.dev.vars.example` + DEPLOYMENT.md §3 as dev/test-only. No secret values committed (`.dev.vars` gitignored). No `git push` performed.

## 14. Known limitations (documented, deliberate)

1. **No real payment gateway** — verification-gated by design (ADR-024); Paymob/Fawry/Stripe rows remain `pending` in PAYMENTS.md §6.
2. Refunds are **full only** in v1 (`partially_refunded` state exists in the machine; no partial-refund UI/flow yet).
3. Subscription renewal is **manual/admin-driven** (renew button + sweeps); no recurring billing rail exists without a real gateway.
4. Reconciliation is sweep-based (TTL expiry + mismatch flagging); `fetchRemoteStatus` on the mock reports `unknown` — a real daily reconciliation job arrives with the first verified gateway.
5. No cart (direct purchase only); no admin-created-orders UI (schema supports `source='admin'`); receipt = order detail page (no PDF invoices).
6. Dashboard "subscription expiry card" (FEATURE-SPEC §2) deferred to Phase 7 dashboard consolidation.
7. Code batch detail lists up to 500 codes / 200 redemptions (pagination deferred; batch sizes are capped at 500 anyway).

## 15. Remaining work (next phases)

- **Phase 7 (do not start without owner go-ahead):** admin platform consolidation incl. dashboard expiry card, notifications (purchase/rejection messages), analytics over commerce events, admin-created orders, partial refunds UI, first gateway verification (docs → ADR → adapter), real-device mobile matrix.
- Optional hardening: per-product discount `appliesTo` enforcement exists in schema/service input but the admin UI does not yet expose product-scoped discounts.

## 16. Commit

- **Phase 6 code + docs commit: `7cc2e44`** (59 files: schema/migration, services, providers, 11 routes + registry/nav, settings, i18n, scripts, tests, docs).
- This report is committed separately on top of it (see `git log`); HEAD of `main` at delivery = report commit.
- Verification at commit time: `npm run verify` exit 0 · smoke 229/229 (cold) · fresh-DB migrations 7/7 · readiness gate both directions. **No `git push`** (sandbox policy — owner pushes).
