# Test Plan

> Status: **Phase 0 strategy.** Per-phase execution results are appended in §6.
> Rule: a phase is not done until its rows in §4 pass and the regression checklist (PROJECT-PLAN §6) is green.

## 1. Layers & tools

| Layer | Tool | Runs | What it proves |
|---|---|---|---|
| Unit | Vitest | every PR | entitlement resolver matrix, exam timing/deadline math, grading & partial credit, code hashing/normalization, policy evaluators, settings Zod schemas |
| Integration | Vitest + Workers runtime (miniflare pool) with real local D1/R2 | every PR | auth flows, device policy, file signing, webhook signature verification + idempotency, transactional grant paths, attempt finalization under races |
| E2E | Playwright (local `wrangler dev` target) | pre-release + per-phase for critical flows | student journey end-to-end, exam journey, admin content → student visibility |
| Device matrix | Manual, real devices | Phases 3, 7 (+touch points per phase) | iPhone Safari/Chrome, iPad Safari, Android Chrome, desktop Chrome/Edge |

## 2. Critical-flow e2e scripts (owned by phases)

- P1: register → login → logout → reset password → wrong-password lockout; admin guard (student hitting `/admin` gets 403 server-side).
- P2: admin creates course tree → publishes → student sees/denies per access_level; private file URL without signature 404s; signed URL expires.
- P3: entitled student plays video (mock+real), resume across devices, replay cap blocks N+1 watch; unentitled token mint → 403.
- P4: timed exam with refresh mid-way → answers recovered → submit idempotent (double-click, network retry) → deadline expiry auto-submits per policy → essay manual grading → results visibility per policy.
- P5: manual checkout → admin approval → entitlement appears; activation code redeem once (two concurrent tabs → exactly one success); discount math; refund revokes/shortens entitlement per policy.
- P3 ✅: CMS edit page → publish → public page reflects without deploy; draft never public; preview admin-only; audit rows for every CMS mutation; unsafe HTML/links sanitized or rejected (unit + integration + runtime smoke §12).
- P7: full regression + performance budgets + device matrix.

## 3. Authorization test matrix (unit, exhaustive — the crown jewels)

For each content type × each state: {public, authenticated, entitled-free, entitled-paid, expired entitlement, revoked, unpublished, scheduled-future, expired-content, free_preview flag, admin_override} × {anon, student, teacher, admin} → expected verdict. Any new access source extends this matrix first (test-first rule for the resolver).

## 4. Coverage matrix (brief §46 mapped)

| Area | Layer(s) | Phase |
|---|---|---|
| Auth, RBAC, course access, free/paid content | unit+integration+e2e | 1–3 |
| Subscriptions, activation codes, payments, webhooks | integration (signed fixtures) | 5 |
| Video playback/protection/replay limits | integration + device | 2–3 |
| Device restrictions, sharing deterrence | integration | 1,3 |
| PDF permissions (view/download/expiry) | integration | 2 |
| Exam timing, submission, attempts, randomization, essay grading | unit+integration+e2e | 4 |
| Progress tracking | integration | 3 |
| Admin actions + audit | e2e | 6 |
| Mobile responsiveness / iPhone Safari / Android / desktop | device matrix | 3,7 |

## 5. Device matrix & iOS-specific checklist (manual, real hardware — owner-assisted where needed)

- iPhone Safari: safe-area insets, `dvh` behavior, fixed bottom nav, sticky header, keyboard push (form fields, modal scroll), video playsinline/fullscreen/rotation/PiP, backgrounding mid-exam and mid-video (resume), network loss + airplane-mode toggle during exam, session persistence.
- iPhone Chrome (WebKit): same core checks.
- iPad Safari: layout breakpoints, landscape.
- Android Chrome: video, keyboard, 100vh.
- Desktop Chrome/Edge: full admin flows, uploads.
- Honest boundary: this sandbox cannot run real iPhones; the build encodes the iOS rules (ARCHITECTURE §15) and automated layout tests cover what's simulatable; final sign-off is on hardware.

