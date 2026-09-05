# Architecture

> Status: **Phase 0 — approved baseline.** This document describes the system as designed;
> it is updated in the same phase as any architectural change (see `DECISIONS.md` ADRs).

## 1. Decided stack (ADR-001/002/006/007/008)

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers (Workerd) — one deployable |
| Framework | **React Router v7 (framework mode)** — SSR + client navigation, TypeScript strict |
| Build | Vite + `@cloudflare/vite-plugin`; scaffolded from the official RR7 Cloudflare template (Phase 1) |
| Database | **Cloudflare D1** (SQLite) via Drizzle ORM, versioned migrations |
| Object storage | **R2** — `public-assets` (cacheable), `private-files` (signed URLs only), `video-masters` (never public) |
| Video | `VideoProvider` interface — **Mux** adapter (production), **mock** adapter (dev), future: Bunny/Cloudflare Stream |
| Payments | `PaymentProvider` interface — **manual rail** (transfer + admin approval) first; verified gateways Phase 6 |
| i18n | **Arabic + English, RTL/LTR** from day one; logical CSS properties; Arabic default (admin-configurable) |
| Auth | Email/password, PBKDF2-SHA256 (600k iter, WebCrypto), opaque DB-backed sessions bound to devices |
| Testing | Vitest (+ Workers pool), Playwright e2e, real-device matrix |

## 2. System shape

```
Browser (iPhone-first, RTL-ready)
  │  HTTPS only · HTML SSR + hydrated RR7 app
  ▼
Cloudflare edge ── WAF/CDN ──► Worker (the app)
  RR7 router
  ├─ routes/_public/    marketing, catalog, auth, pricing   (no auth required)
  ├─ routes/_student/   dashboard, learn, exams, devices    (session required)
  ├─ routes/_teacher/   content authoring (Phase 5+)        (teacher role)
  ├─ routes/_admin/     admin platform (Phase 7)            (admin/super_admin)
  └─ routes/resources/  webhooks (payment), beacons (progress) — signature/entropy verified
  every loader/action = server code ──► server/ modules
      auth · entitlements · exams · settings · audit · http(guards)
      video/<provider>  payments/<provider>  files(R2)  notifications/<channel>
  │            │              │
  D1           R2          External (Mux now; gateways later)
```

**Golden rules**
1. Business logic lives in `server/` modules; routes are thin adapters (validate → call module → return).
2. `*.server.ts` files are guaranteed server-only (bundler-enforced); client code can never import them.
3. Vendor SDKs never appear in business logic — only inside `server/<domain>/providers/<name>`.
4. Access decisions come from exactly one place: the entitlements resolver. No scattered `if (user.paid)` checks.
5. Exam timing, replay limits, payment confirmation, entitlement checks: **always server-authoritative**.

## 3. Project structure

```
/
├─ app/                          # client + shared UI
│  ├─ routes/  _public/ _student/ _teacher/ _admin/ resources/
│  ├─ components/  ui/ (design system) · player/ · exams/ · admin/
│  ├─ lib/        client-safe only (fetchers, i18n, format, player glue)
│  ├─ locales/    ar/ en/ namespaced dictionaries
│  └─ root.tsx · routes.ts · entry.client.tsx · entry.server.tsx
├─ server/
│  ├─ db/         schema/ (Drizzle) · migrations/ · seed.ts · repositories/
│  ├─ auth/       password.server.ts · session.server.ts · guards.server.ts
│  ├─ entitlements/ resolver.server.ts · grant.server.ts
│  ├─ video/      provider.ts (interface) · providers/mux · providers/mock · progress.server.ts
│  ├─ payments/   provider.ts · providers/manual (+verified gateways later) · webhooks.server.ts
│  ├─ exams/      attempt.server.ts · grading.server.ts · selection.server.ts
│  ├─ files/      storage.server.ts (R2 signing) · validation.server.ts
│  ├─ settings/   schema.ts (Zod groups) · service.server.ts
│  ├─ audit/      log.server.ts
│  ├─ notifications/ channel.ts · channels/{inapp,email}.server.ts
│  └─ http/       middleware.server.ts (headers, origin check, rate limit) · errors.ts
├─ tests/  unit/ integration/ e2e/ fixtures/
├─ docs/  (this set)
├─ wrangler.jsonc  .dev.vars.example  vite.config.ts  drizzle.config.ts  package.json
```

## 4. Request lifecycle

