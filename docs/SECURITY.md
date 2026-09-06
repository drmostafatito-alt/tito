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

- PBKDF2-SHA256, **100,000 iterations** (default), 16-byte random salt per user, via WebCrypto (constant-time compare). Upgradable hash params versioned in the hash string (`pbkdf2$sha256$100000$salt$hash`). The 100k default is a **deliberate operational choice** for the Workers free plan's CPU budget (see the `AUTH_PBKDF2_ITERATIONS` note in DEPLOYMENT.md §3 and the inline rationale in `server/auth/password.server.ts`); OWASP's 600k guidance applies once the platform is on a paid plan — raising the iteration count requires only setting `AUTH_PBKDF2_ITERATIONS` (existing hashes transparently rehash on next login). The setting is clamped to a safe range (50k–2M).
- Opaque session tokens: 256-bit CSPRNG, only SHA-256 hashes stored; cookie `HttpOnly; Secure; SameSite=Lax`.
- Session expiry sliding 30d (setting `security.session_days`); absolute cap 180d. Logout & password change revoke sessions (password change: all devices).
- Login/register/forgot throttled per-IP and per-account (D1 fixed-window counters) with progressive delay; failures → `security_events`.
- Password reset: single-use token (hashed, 60-min TTL); reset also revokes all sessions. **Email delivery is NOT implemented yet** (verification-gated, ADR-024 discipline) — the raw token is exposed **only** in an explicit development context (`ENVIRONMENT=development` or `EXPOSE_DEV_RESET_TOKEN=true`) for local testing; any unknown/missing configuration fails closed (token never returned). See §17 for the C1 hardening.
- Enumeration resistance: register/login/reset responses are uniform in shape and timing where practical.

## 3. Sessions, devices, account-sharing deterrence (P1/P4)

- Device identity = random key in a durable cookie (+ localStorage fallback), hashed at rest; sessions are bound to device rows. Logout alone does **not** free a device slot (policy-driven).
- Settings: `devices.max_per_student` (default 1), `devices.on_limit` (block | replace_oldest), `devices.change_limit_per_30d`, `devices.replace_enabled`.
- Anomaly heuristics: rapid IP/ASN changes, many device additions, impossible travel (coarse) → `security_events` + optional admin review queue.
- Admin: force logout, revoke device, reset device list, per-student session/device history.

## 4. Authorization (P1 core; grows P2–P6)

- RBAC route guards server-side in layouts; teacher/admin permission matrix in settings (super_admin editable).
- Entitlement resolver is the single source of resource access truth (see ARCHITECTURE §7); exhaustive unit tests are the proof, including: expired entitlement, revoked subscription, unpublished content, free_preview scope, plan coverage.
- Admin actions require admin session + are audit-logged with before/after.

## 5. Transport & headers (P1)

- HTTPS only (Cloudflare); HSTS at edge; redirects to canonical domain.
- CSP: `default-src 'self'`; `media-src 'self' https://stream.mux.com blob:`; `img-src 'self' data: https://image.mux.com`; `script-src 'self'`; `style-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`. App-authored markup never uses inline scripts/styles (design system enforces this); reviewed whenever a provider is added.
- CSP nonce for framework hydration scripts (W4): React Router v7 emits a small set of inline `<script>` tags (hydration context, streaming, module bootstrap) that carry no `src`, so a strict `script-src 'self'` blocks them. In production these are whitelisted with a **per-request CSP nonce** (`crypto.randomUUID()`, seeded once per request in `workers/app.ts`, surfaced via `server/csp.server.ts` and applied to the header in `app/root.tsx` middleware and to the inline scripts via `<ServerRouter nonce>`). `script-src` becomes `'self' 'nonce-<v>'` — `'unsafe-inline'` is **never** used in production; it is retained only for the Vite HMR client in local dev. The nonce is not user-controllable, never hardcoded, and grants nothing beyond the trusted server-rendered scripts of that one response. See §18 for the W4 E2E-discovered regression and its fix.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera=(), microphone=(), geolocation=()), `Cross-Origin-Opener-Policy: same-origin`.
- CSP includes `upgrade-insecure-requests` (never downgrade to http). CSP violation reporting (`report-to`/`report-uri`) is deferred until a report-collection endpoint exists — documented, not hidden.
- Cookies: always `Secure` + `HttpOnly` (session) + `SameSite=Lax`.

