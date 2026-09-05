# Changelog

All notable changes are documented here. Versioning stays 0.x until first production release.

## [0.4.0] — 2026-09-05

### Added — Phase 2 (content domain)
- D1 schema 0001 (content domain): programs → grades → subjects → courses → units → lessons → lesson_items hierarchy + videos + files + entitlements tables with slug-unique and index coverage. DB-level FKs on content tables deliberately deferred (SQLite table-rebuild migration cost); referential integrity enforced at the application layer instead — `ContentReferenceError` + `assert*Ref` guards in every create path, surfaced as validation errors in the admin UI (ADR-017, regression-tested).
- Content admin: full CRUD over HTTP (`/admin/content` tree + node editor) — create at every level, rename/save, status (draft/published/archived), visibility, access_level, publish/expiry windows, thumbnails, slug generation (Arabic-aware slugify + uniqueness), sibling ordering (move-up/move-down with 0..n-1 normalization + boundary no-op), archive; every mutation audited.
- Private file storage: admin upload → R2 `PRIVATE_FILES` (never public); access ONLY via `/files/:id` with server-minted HMAC signed URLs (`perm=view|download`, `exp`, `sig`; TTL from settings `video.fileUrlTtlSeconds`, default 120s); permission + expiry + file-id are all HMAC-covered (tamper/swap/replay → 404-shaped); `download_allowed` decides attachment vs inline; Range requests → 206; no-store caching. File-row ID regression guard: `putPrivateFile` and `insertFile` provably share one ID (integration test).
- Entitlement engine (server-side only): resolver verdict chain (admin bypass → free_preview → public/authenticated access_level → grants by resource or ancestor → denial) with reasons; admin grant/revoke UI (`/admin/entitlements`, days + note, audited); lesson pages + playback API gate on the verdict; UI renders verdicts, never computes them.
- VideoProvider abstraction (ADR-006 in practice): provider-neutral `videos` rows (provider/asset/playback ids + status); `POST /api/playback/:videoId` is the ONLY credential-minting path (entitlement re-checked server-side every call; admins bypass; provider-neutral JSON `{type,url,expiresAt,posterUrl}`); mock adapter (offline synthetic HLS, HMAC tokens ≤45s, playback/thumbnail scope separation) + Mux adapter (Ed25519 signed-JWT playback, direct-upload ingest, API sync) selected purely by settings `video.provider` — switching verified live: with Mux active and credentials absent, ingest fails loudly (`VideoNotConfiguredError`, row stays `pending`, NO silent mock fallback); revert restores mock ingest.
- Catalog + lesson pages: `/courses` listing (published + visibility-filtered), course/unit pages, `/learn/:courseSlug/:lessonSlug` with locked state for denied verdicts (no signed URLs leak into locked HTML) and embedded player/file links when allowed.
- Runtime smoke harness `scripts/smoke.mjs`: 104 HTTP checks against a live `wrangler dev` worker (headers/CSP, CSRF layers, RBAC, signed-URL tamper matrix, playback token discipline, grant flip, logout revocation, rate-limit no-bypass); persisted cookie jars model real browser device keys.

### Changed
- Integration tests are hermetic: miniflare provides test-only secret bindings (`vitest.integration.config.ts`) — full suite passes with or without `.dev.vars` (37/37 both ways).
- `scripts/check-imports.mjs`: added `unusedServerImports()` guard (unused `~server/*` value imports in routes break the RR7 production build — caught at lint time now).
- `.gitignore`: added `build/` (generated RR7 output must never be committed).

### Fixed
- Mock provider `posterUrl` reused the playback-scoped token while `/api/mock-stream` derives scope from the file extension (poster.svg → thumbnail scope) → poster always 404'd. Now signs a separate thumbnail-scoped token (integration regression in `video.test.ts`; runtime check in smoke §6).
- `admin.files.tsx` unused `bucketOf` import broke the production build (route-exports/dot-server interplay) — removed; guarded by the lint addition above.
- `video.test.ts` fixture parsed the mock token from the wrong place (provider contract: token lives in the URL query).

### Verification (Phase 2 exit)
- Static: lint:imports ✓ · tsc 0 errors · unit 52/52 · integration 37/37 · production build ✓ (`npm run verify` exit 0).
- Runtime (`wrangler dev`, local D1+R2, seeded): migrations 0000+0001 applied; seed idempotent (double-run stable counts); SQL referential-integrity spot checks pass; HTTP smoke 104/104 including Phase 1 regressions (auth, sessions/devices, RBAC 404-shape, CSRF, rate limits, headers/CSP); provider-switch matrix verified; security audit clean (no secret values in client/server bundles, `.dev.vars` gitignored, private bucket unreachable unsigned).

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
