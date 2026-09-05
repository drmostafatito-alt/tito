# Changelog

All notable changes are documented here. Versioning stays 0.x until first production release.

## [0.3.0] — 2026-09-05

### Added — Phase 1 (foundation & auth core)
- Runtime architecture per ADR-015: React Router 7.18.3 framework build (`build/client` + `build/server`) + `workers/app.ts` entry served by wrangler for BOTH local dev and production; `RouterContextProvider` load context with cross-bundle `cloudflareContext` (ADR-016 pins: Vite 8.2.2, wrangler 4.129.0, vendored Node 22, compat date 2026-04-01).
- Auth core: register/login/logout/reset with PBKDF2 (100k default) + transparent rehash, sessions + device-concurrency limit, sliding refresh cookie, 404-shaped RBAC guards (rank student<teacher<admin<super_admin), fixed-window rate limits (login 10/min IP + 20/min email, register/forgot 5/h), enumeration-resistant reset, security-events audit.
- D1 schema 0000 (identity, sessions, devices, rate_limit_counters, settings, audit, security_events) + seed; settings service (admin-only, audited); strict CSP + security headers via root middleware (`future.v8_middleware`); CSRF sec-fetch/origin checks.
- i18n ar/en with RTL-first layouts, IBM Plex Sans Arabic self-hosted; minimal public/protected/admin route shells.
- Tests: 32 unit + 7 integration (workerd pool, embedded migrations manifest); CI on Node 22.

## [0.2.0-planning] — 2026-09-05

### Added — Phase 0 (full documentation set)
- `ARCHITECTURE.md` — decided stack (RR7 on Workers, D1, R2), system shape, module boundaries, request lifecycle, route map, auth/session/device model, authorization model, settings/CMS, i18n/RTL, performance budgets, error handling, iOS/Safari rules.
- `DATABASE-SCHEMA.md` — conventions + full domain schema (~45 tables, phase-mapped), access-resolution model, referential notes.
- `SECURITY.md` — controls per phase, CSRF/headers/CSP policy, rate limiting, media protection, payments & exam security, honest limitations.
- `DEPLOYMENT.md` — environments (local/preview/prod), Cloudflare resources, secrets inventory, CI/CD, migration safety, first-deploy runbook, plan-boundary policy.
- `TEST-PLAN.md` — layers/tools, critical-flow e2e scripts, authorization test matrix, device/iOS checklist.
- `PAYMENTS.md` — order/payment separation, state machine, manual rail + activation codes v1, gateway verification gate + log.
- `VIDEO-PROVIDERS.md` — provider interface, ingestion/playback flows, mock + mux adapters (playback model verified against Mux docs 2026-09-05), migration runbook, iOS player rules.
- `FEATURE-SPEC.md` v1 — behavioral contracts per module.
- `ADMIN-GUIDE.md` skeleton (grows per phase).

### Changed
- `DECISIONS.md` — ADR-002/006/007/008 marked Accepted after owner decisions (RR7 stack; Mux; manual-first payments; Arabic+English RTL). Added ADR-014 (access model shape). Mux playback verification recorded.
- `PROJECT-PLAN.md` — documentation index updated; decisions locked.

### Status
No application code yet. Awaiting architecture approval → Phase 1 (Foundation).

## [0.1.0-planning] — 2026-09-05
- Initial planning artifacts: PROJECT-PLAN, DECISIONS (ADR-001–013), CHANGELOG.
