# Changelog

All notable changes are documented here. Versioning stays 0.x until first production release.

## [0.5.0] — 2026-09-05

### Added — Phase 3 (CMS / page builder — owner-inserted phase, ADR-018)
- D1 schema 0002 (CMS domain) + 0003 (admin CMS permission seed): `pages` (slug/status/seo/published_snapshot), `page_versions` (append-only snapshots), `blocks` (draft tree: sections + components, ordering, visibility), `menus`/`menu_items` (header/footer/student/legal, one nesting level), `forms`/`form_fields`/`form_submissions` (declarative validation, consent, rate-limited submissions), `role_permissions` (nine `cms.*` permissions; super_admin bypasses). App-layer reference guards mirror ADR-017.
- Block registry `app/cms/registry.ts` (single source of truth, client-safe): 38 block types with zod schemas, default props, field descriptors (bilingual text, icon-id pickers, image pickers bound to PUBLIC_ASSETS files, ref pickers for courses/subjects/programs, repeaters), reserved slugs, SEO schema, `safeHref`. Adding a block type = one registry entry + one renderer case (no migration/route change).
- Admin CMS UI (non-developer friendly): pages list (create/duplicate/archive/delete/reorder/publish/unpublish), page builder (sections + blocks: add/edit/move up-down/duplicate/hide/delete, grouped palette, per-block settings forms generated from the registry), version history with notes + non-destructive restore (auto-snapshots the current draft first), admin-only draft preview route with validation-issue listing, menus editor, forms editor (fields/options/messages/consent/submissions view), appearance admin (identity/branding, theme tokens, presentation toggles, student-dashboard modules, **new System tab**: platform name/tagline/support/maintenance + super-admin video-provider policy).
- Public rendering: `/` = CMS page `home`, `/p/:slug` for other pages — both render ONLY the validated published snapshot (drafts can never leak); per-page SEO meta (title/description/canonical/OG/robots); rich-text sanitized via HTMLRewriter allowlist at publish; dynamic blocks (course/subject/program cards, latest lessons, free/featured) resolve server-side with entitlement-safe data and empty states; `/theme.css` emits zod-validated design tokens as CSS variables (no arbitrary CSS, CSP-safe: zero inline styles); icon registry ids only (no raw SVG storage); menus drive header/footer/student/legal nav.
- Settings groups `identity`, `theme`, `presentation`, `dashboard` (+ `platform`/`video` now admin-editable via System tab): owner identity (name/photo/title/logo/favicon/hero/about/contact/socials/copyright), theme tokens (colors/radius/shadow/density/font-scale), course/subject card toggles + CTA labels, lesson-page & video-player presentation options, student dashboard modules (my_courses/quick_actions/support) — modular dashboard never exposes unauthorized data (entitlements stay server-side).
- Production-content enforcement (ADR-020): `scripts/check-production-readiness.mjs` (`npm run check:production-readiness`, `--remote` for prod D1) — 10 checks, fails deploy on demo accounts/seed-smoke content/mock provider/placeholder media/template branding/empty owner identity/lorem snapshots/unapplied migrations/missing CMS permissions/no super admin. `scripts/bootstrap-admin.mjs` — production first-admin (roles + one super admin, one-time password, refuses dev-placeholder emails; the seed script stays LOCAL-ONLY).
- Tests: unit `cms-registry.test.ts` (9) + integration `cms.test.ts` (9); runtime smoke §12 (22 CMS checks incl. draft-404 → publish → anonymous render, preview gating, menu visibility, form validation messages, zero-deploy platform rename); docs: `CMS.md` (admin + technical guide), ADR-018/019/020, SECURITY §15 (CMS audit), ARCHITECTURE §8 rewrite, DATABASE-SCHEMA CMS section, phase renumbering across all living docs.

### Changed
- Student dashboard, catalog, course/lesson pages, and VideoPlayer now render from settings-driven presentation config (Phase 3 stages 5–6); homepage is fully CMS-composed (no hard-coded marketing content anywhere).
- Admin header: mobile nav toggle with 44px touch targets; builder tool buttons scale to 44px on small screens (iPhone audit, stage 7).
- `scripts/smoke.mjs`: 13 sections (CMS §12 added; rate-limiting renumbered §13) — 126 checks total.

### Fixed
- Smoke theme-token needle (`--brand-500` → `--color-brand-500`, the actual emitted variable).
- `bootstrap-admin`/`check-production-readiness` local mode honors `PERSIST_DIR` via wrangler `persist.path` (isolated fresh-DB verification); bootstrap disposes the platform proxy (no hang) and uses a non-blocklisted `full_name`.

### Verification (Phase 3 exit)
- Static: lint:imports ✓ · tsc 0 errors · unit **61/61** · integration **46/46** · production build ✓ (`npm run verify` exit 0).
- Runtime (cold seeded local D1+R2, live `wrangler dev`): smoke **126/126** including all Phase 1–2 regressions (auth, RBAC, devices, signed URLs, playback tokens, entitlement flip, revocation, rate limits, CSP/headers).
- Readiness gate both directions: seeded dev DB → exit 1 (6 findings); fresh production-like DB (migrations + bootstrap + owner config only) → **10/10 PASS exit 0**.
- Security/access audit clean (SECURITY §15); mobile audit code-level green (real-device matrix remains owner-assisted, TEST-PLAN §5).

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
