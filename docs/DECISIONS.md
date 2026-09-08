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

## ADR-021 Student progress & playback policy (Phase 4)

**Context.** Phase 4 needs lesson/video progress, resume, completion, and replay
policy. The video pipeline (ADR-006), entitlement resolver (ADR-009), and settings
system (ADR-012) already exist; progress must not weaken any of them.

**Decision.**
1. **DB is the single source of truth** for progress (D1 tables `lesson_progress`,
   `video_progress`, `video_watch_sessions`, `events` — additive migration 0004).
   localStorage is never authoritative; the client only reports positions.
2. **Progress is per student, not per device** (FEATURE-SPEC §4). `device_id` is
   recorded on watch sessions for analytics/audit only.
3. **Client-reported positions are sanity-clamped** (0..duration) and treated as
   self-report — they unlock nothing. Every beacon re-checks the session AND the
   lesson entitlement server-side (`POST /beacons/progress`); progress writes can
   never grant access.
4. **Completion is server-decided**: a video completes at
   `settings.video.completionThresholdPct` (default 90) of its duration; a lesson
   auto-completes only when ALL its required items are videos that completed
   (files/exams have no completion signal yet — students mark those lessons
   complete explicitly). The `lesson_complete` event is emitted exactly once
   (pre-read `wasCompleted` guard).
5. **Replay policy is enforced at credential-mint time** in `POST /api/playback/:id`
   using the pre-increment `watch_count` (`settings.video.replayLimit`, 0 = unlimited
   default; admins rank ≥ 3 bypass, mirroring the resolver). Enforcement happens
   before minting, so a denied replay never produces credentials.
6. **Progress writes never block entitled playback**: `startWatch` runs after the
   mint inside try/catch; a failed progress write cannot deny a video the student
   is entitled to.
7. **Resume**: `resumeAt` is returned by the playback API (position > 5s and not
   completed); the player seeks on `loadedmetadata`. Heartbeats are debounced (10s)
   and fire-and-forget (`fetch keepalive`; `sendBeacon` for the final "ended" beacon
   on `pagehide`) per ARCHITECTURE §13/§15.
8. **Course % = completed published lessons / published lessons** of published
   units. Draft/unpublished content never counts and never renders.

**Consequences.** One additive migration; two new settings knobs (defaults preserve
prior behavior); no changes to the provider abstraction, signed-URL discipline, or
CMS. Beacons are a resource route outside the document shell (no CSRF token needed —
session cookie + same-origin middleware still apply).

## ADR-022 Assessment engine (Phase 5)

**Context.** Phase 5 adds the question bank, exam builder, attempt engine,
auto-grading and results. Reserved structures from earlier phases had to be
used, not duplicated: the lesson-page exam item slot (P2/P3), the
`exam_start`/`exam_submit` event types (P4 schema), the beacon/idempotency
discipline (P4 resource routes), and the entitlement resolver (ADR-009).
Essay grading is explicitly deferred by the owner brief; the schema must not
block it.

**Decisions.**
1. **Domain separation.** Exam DATA lives in the Assessment domain
   (`server/assessment/*`, 8 tables). The CMS/content system only LINKS an
   exam via `lesson_items.exam_id`; the lesson page renders the card from the
   Assessment service. No exam fields were added to content tables.
2. **Answer-key containment.** `attemptContext` is the ONLY live-attempt
   serializer and is sanitized by construction (id/type/stems/points/choices
   with content only). Correctness flags, feedback and explanations exist
   server-side until submission, then reappear only through
   `attemptSummary`/`attemptReview` under the `results.*` policy. Review is
   additionally gated by summary visibility: a hidden result (show=manual /
   before window end) leaks NOTHING per-question either.
3. **Server-authoritative timing.** `started_at`/`deadline_at` are computed
   from the server clock at start; the client renders a countdown from
   `remainingSeconds` only. Submission/expiry compare against the server clock
   with `settings.assessment.graceSeconds`; past deadline+grace the attempt is
   AUTO-SUBMITTED with the answered-so-far set (FEATURE-SPEC §6). No client
   timestamp is ever read. Expiry runs as sweep-on-touch (loader/action
   entry) — Workers have no cron in this deployment.
4. **Frozen attempt sets.** `startAttempt` materializes questionOrder +
   per-question points into `exam_attempts.metadata`. Grading/review use ONLY
   the frozen data — bank edits mid-attempt cannot change an in-flight exam.
   Randomization is seeded (`random_seed`, mulberry32, per-question choice
   seed) so the student's own order is reproducible in review.
