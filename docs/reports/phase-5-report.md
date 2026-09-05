# Phase 5 Report — Assessment Engine

**Date:** 2026-09-05 · **Repo state at start:** `58ab6d1` (Phase 4 delivered) · **Code commit:** `0674c54`
**Verdict: DELIVERED.** `npm run verify` exit 0 (unit 76/76, integration 96/96), cold-runtime smoke **193/193**, fresh-DB migrations 6/6, readiness gate proven in both directions. Nothing below is claimed that was not executed in this sandbox.

---

## 1. Implementation (what was built)

Full assessment engine per owner brief §§3–16 and FEATURE-SPEC §5/§6:

- **Question bank (DB-driven, zero hardcoded questions):** MCQ / true-false / multi-select (essay creatable but NOT attachable in P5 — fail-closed), bilingual stems + explanations, per-choice feedback, difficulty, default points, tags, subject/course/unit/lesson association, status workflow `draft → in_review → published → archived → draft`, soft delete (refused while attached to an exam), duplicate-to-draft.
- **Exam builder (inside the existing admin architecture):** create/edit exams, full policy config (duration, pass %, attempts cap + cooldown, question/choice randomization, manual vs pool selection with the §6 pools contract, results visibility `immediate|after_end|manual`, review mode, show answers/explanations, availability window), attached-question manager (add/remove/reorder/points override — draft-only), fail-closed publish gate, unpublish/archive/unarchive (non-destructive — attempts preserved), attempt counters, student-page preview.
- **Attempt engine:** eligibility (published ∧ access ∧ window ∧ caps ∧ cooldown), start materializes a FROZEN question set (order + points in `attempt.metadata`) with a seeded random permutation, one live attempt per (exam, student) enforced by a partial-unique DB index (duplicate start = resume, even under races), server-computed deadline, autosave (idempotent per-(attempt,question) upsert with version counter), sweep-on-touch expiry with grace window → auto-submit answered-so-far, atomic exactly-once submission claim → auto-grading → `graded`.
- **Auto-grading:** mcq/true_false exact match; multi_select partial credit `points × max(0, hits − misses)/totalCorrect` (2dp, toggleable to all-or-nothing); earned/total, percentage, pass/fail at `percentage ≥ pass_percent`. Grading reads ONLY frozen attempt data — mid-flight bank edits cannot alter an in-flight attempt. Essay/manual grading deferred but fully reserved in schema (`text_answer`, `graded_by`, `grading_status=needs_manual`, `essay_points`) — the engine needs no rewrite to add it.
- **Student UX:** `/exams` index (availability/usage badges), `/exams/:slug` intro (policy, eligibility alerts, start/resume, attempt history), `/exams/:slug/attempt` focused-mode page (sticky countdown + save indicator, question navigator with answered states, ≥44px choice buttons, prev/next, submit confirmation with unanswered count, auto-submit at zero, per-change autosave + `pagehide` beacon flush — refresh/reconnect resumes exact server state), `/results` + `/results/:attemptId` (policy-gated score/percentage/pass/correct-count/submitted-at/attempt-number + gated review). Mobile-first throughout (class-only styling, CSP-safe).
- **Integrations:** lesson-page exam item renders the REAL exam card (CMS only links — exam data lives in the Assessment domain); admin content add-item form gained an exam picker; `maybeAutoCompleteLesson` counts required exam items complete on a GRADED attempt (opening ≠ completion; pass/fail is scoring, not completion); reserved events `exam_start` (once per attempt) and `exam_submit` (exactly once via the grading claim).

## 2. Reused architecture (audit → what was used, not rebuilt)