## 6. Execution log

| Phase | Date | Scope | Result |
|---|---|---|---|
| 1 | 2026-09-05 | Static: check-imports, typegen (17 files), tsc, unit (32/32), integration (7/7), production build (client+SSR) | ✅ all green |
| 1 | 2026-09-05 | Runtime (`wrangler dev`, production-path worker, local D1 + `.dev.vars`): home 200 `lang=ar dir=rtl` rendered from D1 settings; 5 security headers + strict CSP; static asset 200; cross-site POST blocked (400/403), same-origin passes; unauth `/dashboard` → 302 login; admin + student login 302 + `__edu_session` (`HttpOnly; Secure; SameSite=Lax`); session → D1 lookup (dashboards 200); `/admin` RBAC: admin 200, student → 404-style redirect + 4 `permission_denied` events in D1; device-concurrency limit enforced (`device_limit`); logout 302 → post-logout redirect; workerd RSS ~150 MB, no OOM through ~25 requests | ✅ all green |
| 2 | 2026-09-05 | Static: check-imports (+ new unused-server-import guard), tsc 0 errors, unit **52/52**, integration **37/37** — hermetic (passes with AND without `.dev.vars`; miniflare supplies test-only secret bindings), production build client+SSR green; `npm run verify` exit 0 | ✅ all green |
| 2 | 2026-09-05 | DB integrity: migrations 0000+0001 applied to local D1; seed run twice → idempotent (stable row counts); SQL spot checks: lesson_item→videos, lesson_item→files, entitlement→subjects all resolve; content-domain FK deferral covered by app-layer `ContentReferenceError` guards (ADR-017) incl. live HTTP test (dangling video attach rejected) and regression tests | ✅ all green |
| 2 | 2026-09-05 | Runtime HTTP smoke (`scripts/smoke.mjs` vs live `wrangler dev`, seeded local D1+R2) — **104/104**: headers+strict CSP on public/lesson/file responses; anon denial (lesson → 302 login?next, playback → 401); CSRF both layers (evil Origin → 400 by RR7 `throwIfPotentialCSRFAttack`; `sec-fetch-site: cross-site` → 403 app middleware); GET /logout → 405; student/admin login + HttpOnly session cookies; RBAC student→/admin 404-shaped; free_preview vs entitled lesson gating; signed file URLs: view=inline/download=attachment, unsigned/tampered-sig/wrong-id/perm-swap/expired → 404, Range → 206, no-store; mock playback: provider-neutral JSON, ≤45s TTL, master.m3u8 200, forged/missing token → 404, poster thumbnail-scope 200 (regression), GET playback → 302, unknown id → 404; unentitled new student: locked page w/o signed URLs, protected playback → 403; admin CRUD over HTTP: create program/grades, slug generation, move-up ordering + boundary no-op, rename, draft, archive (catalog unaffected); upload → listed → signed fetch 200 %PDF; video register → attach to lesson → dangling-ref attach rejected; entitlement grant → access flips server-side (signed URLs + playback 200); logout revokes (dashboard 302, playback 401); rate limit blocks ≤10/min and refuses VALID credentials while limited | ✅ 104/104 |
| 2 | 2026-09-05 | Provider-switch matrix (live): settings `video.provider` → `mux` with absent API credentials → ingest fails loudly (`VideoNotConfiguredError: missing MUX_TOKEN_ID, MUX_TOKEN_SECRET`), row stored as provider=mux status=pending (not playable), NO silent mock fallback; revert → mock ingest succeeds (status=ready); test rows cleaned | ✅ all green |
| 2 | 2026-09-05 | Security audit: secret VALUES absent from `build/client` + `build/server` bundles (per-var grep); secret NAMES + `.server` module code absent from client bundle; `.dev.vars` gitignored (`.dev.vars.*` too, example allowed); private R2 bucket only reachable via signed `/files/:id` (guessed object paths 404); `build/` added to `.gitignore` | ✅ all green |