## 6. CSRF (P1)

Mutations require same-origin evidence: `Origin`/`Sec-Fetch-Site` check in middleware for all non-GET route requests; reject mismatches. (SameSite=Lax is the second layer.) Webhook resource routes are exempt by design but demand provider signatures instead.

## 7. Input validation & injection (all phases)

- Zod schemas at every action boundary; unknown keys stripped.
- All SQL via Drizzle (parameterized). No string-concatenated SQL anywhere.
- Output rendered through React escaping; `dangerouslySetInnerHTML` banned by lint (admin `custom_markdown` block renders a sanitized allowlist subset).
- Uploads: size caps per kind, MIME sniffing (not extension trust), image re-encode, PDF/images only for study material, stored under random R2 keys with no user-controlled path parts.
- SSRF: admin-defined external URLs (if any) go through a validation allowlist; the server never fetches user-supplied URLs.

## 8. Protected media (P2/P4)

- Files: R2 `private-files` never public; short-TTL signed URLs (setting `video.fileUrlTtlSeconds`, shipped default **120s**) issued only after entitlement + per-file permission. The HMAC covers file id + `perm` (view|download) + expiry: tampering, id-swapping, perm-swapping, or expiry all produce the same 404-shaped response (no existence/permission oracle). `download_allowed` decides `attachment` vs `inline` disposition; Range requests served (206); responses `no-store`. *Verified live in Phase 2 smoke §5.*
- Active-content sandboxing (H5, Phase 8): HTML-renderable uploads (SVG/HTML/XHTML) are served with `Content-Security-Policy: sandbox`, so a directly-navigated file can't execute scripts or touch the app origin (stored-XSS defense-in-depth). Subresource `<img>` rendering is unaffected (browsers ignore the response CSP in subresource contexts); SVG uploads remain permitted.
- Video: raw MP4/HLS never exposed for protected content. Playback requires server-minted provider credentials (Mux signed JWT / mock HMAC token, ≤45s TTL, settings-capped ≤60s) via `POST /api/playback/:videoId` — entitlement re-checked server-side on EVERY mint; admins bypass; unentitled → 403; anonymous → 401. Playback restrictions (domain allowlist) configured at the provider. Mock provider mimics the same token discipline in dev, with playback/thumbnail scope separation (cross-scope tokens rejected). *Verified live in Phase 2 smoke §6/§7/§10.*
- Progress beacons authenticate the session and validate the video is entitlement-covered before writing.

## 9. Payments security (P6)

- Webhooks: signature verification per provider's official scheme (scheme recorded in `PAYMENTS.md` verification ADR before the adapter ships); replay protection via unique `provider_event_id`; every event stored raw (sanitized) in `payment_events` and processed idempotently.
- Grant path: signature-verified webhook **or** explicit admin approval → single transaction (`payments.status='paid'` + entitlements). No grant from any redirect/success page.
- Manual rail: admin approval requires admin role + is audit-logged; amount and order are server-computed.
- Idempotency keys on checkout initiation; state machine transitions validated (never jump to `paid` from `expired`, etc.).

## 10. Exam integrity (P5)

- Server timestamps + `deadline_at`; client timer is cosmetic; submissions after deadline+grace are rejected or flagged per exam policy.
- One live attempt per exam (partial unique index); submission idempotent via attempt status machine; autosave versioned per question.
- Question/answer payloads for an in-progress attempt never include correct-answer flags (grading data stays server-side).

## 11. Secrets & configuration (P1)

- Local: `.dev.vars` (gitignored, example committed). Deployed: `wrangler secret put`. No secrets in D1, settings, or client.
- Secret inventory maintained in DEPLOYMENT.md (names only, never values).
- Vendor credentials least-privilege where the provider allows (e.g., Mux token scoped to one environment).

## 12. Audit & monitoring (P1 onward)

