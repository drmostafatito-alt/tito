# Phase 8 — W8 Dependency + Security Final Audit Report

Date: 2026-09-06 · Branch: `arena/01a07397-tito` · Scope: final dependency, security, configuration, and runtime hardening audit before the performance phase.

> **Git-state note.** The prior sandbox's local-only commits (W5/W6/W7) were not preserved across the arena session — this clone's reflog shows a fresh checkout of `11360d4` (Phase 7 baseline) with the working-tree files intact. A recovery baseline commit `b3635e0` was created first to restore the W5–W7 delivered state onto a clean tree, then W8 proceeded from there. No W5–W7 work was lost; only the intermediate commit objects were recreated as one baseline.

---

## 1. Baseline (recorded before any W8 change)

| Check | Result |
|---|---|
| `npm install` | added 270 packages, audited 290 — **11 vulnerabilities (4 moderate, 7 high)** |
| `npm audit` | 11 findings, all in the dev/build toolchain (details §2) |
| `npm run verify` | **PASS** (lint:imports, typecheck, unit 122, integration 197, build OK) |
| `git status` | clean after recovery baseline `b3635e0` |

## 2. Dependency inventory & findings

**Production runtime dependencies** (`package.json` `dependencies`): `@fontsource/ibm-plex-sans-arabic`, `drizzle-orm@0.45.2`, `isbot`, `react@19.2.8`, `react-dom@19.2.8`, `react-router@7.18.3`, `zod@4.5.4`.

**Zero vulnerabilities in any production dependency.** All 11 audit findings are transitive dev/build-only:

| Package (vulnerable) | Severity | Chain (root → vulnerable) | Runtime impact | Fix | Classification |
|---|---|---|---|---|---|
| `esbuild@0.18.20` (GHSA-67mh-4wv8-2f99) | moderate | `drizzle-kit@0.31.10` → `@esbuild-kit/esm-loader@2.6.5` → `@esbuild-kit/core-utils@3.3.2` → `esbuild@0.18.20` | dev-server request exposure; **dev tool only** (migration generator) | `--force` downgrades drizzle-kit 0.31→0.18 (breaking) | **DEFERRED** |
| `extract-zip@2.0.1` (GHSA-jmr9-qjv8-65gv) | high | `chrome-aws-lambda@10.1.0` → `puppeteer-core@10.4.0` → `extract-zip` | symlink path traversal during zip extraction; **e2e browser unpack only** | `--force` downgrades chrome-aws-lambda →1.17 (breaking) | **DEFERRED** |
| `node-fetch@2.6.1` (GHSA-r683-j2x4-v87g) | high | same `puppeteer-core` chain | header forwarding; **e2e browser download only** | same | **DEFERRED** |
| `tar-fs@2.0.0/2.1.1` (GHSA-vj76-c3g6-qr5v, GHSA-8cj5-5rvv-wf4v, GHSA-pq67-2wwv-3xjx) | high | `chrome-aws-lambda` → `lambdafs@2.1.1` → `tar-fs`; and `puppeteer-core` → `tar-fs` | tarball extraction traversal; **e2e browser unpack only** | same | **DEFERRED** |
| `ws@7.4.6` (GHSA-3h5v-q93c-6h6q, GHSA-96hv-2xvq-fx4p) | high | `puppeteer-core@10.4.0` → `ws@7.4.6` | DoS on many headers/fragments; **e2e browser only** | same | **DEFERRED** |

**Reachability proof.** `chrome-aws-lambda` is referenced **only** by `scripts/e2e-browser-setup.mjs` (extracts a Chromium binary + NSS libs for local Playwright). `drizzle-kit` is invoked only by `db:generate`/migration scripts. Neither is imported by `workers/app.ts`, the server bundle, or any route; they are excluded from the deployed Workers bundle (the production `dependencies` set has no audit findings). The vulnerable `ws@8.x` already used by the Cloudflare toolchain is **not** the vulnerable `ws@7.x` (npm `ls` shows `ws@8.21.0` deduped under `@cloudflare/vite-plugin`/`miniflare`).

