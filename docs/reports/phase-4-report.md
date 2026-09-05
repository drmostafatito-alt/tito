# Phase 4 report — Student Experience (delivered 2026-09-05)

Repo state at phase start: `c50a17a` (Phase 3 final). All Phase 4 work is committed on top of it.
Format: the 14 sections required by the owner's Phase-4 instruction (extends PROJECT-PLAN §5).

---

## 1. What was implemented

**Progress engine (DB = single source of truth, ADR-021).**
- 4 additive D1 tables: `lesson_progress`, `video_progress`, `video_watch_sessions`, `events` (migration `0004_amused_hiroim`, pure DDL).
- `server/progress/service.server.ts`: `startWatch` (mint-time watch accounting + session open + lesson touch), `recordBeacon` (position upsert clamped to duration, session updates, server-decided completion at `settings.video.completionThresholdPct` — default 90 — with an exactly-once `lesson_complete` guard), `maybeAutoCompleteLesson` (FEATURE-SPEC §4 rule: only when ALL required items are completed videos), `setLessonCompleted` (manual toggle), `lessonProgressMap` / `videoProgressMap`, `courseProgress` / `courseProgressBatch` (course % = completed published lessons / published lessons of published units), `continueLearning`, `progressStats`.
- Settings knobs (additive, defaults preserve prior behavior): `video.completionThresholdPct` (50–100, default 90), `video.replayLimit` (0–1000, default 0 = unlimited).

**Beacon + playback pipeline.**
- `POST /beacons/progress` resource route: session-validated (401 anon), zod payload validation (400), lesson entitlement RE-CHECKED server-side on every beacon with a lesson context (403 non-entitled; 404 unknown video/lesson refs), threshold read from settings, GET → 405.
- `POST /api/playback/:videoId`: replay limit enforced at MINT time against the pre-increment `watch_count` (403 `replay_limit`; admins rank ≥ 3 bypass); `resumeAt` returned from the stored position (>5s and not completed); `startWatch` runs post-mint inside try/catch so a progress-write failure can never deny an entitled playback.
- `VideoPlayer`: resume seek on `loadedmetadata` + localized "resumed" notice; 10s-debounced heartbeats (`fetch` keepalive) + final `ended` beacon via `sendBeacon` on `pagehide`; watched-seconds accumulate only from continuous forward deltas; server `resumeAt` wins over the prop; `onLessonCompleted` → page revalidation.

**Learn page + student pages.**
- `learn/:courseSlug/:lessonSlug`: progress in loader (lesson status, per-video positions, course %), `toggle-complete` action (entitlement re-checked server-side, 403 otherwise), completed/in-progress badges, course progress bar, mark-complete/incomplete button, exam placeholder now uses i18n.
- Dashboard from REAL data: continue-learning module (4 most recent lessons, resume/completed badges, course %), stats module (completed lessons / in-progress / videos watched), my-courses tiles with % bars; modules admin-toggleable via canonical `DASHBOARD_MODULE_IDS` exported from the settings schema.
- Catalog hierarchy (published-only, entitlement-aware): `/programs` (subject counts), `/programs/:slug` (grades → subjects with visible-course counts), `/subjects/:slug` (course cards honoring the admin presentation config), 404 for unknown/unpublished slugs.
- Course page: breadcrumbs (catalog → subject → course), thumbnail, teacher, summed video duration, lesson count, per-lesson server verdicts (locked lessons render without learn links; free_preview is a logged-in affordance per the unit-tested resolver), course progress + per-lesson completed/in-progress states.
- Unit page rewritten: real per-lesson entitlement verdicts with grants (fixes a pre-existing UI-accuracy leak — see §7), progress states, resume/open CTA, breadcrumbs.
- `/profile` (student): account info (email read-only + role + member-since), self-service fullName / phone / localePref (zod fail-closed), locale cookie synced when the preference changes, `profile_updated` security event.
- Student layout: mobile nav toggle (44px target, `aria-expanded`/`aria-controls`, collapsible panel), CMS **student menu** rendered (desktop dropdown + mobile panel), links for dashboard/courses/programs/profile/security.

## 2. What was reused from existing (not re-implemented)

