# Security Model

> Status: **implemented security model, audited 2026-09-15.** Controls still
> dependent on owner/provider configuration are called out explicitly; this file
> is not evidence that Resend, DNS, or Cloudflare production resources are live.

## 1. Principles

1. Server-side authority for every decision (authz, entitlement, exam timing, payment confirmation, replay limits).
2. Deny by default; fail closed (errors never open access).
3. No secrets in code, client bundles, logs, or error pages — `wrangler secret` + `.dev.vars` (gitignored) only.
4. Never store card numbers, CVV, or credentials we don't need. We store no card data at all — gateways do.
5. Layered deterrence with honest claims: device limits reduce account sharing; nothing stops screen recording.

## 2. Authentication (P1)

- PBKDF2-SHA256, **100,000 iterations** (default), 16-byte random salt per user, via WebCrypto (constant-time compare). Upgradable hash params versioned in the hash string (`pbkdf2$sha256$100000$salt$hash`). The 100k default is a **deliberate operational choice** for the Workers free plan's CPU budget (see the `AUTH_PBKDF2_ITERATIONS` note in DEPLOYMENT.md §3 and the inline rationale in `server/auth/password.server.ts`); OWASP's 600k guidance applies once the platform is on a paid plan — raising the iteration count requires only setting `AUTH_PBKDF2_ITERATIONS` (existing hashes transparently rehash on next login). The setting is clamped to a safe range (50k–2M).
- Opaque session tokens: 256-bit CSPRNG, only pepper-keyed SHA-256 hashes stored; `__Host-edu_session` is `HttpOnly; Secure; SameSite=Lax; Path=/` and cannot be set with a parent-domain scope.
- Session expiry sliding 30d (setting `security.session_days`); absolute cap 180d. Logout & password change revoke sessions (password change: all devices).
- Login/register/forgot throttled per-IP and per-account (D1 fixed-window counters) with progressive delay; failures → `security_events`.
- Password reset: 256-bit CSPRNG token, peppered hash at rest, 10–30 minute DB expiry (default 30), one active link per user, single-use conditional claim, password update + session revocation + token claim in one D1 transaction. Links carry the bearer in a URL fragment; client code removes it before exchanging it for a 15-minute `HttpOnly` `__Host-edu_reset` cookie. The public forgot response is always `{ sent: true }` and never contains token/provider state. See §17.
- Enumeration resistance: forgot-password has the same response for malformed, unknown, throttled, provider-failed, and known addresses and enforces a 250 ms minimum service time. Unknown-email login performs PBKDF2-class dummy work; login failures remain uniform.

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
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, and a restrictive `Permissions-Policy`: camera/microphone/geolocation/payment/USB are disabled; fullscreen is limited to self and the allowlisted `youtube-nocookie.com` player. Every response to a request carrying a session cookie (HTML, React Router data, API, or redirect) is `private, no-store`; authentication routes are always `private, no-store`, and reset/email-verification routes are `no-referrer`.
- CSP includes `upgrade-insecure-requests` (never downgrade to http). CSP violation reporting (`report-to`/`report-uri`) is deferred until a report-collection endpoint exists — documented, not hidden.
- Cookies: always `Secure` + `HttpOnly` (session) + `SameSite=Lax`.

## 6. CSRF (P1)

All `POST`/`PUT`/`PATCH`/`DELETE` requests pass one root middleware gate. An exact `Origin` or `Referer` match is accepted; when privacy software omits both, only browser-controlled `Sec-Fetch-Site: same-origin` is accepted (`same-site` is rejected). Production compares against the configured HTTPS `APP_ORIGIN`, never a client-controlled Host header. `SameSite=Lax` cookies are a second layer. Only payment webhook resource paths are exempt, and those fail closed unless their provider signature validates.

## 7. Input validation & injection (all phases)

- Route actions use bounded Zod schemas or explicit allowlists before service calls; unknown/unsupported actions fail closed.
- SQL values use Drizzle parameters or D1 prepared-statement binds. Fixed internal SQL fragments are never built from request values.
- Output renders through React escaping; the CMS rich-text path uses a sanitizer allowlist before any HTML rendering.
- Uploads: request and per-kind size caps, normalized declared MIME, byte-signature validation before R2 writes, random storage keys, and replacement-kind checks. Buffered Worker uploads are capped at 50 MiB; larger media requires a future direct-to-R2/provider flow. Signature validation is not antivirus scanning, so downloaded student documents remain untrusted and should be scanned operationally if the threat model requires it.
- SSRF: admin-defined external URLs (if any) go through a validation allowlist; the server never fetches user-supplied URLs.

## 8. Protected media (P2/P4)