`audit_logs` (admin/content/price/permission/payment/code changes, before/after) · `security_events` (auth/device) · `payment_events` (webhook inbox) · Workers error logs. Searchable admin views (Phase 7).

## 13. Rate limiting & abuse (P1)

D1 fixed-window counters per route+IP and per route+account on: login, register, forgot/reset, checkout, code redemption, payment confirmation, CMS form submission, playback token mint (Phase 8), and exam save/submit (Phase 8). Limits admin-configurable (`security.rate_limits`). Cloudflare WAF rate rules noted as the scale-up path (documented, not assumed).

- Rate-limit bucketing trusts **only** `cf-connecting-ip` (set by the Cloudflare edge). `x-forwarded-for` is client-controlled and deliberately ignored so an attacker cannot rotate buckets to bypass limits (H4, Phase 8).

## 14. Backups & recovery (P7 rehearsal; policy from P1)

`wrangler d1 export` before every destructive migration (runbook in DEPLOYMENT.md); R2 lifecycle rules for masters; restore rehearsal in Phase 7. Backup → migrate → verify → deploy, never blind.

Phase 8 (W5) implemented the full backup/restore procedure and rehearsed it on
synthetic data: `scripts/backup.mjs` (D1 logical export + R2 object copy +
`manifest.json` inventory) and `scripts/restore.mjs` (wipe → schema → data → R2 →
integrity verification) — see docs/BACKUP-RESTORE.md. D1 export alone is not a
complete backup (it omits R2 object bytes). Restore is destructive and gated:
`--force` always, plus `EDUCORE_ALLOW_UNSAFE_RESTORE=1` for any remote target, so
a restore cannot hit production by accident (guards unit-tested in
`tests/unit/backup-safety.test.ts`).

## 15. CMS / page-builder security (P3 — audited at Stage 9)

- **No arbitrary execution**: admin input never becomes code. Rich text passes an HTMLRewriter allowlist sanitizer (script/style/iframe/form removed wholesale including content; unlisted tags unwrapped keeping text; `on*` attributes stripped; URLs via `safeHref` — `javascript:`/`data:`/insecure http rejected; `target=_blank` gets `rel="noopener"`). Icons are registry ids resolved to components — raw SVG/HTML never stored. Theme tokens are zod-validated and emitted only as CSS variables at `/theme.css` — no arbitrary CSS injection. Form behavior is declarative (field types + validation rules only); no server-side code execution path exists. CSP compatibility verified: no inline `style=` anywhere in CMS renderers.
- **Draft isolation**: public routes (`/`, `/p/:slug`) render ONLY `pages.published_snapshot` of `status='published'` pages; drafts/unpublished → 404. Draft preview (`/admin/cms/preview/:pageId`) requires admin session + `cms.read`; no public preview tokens exist.
- **Authorization**: every admin CMS route = `requireRole(3)` + granular `canCms` check (`cms.read/create/edit/publish/delete/manage_theme/manage_navigation/manage_forms/manage_seo`; super_admin bypass). Menu hrefs validated (`safeHref`) so navigation can't smuggle `javascript:` URIs; links to authenticated routes remain protected because authorization is enforced at those routes, never by hiding links.
- **Validation on every transition**: block props are zod-validated on create, update, AND publish (publish revalidates the whole tree; unsafe links rejected with `CmsValidationError`). Broken blocks fail publish loudly instead of rendering half-broken pages.
- **Image resolution**: `resolvePublicImageUrls` maps file ids ONLY through PUBLIC_ASSETS rows; private files remain behind the signed `/files/:id` path (Phase 2 discipline unchanged).
- **Form submissions**: rate-limited (10/hour per ipHash bucket `form-submit`), server-validated per field (required/type/options/consent/disabled), stored as sanitized JSON; visitor file uploads are NOT accepted (a File value degrades to its name — no storage write).
- **Audit**: every content/config mutation logs `audit_logs` (actor, action `cms.*`, entity, before/after where practical). Exceptions by design: idempotent bootstrap seeders (`seedCmsPermissions`, `seedSettingsDefaults`, `ensureMenu` container creation — no content) and visitor form submissions (the submission row itself is the record).

## 16. Honest limitations (acknowledged, not hidden)