- Auth/session/RBAC: `resolveAuth`, `requireUser`, session cookie discipline, CSRF middleware (beacons pass `sec-fetch-site: same-origin` from modern browsers).
- Entitlement engine (ADR-009): `resolveAccess` pure resolver + `resolveContentAccess` (grants), `chainForCourse`/`chainForLesson` — every new route/action re-checks access server-side.
- Video abstraction (ADR-006) untouched: `mintPlayback`, provider registry, mock/Mux adapters, short-TTL tokens, `/api/mock-stream`. No API keys or vendor logic in the frontend; no signed-URL rebuild.
- Files/R2: signed-URL discipline unchanged; materials on the lesson page still render via existing `signFileUrl` permissions.
- CMS/settings (Phase 3): settings groups + zod schemas, dashboard-module toggles, presentation config for catalog cards, menus (`menuItemsFor(db, "student")`), icon registry, sanitizers.
- Design system: Card/Badge/Input/Button/Alert/EmptyState, theme tokens, i18n (`t` with params), `formatDate`, pt/pb-safe + dvh utilities.

## 3. New files

| File | Purpose |
|---|---|
| `server/db/schema/progress.ts` | 4 progress tables + indexes |
| `drizzle/0004_amused_hiroim.sql` (+ snapshot/journal) | generated migration |
| `migrations/0004_amused_hiroim.sql` | wrangler-applied copy |
| `server/progress/service.server.ts` | progress service (501 lines) |
| `app/routes/beacons.progress.tsx` | POST /beacons/progress resource route |
| `app/components/ProgressBar.tsx` | shared CSP-safe segmented progress bar |
| `app/routes/public.programs.tsx` | /programs index |
| `app/routes/public.programs.$slug.tsx` | /programs/:slug (grades → subjects) |
| `app/routes/public.subjects.$slug.tsx` | /subjects/:slug (courses) |
| `app/routes/student/profile.tsx` | /profile page + action |
| `tests/integration/progress.test.ts` | 12 integration tests |
| `docs/reports/phase-4-report.md` | this report |
| `.react-router/types/**` (5 generated) | typegen artifacts for the new routes |

## 4. Modified files

| File | Change |
|---|---|
| `server/settings/schema.ts` | video knobs (threshold, replayLimit), `DASHBOARD_MODULE_IDS` canonical export, dashboard defaults include continue/stats |
| `server/content/service.server.ts` | `catalogCourses` additionally selects `programSlug`/`gradeSlug` (additive) |
| `server/db/schema/identity.ts` | `security_events.type` enum + `profile_updated` (TS-level; column is TEXT) |
| `server/db/schema/index.ts` | export progress schema |
| `server/security/events.server.ts` | `SecurityEventType` + `profile_updated` |
| `app/routes.ts` | +4 routes (beacons, programs ×2, subjects, profile) |
| `app/routes/api.playback.$videoId.tsx` | replay limit pre-mint, `startWatch` post-mint (non-blocking), `resumeAt` |
| `app/components/player/VideoPlayer.tsx` | resume + heartbeats/ended beacons + completion callback |
| `app/routes/learn.$courseSlug.$lessonSlug.tsx` | progress loader data, toggle-complete action, badges/bar/button, `data-lesson-id` |
| `app/routes/public.courses.$slug.tsx` | teacher/thumbnail/duration/breadcrumbs, per-lesson verdicts + progress |
| `app/routes/public.courses.$slug.units.$unitId.tsx` | rewritten with real per-lesson verdicts + progress |
| `app/routes/student/dashboard.tsx` | continue/stats modules, course % (real data) |
| `app/routes/student/layout.tsx` | mobile nav + CMS student menu + catalog/profile links |
| `app/routes/admin.appearance.tsx` | dashboard module ids iterated from the schema export |
| `app/cms/registry.ts`, `app/cms/icons.tsx` | `lock` icon (registry id + glyph) |
| `app/locales/{ar,en}.ts` | `progress.*`, `catalog.*`, `profile.*`, `content.durationMinutes`, `content.examNotReady`, `player.resumed`, dashboard module labels |
| `scripts/smoke.mjs` | §14 journey (+36 checks; §13 rate-limit stays last) |
| `tests/unit/settings.test.ts` | +2 tests (video knobs, dashboard module ids) |
| `tests/integration/migrations.generated.ts` | manifest regenerated (5 migrations) |
| `docs/{DECISIONS,DATABASE-SCHEMA,ARCHITECTURE,TEST-PLAN,PROJECT-PLAN,CHANGELOG}.md` | ADR-021, live progress schema, route map, execution log, phase status, 0.6.0 |

## 5. Database changes (migrations applied)

