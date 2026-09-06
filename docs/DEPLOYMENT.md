# Deployment & Environments

> Status: **Phase 0 plan.** Owner has: Cloudflare account + custom domain + Mux account.
> First real deploy happens at end of Phase 1; this runbook is validated then and kept exact.

## 1. Environments

| Env | Where | D1 | R2 | Secrets | Purpose |
|---|---|---|---|---|---|
| local | `wrangler dev` in sandbox/dev machine | local D1 (miniflare, file-backed) | local R2 sim | `.dev.vars` | development, live preview |
| preview | Worker preview URL / `*.workers.dev` | `DB_PREVIEW` | `ASSETS_PREVIEW`/`FILES_PREVIEW`/`MASTERS_PREVIEW` | preview secrets (`wrangler secret --preview`? no — separate preview Worker) | integration testing with fixtures |
| production | custom domain | `DB_PROD` | prod buckets | prod secrets | live |

Isolation rule: production data is **never** copied to dev/preview. Fixtures/seed scripts only.

## 2. Cloudflare resources (created once, via dashboard or `wrangler`)

- D1 databases: `educore-preview`, `educore-prod`
- R2 buckets: `public-assets`, `private-files`, `video-masters` (× env suffix for preview)
- Worker + static assets (RR7 build), custom domain attached, HTTPS automatic (Cloudflare edge)
- Bindings in `wrangler.jsonc`: `DB` (D1), `PUBLIC_ASSETS`, `PRIVATE_FILES`, `VIDEO_MASTERS` (R2). The active video provider is NOT an env binding — it is the settings row `video.provider` in D1 (admin-switchable, ADR-006).

## 3. Secrets inventory (names only — values never in repo)

| Name | Env | Phase |
|---|---|---|
| `SESSION_PEPPER` | all | P1 (defense-in-depth on token hashing; dev fallback exists, MUST be set in prod) |
| `FILE_URL_SECRET` | all | P2 — REQUIRED: HMAC key for signed private-file URLs (no fallback) |
| `MOCK_VIDEO_SECRET` | all (dev/local; prod only if mock provider used) | P2 — REQUIRED when provider=mock: playback-token HMAC (no fallback) |
| `MOCK_PAYMENTS_SECRET` | dev/local/tests ONLY | P6 — binds the TEST-ONLY `mock` payment provider (webhook HMAC). NEVER set in production: without it the mock adapter is not registered and `/webhooks/payments/mock` 404s. No real gateway secret exists yet (PAYMENTS.md §6). |
| `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` | prod/preview | P2 — required when provider=mux (API ingest/sync); absent → loud `VideoNotConfiguredError` |
| `MUX_SIGNING_KEY_ID` / `MUX_SIGNING_PRIVATE_KEY` | prod/preview | P2 — required when provider=mux (signed-JWT playback) |
| `AUTH_PBKDF2_ITERATIONS` (non-secret tuning) | all | P1 (default 100k) |
| `RESEND_API_KEY` (email — pending verification ADR) | prod | P3+ |
| Payment gateway keys | prod | P5 (only with verification ADR) |

Local: copy `.dev.vars.example` → `.dev.vars` (gitignored; committed file contains placeholders only).

## 4. CI/CD (GitHub → Cloudflare)

1. PR: `typecheck` → `lint` → `unit` → `integration (miniflare D1)` → `build`. Preview deploy to preview Worker.
2. Merge to `main`: same suite + deploy preview env + e2e smoke (Playwright against preview).
3. Release (`git tag vX.Y.Z`): full regression checklist (PROJECT-PLAN §6) → `wrangler deploy` → `wrangler d1 migrations apply DB_PROD` (after export) → post-deploy verification script (health, login, key pages, CSP headers).
4. Rollback: `wrangler rollback` (Workers versions) + documented migration-reversal policy (expand/contract migrations; never blind down).

## 5. Migration safety (backup → migrate → verify → deploy)

- Every migration is additive-first (expand/contract pattern). Destructive steps are separate, later migrations gated on a verified export.
- Pre-migration: `wrangler d1 export educore-prod --remote --output backups/$(date +%F).sqlite` (+ R2 master listing). Backup verified (row counts of core tables logged) before applying.
- Full backup/restore tooling (Phase 8 / W5): `node scripts/backup.mjs` and
  `node scripts/restore.mjs` — see docs/BACKUP-RESTORE.md for scope, procedure,
  limitations, and the executed rehearsal. Restore is destructive and
  environment-gated (`--force`; remote restore requires an explicit unsafe opt-in).
- Migrations are transactional per D1 batch; a failed batch leaves the previous state.

## 6. First-deploy runbook (updated for Phase 3 / ADR-020)

1. `npm ci && npm run verify` (typecheck/lint/tests/build all green).
2. Create D1 preview + prod; apply migrations (`wrangler d1 migrations apply <db> --remote`).
3. Bootstrap the first super admin: `npm run bootstrap:admin:remote` (email via `ADMIN_BOOTSTRAP_EMAIL` or `--email=`; one-time generated password printed once; refuses dev-placeholder emails). **Never run `scripts/seed.mjs` against preview/prod — it is LOCAL-DEV ONLY (plants demo content the readiness gate rejects).**
4. Owner logs in, changes the bootstrap password, fills Appearance → System (platform identity, video provider) + Identity (owner name/photo/logo/contact) — all zero-deploy.
5. **Pre-deploy gate**: `npm run check:production-readiness -- --remote` must pass (exit 0). It fails on demo accounts, seed/smoke content, mock video provider, placeholder media, template branding, empty owner identity, lorem-ipsum pages, unapplied migrations, missing CMS permissions, or no active super admin (ADR-020).
6. Deploy preview → smoke → deploy prod → smoke (`SMOKE_BASE_URL=<url> SMOKE_ADMIN_PASSWORD=… node scripts/smoke.mjs`; note: smoke creates `smoke-`-prefixed rows — re-run the readiness gate afterwards or clean up before launch).
7. Set secrets; verify CSP/headers with a security-header scan; verify cookie flags.
8. Update this file with anything that differed.

## 7. Custom domain & cookies

- Canonical domain redirect (www/apex unify), HTTPS enforced, HSTS at edge.
- Cookies: `Secure`, host-only (no wildcards), `SameSite=Lax`; CORS: same-origin only by default (webhooks are server-to-server, not CORS).

## 8. Cloudflare plan boundaries (free-plan-first — no silent paid usage)

Tracked limits: Workers free (100k req/day, 10ms CPU), D1 free (5M rows read/day), R2 free (10GB). The admin overview (Phase 7) surfaces a usage notice if `CF_API_TOKEN` (optional, read-only analytics scope) is configured; otherwise docs table only. Exceeding free tier requires owner's explicit plan upgrade decision — the app never silently depends on paid features. Mux streaming/Delivery usage is billed by Mux — flagged to owner before first production upload.
