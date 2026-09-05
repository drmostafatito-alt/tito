# Architecture Decision Records & Open Decisions

Format per record: **Context / Decision / Consequences / Status**.

**Policy:** any external-provider adapter (payments, video, email, WhatsApp) requires a *verification ADR* citing current official documentation before implementation. No invented APIs.

**Owner decisions locked 2026-09-05:** stack = React Router v7 full-stack · locale = Arabic+English RTL-ready · first payment rail = manual + activation codes · infra = Cloudflare account + custom domain + Mux account available.

---

## ADR-001 Cloudflare-native deployment target
**Status: Accepted**
- **Context:** Brief requires Cloudflare-first (frontend+API, D1, R2), free-plan-first, no silent paid usage.
- **Decision:** App runs on Cloudflare Workers (static assets + Worker). D1 = relational store. R2 buckets: `public-assets`, `private-files`, `video-masters`. Paid-tier needs are flagged to the owner before adoption.
- **Consequences:** Low cost, no server ops. D1 is SQLite: single-writer transactions, hot writes batched. Abstraction layers (video/payments/email) preserve migration options.

## ADR-002 Application framework & repo shape
**Status: Accepted (owner decision Q1)**
- **Decision:** single **React Router v7 (framework mode)** TypeScript app on Workers: SSR + client navigation, one deployable; route groups `_public/_student/_teacher/_admin`; server-only modules in `server/` (bundler-enforced `*.server.ts`); scaffolded from the official RR7 Cloudflare template in Phase 1.
- **Consequences:** Server-rendered auth guards on every navigation (including first load), no CORS layer, one deploy artifact, D1/R2 accessed directly in loaders/actions. Admin ships as a route group in the same app (guarded server-side), not a separate app — one design system, one auth model. Trade-off accepted: no separate mobile-app API in v1 (the JSON loaders already expose typed endpoints suitable for a future app client).

## ADR-003 Data layer: Drizzle ORM + Wrangler D1 migrations
**Status: Accepted**
- Typed schema; versioned migrations; **separate databases per environment**; `wrangler d1 export` backup mandatory before destructive changes (backup → migrate → verify → deploy). Path to Postgres preserved via repository discipline.

## ADR-004 Authentication model
**Status: Accepted**
- PBKDF2-SHA256, 600k iterations, per-user salt (WebCrypto — Workers-native). Opaque 256-bit session tokens stored hashed; `HttpOnly; Secure; SameSite=Lax`; sliding 30-day expiry; sessions bound to devices; login/reset rate-limited; reset tokens single-use hashed TTL 60min; role checks in server handlers only.

## ADR-005 Device & session identity (account-sharing deterrence)
**Status: Accepted**
- Random durable device key (hashed at rest) + UA/platform heuristics; settings-driven policy (max devices default 1, block vs replace-oldest, change limits, force logout, revoke); events audited. Explicit: deterrence, not a 100% guarantee.

## ADR-006 Video provider abstraction
**Status: Accepted. Initial provider: Mux (owner has account).**
- Interface per VIDEO-PROVIDERS.md; adapters `mock` (dev) + `mux` (prod). **Playback model verified 2026-09-05** against Mux official docs: signed playback = short-TTL JWT (Ed25519 signing key) appended to `stream.mux.com/{PLAYBACK_ID}.m3u8`; optional domain playback restrictions; signed thumbnails. Re-verification pass on upload API + Workers Ed25519 WebCrypto during Phase 2 scaffold (links in verification queue).
- Masters preserved in R2 `video-masters/` → provider migration = re-ingest job.

## ADR-007 Payment provider abstraction & first rail
**Status: Accepted (owner decision Q3): manual rail + activation codes first.**
- Orders vs Payments separated; entitlements granted only in a transaction from signature-verified webhook or explicit admin approval. Gateway adapters (Paymob/Fawry candidates; Stripe entity-constrained) require Phase 5 verification ADRs — none implemented until then.

## ADR-008 Localization & RTL
**Status: Accepted (owner decision Q2): Arabic + English, RTL from day one.**
- `ar` default (admin-configurable), logical CSS properties, namespaced dictionaries, `_ar/_en` content columns with documented fallback, self-hosted fonts (IBM Plex Sans Arabic + Inter).