1. Edge → Worker. `http/middleware` applies security headers, Origin/`Sec-Fetch-Site` check for mutations (CSRF), and D1-backed rate limits on sensitive routes.
2. `getLoadContext` builds the per-request context: `env` (D1/R2/secrets bindings) + `authContext` (resolved lazily from the session cookie: user, role, active device) + `settings` (typed, request-cached).
3. RR7 runs the matched route's `loader` (GET) or `action` (POST/PATCH/DELETE) — server code with full bindings.
4. Guards: route group layout enforces session/role; resource-level checks call `entitlements.resolver`.
5. Mutations validate input with Zod, run inside D1 transactions where multi-table consistency matters (orders→payments→entitlements; attempt finalization; code redemption).
6. Responses: SSR HTML (documents) or JSON (client navigations, beacons). Errors go through `http/errors.ts` → typed `AppError` codes; error boundaries render friendly localized messages; internals are logged server-side only.

## 5. Route map (target)

**Public:** `/` (CMS-rendered homepage) · `/courses` · `/courses/:slug` · `/subjects/:slug` · `/pricing` · `/login` `/register` `/forgot-password` `/reset-password` · `/contact` · legal pages.
**Student:** `/dashboard` · `/my/courses` · `/learn/:courseSlug/:lessonSlug` (video+files+quiz) · `/exams` · `/exams/:id` `/exams/:id/attempt` · `/results` · `/devices` · `/notifications` · `/profile` `/profile/security` · `/cart` `/checkout` `/orders` (Phase 6).
**Teacher (Phase 5+):** question bank, exam authoring, their course content.
**Admin (Phase 7, grows from Phase 1; CMS live since Phase 3):** `/admin` overview + Students · Teachers · Content tree · Videos · Files · Question bank · Exams · Results · Orders · Payments · Subscriptions · Activation codes · Discount codes · Notifications · CMS · Settings · Security (devices/sessions/events) · Audit log · Analytics.
**Resource routes:** `/webhooks/payments/:provider` (signature-verified, Phase 6) · `/beacons/progress` (session-validated, Phase 4) · `/files/:id?perm&view-signature` (**live P2**: streams the private R2 object after HMAC-signed-URL verification — id+perm+exp covered by the signature; denials are 404-shaped; Range supported) · `/api/playback/:videoId` (**live P2**: POST-only, entitlement-checked token minting; GET → 302) · `/api/mock-stream/:videoId/:file` (**live P2, dev provider**: token-scoped synthetic HLS/poster; disappears from the request path when Mux is the active provider).

## 6. Authentication & session model (ADR-004/005)

- Register (rate-limited, Zod-validated) → PBKDF2 hash (600k iterations, 16-byte salt, constant-time compare).
- Login → device resolution: durable cookie `dk` (random 128-bit) → SHA-256 hash looked up per user. Policy from settings (`devices.max_per_student`, `devices.on_limit: block|replace_oldest`, `devices.change_limit_per_30d`). Evictions/limits → `security_events`.
- Session token: 256-bit random, stored hashed, `HttpOnly; Secure; SameSite=Lax; Path=/`, sliding 30-day expiry (configurable). Logout revokes the session row — device slot is **not** freed by mere logout when policy says so (device binding persists; revocation is explicit).
- Password reset: single-use 256-bit token (hashed, 60-min TTL); change password requires current password and revokes all other sessions.
- Suspicious-login heuristics: new device + new IP class + off-hours → optional admin review flag (settings-driven).

## 7. Authorization model

- **RBAC layer:** `student` < `teacher` < `admin` < `super_admin`. Route groups enforce via layout guards (server). Teacher/admin permission matrix is a settings document (super_admin edits).
- **Resource layer (entitlements resolver):** `canAccess(student, {resourceType, resourceId})` walks: content status → `access_level` (`public|authenticated|entitled`) → matching entitlement rows (course/subject/bundle/plan, with expiry & status) → admin override. One function, fully cached per request, unit-tested exhaustively. UI only *renders* the resolver's verdict; it never decides.

## 8. Settings & CMS architecture (ADR-012 → superseded/extended by ADR-019, live since Phase 3)

**Settings** — typed groups in `settings` (Zod-validated on read and write): `platform` (owner identity, logo, favicon, socials, contact), `theme` (validated design tokens → served as CSS variables at `/theme.css`; never arbitrary CSS), `presentation` (course-card toggles, lesson-page block selection, player options), plus the Phase-1 groups (`devices`, `security`, `exams`, `video`, `payments`, `locale`, `maintenance`). All changes audited with before/after diff.

**CMS (Phase 3)** — full guide: `docs/CMS.md`.