| Pre-reserved structure | How it was used |
|---|---|
| `lesson_items.exam_id` slot (P2 schema, P4 placeholder UI) | Real exam card on the lesson page; `admin.content` add-item exam picker; no content-schema changes |
| `events` types `exam_start`/`exam_submit` (P4) | Emitted via the same private `appendEvent` pipeline; video/progress events untouched |
| Beacon/idempotency discipline (P4 `beacons.progress`) | `POST /api/exam-attempt` resource route: plain-fetch + `sendBeacon` get JSON verbatim; upsert-not-insert answers |
| Entitlement resolver (ADR-009) | `examAccess` = chainForLesson/chainForCourse → `resolveContentAccess`; re-checked on EVERY exam loader, action and mutation |
| Auth guards / RBAC | `requireUser` (student routes), `requireRole(3)` (admin routes) — unchanged |
| CMS permission model (`role_permissions` rows) | `canAssessment` mirrors `canCms` (rank≥4 bypass; rank3 needs `assessment.*` row) |
| Audit convention (`logAudit`) | Every admin assessment mutation audited (`assessment.exam.*`, `assessment.question.*`) with ipHash |
| Settings system (ADR-012/019) | New `assessment` group (`graceSeconds`, default 30) — zod-defaulted, admin-editable |
| i18n/Dictionary parity (tsc-enforced) | New `exam.*` + `assessment.*` namespaces, ar+en |

## 3. New files

- `server/assessment/service.server.ts` (~1,470 lines — permissions, config contract, bank CRUD, exam CRUD/gate, set management, PRNG, pool resolution, eligibility, attempt lifecycle, grading, results/review policy, listings)
- `server/db/schema/assessment.ts` (8 tables + indexes incl. partial-unique live attempt)
- `migrations/0005_illegal_mother_askani.sql` + `drizzle/0005_*` (+snapshot/journal)
- Routes: `app/routes/student/exams.tsx`, `exams.$slug.tsx`, `exams.$slug.attempt.tsx`, `results.tsx`, `results.$attemptId.tsx`; `app/routes/api.exam-attempt.tsx`; `app/routes/admin.assessment.tsx`, `admin.assessment.questions.$id.tsx`, `admin.assessment.exams.$id.tsx`
- Tests: `tests/unit/assessment.test.ts` (13), `tests/integration/assessment.test.ts` (38)

## 4. Modified files

- `server/progress/service.server.ts` — `maybeAutoCompleteLesson` extended for required exam items (graded attempt = completion signal); required-file lessons still manual-mark only
- `server/settings/schema.ts` — `assessment` group; `server/db/schema/index.ts` — exports
- `app/routes/learn.$courseSlug.$lessonSlug.tsx` — exam item: real link when published, placeholder otherwise
- `app/routes/admin.content.$type.$id.tsx` — add-item exam picker + exam labels
- `app/routes.ts`, `app/routes/admin/layout.tsx` (nav), `app/routes/student/layout.tsx` (nav)
- `app/components/ui/Button.tsx` — additive `disabled` prop on `SubmitButton`
- `app/locales/ar.ts` / `en.ts` — `exam.*`, `assessment.*`
- `scripts/seed.mjs` (dev demo exam+questions), `scripts/smoke.mjs` (§15, 31 checks, rate-limit stays last), `scripts/check-production-readiness.mjs` (assessment scans, perms ≥15)
- `tests/integration/migrations.generated.ts`; docs: PROJECT-PLAN, DATABASE-SCHEMA, ARCHITECTURE, TEST-PLAN, CHANGELOG (0.7.0), DECISIONS (ADR-022)

## 5. Database & migrations

- **Additive only** — `0005_illegal_mother_askani`: 8 tables (`questions`, `question_choices`, `tags`, `question_tags`, `exams`, `exam_questions`, `exam_attempts`, `exam_answers`), 9 indexes (student/exam/attempt lookups: `exam_attempts(exam,student,status)`, `exam_answers(attempt)`, `questions(status,type,subject)`, `questions(lesson)`, `exams(status)`, `exams(lesson)`, `exam_questions(exam,order)`, `question_choices(q,order)`) + `UNIQUE(exam,student,attempt_number)` + **partial unique** `(exam,student) WHERE status='in_progress'` + `UNIQUE(attempt,question)` + permission seed (`assessment.*` ×6 for admin). No DROP/rename/destructive statement; no prod data touched (no remote access from sandbox by design).
- Fresh-DB verification: `wrangler d1 migrations apply DB --local --persist-to /tmp/clean-p5` → **all 6 migrations ✅ (21 statements)**; integration suite re-applies all migrations to a cold DB every run (96/96 green).