5. **Exactly-once submission.** `submitAttempt` claims the attempt with a
   conditional UPDATE (`status IN (in_progress,grading) → grading`) and checks
   D1's `meta.changes`; only the claimer grades and emits `exam_submit`.
   Replays return the stored result. `exam_start` is emitted once at
   materialization; the partial-unique live-attempt index turns duplicate
   starts (race) into resumes.
6. **Mutations via a resource route.** Save/submit go to
   `POST /api/exam-attempt` (no component) — the P4 beacon discipline: plain
   `fetch` and `sendBeacon` (which cannot set RR single-fetch headers) receive
   the JSON verdict verbatim, and a pagehide beacon works as the last-resort
   autosave flush. UI-route actions are for RR `<Form>` flows only (start).
7. **Grading abstraction.** Auto-grading is a pure function over frozen
   metadata + stored answers (mcq/true_false exact; multi_select partial
   credit `points × max(0, hits−misses)/totalCorrect`, 2dp, toggleable).
   `grading_status` (auto|needs_manual|complete), `text_answer`, `graded_by`
   and `essay_points` are reserved so manual essay grading slots in WITHOUT
   touching the attempt engine; essay questions are creatable in the bank but
   NOT attachable to exams in P5 (fail-closed validation).
8. **Completion semantics.** A required exam item completes its lesson when an
   attempt is GRADED (submitted) — pass/fail is scoring, not completion;
   opening an attempt never completes anything (ADR-021 §4 rule extended in
   `maybeAutoCompleteLesson`).
9. **Availability windows are entered in UTC** in the admin builder
   (datetime-local parsed as UTC, labeled as such) — the server has no single
   admin timezone; window governs START only, deadline governs submit.
10. **Non-destructive lifecycle.** Exams: draft→published→archived
    (unarchive→draft); archiving/unpublishing never touches attempts.
    Questions: soft delete, refused while attached. Exam question-set edits
    are draft-only. `manual_extra_allowed` is stored per contract but NOT
    enforced in P5 (documented limitation).

**Consequences.** Attempt rows are self-contained grading inputs (audit +
regrade-safe). FTS5 question search is deferred (LIKE on stems is adequate at
bank sizes; indexed composite covers admin filters). The readiness gate now
also detects seeded demo exams/questions/tags.

## ADR-023 Commerce engine: payment never authorizes; frozen specs; integer money (Phase 6)

**Context.** Phase 6 adds products/pricing, orders, the manual payment rail,
activation codes, discounts, subscriptions and refunds. Reserved structures
were binding: the `Commerce (P6)` schema block (DATABASE-SCHEMA.md),
PAYMENTS.md (rails/state machines/records), the `entitlements` engine
(ADR-009) and the provider-abstraction pattern proven by VideoProvider
(ADR-007). The owner rule is absolute: **payment does NOT directly authorize
access** — only `verified payment / manual activation → entitlement grant →
the EXISTING resolveAccess()`.

**Decisions.**
1. **One fulfillment transaction, one grant path.** `fulfillPaid` is the ONLY
   code that creates purchase entitlements: it conditionally claims the
   payment (`pending|under_review → paid`, `changes==0` ⇒ idempotent no-op
   return), then one `db.batch` writes order→paid, entitlement rows
   (`source_type: order_item|subscription`), the subscription row (recurring
   plans; `plan_snapshot` embeds `orderId` for refund-revocation) and the
   exactly-once `purchase` event. Admin approval and signature-verified
   webhooks both funnel through it; nothing else grants.
2. **Frozen entitlement specs.** At order time `buildEntitlementSpec`
   validates every product item (node exists + published) and freezes
   `{grants, durationDays, fixedExpiresAt}` into `order_items.entitlement_spec`.
   Fulfillment reads the freeze — later catalog edits never rewrite history.
3. **Server-side pricing only.** Amounts are integer minor units end to end
   (`money.ts` is float-free by construction: `Math.trunc` formatting, floor
   discounts). Checkout reads product/plan from the DB by id; the client
   submits `pricePlanId` and NOTHING monetary — tamper fields are not parsed.
   Promo windows/compare-at are evaluated on the server clock.
4. **State machines are data.** PAYMENTS.md §2 transitions live in
   `PAYMENT_TRANSITIONS`/`ORDER_TRANSITIONS` + `canTransition`; every mutation
   is a conditional UPDATE claim (compare-and-set) so concurrent callers can
   never double-advance. Illegal jumps throw `CommerceStateError`.
5. **Manual rail discipline.** Order → pending payment with a frozen
   `instructions` snapshot (reference = order number + localized instructions
   from `settings.payments`) → student submits evidence (`confirm`, claim
   `pending→under_review`, evidence in `metadata`) → admin approves with the
   EXACT server total (`amount_mismatch` otherwise) or rejects (→ `failed`;
   the student may resubmit on a NEW payment row — 1:N attempts). Submission
   of a reference grants nothing.