- **Draft tree**: a page's draft is a tree of `blocks` rows (section blocks top-level, component blocks as children). Every mutation (add/update/reorder/duplicate/visibility/delete) is permission-checked (`cms.*` via `role_permissions`; super_admin bypasses) and audited.
- **Block registry** (`app/cms/registry.ts`) is the single source of truth: ~40 block types, each with a zod schema, default props, field descriptors (localized text, icon-id pickers, image pickers, repeaters, ref pickers), and a renderer in `app/components/cms/blocks.tsx`. Adding a block type = one registry entry + one renderer case; no schema migration, no route change.
- **Publish** = validate every block against its schema → sanitize rich text (HTMLRewriter allowlist) → serialize into `pages.published_snapshot` + append a `page_versions` row. **Public routes render ONLY the snapshot** — drafts can never leak and rendering is one indexed row read. Preview (`/admin/cms/preview/:pageId`) renders the draft server-side, admin-only.
- **Rollback** = copy a version snapshot back into the draft tree (non-destructive; versions never deleted; an auto-snapshot of the current draft is taken first).
- **Safety**: no arbitrary HTML/JS/CSS anywhere — rich text allowlist-sanitized (elements stripped or unwrapped, `on*` dropped, URLs via `safeHref`), icons are registry ids (never raw SVG), links/`href` validated (`javascript:`/`data:`/insecure http rejected), form behavior declarative-only (validated fields, consent, messages; rate-limited submissions), layout via responsive presets (mobile-first grid classes, no arbitrary CSS), CSP-compatible (no inline styles).
- **Menus** (`menus`/`menu_items`, locations: header/footer/student/legal) drive the public header/footer and student nav; **forms** (`forms`/`form_fields`/`form_submissions`) are embedded on pages via the `form_block` block.
- **SEO**: per-page `seo` JSON (title/description/canonical/OG/robots, zod-validated) rendered through `seoMeta()`; sitemap-clean slugs with reserved-word protection.

## 9. i18n & RTL (ADR-008)

- Locales: `ar` (default) and `en`; resolution order: user preference → cookie → `Accept-Language` → default. `<html lang dir>` set server-side.
- Dictionaries: namespaced JSON per locale, route-level lazy loading; user-generated content stored with explicit `_ar`/`_en` columns (fallback chain documented in FEATURE-SPEC).
- Styling: logical properties only (`margin-inline`, `inset-inline`…), direction-aware iconography, `unicode-bidi: isolate` for mixed runs, Arabic-first typography (self-hosted woff2: IBM Plex Sans Arabic + Inter; no external font CDN).
- Numbers/dates: `Intl` formatting (`ar-EG` with Latin digits initially — admin-configurable).

## 10. Video pipeline (detail in VIDEO-PROVIDERS.md)

Ingest: admin uploads master → R2 `video-masters/` → provider upload (Mux direct-upload) → `videos` row tracks `provider`, `asset_id`, `playback_id`, `status` (poll/sync). Playback: `POST /api/playback/:videoId` → entitlement + replay-policy check → mint provider credentials (Mux signed JWT, short TTL) → client player (hls.js; Safari uses native HLS). Progress beacons update `video_progress` (position, watch sessions, completion threshold, replay count).

## 11. Payments (detail in PAYMENTS.md)

Order → checkout (manual rail first) → `payments` row (`pending`/`under_review`) → admin approval **or** signature-verified webhook → single transaction marks `paid` + creates entitlements/subscriptions. Success pages never grant anything.

## 12. Observability

- `events` (append-only product analytics) — brief §24 event list.
- `audit_logs` — actor, action, entity, before/after diff, IP hash.
- `security_events` — auth/device anomalies.
- Workers platform logs (observability) for errors; structured `console` with request ids.
- Admin analytics (Phase 7) aggregates via SQL over `events` + domain tables.

## 13. Performance budgets

- SSR HTML ≤ ~150KB (gzip) initial; route-level code splitting; images: sized variants + `srcset` + lazy; lists paginated (default 20–50); D1 queries indexed per schema; settings/entitlements request-cached; static assets immutable + CDN cache; fonts `font-display: swap`, preloaded subsets.
- Mobile networks first: beacons instead of blocking calls for progress; exam autosave debounced (3s) + `sendBeacon` on pagehide.

## 14. Error handling & resilience (brief §44/45)

Every mutation path: loading → success → error state with localized, actionable message and retry where safe. Network loss: exam answers queued client-side and re-sent with attempt version; player resumes from last server-known position; optimistic UI avoided on money/exams. Maintenance mode (setting) serves a friendly page to non-admins.

## 15. iOS/Safari-first frontend rules

- `100dvh`/`svh` (never naive `100vh`); safe-area insets (`env()`) for fixed bottom nav/sticky headers; `playsinline` on all video; scroll-lock via `position: fixed` overlay pattern for modals (body scroll freeze); 16px+ inputs (no iOS zoom); `visualViewport` handling for keyboards; orientation changes re-measured via `ResizeObserver`; PiP via standard API where present; `pagehide`/`visibilitychange` for beacons (not `unload`).

## 16. Module dependency rules (lint-enforced)

```
app/*            → app/lib, app/components        (never server/)
server/*         → server/* (no cycles), drizzle, zod
providers/*      → vendor SDK/HTTP only, isolated
routes/*         → server modules via context only
```
