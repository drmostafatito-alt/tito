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
| Payments | `PaymentProvider` interface — **manual rail** (transfer + admin approval) first; verified gateways Phase 5 |
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
  ├─ routes/_teacher/   content authoring (Phase 4+)        (teacher role)
  ├─ routes/_admin/     admin platform (Phase 6)            (admin/super_admin)
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
**Student:** `/dashboard` · `/my/courses` · `/learn/:courseSlug/:lessonSlug` (video+files+quiz) · `/exams` · `/exams/:id` `/exams/:id/attempt` · `/results` · `/devices` · `/notifications` · `/profile` `/profile/security` · `/cart` `/checkout` `/orders` (Phase 5).
**Teacher (Phase 4+):** question bank, exam authoring, their course content.
**Admin (Phase 6, grows from Phase 1):** `/admin` overview + Students · Teachers · Content tree · Videos · Files · Question bank · Exams · Results · Orders · Payments · Subscriptions · Activation codes · Discount codes · Notifications · CMS · Settings · Security (devices/sessions/events) · Audit log · Analytics.
**Resource routes:** `/webhooks/payments/:provider` (signature-verified) · `/beacons/progress` (session-validated) · `/files/:id/*` (signed URL redirect) · `/api/playback/:videoId` (entitlement-checked token minting).

## 6. Authentication & session model (ADR-004/005)

- Register (rate-limited, Zod-validated) → PBKDF2 hash (600k iterations, 16-byte salt, constant-time compare).
- Login → device resolution: durable cookie `dk` (random 128-bit) → SHA-256 hash looked up per user. Policy from settings (`devices.max_per_student`, `devices.on_limit: block|replace_oldest`, `devices.change_limit_per_30d`). Evictions/limits → `security_events`.
- Session token: 256-bit random, stored hashed, `HttpOnly; Secure; SameSite=Lax; Path=/`, sliding 30-day expiry (configurable). Logout revokes the session row — device slot is **not** freed by mere logout when policy says so (device binding persists; revocation is explicit).
- Password reset: single-use 256-bit token (hashed, 60-min TTL); change password requires current password and revokes all other sessions.
- Suspicious-login heuristics: new device + new IP class + off-hours → optional admin review flag (settings-driven).

## 7. Authorization model

- **RBAC layer:** `student` < `teacher` < `admin` < `super_admin`. Route groups enforce via layout guards (server). Teacher/admin permission matrix is a settings document (super_admin edits).
- **Resource layer (entitlements resolver):** `canAccess(student, {resourceType, resourceId})` walks: content status → `access_level` (`public|authenticated|entitled`) → matching entitlement rows (course/subject/bundle/plan, with expiry & status) → admin override. One function, fully cached per request, unit-tested exhaustively. UI only *renders* the resolver's verdict; it never decides.

## 8. Settings & CMS architecture (ADR-012)

Typed groups in `settings` (Zod-validated on read and write): `platform` (name, logo, locale default, maintenance), `theme` (color tokens within safe palette), `homepage` (ordered section documents), `menus`, `footer` (contact, social, WhatsApp), `announcements`, `devices`, `security`, `exams` (global defaults), `video` (replay defaults, completion threshold), `payments` (enabled rails, manual instructions), `locale`. Homepage = array of typed section blocks (`hero`, `banner`, `text`, `courses-showcase`, `pricing`, `cta`, `stats`) rendered by generic block components — reordering/adding sections requires zero deploys. All changes audited with before/after diff.

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
- Admin analytics (Phase 6) aggregates via SQL over `events` + domain tables.

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