## ADR-009 Entitlements engine built early
**Status: Accepted** — engine (schema + resolver + admin-grant/free sources) in Phases 1–2; purchase/subscription/code sources added Phase 5. One resolver, exhaustive test matrix, never scattered checks.

## ADR-010 File storage & protected access
**Status: Accepted** — R2 `private-files` never public; short-TTL signed URLs post-entitlement; view-vs-download decided at signing; metadata + permissions in `files`.

## ADR-011 Exam integrity model
**Status: Accepted** — server-authoritative deadlines; cosmetic client timer; debounced versioned autosave + beacons; idempotent submission via status machine; partial-unique-index single live attempt; per-attempt randomization seed.

## ADR-012 Settings & CMS architecture
**Status: Accepted** — Zod-validated settings groups; homepage/menus/footer/announcements as ordered JSON documents + generic block renderers; all changes audited with diffs; no deploys for routine changes.

## ADR-013 Monolith-first modularity
**Status: Accepted** — one deployable, strictly modular `server/` domains; boundaries lint-enforced; services can split later if ever needed.

## ADR-014 Access model shape
**Status: Accepted (Phase 0, while writing DATABASE-SCHEMA)**
- Content nodes carry `access_level` (public|authenticated|entitled) + `free_preview` on lessons; a separate `content_access_rules` table was considered and **rejected** as over-modeling — entitlements + per-node flags cover all brief §21 cases with one resolver path. If per-rule complexity ever grows, rules table can be added without breaking the resolver contract.