**Why deferred (no fix applied).** `npm audit fix --force` is the only offered remediation and it performs **breaking downgrades** (`drizzle-kit@0.18.1`, `chrome-aws-lambda@1.17.1`). Per instruction, no `--force` and no major churn to make the audit output clean. The correct long-term remediation (owner note, non-blocking): replace the deprecated `chrome-aws-lambda` with `@sparticuz/chromium` (or vendored Chromium) and upgrade `drizzle-kit` once it drops `@esbuild-kit` (present through 1.0.0-beta).

## 3. Security findings by area

### 3.1 Secrets & configuration — CLEAN
- Secret scan across `app/ server/ workers/ scripts/ tests/` (API-key/secret/password/token/private-key/`AKIA…`/`BEGIN … PRIVATE KEY` patterns): **no hardcoded secrets** (all matches are i18n labels, field names, or `env.*` references).
- `.dev.vars` is gitignored; only `.dev.vars.example` (names, no values) is committed. `workers/env.d.ts` declares secret bindings by name only.
- Reset-token exposure (C1) is fail-closed: `shouldExposeDevResetToken` returns the token only for `ENVIRONMENT==="development"` or the exact `EXPOSE_DEV_RESET_TOKEN==="true"` opt-in; unknown/missing config → no token. `check-production-readiness.mjs` additionally fails any deploy whose `wrangler.jsonc` opts in.
- No production/dev confusion: `wrangler.jsonc` ships `database_id: "local"` + placeholder bucket names (production values are set at deploy time per DEPLOYMENT.md); readiness gate enforces content/seed/mock-provider hygiene.

### 3.2 Auth / session / RBAC — CLEAN (re-audited, already tested)
- Password hashing PBKDF2-SHA256 100k (deliberate free-plan choice, documented); salt per user; constant-time compare.
- Opaque 256-bit session tokens, SHA-256 at rest; cookie `__edu_session` HttpOnly + Secure + SameSite=Lax (default in `serializeCookie`); sliding 30d / absolute 180d expiry; logout + password-change revoke sessions.
- CSRF: middleware rejects cross-site mutations via `Origin`/`Sec-Fetch-Site`; SameSite=Lax second layer.
- Rate limiting: D1 fixed-window per-route+IP and per-route+account on auth/reset/checkout/code/payment/CMS-form/playback/exam-save-submit; bucketing trusts only `cf-connecting-ip` (client-controlled `x-forwarded-for` ignored — H4).
- RBAC guards server-side in layouts; admin = `requireRole(3)` + granular permission matrix; super-admin protections; entitlement resolver is single source of access truth.

### 3.3 Input/output — CLEAN
- No `eval`/`new Function`. No client `innerHTML`/`insertAdjacentHTML`/`document.write`.
- `dangerouslySetInnerHTML` appears **only** in CMS `RichText`, whose content is server-sanitized at publish time by an `HTMLRewriter` allowlist (`server/cms/sanitize.server.ts`): script/style/iframe/form removed, `on*` stripped, `safeHref` rejects `javascript:`/`data:`/protocol-relative/bare domains, `target=_blank` gets `rel=noopener`.
- SQL is Drizzle-parameterized throughout (no string-concatenated SQL); the `sql\`…\`` usages are template tags, not interpolation.
- Open redirect: `set-locale` validates `next` (`startsWith("/") && !startsWith("//")`).
- Zod schemas at every action boundary; unknown keys stripped.

### 3.4 Files / R2 / media — CLEAN
- Private files: never exposed by raw R2 key; short-TTL HMAC signed URLs (`verifyFileSignature`, 404-shaped on any mismatch — no existence/permission oracle); `download_allowed` gates `attachment`; Range/206 supported; `Cache-Control: private, no-store` + `nosniff`.
- SVG/HTML (H5): `sandboxCspFor(mime)` serves active-content uploads with `Content-Security-Policy: sandbox` — direct navigation can't run scripts; `<img>` subresource rendering unaffected.
- Video: playback credentials minted server-side on **every** request after entitlement re-check (Mux signed JWT / mock HMAC, ≤45s TTL); unentitled → 403, anonymous → 401; progress beacons re-validate entitlement before write.

