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

---

## Verification queue (must complete before related implementation)

| Item | Phase | Status |
|------|-------|--------|
| Mux playback model (signed JWT, restrictions, thumbnails) | 2 | ✅ verified 2026-09-05 — mux.com/docs (Mux fundamentals; Securing video playback with signed URLs; React Native playback page confirming `?token=` usage) |
| Mux upload API specifics + Workers Ed25519 WebCrypto support | 2 | pending (scaffold-time re-check) |
| Bunny Stream token auth (future adapter) | later | pending |
| Paymob: official API, Egypt, webhooks, signature, refunds | 5 | pending |
| Fawry: same | 5 | pending |
| Stripe: merchant-entity country constraints | 5 | pending |
| Email provider (e.g., Resend) for reset/notifications | 3+ | pending |
| WhatsApp: official WhatsApp Business Platform only | 6+ | pending (legal/account prerequisites) |
| Cloudflare free-tier limits vs projected usage | ongoing | doc'd in DEPLOYMENT §8 |