## ADR-015 Runtime architecture: classic RR build + wrangler (no plugin in runtime path)
**Status: Accepted (Phase 1, 2026-09-05)**
- `@cloudflare/vite-plugin` is used ONLY by the integration test pool (`@cloudflare/vitest-plugin`). It is NOT in the dev/production runtime path: `vite build` (via `react-router build`) produces `build/client` + `build/server`; `workers/app.ts` wraps the server build with `createRequestHandler` and passes a `RouterContextProvider` seeded with `cloudflareContext`; `wrangler dev` (local) and `wrangler deploy` (production) serve the SAME worker entry — dev preview and production are one architectural path.
- Why: (a) plugin-driven dev (`vite dev` → workerd module-runner) OOM-kills the 2 GB sandbox at first request (kernel oom-kill, node RSS 1.34 GB); (b) RR8 + plugin dev is broken upstream (cloudflare/workers-sdk#14555); (c) the plugin's `vite preview` requires a deploy-config step the plugin itself generates, unusable standalone.
- Consequence: dev has no HMR — `npm run dev` = build + `wrangler dev`. Accepted for Phase 1 (rebuild ≈ 7 s); revisit if it slows Phase 2+ iteration materially.
- Load context: RR7 `future.v8_middleware` is enabled (required to activate route middleware at all). With middleware on, RR requires a `RouterContextProvider` — constructed per request in `workers/app.ts`. The context *definition* (`cloudflareContext`) is shared across the two bundles (wrangler bundle vs vite server build) by memoizing `createContext()` on `globalThis[Symbol.for("educore.cloudflare-context")]` — `Symbol.for` is the spec-guaranteed cross-bundle symbol registry; without it each bundle would have a different definition identity and `context.get()` would miss. `server/cf.server.ts` accepts both the provider and the plain `{ cloudflare: { env, ctx } }` shape (tests/direct calls).

## ADR-016 Toolchain pins & environmental constraints
**Status: Accepted (Phase 1, 2026-09-05)**
- **React Router 7.18.3** (runtime + `@react-router/dev`), single version tree-wide. RR8 rejected: dev path broken with the CF plugin upstream (#14555) and its load-context/API changes violate the approved RR7 baseline. 7.18.3 chosen as the last v7 line release, verified green in-repo (owner directive: no opportunistic version moves during debugging).
- **Vite 8.2.2** (rolldown) — NOT the template's Vite 7: Vite 7's esbuild service reproducibly deadlocks in this 2 CPU/2 GB sandbox ("all goroutines are asleep", environmental — standalone esbuild + the official template's exact pins both confirmed). `@react-router/dev@7.18.3` peer-accepts Vite 8.
- **wrangler 4.129.0** (latest) — older CLI's bundled workerd cannot read state written by newer workerd (`_cf_ALARM` schema mismatch). `compatibility_date 2026-04-01`, safe for both wrangler's workerd and the vitest-plugin pool.
- **Vendored Node 22** (`node-linux-x64@^22` devDependency; `scripts/rr.mjs`, `scripts/nw.mjs`) — sandbox shell ships Node 20; RR8-era CLI and wrangler ≥ 4.12x require Node ≥ 22. CI pins Node 22 and the wrappers fall back to the system interpreter when the platform package is absent.
- **Embedded migrations manifest for tests** — workerd test pool has no fs; `scripts/gen-migrations-manifest.mjs` embeds `migrations/*.sql` into `tests/integration/migrations.generated.ts` (generated file — never hand-edit).
- **PBKDF2-SHA256 100k iterations default** (`AUTH_PBKDF2_ITERATIONS`, clamped 50k–2M) — Workers free-plan CPU budget; raise on paid plan (SECURITY.md §2); transparent rehash on login.

## ADR-017 Content-domain referential integrity at the application layer
**Status: Accepted (Phase 2, 2026-09-05)**
- Migration 0001 (content domain: programs → … → lesson_items, videos, files, entitlements) ships **without DB-level FK constraints**. Rationale: every content write path already runs through one service module (`server/content/service.server.ts`) inside D1 batches, and retrofitting FKs onto existing SQLite/D1 tables requires table-rebuild migrations (create-copy-drop-rename) against live data — a destructive-migration class the owner has barred without backup/verification. Deferring keeps Phase 2 non-destructive.
- Compensating control: `ContentReferenceError` + `assert*Ref` guards validate EVERY referenced row (parent, program/grade/subject/course/unit, teacher, thumbnail file, video/file/exam) before insert in all create functions; the admin route maps the error to a validation response (no crash, no partial write). Regression coverage: integration tests for dangling parent/item refs, plus a live HTTP check (dangling video attach rejected — smoke §10). Identity-domain tables (0000) keep real FKs.
- Review trigger: revisit before first production data exists (Phase 7 hardening at the latest) — adding FKs pre-launch via a rebuild migration is cheap on empty tables; the app-layer guards stay regardless (defense in depth).

---

## ADR-018 Phase renumbering: Phase 3 = CMS / page builder
**Status: Accepted (Phase 3, 2026-09-05)**
- The owner redefined the phase sequence mid-project: **Phase 3 is now "production-grade, admin-controlled UI / CMS / page builder"** (delivered in 10 controlled stages), because routine visual/content changes requiring zero code deployment became a top priority ahead of the student-experience work.
- Renumbering map (old → new): student experience P3 → **P4**; assessment engine P4 → **P5**; commerce P5 → **P6**; admin platform consolidation P6 → **P7**; hardening & release P7 → **P8**. All living docs (PROJECT-PLAN, ARCHITECTURE, FEATURE-SPEC, SECURITY, DATABASE-SCHEMA, ADMIN-GUIDE, TEST-PLAN, DEPLOYMENT, PAYMENTS) were updated in one pass; the CMS/homepage-builder scope originally slated for P6 moved into P3 and the remaining P7 scope is consolidation (analytics views, audit UI, list polish).
- Historical artifacts (delivered phase reports, CHANGELOG entries, ADRs ≤ 017) keep their original numbering — this ADR is the mapping key. The brief's own numbering (e.g. "Entitlements in Phase 5") is quoted as-is where referenced.

---

## ADR-019 CMS architecture: draft tree + published snapshot + registry
**Status: Accepted (Phase 3, 2026-09-05) — extends ADR-012, whose `homepage_sections` sketch was never built**
- **Data model**: a page's draft is a tree of `blocks` rows (sections top-level, components as children, `sort_order` + `visible` per row). Publishing validates every block against its zod schema, sanitizes rich text, and freezes the tree into `pages.published_snapshot` (JSON) + appends an immutable `page_versions` row. **Public routes render ONLY the snapshot** → drafts can never leak, public rendering is a single indexed row read (performance), and publish is the single validation choke point.
- **Rollback is non-destructive**: `restoreVersion` copies a snapshot back INTO the draft tree (fresh block ids), first auto-snapshotting the current draft as a version. Versions are append-only; nothing is silently destroyed. Unknown legacy block types in old snapshots are skipped at restore (registry shrank) rather than crashing.
- **Block registry** (`app/cms/registry.ts`) is the single source of truth shared by client and server: type → zod schema, default props, field descriptors (localized text / icon-id / image / ref-picker / repeater), group, section flag, renderer. Adding a block type later = one registry entry + one renderer case — no migration, no route change (owner requirement). 39 types shipped.
- **Safety envelope** (see SECURITY §15): no arbitrary HTML/JS/CSS; allowlist sanitizer (HTMLRewriter); icon registry ids only; `safeHref` URL validation; zod-validated theme tokens emitted as CSS variables (`/theme.css`); declarative-only forms with rate-limited submissions; responsive presets instead of arbitrary CSS (mobile-first grid classes; iPhone-safe: `dvh`, `viewport-fit=cover`, safe-area utilities, 44px touch targets on small screens).
- **Integrity**: mirrors ADR-017 — plain TEXT references + `CmsReferenceError` guards in `server/cms/service.server.ts` (page/parent/menu/form/file refs validated before insert). Reserved slugs (`admin`, `api`, `files`, …) enforced; `home` slug drives `/`.
- **Permissions & audit**: `role_permissions` table with `cms.*` granular permissions (super_admin bypasses); every content/config mutation audited with before/after where practical.
- **Rejected alternatives**: (a) JSON-blob draft per page — worse concurrent-edit granularity and no per-block audit; (b) rendering drafts directly with a visibility flag — risks draft leakage on any query mistake; (c) storing HTML — violates the no-arbitrary-HTML rule. Snapshot+tree gives both safety and speed.

---

## ADR-020 Production content policy: empty-first + readiness gate
**Status: Accepted (Phase 3, 2026-09-05)**
- **Empty-first**: production starts structurally complete but content-empty (minimum system config only). No demo accounts/courses/testimonials/stats/pricing/media, no placeholder text ("Lorem", "John Doe", "Coming soon"), no silent fallbacks — a missing required production config produces a controlled admin-facing error (e.g. `VideoNotConfiguredError` pattern), never fake content. Empty image/media → element omitted or polished empty state; every content-driven area has a designed empty state ("No courses available yet.").
- **Dev fixture isolation**: seed (`scripts/seed.mjs`) and smoke (`scripts/smoke.mjs`) data exist only for local/test environments, are clearly labeled (`seed-`/`smoke-` markers, demo domains), and are never referenced by production routes or migrations.
- **Enforcement gate**: `scripts/check-production-readiness.mjs` (`npm run check:production-readiness`, `--remote` for the production D1) must pass before every production deployment. 10 checks: demo accounts, seed/smoke content (courses/pages/forms/menus/submissions…), mock video provider active, placeholder media, template branding, empty owner identity, lorem-ipsum in published snapshots, migrations fully applied, admin CMS permission seed present, ≥1 active super_admin. Any failure → non-zero exit → deploy blocked. Verified: correctly FAILS (exit 1, 6 findings) against the seeded dev DB and passes system checks.
- **Content lifecycle**: draft → preview → publish → unpublish → archive → delete (soft, `deleted_at`) / restore; no one-way operations, no hard deletes that break integrity.

---

## Verification queue (must complete before related implementation)

| Item | Phase | Status |
|------|-------|--------|
| Mux playback model (signed JWT, restrictions, thumbnails) | 2 | ✅ verified 2026-09-05 — mux.com/docs (Mux fundamentals; Securing video playback with signed URLs; React Native playback page confirming `?token=` usage) |
| Mux upload API specifics + Workers Ed25519 WebCrypto support | 2 | ⚠️ partial (2026-09-05): Ed25519 WebCrypto sign/verify proven INSIDE workerd (integration test); direct-upload + asset-sync implemented per docs but **unexercised against the live Mux API (no production credentials here)** — must re-verify schemas on first credentialed run. Provider-switch behavior verified live: missing creds → loud `VideoNotConfiguredError`, no silent fallback |
| Bunny Stream token auth (future adapter) | later | pending |
| Paymob: official API, Egypt, webhooks, signature, refunds | 6 | pending |
| Fawry: same | 6 | pending |
| Stripe: merchant-entity country constraints | 6 | pending |
| Email provider (e.g., Resend) for reset/notifications | 4+ | pending |
| WhatsApp: official WhatsApp Business Platform only | 7+ | pending (legal/account prerequisites) |
| Cloudflare free-tier limits vs projected usage | ongoing | doc'd in DEPLOYMENT §8 |