6. **Atomic activation codes.** Codes are crypto-random over an
   ambiguity-free alphabet, stored as SHA-256 of the normalized code (+prefix
   for admin search), plaintext shown exactly once. Redemption = pre-checks
   for precise reasons, then a conditional `use_count+1` claim
   (`WHERE active ∧ use_count<max ∧ expiry-ok`, exhaustion folded into the
   CASE) + `UNIQUE(code_id, student_id)`; a unique-catch compensates
   `use_count−1`. Two concurrent redeemers ⇒ exactly one winner (tested).
7. **Discounts without oracles.** Hashed storage; ANY invalid/inactive/
   window-miss code returns the generic `discount_invalid` (no existence
   leak); limits (`max_uses`, `per_user_limit`, `min_order`) enforced via a
   conditional claim UPDATE + per-user subquery, with `used_count−1`
   compensation if the order batch fails.
8. **Refunds are full, windowed, non-destructive.** `paid→refunded` claim,
   `refunds` row, order→refunded, entitlements revoked with reason
   `refund:<paymentId>` (subscription entitlements matched via
   `json_extract(plan_snapshot,'$.orderId')`), subscription cancelled, the
   `purchase` event marked `action: refunded`. History is never deleted;
   access flips through the same resolver. Partial refunds deferred.
9. **Sweeps on touch (no cron).** Order TTL expiry and subscription period
   expiry run inside student loaders (`ordersForStudent`) — Workers-safe.
10. **RBAC + audit on every mutation.** 7 `commerce.*` permissions (rank≥4
    bypass, rank3 via `role_permissions` — the CMS/assessment model);
    `logAudit` on product/price/order/payment/code/discount/refund/
    subscription mutations with before/after diffs.

**Consequences.** Access decisions remain 100% inside `resolveAccess()` —
commerce only writes entitlement rows, so Phases 1–5 gating is untouched and
revocation (refund/pause/expiry) is automatically honored everywhere.
Idempotency is structural (claims + unique indexes), not incidental. Known
deferrals: cart, partial refunds, admin-created orders UI (schema supports
`source='admin'`), reconciliation cron (mock `fetchRemoteStatus` reports
unknown; TTL sweep covers expiry), dashboard expiry card (Phase 7).

## ADR-024 No real payment gateway before verification; binding-gated mock (Phase 6)

**Context.** PAYMENTS.md §3 makes gateway adapters verification-gated:
official docs, webhook signature scheme, sandbox, refund API and merchant
prerequisites must be recorded in the §6 log BEFORE adapter code exists. At
Phase 6 delivery no candidate (Paymob/Fawry/Stripe) had a recorded
verification, and the owner brief forbids real payments/transactions in
tests.

**Decisions.**
1. **No vendor adapter ships.** The `PaymentProvider` interface
   (`server/payments/provider.ts`) + `paymentProviderRegistry(env)` are the
   only contract; `manual` is always registered.
2. **A `mock` adapter proves the gateway discipline** end to end
   (createCheckout → provider reference → HMAC-signed webhook → verify →
   idempotent inbox → fulfill/flag). It registers ONLY when
   `MOCK_PAYMENTS_SECRET` is bound: integration tests and local dev bind it;
   production never does, so the adapter and its webhook path are inert
   there (unknown provider ⇒ 404). The readiness gate flags any
   `payments.provider='mock'` row as deploy-blocking demo data.
3. **Webhook ingestion is provider-agnostic:** signature verification BEFORE
   parsing; `payment_events` inbox unique per `(provider, provider_event_id)`
   with `onConflictDoNothing` ⇒ replay-safe 200 `duplicate`; invalid
   signatures recorded (`signature_valid=0`) and 400-rejected; amount
   mismatches flag the payment `under_review` for a human — never
   auto-fulfill; sanitized payload storage only.
4. **No secret ever reaches the frontend:** provider keys/HMAC secrets are
   server-binding-only; checkout UI exposes no provider configuration.

**Consequences.** Adding a real gateway later = one adapter file + registry
entry + a §6 verification row — zero domain changes. Until then the manual
rail + activation codes are the production payment surface, exactly as
FEATURE-SPEC §7 prescribes for v1.

## ADR-025 Announcements ARE the in-app notification system (lazy reads, no fan-out) (Phase 7)

**Context.** FEATURE-SPEC §9 defines platform announcements with a
draft/publish lifecycle, audience targeting and a student inbox with unread
state — and nothing more. A generic `notifications` fan-out table (one row
per recipient at publish time) would multiply writes by audience size,
complicate post-publish edits, and leave backfill problems for users who
register later. External channels (email/WhatsApp/push) are not verified and
stay gated exactly like payment gateways (ADR-024 discipline).