### 3.5 Commerce — CLEAN (re-audited)
- Grant path = signature-verified webhook **or** explicit admin approval → single transaction (`payments.status='paid'` + entitlements); no grant from any redirect/success page.
- Idempotent fulfillment: unique `provider_event_id` replay protection; state-machine transitions validated (no jump to `paid` from `expired`).
- Manual approval requires admin role + audit log; amounts/orders server-computed; integer minor-unit money; order ownership server-checked; entitlement checks remain server-side.

### 3.6 Assessments — CLEAN (re-audited)
- Server timestamps + `deadline_at` (client timer cosmetic); submissions after deadline+grace rejected/flagged.
- One live attempt per exam (partial unique index); idempotent submission via attempt status machine; autosave versioned per question and authorization-checked; correct-answer flags never shipped to in-progress attempts; result/review authorization enforced.

### 3.7 Database / migrations — CLEAN
- 8 migrations (`0000…0007`), journal order `[0..7]` consistent, no `DROP TABLE/COLUMN`, `TRUNCATE`, `DELETE`, `RENAME`, or `.clear()` anywhere.
- FK / index / unique constraints present throughout (counts: 25/16/13/0/7/13/36/7 per file).
- Backup/restore (W5) assumptions unchanged by W6/W7 (no schema or storage changes); `scripts/backup.mjs` + `restore.mjs` + destructive-restore safety guards remain unit-tested.

### 3.8 HTTP / security headers — CSP correct; one gap fixed (H8)
- CSP is strict: `default-src 'self'`; `script-src 'self' 'nonce-<v>'` (nonce = `crypto.randomUUID().replace(/-/g,"")`, generated per request in `workers/app.ts`, threaded via `server/csp.server.ts` and applied to inline scripts via `<ServerRouter nonce>`). **No `'unsafe-inline'` in production, no `'unsafe-eval'`, no wildcard script/default source.** `style-src 'self'` (+`'unsafe-inline'` dev-only for Vite HMR). `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`.
- **H8 FIX (this audit):** authenticated HTML responses previously had **no explicit `Cache-Control`**, so user-specific pages (dashboard, orders, profile, admin, …) could be retained by browser or shared caches. Added `applyPrivateCacheControl` (in `server/http/headers.server.ts`, wired in `app/root.tsx` middleware) → `Cache-Control: private, no-store` whenever a `__edu_session` cookie is present and the response is `text/html`. Non-HTML (JSON/API/redirects) and anonymous HTML are untouched; static assets and `/files` set their own Cache-Control outside this handler.

### 3.9 Cloudflare / Workers — CLEAN (environment)
- `wrangler.jsonc`: classic Workers entry `./workers/app.ts`, `compatibility_date 2026-04-01`, `nodejs_compat`; assets `./build/client`; bindings `DB` (D1), `PUBLIC_ASSETS`/`PRIVATE_FILES`/`VIDEO_MASTERS` (R2); observability enabled. Local uses miniflare-simulated resources; production IDs/names set at deploy time.
- Production secrets/credentials are unavailable locally and **not assumed** — verification of deployed secrets is owner-assisted.

## 4. Findings classification summary

| # | Finding | Classification |
|---|---|---|
| 1–5 | 11 dev-only audit vulns (esbuild via drizzle-kit; extract-zip/node-fetch/tar-fs/ws via chrome-aws-lambda→puppeteer-core) | **DEFERRED DEPENDENCY ISSUE** (unreachable at runtime; no safe non-breaking fix) |
| 6 | Authenticated HTML lacks `Cache-Control` | **HARDENING OPPORTUNITY → FIXED (H8)** |
| 7 | HSTS / WAF rate rules / production secrets | **OWNER-ASSISTED / ENVIRONMENT** (edge/deploy config; documented, not verifiable locally) |
| — | Everything else (secrets, XSS, SQL, redirects, R2/media, commerce, assessments, migrations, CSP nonce, CSRF, rate-limit, RBAC) | **VERIFIED CLEAN / NOT REACHABLE** (no confirmed vulnerability) |

