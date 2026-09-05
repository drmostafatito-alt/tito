# EduCore (working title)

Production-grade educational platform on Cloudflare (React Router v8 + D1 + R2), Arabic/English with RTL, admin-first configurability, provider-abstracted video & payments.

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
| `npm run build` / `npm run deploy` (wrangler) | production build / deploy (see docs/DEPLOYMENT.md) |