- Files: private R2 buckets are never public; short-TTL signed URLs (default 120s, verifier hard-cap 24h) are issued only after entitlement + per-file permission. HMAC covers file id + `perm` + expiry; tampering/id/permission swapping and expiry are 404-shaped. `download_allowed` controls attachment disposition. A strict RFC 7233 single-range parser supports closed/open/suffix ranges, clamps ends, and returns 416 for malformed/multiple/unsatisfiable requests. Private responses are `no-store` and `no-referrer`.
- Active-content sandboxing (H5, Phase 8): HTML-renderable uploads (SVG/HTML/XHTML) are served with `Content-Security-Policy: sandbox`, so a directly-navigated file can't execute scripts or touch the app origin (stored-XSS defense-in-depth). Subresource `<img>` rendering is unaffected (browsers ignore the response CSP in subresource contexts); SVG uploads remain permitted.
- Video: raw MP4/HLS is never exposed for protected content. `POST /api/playback/:videoId` re-checks entitlement on every mint (admins bypass; unentitled → 403; anonymous → 401). Mux credentials are RS256 JWTs signed server-side with the provider's 2048-bit RSA key; expiry is known asset duration + 30 minutes, four hours for unknown duration, and never over 24 hours because Mux stops segment requests at expiry. hls.js supports Chromium/Firefox/Android and native HLS supports Safari/iOS. A production-host playback restriction is a required owner/provider configuration step and its ID is embedded in each JWT. Mock video is development/test-only and uses scope-separated HMAC tokens.
- Progress beacons authenticate and rate-limit the user, require a lesson context, re-check lesson entitlement, and verify the exact video is attached to that lesson before writing. A client cannot authorize an arbitrary video by pairing it with an entitled lesson.

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
- Secret inventory is maintained in DEPLOYMENT.md (names only). `RESEND_API_KEY`, session pepper, file HMAC key, and Mux credentials are server bindings only; none use `VITE_`/`PUBLIC_` names or enter loader data/client bundles.
- Vendor credentials are least-privilege and environment-specific. Resend uses a dedicated production key; tests use capture transport and synthetic values only.

## 12. Audit & monitoring (P1 onward)

`audit_logs` (admin/content/price/permission/payment/code changes, before/after) · `security_events` (auth/device) · `payment_events` (webhook inbox) · Workers error logs. Searchable admin views (Phase 7).

## 13. Rate limiting & abuse (P1)

D1 fixed-window counters cover login, registration, forgot requests (IP + account), reset validation/completion (IP + token), email change, checkout, code redemption, payment confirmation, CMS forms, playback mint, progress beacons, and exam save/submit. Blocked counters saturate at `limit + 1` so repeated denied traffic does not keep writing the same D1 row. Recovery mail has an 80/day default real-account budget; all transactional mail shares an exact rolling 90-per-24-hour cap beneath Resend Free's owner-confirmed 100/day allowance. Welcome and email-change delivery are each capped at 20 so they cannot completely starve recovery. Limits are bounded in settings where appropriate. Distributed abuse still requires an owner-configured Cloudflare edge/WAF control before launch.

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
- Browser-based exams cannot be fully locked down; server timing, attempt limits, and randomization mitigate but do not eliminate cheating.
- File magic-byte checks prevent simple MIME spoofing but are not a malware scanner.
- Free-plan Worker CPU and D1 daily hard limits can cause availability failures; production metrics and controlled load/auth testing are mandatory.
- Resend capture tests prove application behavior, not DNS reputation or real delivery. Arbitrary-recipient delivery requires owner-verified SPF/DKIM sending-domain configuration.

## 17. Password recovery and Resend boundary

Recovery is deliberately split into a public generic request and a transient
bearer exchange:

1. `POST /forgot-password` validates and rate-limits without changing the public
   `{ sent: true }` shape. Unknown and known accounts have a 250 ms minimum
   service time.
2. For an eligible active account, issuance invalidates prior links and inserts
   one peppered token hash in a transactional D1 batch. A partial unique index
   enforces one unused token per user.
3. Native-fetch Resend delivery runs in `waitUntil`; upstream errors and response
   bodies are never returned/logged. If origin/provider/delivery/budget fails,
   that token is invalidated so an invisible credential is not left active.
4. The Arabic/RTL (or locale-appropriate English) message links to
   `/reset-password#token=…`. Fragments do not enter edge HTTP logs. Client code
   removes the fragment before a same-origin exchange and stores it only in a
   short-lived `HttpOnly; Secure; SameSite=Lax` host cookie. Query-carried tokens
   are rejected and redirected away.
5. Completion validates password policy and rate limits, then changes the hash,
   revokes every session, and claims the token in one D1 transaction. Conditional
   updates ensure concurrent submissions yield one success. The cookie is cleared
   on success/invalidity, and replay fails.

The test capture transport is selectable only in exact `ENVIRONMENT=test`; its
HTTP inbox has an additional constant-time secret gate and is absent from
production configuration. Resend's real key is never used in tests. Production
remains blocked until the owner verifies a sending domain, sets Wrangler secrets,
and performs a controlled delivery test. See `docs/DEPLOYMENT.md`.

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
