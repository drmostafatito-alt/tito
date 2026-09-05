# Security Model

> Status: **Phase 0 baseline** — realized progressively; each control below lists the phase that
> implements it and the phase that tests it. This file is the security checklist of record.

## 1. Principles

1. Server-side authority for every decision (authz, entitlement, exam timing, payment confirmation, replay limits).
2. Deny by default; fail closed (errors never open access).
3. No secrets in code, client bundles, logs, or error pages — `wrangler secret` + `.dev.vars` (gitignored) only.
4. Never store card numbers, CVV, or credentials we don't need. We store no card data at all — gateways do.
5. Layered deterrence with honest claims: device limits reduce account sharing; nothing stops screen recording.

## 2. Authentication (P1)

- PBKDF2-SHA256, 600k iterations, 16-byte random salt per user, via WebCrypto (constant-time compare). Upgradable hash params versioned in the hash string (`pbkdf2$600000$salt$hash`).
- Opaque session tokens: 256-bit CSPRNG, only SHA-256 hashes stored; cookie `HttpOnly; Secure; SameSite=Lax`.
- Session expiry sliding 30d (setting `security.session_days`); absolute cap 180d. Logout & password change revoke sessions (password change: all devices).
- Login/register/forgot throttled per-IP and per-account (D1 fixed-window counters) with progressive delay; failures → `security_events`.
- Password reset: single-use token (hashed, 60-min TTL); reset also revokes all sessions.
- Enumeration resistance: register/login/reset responses are uniform in shape and timing where practical.

## 3. Sessions, devices, account-sharing deterrence (P1/P3)

- Device identity = random key in a durable cookie (+ localStorage fallback), hashed at rest; sessions are bound to device rows. Logout alone does **not** free a device slot (policy-driven).
- Settings: `devices.max_per_student` (default 1), `devices.on_limit` (block | replace_oldest), `devices.change_limit_per_30d`, `devices.replace_enabled`.
- Anomaly heuristics: rapid IP/ASN changes, many device additions, impossible travel (coarse) → `security_events` + optional admin review queue.
- Admin: force logout, revoke device, reset device list, per-student session/device history.

## 4. Authorization (P1 core; grows P2–P5)

- RBAC route guards server-side in layouts; teacher/admin permission matrix in settings (super_admin editable).
- Entitlement resolver is the single source of resource access truth (see ARCHITECTURE §7); exhaustive unit tests are the proof, including: expired entitlement, revoked subscription, unpublished content, free_preview scope, plan coverage.
- Admin actions require admin session + are audit-logged with before/after.

## 5. Transport & headers (P1)

- HTTPS only (Cloudflare); HSTS at edge; redirects to canonical domain.
- CSP: `default-src 'self'`; `media-src 'self' https://stream.mux.com blob:`; `img-src 'self' data: https://image.mux.com`; `script-src 'self'`; `style-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`. No inline scripts/styles (design system enforces this); reviewed whenever a provider is added.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera=(), microphone=(), geolocation=()), `Cross-Origin-Opener-Policy: same-origin`.
- Cookies: always `Secure` + `HttpOnly` (session) + `SameSite=Lax`.

## 6. CSRF (P1)

Mutations require same-origin evidence: `Origin`/`Sec-Fetch-Site` check in middleware for all non-GET route requests; reject mismatches. (SameSite=Lax is the second layer.) Webhook resource routes are exempt by design but demand provider signatures instead.

## 7. Input validation & injection (all phases)

- Zod schemas at every action boundary; unknown keys stripped.
- All SQL via Drizzle (parameterized). No string-concatenated SQL anywhere.
- Output rendered through React escaping; `dangerouslySetInnerHTML` banned by lint (admin `custom_markdown` block renders a sanitized allowlist subset).
- Uploads: size caps per kind, MIME sniffing (not extension trust), image re-encode, PDF/images only for study material, stored under random R2 keys with no user-controlled path parts.
- SSRF: admin-defined external URLs (if any) go through a validation allowlist; the server never fetches user-supplied URLs.

## 8. Protected media (P2/P3)

- Files: R2 `private-files` never public; short-TTL (default 5 min, setting) signed URLs issued only after entitlement + per-file permission (view vs download decided at signing: attachment disposition + download flag).
- Video: raw MP4/HLS never exposed for protected content. Playback requires server-minted provider credentials (Mux signed JWT ≤ 60s TTL) after entitlement + replay-policy checks. Playback restrictions (domain allowlist) configured at the provider. Mock provider mimics the same token discipline in dev.
- Progress beacons authenticate the session and validate the video is entitlement-covered before writing.

## 9. Payments security (P5)

- Webhooks: signature verification per provider's official scheme (scheme recorded in `PAYMENTS.md` verification ADR before the adapter ships); replay protection via unique `provider_event_id`; every event stored raw (sanitized) in `payment_events` and processed idempotently.
- Grant path: signature-verified webhook **or** explicit admin approval → single transaction (`payments.status='paid'` + entitlements). No grant from any redirect/success page.
- Manual rail: admin approval requires admin role + is audit-logged; amount and order are server-computed.
- Idempotency keys on checkout initiation; state machine transitions validated (never jump to `paid` from `expired`, etc.).

## 10. Exam integrity (P4)

- Server timestamps + `deadline_at`; client timer is cosmetic; submissions after deadline+grace are rejected or flagged per exam policy.
- One live attempt per exam (partial unique index); submission idempotent via attempt status machine; autosave versioned per question.
- Question/answer payloads for an in-progress attempt never include correct-answer flags (grading data stays server-side).

## 11. Secrets & configuration (P1)

- Local: `.dev.vars` (gitignored, example committed). Deployed: `wrangler secret put`. No secrets in D1, settings, or client.
- Secret inventory maintained in DEPLOYMENT.md (names only, never values).
- Vendor credentials least-privilege where the provider allows (e.g., Mux token scoped to one environment).

## 12. Audit & monitoring (P1 onward)

`audit_logs` (admin/content/price/permission/payment/code changes, before/after) · `security_events` (auth/device) · `payment_events` (webhook inbox) · Workers error logs. Searchable admin views (Phase 6).

## 13. Rate limiting & abuse (P1)

D1 fixed-window counters per route+IP and per route+account on: login, register, forgot/reset, checkout, code redemption, playback token mint, exam submit. Limits admin-configurable (`security.rate_limits`). Cloudflare WAF rate rules noted as the scale-up path (documented, not assumed).

## 14. Backups & recovery (P7 rehearsal; policy from P1)

`wrangler d1 export` before every destructive migration (runbook in DEPLOYMENT.md); R2 lifecycle rules for masters; restore rehearsal in Phase 7. Backup → migrate → verify → deploy, never blind.

## 15. Honest limitations (acknowledged, not hidden)

- Device fingerprinting can be defeated by determined users; policy + audit is deterrence.
- Signed video URLs prevent casual hotlinking, not screen recording.
- No DRM in v1 (Mux DRM is a paid consideration; documented as a future option).
- Browser-based exams cannot be fully lock-down; we mitigate with server timing, attempt limits, randomization.