## 6. API / routes

| Route | Kind | Notes |
|---|---|---|
| `GET /exams` | student (auth) | accessible published exams + state/usage |
| `GET /exams/:slug` | student | intro; touch runs expiry sweep; 404 unpublished/archived, 403 non-entitled, 302 anon |
| `POST /exams/:slug` (`_action=start`) | student | eligibility → 302 attempt page or `{startError}` |
| `GET /exams/:slug/attempt` | student | live attempt (sanitized), server `remainingSeconds`; expired → sweep + 302 `?expired=1` |
| `POST /api/exam-attempt` | resource | `_action=save` → `{ok,version}` / `{error}`; `_action=submit` → `{ok,redirect}`; 404 ownership, 403 entitlement, `closed` post-submit |
| `GET /results`, `GET /results/:attemptId` | student | policy-gated summary/review; IDOR → 404 |
| `GET /admin/assessment` (+`?tab=exams`) | admin ≥3 | hub; `assessment.read` gated |
| `GET/POST /admin/assessment/questions/:id` | admin | editor; save/status/duplicate/delete/create-tag; audited |
| `GET/POST /admin/assessment/exams/:id` | admin | builder; create/save-basic/save-config/attach/detach/move/points/publish/unpublish/archive/unarchive; audited |

## 7. Security (explicit audit per brief §18)

- **Answer-key leakage:** `attemptContext` is the only live serializer and is sanitized by construction; integration test asserts the serialized payload contains no `isCorrect`/`explanation`/`feedback` and choice objects expose exactly `{id, contentAr, contentEn}`; smoke asserts the same on live HTML. Review correctness flags exist only post-submission under `results.review_mode ∧ show_answers`, and are additionally gated by summary visibility (a hidden result leaks nothing per-question — found and fixed during testing).
- **IDOR:** every attempt/results access goes through `getOwnedAttempt(attemptId, sessionUserId)` → other student's id = plain 404 (proven with an ENTITLED second student, not just a non-entitled one).
- **Entitlement:** re-checked server-side on every loader AND action AND the resource route (anon → 302 login; non-entitled → 403 on intro, attempt, save, submit, results).
- **Timing:** no client timestamp is parsed anywhere; deadline/grace comparisons use `Date.now()` server-side; late submit beyond grace auto-submits and clamps `time_used` at deadline+grace (test: 91s submit on a 60s+30s window stores exactly 90).
- **Idempotency:** conditional-UPDATE claim + D1 `meta.changes` → double submit returns the stored result, ONE `exam_submit`; partial-unique index → duplicate start resumes.
- **Post-submit immutability:** saves return `{error:'closed'}`; attempt page redirects away.
- **RBAC:** students → `/admin/assessment` = 404-shaped redirect; rank-3 admins need `assessment.*` rows (rank≥4 bypass); every admin mutation audited.

## 8. Tests

- **Unit 76/76** (+13): config-contract defaults/merges/nullability/rejections (7 invalid shapes), `seededShuffle` determinism/permutation/purity/seed-sensitivity, `choiceSeed` stability.
- **Integration 96/96** (+38, real D1 + real route loaders/actions): bank CRUD/validation/type-immutability/workflow/duplicate/delete-guard/tags; publish gate (empty / draft-attach refused / essay refused / pool resolution); config merge; access + route gates; windows/caps/cooldown; start materialization + resume + frozen points + exactly-once `exam_start`; sanitized context; autosave versioning/retry + route refresh-resume; IDOR (entitled B); timing (deadline math, sweep auto-submit with answered-so-far, late-submit clamp, route touch-sweep); submit idempotency + lock; grading (full/zero/unanswered/partial 1.5-of-3/boundary/points-override); results policy + review gating; progress integration (start ≠ completion, graded → completed).
- Real bugs found & fixed by tests: partial question updates rejected (choices fallback), review leak under `show=manual`, UI-route actions unusable by plain fetch (→ resource route), i18n block mis-nested into `auth` (found by smoke).

