# Pre-Deployment Security, Bug & Password-Recovery Audit — Dr Mostafa Tito

Audit date: 2026-09-15 · Branch: `arena/01a0a65f-tito` · Baseline: `origin/main` @ `1a0de72f1c2ea0bada977dc7492ce9259bae4e10`
Code under audit: commit `d218dc4` (this report is the only commit after it) · Deploy performed: **NO** (forbidden by scope)

---

## 1. Verdict

**SAFE TO DEPLOY — WITH OWNER ACTIONS (owner-managed infrastructure items only).**

No CRITICAL and no HIGH findings were found in code, configuration, dependencies, Git history or the live application surface. The one MEDIUM item (HSTS) and the LOW items below are documented, and the two LOW code defects found in this pass were fixed and re-verified. The remaining blockers are all owner-side infrastructure actions (Resend domain verification/DNS, production secrets/bindings, Cloudflare edge settings) that cannot be performed from the repository and are not code defects.

## 2. Scope & Method

Static code review of the full request path (routes → loaders/actions → service layer → Drizzle/D1/SQL → R2), plus:

- **Live probing** of a production build (`npm run build` + `wrangler dev` on the project's own test env file): headers, CSRF/origin gate, enumeration behaviour, token scrubbing, test-endpoint gating, signed-file rejection, method gating.
- **History-aware secret scanning** (`scripts/audit-secrets.mjs`, added in commit `9d423ae`): walks every blob of every commit via `git rev-list --objects --all` + `git cat-file --batch`, reports only kind/path/sha/length (never values).
- **Dependency audit** from the lockfile (`npm audit`, all severities).
- **Full test execution**: unit, integration (Workers runtime via `@cloudflare/vitest-plugin`), Playwright E2E, typecheck, lint, production build.
- **Targeted responsive sweep** at 320/360/390/768/1024/1440 px in LTR (en) and RTL (ar) across public, student and admin surfaces.

No production database, production migration, production secret, DNS record or deployment was touched.

## 3. Security Counts

| Severity | Found | Fixed in this pass | Open |
|---|---|---|---|
| CRITICAL | 0 | 0 | 0 |
| HIGH | 0 | 0 | 0 |
| MEDIUM | 1 | 0 | 1 (owner action) |
| LOW | 6 | 5 | 1 (accepted, documented) |
| INFO | 4 | — | — |

Finding details are in §4 (none for CRITICAL/HIGH), §5 (fixed) and §6 (open/informational).

## 4. Critical / High Findings

**None.** This is an evidence statement, not an opinion. The controls below were individually verified rather than assumed:

- Authentication: PBKDF2-SHA256 (100k default) with per-user 16-byte salt, `needsRehash` upgrade-on-login, timing-equalised unknown-user path, per-IP **and** per-identifier login throttling, `__Host-` prefixed HttpOnly cookies, 180-day absolute session cap with sliding refresh, session revocation reasons recorded.
- CSRF: framework-level origin check for document/action posts (400) **and** application middleware same-origin enforcement (403) on every other mutation; no unsigned mutation path exists; payment webhooks are signature-verified (HMAC) and deliberately exempt.
- Authorization: every `/admin/*` loader **and** action begins with `requireRole(context, request, 3)` plus a granular permission check; rank guard blocks acting on any peer/superior and on self; student IDOR attempts are redirected with no data; E2E asserts student → admin surfaces 4×.
- Injection: 100% Drizzle parameterisation for SQL; `dangerouslySetInnerHTML` only on the admin rich-text editor and CMS blocks rendered from **sanitised, publish-time-frozen** snapshots; uploaded filenames sanitised into R2 keys.
- Files: private objects require an HMAC signature (`perm`+`exp`+`sig`) over `FILE_URL_SECRET`; unsigned/forged → 404; `download` requires the `download_allowed` flag; byte-range parsing is RFC-7233 correct (206/416); HTML-renderable MIME types are served under a sandbox CSP.
- Commerce: server-authoritative pricing, single entitlement-granting path (`fulfillPaid`, atomic claim with `changes === 1`), webhook amount mismatch → `under_review` (never auto-fulfil), replay idempotency by `provider_event_id`, refunds revoke entitlements, activation codes stored only as hashes with atomic claim + unique-index race compensation.
- Secrets: no credential in the working tree or in any of the 109 commits; `.dev.vars` was never committed; the only env-shaped tracked file is the synthetic `tests/e2e/test.env`.
- Dependencies: `npm audit` → 0 vulnerabilities (info/low/moderate/high/critical).

## 5. Bugs Fixed (this pass)

All four layout defects shared one root cause: grid/flex children keep the CSS default `min-width: auto`, so they cannot shrink below their content's min-content width (file inputs, long `<select>` options, a non-wrapping button row), producing horizontal page scroll on narrow phones.

| # | Sev | Location | Issue | Evidence | Fix | Status |
|---|---|---|---|---|---|---|
| 1 | LOW | `app/routes/admin.cms.tsx:134` | CMS action-link row did not wrap → page 384 px wide at a 320 px viewport (64 px overflow) | Playwright sweep, `documentElement.scrollWidth` vs `innerWidth` | `flex flex-wrap gap-2` | FIXED — 0 px overflow at 320/360, LTR + RTL |
| 2 | LOW | `app/routes/admin.videos.tsx:129,138–201` | Ingest/YouTube form labels (`grid`, default `min-width:auto`) could not shrink; text + file inputs forced 49 px overflow | same | `min-w-0` on the grid items, `w-full min-w-0` on the shared input class | FIXED — 0 px |
| 3 | LOW | `app/routes/admin.entitlements.tsx:122,139–167` | Grant form: long `<select>` option text expanded the grid column → 45 px overflow | same | `min-w-0` + `w-full min-w-0` | FIXED — 0 px |
| 4 | LOW | `app/routes/admin.assignments.tsx:18–19,158–180` | Filter bar (`lg:grid-cols-12`) children with long course names → 49 px overflow | same | `min-w-0` on the columns, `w-full min-w-0` on the controls | FIXED — 0 px |
| 5 | LOW | `app/routes/api.mock-stream.$videoId.$file.tsx:27` | With `MOCK_VIDEO_SECRET` unbound (production), the public mock-stream URL threw inside `mockTokenSecret` → unhandled 500 instead of 404 | code path review | explicit `if (!env.MOCK_VIDEO_SECRET) return 404` | FIXED — plain 404, no throw |

Post-fix sweep: 28 admin/student routes measured at 320/360 px and 24 public/student/admin routes measured at 320–1440 px — all clean (LTR); the four originally broken screens plus three neighbours are also clean at 320/360 px in **RTL/Arabic**. No visual redesign: spacing/typography/colours unchanged; only shrink behaviour was corrected.

## 6. Findings Reported, Not Fixed

**MEDIUM-1 — HSTS is not emitted by the application (owner/edge action).**
`server/http/headers.server.ts` sets CSP (nonce-based), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `X-Frame-Options: DENY`, but no `Strict-Transport-Security`; `docs/SECURITY.md §5` deliberately delegates HSTS to the Cloudflare edge. Impact: without it, a first-visit downgrade/SSL-strip cannot be pinned by the browser. Status: **OWNER ACTION REQUIRED** (Cloudflare dashboard → SSL/TLS → Edge Certificates → Enable HSTS). Not changed in code because enabling `includeSubDomains` from the Worker without the owner's DNS state could break subdomains.

**LOW-6 — Registration reveals account existence (accepted, documented).**
`server/auth/service.server.ts` register path returns `email_taken` ("هذا البريد الإلكتروني مسجل بالفعل."), giving an account oracle at ≤5 requests/hour/IP (default `registerPerHour = 5`). Password recovery — where the brief mandates enumeration protection — is fully generic (verified live and in integration tests). Not changed: it is a deliberate UX trade-off and changing it would alter the registration contract and its tests; flagged for an owner decision (recommendation: keep, or switch to a generic "check your email" + notification email).

**INFO-1** — `noindex` for private/auth pages ships as `<meta name="robots">` (via `authPageMeta` / route `meta`) and `robots.txt` disallow; no `X-Robots-Tag` header. Adequate (crawlers honour meta), noted as defence-in-depth only.
**INFO-2** — after a password reset all sessions are revoked (`revoked_reason = 'password_reset'`) while the durable device-trust cookie (`__Host-edu_dk`) survives by design (ADR-005). A device cookie alone cannot authenticate; the policy is documented and intentional.
**INFO-3** — `scripts/seed.mjs` generates a fallback local admin password using `Math.random()` for its numeric suffix. Local seed only; `check-production-readiness` rejects the seeded identities (`@educore.local`, demo/smoke accounts) for production.
**INFO-4** — `Math.random()` in `rate-limit.server.ts` / `budget.server.ts` drives a 2 % probabilistic sweep only; no security decision depends on it.

## 7. Password Recovery — Flow & Implementation

The capability already existed and was extended, never duplicated (no second email system):

`/forgot-password` (form + "نسيت كلمة المرور؟" link on login) → `requestPasswordReset()` → D1 batch: invalidate every unused token for the user, insert the new one → Resend (`sendPasswordResetEmail`) → **HTTPS URL with the bearer in the URL fragment** (`/reset-password#token=…`) → client strips the fragment with `history.replaceState` and POSTs it once to `exchangeResetToken()` → server validates, marks it exchanged and returns `__Host-edu_reset` (HttpOnly, Secure, SameSite=Lax, 900 s) → `/reset-password` validates the cookie server-side → new password → `resetPassword()` single D1 batch → token consumed, sessions revoked → login with the new password.

Live confirmation (production build): `/reset-password?token=<43-char>` → `302` to the clean path (no query-carried credential survives); `GET /logout` → `405`; `/__test/email-capture` → `404` without/with a wrong `x-test-capture-secret`.

## 8. Password Recovery — Security Criteria

| Criterion | Evidence | Status |
|---|---|---|
| CSPRNG token | `newOpaqueToken()` = `crypto.getRandomValues(new Uint8Array(32))` → 43-char base64url | PASS |
| Sufficient entropy | 256 bits (unit test asserts shape/uniqueness over 500 draws) | PASS |
| Hashed storage only | store `SHA-256(SESSION_PEPPER ‖ token)`; plaintext never persisted | PASS |
| Short expiry | `resetTokenMinutes` (default 30; migration `0011` clamps ≤ 30) | PASS |
| Single use | claim conditioned on `used_at IS NULL` inside the completion batch | PASS |
| Previous-token invalidation | invalidating `UPDATE` + insert in one batch, plus partial unique index `password_reset_one_active_user_uq` | PASS |
| Brute-force protection | `resetAttemptsPer15Minutes` (10) per IP **and** per token | PASS |
| Request rate limiting | `forgotPerHour` 5/IP, `forgotPerAccountHour` 3/account, `resetEmailsPerDay` 80 (global 90/24 h ceiling vs Resend Free 100/day) | PASS |
| Enumeration protection | identical `{ok:true}` / `{sent:true}` for known, unknown, malformed, throttled and budget-exhausted; 250 ms response floor (verified live: byte-identical responses) | PASS |
| No password by email | email carries only the reset link + expiry copy | PASS |
| No token in logs/Referrer | fragment transport, `no-referrer` on `/reset-password`, security events store `userId`+`ipHash` only | PASS |
| No secret in the frontend | no `RESEND`/`VITE_` reference in client code; key is server-only; `check-deploy-config` rejects `TEST_CAPTURE_SECRET`/`MOCK_*` in production | PASS |
| HTTPS production URL | `applicationOrigin()` in production accepts only a valid HTTPS `APP_ORIGIN` (never the request Host) | PASS |
| Server-side validation | token shape + digest + expiry + status checked in the service, not the client | PASS |
| Safe password policy | min length + common-password rejection; same policy as registration | PASS |
| Atomic concurrency | one D1 batch (password update + session revocation + token claim) requiring `changes === 1`; concurrent loser rejected; covered by integration test | PASS |
| No oracle on failure | definite delivery failure marks the token used; provider errors never surfaced | PASS |

## 9. Password Recovery — Tests

- **Unit** (`tests/unit/reset-token.test.ts`, `password.test.ts`, `security-boundaries.test.ts`): token shape/length/charset, non-degeneracy, deterministic pepper-bound hashing, cookie extraction rules.
- **Integration** (`tests/integration/auth.test.ts`): known vs unknown email identical result, response-time floor, hash-only storage, previous-link invalidation, single active token, expired/replayed token rejection, one concurrent winner, issuance limit ≤5 captures from 7 attempts, exchange limit (11th → `rate_limited`), delivery-unavailable → token invalidated with no leak.
- **E2E** (`tests/e2e/password-recovery.spec.ts`, 3 tests + 2 setup): forgot → generic notice → captured email → 43-char token, RTL HTML, no brand leakage → fragment exchange → `__Host-edu_reset` flags → reset → `/login?reset=1` → old password rejected, new password logs in, replay shows the invalid-link alert with zero password inputs; email-change requires the current password and revokes sessions after verification.
- **No real Resend key is used anywhere in tests** (capture transport + synthetic secret only).

## 10. Resend Integration

Single existing abstraction extended (`server/email/{provider,service,templates,budget,test-capture}.server.ts`). Server-only `fetch` with a 10 s timeout is the **only** outbound call in the codebase — no SSRF surface. `NoopEmailProvider` unless `EMAIL_PROVIDER=resend` + a key matching `/^re_[A-Za-z0-9_-]{21,197}$/` + a valid `EMAIL_FROM`; capture transport only in `ENVIRONMENT=test` with a constant-time `x-test-capture-secret`. Free-plan budget 90 emails/24 h (reset 90, email change 20, welcome 20) enforced atomically in D1. HTML escaping is applied to every interpolated value (name, brand, URL).

**This audit did not send a real email and does not claim Resend delivery works**; the provider path is exercised only through the capture/mock transport.

## 11. Resend Owner Actions (OWNER ACTION REQUIRED)

1. Create/verify the sending domain in the Resend dashboard (free plan) and add the SPF + DKIM records it displays (and DMARC if the owner wants policy reporting) to DNS. *Do not invent values — use the dashboard's own records.*
2. Set `EMAIL_FROM` to an address on that verified domain (e.g. `no-reply@<verified-domain>`). `onboarding@resend.dev` is manual-testing only and can only reach the account owner's address.
3. Set `RESEND_API_KEY` as a Worker secret (`wrangler secret put RESEND_API_KEY`) — never in `wrangler.jsonc`, `.dev.vars` or any `VITE_*`/public variable.
4. Confirm `EMAIL_PROVIDER=resend` and `ENVIRONMENT=production`, then run `npm run check:deploy-config` and `node scripts/check-production-readiness.mjs --remote` before the first deploy.
5. After the first real deploy, send one password-reset to a controlled mailbox and confirm the link opens on the HTTPS origin (manual smoke test).

## 12. Environment Variables (names only — no values)

Required in production: `ENVIRONMENT`, `APP_ORIGIN`, `SESSION_PEPPER`, `AUTH_PBKDF2_ITERATIONS`, `FILE_URL_SECRET`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY`, `MUX_PLAYBACK_RESTRICTION_ID`.
Must be **absent** in production (the deploy gate rejects them): `TEST_CAPTURE_SECRET`, `MOCK_VIDEO_SECRET`, `MOCK_PAYMENTS_SECRET`, `EXPOSE_DEV_RESET_TOKEN`.
Local/seed only: `ADMIN_BOOTSTRAP_EMAIL` (bootstrap/seed paths refuse demo identities for production).
Bindings: `DB` (D1), `PUBLIC_ASSETS`, `PRIVATE_FILES`, `VIDEO_MASTERS` (R2).

## 13. Dependency Audit

`npm audit --audit-level=moderate` → **0 vulnerabilities**; full `npm audit --json` → `{info:0, low:0, moderate:0, high:0, critical:0, total:0}`. No dependency has a known advisory requiring an upgrade path, therefore no major-version upgrade was performed (blind upgrades are out of scope by instruction). `npm ci` is clean (232 packages, only upstream `@esbuild-kit/*` deprecation notices).

## 14. Authorization / IDOR / Privilege Escalation

- Every admin loader **and** action is rank-gated at 3+, then permission-gated (`canPlatform` / `canCms` / `canCommerce`); `canPlatform` requires rank ≥ 4 or rank-3 `role_permissions`.
- `rankGuard` refuses acting on any target whose rank is ≥ the actor's (covers self, peers and superiors); role changes require rank ≥ 4; delegation is audited.
- Student-facing data uses ownership-scoped queries; `orderDetailForStudent` returns a 404-shaped IDOR result for foreign orders (integration-tested), as do foreign payment-proof and assignment files.
- E2E (`security.spec.ts`): student → admin detail, audit viewer, commerce hub and security center all blocked; the global CSRF gate rejects missing/cross-origin mutation evidence; unknown playback never returns 200 and never leaks a stream URL.
- Hidden UI is never the boundary: all of the above is enforced in loaders/actions/services.

## 15. Files / Uploads / Downloads

Magic-byte validation before storage (pdf, jpeg, png, gif, webp, strict SVG, zip/7z/rar, OOXML/OLE2, text, mp4/mov ISO-BMFF, matroska, ogg, wav, mp3, aac); size caps (50 MiB pdf/audio/archive/video, 25 MiB doc, 10 MiB image, 52 MiB multipart); R2 keys built from a UUID plus a sanitised filename (no traversal/extension injection). Private objects are reachable only through signed URLs (`id|perm|exp` HMAC over `FILE_URL_SECRET`, TTL ≤ 86400 s), return `private, no-store` + `no-referrer`, and serve HTML-renderable types under a sandbox CSP. Public assets are separated into a different bucket binding and cached `max-age=3600`. Live probes: unsigned and forged-signature requests → 404.

## 16. Commerce / Payments / Entitlements

Server-authoritative pricing (checkout submits only a plan id); entitlement rows are inserted in exactly three audited places, all behind atomic claims; `approveManualPayment` (manual rail) remains the **only** path that grants entitlements for payments; webhook fulfilment re-verifies the amount against the order and flags mismatches instead of fulfilling; replays are idempotent by `provider_event_id`; refunds revoke entitlements and cancel subscriptions; activation codes are stored as hashes with `use_count < max_uses` claims and unique-index race compensation. Business model unchanged (cash / installments / InstaPay + proof upload + admin review + WhatsApp activation code); the `mock` gateway adapter is inert unless `MOCK_PAYMENTS_SECRET` is bound.

## 17. Web Hardening

CSRF/origin gate (two independent layers, verified live: no `Origin` → 403, foreign `Origin` → 400 from the framework check for document actions, foreign `Referer` → 403, `Sec-Fetch-Site: cross-site` → 403, same-origin → 200). No `Access-Control-Allow-*` header exists anywhere (same-origin only). Headers: nonce-based CSP with no `unsafe-inline`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`, `upgrade-insecure-requests`; `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`; COOP `same-origin`; restrictive `Permissions-Policy`; `private, no-store` on authenticated responses and `no-referrer` on token-bearing pages. Body caps 1 MiB default / 52 MiB for upload routes; webhook bodies streamed with a 64 KB cap. Errors are logged as class names only; no stack or route data reaches the client. Rate limiting is D1 fixed-window with a global sweep; client IP is taken only from `cf-connecting-ip`. Redirects use `safeLocalRedirect` (rejects `//`, backslashes, encoded slashes, control characters); the external exam platform accepts only HTTPS Google-Forms URLs rebuilt into a canonical embed.

## 18. SEO & Indexing

Sitemap is derived from live published state (no stale/draft/archived/private URLs, no query variants); robots.txt disallows admin, student, auth, files, api, beacons, webhooks and the test capture inbox, and exposes exactly one `Sitemap:` directive. Private and auth surfaces additionally carry `noindex` meta. Public pages emit canonical + OpenGraph from owner-editable CMS data (E2E asserts one localised title and OG set per page). No sensitive data (emails, tokens, internal ids) appears in structured data or sitemap output.

## 19. Tests — Unit / Integration / E2E

| Suite | Command | Result |
|---|---|---|
| Unit | `npm run test:unit` | **34 files / 382 tests passed** (exit 0) |
| Integration | `npm run test:integration` | **28 files / 305 tests passed** (exit 0) |
| E2E | `npx playwright test` | **86 tests passed (4.0 m)** (exit 0) |

E2E composition (86): rtl-mobile 9 · homepage 7 · security 6 · lesson-video 6 · catalog 6 · auth 6 · accessibility 6 · csp 5 · cms-builder 5 · admin 5 · question-platform 4 · seo-meta 3 · password-recovery 3 · locale-settings 3 · youtube-content 2 · whatsapp-fab 2 · identity-contact 1 · free-content 1 · commerce 1 · announcements 1 · auth setup 2.

## 20. Typecheck / Lint / Production Build

- `npm run typecheck` → exit 0 (route typegen + `tsc`, no errors).
- `npm run lint` → exit 0, "module boundaries clean" (client/server import boundaries enforced).
- `npm run build` → exit 0 (`✓ built in 1.69 s`); the only messages are two benign `INEFFECTIVE_DYNAMIC_IMPORT` notices about intentional dynamic imports.

## 21. Accessibility & Responsive Behaviour

- E2E axe pass: `0 violation(s)` on every audited surface (public/auth pages, 9 student pages, admin module pages), with a gate of zero critical violations and zero target-size failures; DOM-structure regressions covered (single H1, main landmark, uniquely labelled navs, labelled admin filters — all passing).
- RTL/mobile E2E: Arabic RTL and English LTR rendering, ARIA mobile nav toggles, RTL-flipped directional icons, `dir=ltr` on email tokens.
- Responsive sweep (this audit): 52 route entries measured in LTR across six widths (320/360/390/768/1024/1440) plus the seven highest-risk admin screens re-measured in RTL/Arabic. Four overflow defects were found and fixed (§5); the post-fix sweep reports zero horizontal overflow on every combination tested.
- Console/network sanity on the production build (13 pages: home, curriculum, course, lesson, login, register, forgot, reset, student dashboard/orders, admin dashboard/CMS/commerce): zero page errors, zero failed same-origin requests, zero hydration/DOM failures. The only console message observed was an external `i.ytimg.com` YouTube thumbnail failing to load because the audit sandbox has no outbound network — not an application defect. No redesign was performed.

## 22. Production Configuration, Git State & Remaining Blockers

**Production configuration review.** `wrangler.jsonc` points at local D1/R2 names by design; `scripts/check-deploy-config.mjs` fails closed and rejects: non-production `ENVIRONMENT`, missing/invalid `RESEND_API_KEY`/`EMAIL_FROM`, non-HTTPS or reserved-example `APP_ORIGIN`, missing Mux credentials/playback restriction, placeholder or reused secrets, local D1/R2 bindings, and the presence of `TEST_CAPTURE_SECRET`/`MOCK_*`/`EXPOSE_DEV_RESET_TOKEN`. `runtime-config.server.ts` additionally refuses to boot (HTTP 503) on a mis-configured production environment, and treats an unknown/missing `ENVIRONMENT` as production. Production must also start content-empty: `check-production-readiness.mjs` rejects seed/demo/smoke accounts, seed content and unapplied migrations.

**Git state.**
- Audited code commit: `d218dc4` — "fix(ui,security): narrow-viewport overflow on four admin screens + 404 on unconfigured mock stream".
- Previous audit commit: `9d423ae` — secret-audit tool, reset-token unit tests, `/__test/` robots entry, sitemap docstring fix.
- Remote branch SHA: `d218dc4` on `origin/arena/01a0a65f-tito` (this report is the next commit on the same branch).
- Working tree before this report commit: clean (no untracked or ignored build artifacts added; `git status --short --branch` empty apart from the branch line).
- Baseline `main` untouched: `origin/main` still `1a0de72f1c2ea0bada977dc7492ce9259bae4e10`. No force push, no history rewrite, no PR, no merge, **no deploy**.

**Remaining blockers (all owner-side; none are code defects).**

1. Resend: verify the sending domain and add the dashboard-provided SPF/DKIM (and optionally DMARC) DNS records; then set `EMAIL_FROM` + `RESEND_API_KEY` (§11).
2. Production secrets & bindings: `SESSION_PEPPER`, `FILE_URL_SECRET`, Mux credentials, real D1 database + R2 buckets, `APP_ORIGIN`; ensure `TEST_CAPTURE_SECRET`/`MOCK_VIDEO_SECRET`/`MOCK_PAYMENTS_SECRET` are **unset**.
3. Cloudflare edge: enable HSTS (MEDIUM-1) and confirm "Always Use HTTPS"; WAF/rate-limit rules if desired.
4. Run the two gates against the real environment after provisioning: `npm run check:deploy-config` and `node scripts/check-production-readiness.mjs --remote`.
5. Optional owner decision on registration account-enumeration copy (LOW-6).

**No further code work is required before deployment.**