- **`0004_amused_hiroim.sql`** — purely additive DDL: 4 `CREATE TABLE` (lesson_progress, video_progress, video_watch_sessions, events) + 7 `CREATE INDEX`. No renames, no drops, no data rewriting; safe on a populated production DB.
- Applied to local dev D1 (`wrangler d1 migrations apply DB --local`) and verified on an **isolated fresh DB** (`--persist-to /tmp/p4-prod`): all 5 migrations ✅.
- The integration suite rebuilds a cold DB from all 5 migrations on every run (`apply-migrations.setup.ts` + regenerated manifest).
- `security_events.type` gained the value `profile_updated` at the TypeScript level only — the column is plain TEXT, **no migration needed or produced** (`drizzle-kit generate`: "No schema changes").

## 6. API / backend changes

- **New:** `POST /beacons/progress` (JSON: `videoId`, optional `lessonId`/`durationSeconds`/`watchedSeconds`, `positionSeconds`, `kind: heartbeat|ended`) → `{completed, lessonCompleted, positionSeconds}`. Errors: 401 anon, 400 invalid, 403 non-entitled (lesson context), 404 unknown refs, 405 non-POST.
- **Changed:** `POST /api/playback/:videoId` response gained `resumeAt`; new denial mode 403 `replay_limit` (only when `settings.video.replayLimit > 0`, default 0 keeps prior behavior; admins bypass).
- **Changed:** `POST /learn/:courseSlug/:lessonSlug` action `toggle-complete` (new in Phase 4) — entitlement re-checked before writing.
- **New settings keys** (admin-editable via existing Appearance → System tab): `video.completionThresholdPct`, `video.replayLimit`; `dashboard.modules` extended with `continue` + `stats` (defaults enabled).
- Progress events appended to the new `events` table: `video_start`, `video_complete`, `lesson_complete` (once per completion).

## 7. Security changes

- Every new/changed loader+action enforces auth → entitlement server-side (UI hiding is never the control): beacons re-check the lesson chain per request; toggle-complete re-checks; catalog pages render links only for allowed lessons; locked lessons render without hrefs.
- **Fixed (pre-existing UI-accuracy leak):** the old unit page marked a lesson open when the COURSE verdict allowed it (`verdict.allowed || courseVerdict.allowed`) and ran the resolver with an empty entitlement set — entitled lessons inside an allowed course appeared unlocked. Now per-lesson verdicts consult real grants (learn route/playback always enforced server-side regardless; smoke proves the 403s).
- Client-reported positions are clamped (0..duration) and are self-report only — they never authorize anything; completion decisions are server-side.
- Replay limit is enforced PRE-mint: a denied replay never yields credentials.
- Progress writes are wrapped so failures cannot deny entitled playback (availability without weakening authz).
- Profile updates: zod fail-closed validation, `profile_updated` security event, locale cookie written only on preference change (HttpOnly/SameSite=Lax/Secure, same attributes as `/set-locale`).
- CSP discipline kept: no inline styles anywhere in the new UI (segmented `ProgressBar` is class-only), icons via the registry id system.
- CSRF: beacon/playback POSTs ride the existing root middleware (same-origin/`sec-fetch-site`); no new cookie or token surface.

## 8. Tests added

- `tests/integration/progress.test.ts` — **12 tests** calling the REAL route actions against D1: anon beacon 401; invalid payloads 400; non-entitled + lesson context 403 with zero rows written; unknown lesson/video 404; heartbeat upsert + lesson touch; threshold completion (below → not completed; ended past threshold → video + lesson auto-completed; EXACTLY ONE `lesson_complete`/`video_complete` event across repeated beacons); anon mint 401 + non-entitled 403; mint watch accounting + watch session opened + `resumeAt=0`; heartbeat → re-mint `resumeAt=30`; ended beacon closes the session; completed video → `resumeAt=0`; `replayLimit=1` blocks the 2nd mint (403 `replay_limit`) and admin promotion bypasses; course % (0 → 50 → back), idempotent `setLessonCompleted` events, un-mark; `continueLearning` + `progressStats` aggregates.
- `tests/unit/settings.test.ts` — **+2**: video knobs defaults (90/0) + bounds rejection; `DASHBOARD_MODULE_IDS` defaults all-enabled + unknown module id rejected.
- `scripts/smoke.mjs` — **§14 (+36 runtime checks)**: full journey on a live worker (catalog hierarchy 200/404s, per-lesson locks for anon, beacon gates incl. fresh-registered non-entitled student 403, heartbeat → resume, threshold completion → badge, completed → no stale resume, manual mark-complete + 400/403 paths, dashboard real-data modules incl. 100% course progress, profile view/save/invalid/propagation, mobile nav presence).

## 9. Full test results

