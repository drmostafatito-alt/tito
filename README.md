# EduCore (working title)

Production-grade educational platform on Cloudflare (React Router 7 framework mode + D1 + R2, served by `workers/app.ts`), Arabic/English with RTL, admin-first configurability, provider-abstracted video & payments.

**Status: Phases 0–2 complete** (planning docs → foundation/auth → content domain: admin CRUD, private files, entitlements, video providers). Phase 3 (student experience) not started. See `docs/CHANGELOG.md`.

**Read `docs/` first** — it is the single source of truth (`PROJECT-PLAN.md` for phases, `ARCHITECTURE.md` for design, `DECISIONS.md` for rationale).

## Quick start (local)

```bash
npm install
cp .dev.vars.example .dev.vars       # fill values
npm run db:migrate:local             # apply D1 migrations (miniflare)
npm run db:seed:local                # roles, settings, super admin + demo student
npm run dev                          # vite + workerd on :5173
```

## Common scripts

| Script | Purpose |
|---|---|
| `npm run verify` | boundaries → typecheck → tests → build (run before every deploy) |
| `npm run db:generate` | drizzle-kit generate + sync into `migrations/` |
| `npm run db:migrate:local` | apply migrations to local D1 |
| `npm run test` | unit (node) + integration (workerd, real local D1) |
| `node scripts/smoke.mjs` | HTTP runtime smoke suite against a live `npm run dev` worker (needs migrated + seeded local state; `SMOKE_ADMIN_PASSWORD` from the seed output — see the script header) |
| `npm run build` / `npm run deploy` (wrangler) | production build / deploy (see docs/DEPLOYMENT.md) |