**Decisions.**
1. **Two tables ship (migration 0007, additive):** `announcements`
   (bilingual title/body as PLAIN TEXT — nothing to sanitize; audience
   `all|students|teachers`; status `draft|published|archived`; optional
   `publish_at` schedule + `expires_at` window; `published_at` stamp;
   `created_by`) and `announcement_reads` (UNIQUE(announcement_id, user_id)
   — lazy read receipts; user_id is an app-ref per ADR-017).
2. **Visibility is computed at READ time, server-side:**
   `status='published'` AND window open (`publish_at` NULL/≤now,
   `expires_at` NULL/>now) AND audience matches the viewer (admins match
   `all` only). Drafts, archived and expired rows never reach students —
   smoke-verified end to end. Post-publish edits apply to everyone
   immediately; there are no stale per-user copies.
3. **Read state is lazy:** an `announcement_reads` row exists only after the
   user marks read (`onConflictDoNothing` ⇒ idempotent). Unread badge =
   visible announcements minus the user's read rows — two indexed queries,
   zero write amplification. `markAllRead` inserts at most 100 rows per call
   (bounded Workers write).
4. **Lifecycle guards live in the service:** create always lands as draft;
   update allowed on draft+published (archived is frozen); unpublish returns
   to draft keeping `published_at`; publish rejects an `expires_at` already
   in the past; archive is a frozen terminal state. There is NO delete path —
   announcements are permanent operational records. Every mutation writes an
   audit row (`announcements.create/update/publish/unpublish/archive`)
   through the existing audit infrastructure.
5. **No external channel and no `server/notifications/` module ship.** The
   student notification center (`/notifications`, nav unread badge) IS the
   v1 notification system; `server/announcements/service.server.ts` owns the
   domain. Email/WhatsApp require a recorded verification (provider docs,
   deliverability, opt-in rules) before any adapter code — same gate as
   ADR-024.
6. **Announcements are operational content, not analytics events:** they are
   never counted into learning/video/exam metrics.

**Consequences.** Publish cost is O(1) regardless of audience size;
registration-during-publication works with no backfill. Per-user
notification preferences or an external channel can layer on later without
schema change (audience column + user-scoped reads already exist). The
`teachers` audience value is reserved by the spec and behaves as "no
matching users" until a teacher role ships.

## ADR-026 Course prerequisites are a completion-gated DAG enforced at open time (Phase E)

**Status: Accepted**

- **Context:** Courses are stand-alone today; nothing sequences them. Phase E adds course-level prerequisites so a learner must finish earlier course(s) before opening a later one. There is no completion/“enrollment” model besides per-lesson progress.
- **Decision:**
  1. **Data:** a `course_prerequisites` junction table (course_id → prerequisite_course_id), plain TEXT refs with app-layer integrity (both ends must exist; self-reference, duplicates and **cycles** are rejected at write — `setCoursePrerequisites` validates the resulting graph stays a DAG). Completion is defined by the learner: a prerequisite course is “completed” once **every published lesson** of it has a `completed` `lesson_progress` row (and it has ≥1 published lesson).
  2. **Server gate:** `coursePrereqGate(db, {userId, roleRank}, courseId)` returns `{locked, missing}` for a signed-in **student** against the **transitive closure** of live (published, non-deleted) prerequisites. It is layered on top of `resolveContentAccess`, which stays a pure entitlement/visibility decision (no DB/progress access). It is consulted at the **open surfaces**: the course page (`/courses/:slug`, renders a locked state listing missing prerequisites and refuses lesson/unit access) and the learn route (a gated student is redirected to the course page). Staff (roleRank ≥ 2) and anonymous viewers bypass.
  3. **Storefront stays the storefront:** the public catalog and buy CTAs still list/lock purchase of a prerequisite-gated course — a learner must be able to browse and buy before prerequisites are met. Gating applies to **opening content**, not to browsing/buying. (This is the deliberately chosen scope for “only sees/opens”; the page shows the prerequisite requirement rather than hiding the course.)
  4. **Clone independence:** `duplicateNode` copies the course subtree only and does **not** carry prerequisite edges, media binaries, progress, entitlements or audit — consistent with copies defaulting to draft with scheduling cleared; admin re-applies prerequisites on the copy via the course editor.
- **Consequences:** prerequisites compose transitively and are cycle-safe; admins manage them per course in the node editor (`_action=set-prerequisites`, audited as `content.course.prerequisites`). An archived/draft prerequisite stops gating (it is not live/completable), preventing permanent lockout; admins are expected to prune stale edges. Requires migration `0012_course_prerequisites.sql`.
