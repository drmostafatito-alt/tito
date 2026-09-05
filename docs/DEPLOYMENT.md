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
- Bindings in `wrangler.jsonc`: `DB`, `PUBLIC_ASSETS`, `PRIVATE_FILES`, `VIDEOS_MASTERS`, `VIDEO` provider flag

## 3. Secrets inventory (names only — values never in repo)

| Name | Env | Phase |
|---|---|---|
| `SESSION_PEPPER` | all | P1 (defense-in-depth on token hashing) |
| `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` | prod/preview | P2 |
| `MUX_SIGNING_KEY_ID` / `MUX_SIGNING_PRIVATE_KEY` | prod/preview | P2 |
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
- Migrations are transactional per D1 batch; a failed batch leaves the previous state.

## 6. First-deploy runbook (end of Phase 1)

1. `npm ci && npm run verify` (typecheck/lint/tests/build all green).
2. Create D1 preview + prod; apply migrations; run seed (super admin from `ADMIN_BOOTSTRAP_EMAIL` + one-time generated password printed once to operator, must change at first login).
3. Deploy preview → smoke → deploy prod → smoke.
4. Set secrets; verify CSP/headers with a security-header scan; verify cookie flags.
5. Update this file with anything that differed.

## 7. Custom domain & cookies

- Canonical domain redirect (www/apex unify), HTTPS enforced, HSTS at edge.
- Cookies: `Secure`, host-only (no wildcards), `SameSite=Lax`; CORS: same-origin only by default (webhooks are server-to-server, not CORS).

## 8. Cloudflare plan boundaries (free-plan-first — no silent paid usage)

Tracked limits: Workers free (100k req/day, 10ms CPU), D1 free (5M rows read/day), R2 free (10GB). The admin overview (Phase 6) surfaces a usage notice if `CF_API_TOKEN` (optional, read-only analytics scope) is configured; otherwise docs table only. Exceeding free tier requires owner's explicit plan upgrade decision — the app never silently depends on paid features. Mux streaming/Delivery usage is billed by Mux — flagged to owner before first production upload.