- `npm run verify` → **exit 0**: `lint:imports` ✓ · `tsc --noEmit` 0 errors · unit **63/63** (61 Phase-3 + 2 new) · integration **58/58** (46 Phase-3 + 12 new; cold DB rebuilt from all 5 migrations) · production build (client + SSR) ✓.
- No existing test was disabled, skipped, or weakened.

## 10. Smoke / regression results

- Cold run (fresh `.wrangler` state → 5 migrations → seed → fresh cookie-jar dir → live `wrangler dev` production-path worker): **162/162 passed, 0 failed** — 126 Phase 1–3 regression checks (auth, RBAC, devices, signed URLs incl. tamper/expiry/perm-swap, playback tokens, entitlement flip, revocation, CMS builder/publish/preview/menus/forms, zero-deploy rename, rate limits, CSP/headers) + 36 new §14 journey checks.
- Three smoke expectations were initially wrong and were corrected against the unit-tested resolver design (free_preview is a logged-in affordance; the seeded mock video is 120s → threshold 108s; the beacon-denial probe must target the entitled lesson). No product-code regressions were found by the smoke run.

## 11. Production verification

- **Nothing was pushed or deployed** (owner rule: no `git push` from the sandbox). No remote/prod command was executed.
- Production-readiness gate (ADR-020) re-proven **both directions** with migration 0004 present:
  - isolated fresh DB (`/tmp/p4-prod`: 5/5 migrations + `bootstrap-admin.mjs --email=owner@mostafatito.com` + owner-config settings only) → **10/10 PASS** (migrations 5/5, CMS permissions 9/9, super admin present, no demo content);
  - seeded dev DB → **exit 1 with 5 findings** (demo accounts, seed content, mock provider, placeholder media, owner identity) — fail-closed behavior intact.
- No new environment variables; no video-provider policy changes; defaults for the new settings preserve pre-Phase-4 behavior (`replayLimit=0` unlimited).
- Migration reviewed statement-by-statement: additive DDL only — safe against populated production data.

## 12. Known limitations (honest)

1. **Manual completion for non-video requirements:** lessons whose required items include files/exams cannot auto-complete (no completion signal exists yet) — students mark them complete explicitly. Documented in ADR-021; exams arrive with Phase 5.
2. **Positions are self-reported:** clamped and non-authoritative; a determined student could beacon a high position to auto-complete a video-only lesson. Completion ≠ assessment; Phase 5 exams are the graded gate.
3. **Replay limit counts credential mints**, not full watches (a page refresh consumes one). Default 0 = unlimited keeps current behavior until the owner sets a policy.
4. **Watch-session attribution:** heartbeats extend the most recent OPEN session for a student+video; simultaneous multi-device playback would attribute watched seconds to the newest session (analytics-only field, no authz impact).
5. **Mobile verified at code level only** (44px targets, dvh/safe-area, responsive grids, mobile nav) — the real-device matrix remains owner-assisted (TEST-PLAN §5), unchanged from Phase 3.
6. **Notifications/announcements deferred to Phase 7** (FEATURE-SPEC §9 P4/P7 split); the Phase-4 row in PROJECT-PLAN records this deviation. Device-management UI already shipped in Phase 1 (`/profile/security`).
7. `continueLearning` over-fetches `limit×2` then filters unpublished/deleted lessons — in rare edge cases fewer than `limit` items return.
8. Carried from Phase 3: `pres.showRelated` stored-but-unenforced; exam items render a localized "available with the exams phase" placeholder.

## 13. Remaining work (next phases — untouched here)

- **Phase 5 (assessment engine):** question bank, exam builder, attempt engine (server timing, autosave via the same beacon discipline, idempotent submission), auto-grading + essay queue, results. The lesson-page exam item slot and `events` types (`exam_start`, `exam_submit`) are already reserved.
- **Phase 6 (commerce):** products/pricing, PaymentProvider (manual rail first), webhooks → entitlement grants feeding the same resolver, activation codes.
- **Phase 7 (admin platform):** analytics dashboards over the `events`/`video_watch_sessions` tables now being populated, notifications/announcements, full admin lists.
- **Phase 8 (hardening):** Playwright e2e, real-device matrix, accessibility audit, pen checklist, deploy runbook rehearsal.

## 14. Exact commit hash

- **Phase 4 code + docs commit: `f6fa53f`** (full hash: see `git rev-parse f6fa53f`), parent `c50a17a` (Phase 3 final). 46 files changed, 6184 insertions(+), 138 deletions(−).
- This report is committed as a follow-up commit on top of `f6fa53f` (a report cannot contain its own commit hash).
- Branch: `main`. **Not pushed** (owner instruction — no `git push` from the sandbox).