## 9. Full verify results

`npm run verify` → **exit 0**: `lint:imports` ✓ · `typecheck` (typegen + tsc) 0 errors ✓ · unit **76/76** ✓ · integration **96/96** ✓ · production build (client+SSR) ✓. No test skipped/disabled/weakened; no Phase 1–4 assertion altered (58 prior integration tests untouched and green).

## 10. Smoke results (live `wrangler dev`, cold seeded D1+R2, fresh jar dir)

**193/193** — all Phase 1–4 regressions (162) plus §15 (31 checks): discovery/authorization (anon 302, unentitled 403, RBAC redirect), lesson→exam link, intro policy, start→302, attempt hooks + server countdown + sanitized HTML, autosave v1→retry v2 (one row)→refresh restores, admin-granted entitled B: A's result **404** + save-on-A's-attempt **404 JSON**, unknown attempt 404, submit→`/results/:id`, **double submit → same stored result**, results **2/3 · 66.7% · ناجح · review visible**, save-after-submit `closed`, attempt page 302 (not reusable), history `محاولة 1 · مُصححة`, attempt 2 = new id (consumed so re-runs never leave a live attempt), `/results` index, admin hub + exams tab. Rate-limit checks ran LAST by design.

## 11. Production verification

- Fresh-DB migrations: 6/6 ✅ on an isolated `--persist-to /tmp` D1 (also the integration-suite path every run).
- Readiness gate, seeded+smoked dev DB → **5 FAIL exit 1** as required (demo accounts ×3; seed/smoke content ×17 including the demo exam/questions — new assessment scans detect them; mock provider; placeholder media; owner identity unset).
- Readiness gate, isolated fresh DB → content+assessment scans **PASS (0 rows — no false positives)**; only the 4 expected unconfigured checks fail (provider/branding/owner/no super-admin) — identical to the Phase-4 baseline; the bootstrap flow (ADR-020) remains the path to a green production gate.
- No secrets hardcoded; no video-provider changes; no entitlement-policy changes; no `git push` (impossible + forbidden from sandbox).

## 12. Known limitations

1. **Essay/manual grading not implemented** (deferred per brief): essay questions can exist in the bank but cannot be attached to exams (fail-closed); `needs_manual`/`text_answer`/`graded_by`/`essay_points` are reserved — no engine rewrite needed to add the manual queue.
2. **`attempts.manual_extra_allowed`** is stored per contract but not enforced (no admin "grant extra attempt" action yet).
3. **FTS5 question search deferred** — admin bank search is `LIKE` on stems (adequate at current scale; composite index covers filters).
4. **Availability window inputs are UTC** in the admin builder (labeled); no per-admin timezone preference yet.
5. **Pool builder is JSON-contract-based** (validated textarea), not a visual filter UI.
6. Expiry is **sweep-on-touch** (no Workers cron in this deployment): an expired live attempt is auto-submitted on the next request to any exam surface — a fully abandoned attempt stays `in_progress` in the DB until touched (it can never be resumed past deadline: every entry sweeps first).
7. Device-matrix §5 (real iPhones) remains owner-assisted; code-level mobile audit done.

## 13. Remaining work (next phases — NOT started per instruction)

Phase 6 commerce (products/orders/payments/webhooks, entitlement sources), Phase 7 notifications/teacher role, Phase 8 analytics. Within assessment (owner-call): manual essay grading queue, `manual_extra_allowed` enforcement, visual pool builder, FTS5 search, per-exam results export.

## 14. Exact commit hash

- **Phase 5 code + docs: `0674c54`** (48 files, +10,692 / −28, on top of `58ab6d1`).
- This report: committed separately as the immediately following commit (see `git log`; pattern established in Phases 3–4 so the report can reference the code hash).
- No push performed (sandbox has no remote credentials; owner pushes from their machine).