- Device fingerprinting can be defeated by determined users; policy + audit is deterrence.
- Signed video URLs prevent casual hotlinking, not screen recording.
- No DRM in v1 (Mux DRM is a paid consideration; documented as a future option).
- Browser-based exams cannot be fully lock-down; we mitigate with server timing, attempt limits, randomization.

## 17. Password-reset token exposure (C1 — Phase 8 hardening)

The raw password-reset token is a full account-takeover credential, so its
exposure is governed by an **explicit allowlist, not a "!= production" check**:

- `server/auth/service.server.ts` → `shouldExposeDevResetToken(env)` returns the
  token **only** when `ENVIRONMENT === "development"` OR `EXPOSE_DEV_RESET_TOKEN === "true"`.
- **Unknown / missing configuration fails closed**: `ENVIRONMENT=production`,
  `staging`, `preview`, `undefined`, or any other value never returns the token.
  The `EXPOSE_DEV_RESET_TOKEN` flag must be exactly `"true"` to take effect.
- The forgot-password UI renders a reset link **only** when a token is actually
  returned; there is no other path that can surface the token.
- Defense-in-depth: `scripts/check-production-readiness.mjs` fails a deploy whose
  committed `wrangler.jsonc` opts into `EXPOSE_DEV_RESET_TOKEN` or a development
  `ENVIRONMENT`. The runtime guard in the auth service is the **primary** control;
  the readiness gate is not relied upon for runtime protection.
- Regression tests (`tests/integration/auth.test.ts` → "password reset token
  exposure (C1 — fail closed)") cover the production / staging / undefined /
  preview / development matrix, the explicit-flag opt-in, the not-exactly-"true"
  case, and assert the safe response carries no token material.

Until an email channel is verified and shipped (ADR-024 gate), password reset is
a **dev/testing-only flow**: in production the token is created but never
delivered, so reset is effectively inert rather than a leak surface.

## 18. CSP hydration-script regression (W4 E2E — confirmed production bug)

**Classification:** confirmed production bug, discovered by the Phase 8 W4
Playwright E2E suite. *Not* a dependency or misconfiguration — it is an
interaction between React Router v7's SSR output and a strict CSP.

**Root cause.** React Router v7 server-renders inline `<script>` tags (hydration
context, streaming bridge, module bootstrap) that have no `src`. The platform's
strict CSP (`script-src 'self'`, SECURITY.md §5) correctly blocks nonce-less
inline scripts, so those hydration scripts never ran.

**Affected flows.** Every authenticated surface — student dashboard, lesson/video
player, exam attempt, checkout, and the admin platform — plus the hydration of
the public pages. The failure was universal, not route-specific.

**Security / availability impact.** Availability: the server returned the full,
correctly-rendered HTML, but the client bundle never hydrated, so the app was
visibly present yet completely non-interactive (no forms, no video player, no
exam, no admin actions). No data exposure resulted. The silent nature of the
failure (browsers log a CSP violation but the *absence* of a script is easy to
miss) is what let it reach an otherwise-green test pass.

**Fix (no CSP weakening).** A per-request nonce is generated once per request in
`workers/app.ts` (`crypto.randomUUID()`, 32 hex), threaded through the
router-context key in `server/csp.server.ts`, emitted in the header by the
`app/root.tsx` middleware (`script-src 'self' 'nonce-<v>'`), and applied to the
inline scripts via `<ServerRouter nonce>` in `app/entry.server.tsx`. `'unsafe-inline'`
is never added in production; the policy is otherwise unchanged (no wildcards).

**Regression tests.**
- `tests/unit/security-headers.test.ts` — pins the exact policy shapes: production
  nonce-less stays `script-src 'self'`; nonce form is `'self' 'nonce-<v>'` with no
  `unsafe-inline`; dev-only `'unsafe-inline'`; no `*`/`unsafe-eval`; other headers
  unchanged.
- `tests/e2e/csp.spec.ts` — walks dashboard / lesson+video / exam intro / checkout /
  admin in a real Chromium and fails on any `script-src`/`style-src`/`connect-src`
  violation (the functional breakers), with a documented `font-src data:` cosmetic
  exception.