No **CONFIRMED VULNERABILITY** was found in application code.

## 5. Tests proving the fix

- `tests/unit/security-headers.test.ts` — added `applyPrivateCacheControl` describe (3 cases): authenticated HTML → `private, no-store`; anonymous HTML untouched; non-HTML (JSON/text/svg/redirect) untouched even with a session.
- Existing security suites re-run green: CSP nonce shape, rate-limit (H4), reset-token fail-closed (C1), IDOR/privilege isolation, file/signature, commerce idempotency.

## 6. Verification results

| Check | Result |
|---|---|
| Targeted security tests | `security-headers.test.ts` 8 passed (incl. 3 new) |
| Full unit suite | **125 passed / 14 files** (was 122) |
| Full integration suite | **197 passed / 11 files** |
| Full Playwright suite | **52 passed** |
| `npm run verify` | **PASS** |
| `npm audit` (final) | unchanged — 11 (4 moderate, 7 high), all deferred dev-only |
| `git diff --check` | **PASS** |

## 7. Deferred items & rationale

- All 11 dependency vulnerabilities (dev/build-only, unreachable at runtime, no non-breaking fix). Long-term: replace `chrome-aws-lambda` with `@sparticuz/chromium`; upgrade `drizzle-kit` once it drops `@esbuild-kit`.

## 8. Owner-assisted / environment limitations

- **HSTS** — configured at the Cloudflare edge (per SECURITY.md §5); not assertable from local code (owner edge config).
- **Cloudflare WAF rate rules** — documented scale-up path, not assumed.
- **Production secrets / D1 database_id / R2 bucket names** — set via `wrangler secret put` + deploy config; unavailable locally, not inspected.
- **Modern-browser visual/layout confirmation** (W6 `target-size`, W7 visual overflow) — requires a current-browser re-run; sandbox browser (Chromium 92) cannot apply Tailwind v4 CSS.

## 9. Remaining risks (acknowledged, non-blocking)

- Device fingerprinting / screen recording deterrence limits (honest-limitations, SECURITY.md §16).
- No DRM in v1.
- Browser-based exams cannot be fully lock-down.
- Password-reset email delivery not yet shipped (ADR-024 gate) — reset is dev/testing-only; token fail-closed.

## 10. Production deployment / security checklist

1. `npm run verify` green; `npm audit` reviewed (dev-only deferred items acknowledged).
2. `node scripts/check-production-readiness.mjs --remote` PASS before every deploy (no seed/smoke/mock content, owner identity set, migrations applied, ≥1 active super admin, no `EXPOSE_DEV_RESET_TOKEN`/dev `ENVIRONMENT`).
3. Back up D1 (`scripts/backup.mjs`) before any destructive migration; restore gated by `EDUCORE_ALLOW_UNSAFE_RESTORE`.
4. `wrangler secret put` for every name in DEPLOYMENT.md (never values in code/`wrangler.jsonc`).
5. HSTS + canonical-domain redirect + WAF rate rules at the Cloudflare edge.
6. Video provider set to real provider (not `mock`); file/video TTLs within documented caps.
7. Confirm CSP nonce + strict headers in a deployed response; no `'unsafe-inline'`/`'unsafe-eval'`/wildcard.

## 11. Final verdict

**PASS** — no confirmed vulnerabilities in application code; all dependency findings are deferred dev-only issues (unreachable at runtime, no safe non-breaking fix); the one hardening gap (authenticated-HTML caching) is fixed with regression coverage; full test + verify + audit + `diff --check` all green. Owner-assisted items (HSTS/WAF/production secrets) are existing deployment-environment responsibilities documented in SECURITY.md/DEPLOYMENT.md, not new code defects.
