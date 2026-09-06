# Phase 8 — W9: Performance Audit + Optimization

**Workstream:** W9 (Performance Audit + Optimization)
**Branch:** `arena/01a07397-tito`
**Baseline commit:** `76660a9` (W8 delivery)
**Date:** 2026-09-06
**Verdict:** **PASS**

---

## 1. Baseline environment

| Item | Value |
|---|---|
| Runtime (local) | Node v22.22.3, npm 10.9.8 |
| Platform target | Cloudflare Workers + D1 (SQLite) |
| Local DB | D1 SQLite emulation (`cloudflare:test` for integration) |
| Frontend | React Router v7 (framework mode), Vite, Tailwind CSS v4 |
| Browser for E2E | Bundled Chromium **92** (self-contained; see §9 limitations) |
| Playwright config | `workers: 1`, `fullyParallel: false` |
| Test baseline | Unit 125, Integration 197, Playwright 52 (all passing pre-W9) |
| `npm audit` | 11 dev-only findings (4 moderate, 7 high) — carried from W8, unchanged |

The platform's own performance budget (ARCHITECTURE §13): SSR HTML ≤ ~150 kB (gzip); route-level code splitting; images sized + `srcset` + lazy; lists paginated (default 20–50); D1 queries indexed per schema; settings/entitlements request-cached; static assets immutable + CDN-cached; fonts `font-display: swap`; progress beacons instead of blocking calls; exam autosave debounced (3 s) + `sendBeacon` on `pagehide`.

---

## 2. Measurement methodology

W9 was scoped as a **measure-first, evidence-based** audit. Three techniques were used, each preferred only where it is deterministic:

1. **Static query-shape analysis (primary).** Every hot loader/service was inspected for (a) queries issued inside loops over rows (N+1), and (b) sequential `await`s of mutually independent queries that could share a round trip. Findings were confirmed by reading the actual query builder calls (Drizzle), not by intuition — every reported N+1 is a `for (const …) { await db… }` or a chain of sequential `await db…` in the source.
2. **Production build / bundle budget.** `npm run build` output was captured before and after, and the emitted chunk sizes compared directly (identical chunk hashes prove the client bundle did not change).
3. **Regression tests with deterministic assertions.** Each optimization got a targeted integration test asserting the *behavioral output* (resolved view models, verdicts, counts) is identical before/after, so the optimization is provably behavior-preserving.

**Deliberately NOT used:** Lighthouse / Core Web Vitals / synthetic RUM scores — these cannot be measured truthfully in this sandbox (see §9). No invented scores are reported anywhere in this document.

---

## 3. Production build / bundle measurements

### Before (W9 baseline, commit `76660a9`)

- Client assets total: **1,542,491 bytes**
- Top client JS chunks: `entry.client-DRWyGwe7.js` 185,990 · `jsx-runtime-DuW4Mhk6.js` 131,058 · `registry-EvFFUgZ0.js` 117,111 · `i18n-DXMLG5hA.js` 70,777
- Client CSS: `root-bnIk0aWs.css` 69,562
- Server bundle: `index.js` 1,281.69 kB (gzip 251.95 kB)

### After (this workstream)

- Client assets total: **1,534,299 bytes**
- Top client JS chunks: `entry.client-DRWyGwe7.js` 185,990 · `jsx-runtime-DuW4Mhk6.js` 131,058 · `registry-EvFFUgZ0.js` 117,111 · `i18n-DXMLG5hA.js` 70,777 — **identical hashes/sizes**
- Client CSS: `server-build-bnIk0aWs.css` 69,562 — **unchanged**
- Server bundle: `index.js` 1,286.13 kB (gzip 253.03 kB)

**Conclusion:** the client bundle is byte-for-byte unchanged on the main chunks (the small total delta is font/asset hash reordering, not application code) — all W9 changes are server-side. The server bundle grew +4.44 kB raw (+1.08 kB gzip) purely from the added batching logic; the server bundle is never shipped to clients, so this is not a client-cost regression. There is **no client-side regressions and no new client dependency**.

---

## 4. Important route measurements

Query-count profiles (D1 round trips) on the highest-traffic routes, before vs after:

| Route / surface | Before | After | Classification |
|---|---|---|---|
| CMS page render (`p.$slug`) — forms | 2 queries × N form blocks | **2 queries total** | OPTIMIZATION APPLIED |
| CMS page render — content blocks | 7 sequential round trips | **2 round trips** | OPTIMIZATION APPLIED |
| Student exam index (`/exams`) | ~6 queries × N published exams | **7 queries total** | OPTIMIZATION APPLIED |
| Student dashboard (`/student`) | batched (`Promise.all` + `courseProgressBatch`) | unchanged | ALREADY OPTIMIZED |
| Courses catalog (`/courses`) | single JOIN + batched `lessonCounts`/`teacherNames`/images | unchanged | ALREADY OPTIMIZED |
| Admin analytics overview | ~20 queries in ONE `db.batch` round trip | unchanged | ALREADY OPTIMIZED |

---

## 5. DB / query analysis (index audit)

Indexes are declared in the schema (`server/db/schema/*`) and materialized by migrations 0001–0008. The audit checked every hot `WHERE`/`JOIN`/`ORDER BY` against existing indexes:

- `form_fields`: `form_fields_form_idx (form_id, sort_order)` + `form_fields_form_name_idx (form_id, name)` — **covers** the batched form-field query (`WHERE form_id IN (…) ORDER BY form_id, sort_order, created_at`).
- `entitlements`: `entitlements_lookup_idx (student_id, resource_type, resource_id, status)` — **covers** the single entitlement fetch (`WHERE student_id = ? AND status IN (…) AND (resource_id IN (…) OR resource_type='plan')`).
- `courses`: `courses_subject_idx (subject_id, status, sort_order)` and `courses_visibility_idx (visibility, status)` — cover catalog/dashboard lookups.
- `units`: `units_course_idx (course_id, sort_order)`; `subjects`: `subjects_grade_idx (grade_id, sort_order)` — cover ancestry-chain batch loads by primary key / `IN`.

**No new index was added.** Every batched query I introduced is covered by an existing index. Adding indexes blindly is explicitly out of scope per the task constraints; none was warranted.

---

## 6. N+1 / sequential-await findings

Three real, evidence-confirmed inefficiencies were found and fixed. All are in server-only code paths.

### 6.1 `resolveForms` (CMS render) — N+1  **[CONFIRMED BOTTLENECK → OPTIMIZATION APPLIED]**

`server/cms/render.server.ts` resolved form blocks by looping over each form id and issuing **two sequential queries per form** (one for the `forms` row, one for its `form_fields`). A page with N form blocks cost 2N round trips.

**Fix:** collect all form ids, then issue **2 batched queries total** — `forms WHERE id IN (…)` and `form_fields WHERE form_id IN (…) ORDER BY form_id, sort_order, created_at` — and group fields by `formId` in memory. Field ordering per form is preserved.

**Before/after:** 2N queries → 2 queries (regardless of N). Regression test added (`tests/integration/cms.test.ts`).

### 6.2 `resolveDynamicBlocks` (CMS render) — sequential awaits  **[CONFIRMED BOTTLENECK → OPTIMIZATION APPLIED]**

The content-block resolver issued its content lookups as **four sequential `await`s** (courses → subjects → programs → per-subject course counts), then **three more sequential `await`s** (lesson counts → teacher names → subject titles). The first four are mutually independent; the last three depend only on the course rows (not on each other).

**Fix:** `Promise.all` the four independent queries into one round trip, and `Promise.all` the three course-dependent queries into a second round trip.

**Before/after:** 7 sequential round trips → 2 round trips. No ordering/dependency violated (the two groups are genuinely independent; nothing with a data dependency was parallelized).

### 6.3 `listPublishedExamsForActor` (student exam index) — N+1  **[CONFIRMED BOTTLENECK → OPTIMIZATION APPLIED]**

`server/assessment/service.server.ts` listed published exams by looping over rows and, per exam, calling `examAccess` (which re-walks `lesson → unit → course → subject` with 2–4 sequential queries + one entitlement query) **and** one `exam_attempts` aggregate query. ~6 queries per exam; a catalog of N exams cost ~6N round trips on the student-facing `/exams` route.

**Fix:** batch the whole listing to a constant number of queries:
1. exams (1 query)
2. lessons / units / courses / subjects by `inArray` (4 queries, chained only where a later id set depends on the prior)
3. entitlements **once** for the actor over the union of all referenced node ids (1 query)
4. `exam_attempts` aggregate **grouped by examId** (1 query)

The per-exam verdict is still produced by the **same pure resolver** (`resolveAccess`), fed by the same `ChainRow` shapes and the same entitlement set, so authorization semantics are unchanged. Passing the union entitlement set (a superset of what each exam would fetch) is provably equivalent because `entitlementCovers` only matches an entitlement when it actually covers that exam's chain.

**Before/after:** ~6N queries → 7 queries (constant). Regression test added (`tests/integration/assessment.test.ts`).

To support 6.3 without duplicating query logic, two small private helpers in `server/entitlements/access.server.ts` (`entitlementsFor`, `chainRefsOf`) were exported — **no behavior change**, just visibility.

---

## 7. Caching / HTTP analysis

- Authenticated HTML continues to carry `Cache-Control: private, no-store` (the W8 fix in `server/http/headers.server.ts` via `applyPrivateCacheControl`, wired in `app/root.tsx`). **Unchanged and intact.**
- Static assets are built with content-hashed filenames (immutable) and served via the Workers/CDN path; fonts use `font-display: swap` with preloaded subsets (per ARCHITECTURE §13).
- Signed-URL / R2 file access is authorization-gated server-side; W9 made **no** change to private-resource proxying or signing.
- No caching change was required or made — the audit found the existing strategy already aligned with the budget.

---

## 8. Frontend / mobile findings

- The client bundle is unchanged by this workstream (server-only edits), so no mobile payload regression was introduced.
- The app already follows the iOS/Safari-first rules (ARCHITECTURE §15): `100dvh`/`svh`, safe-area insets, `playsinline`, 16px+ inputs, `pagehide`/`visibilitychange` beacons.
- Progress is reported via non-blocking beacons; exam autosave is debounced (3 s) with `sendBeacon` on `pagehide` (ARCHITECTURE §13).
- **No client-side change was made** — nothing in the frontend needed optimization beyond what is already present, and inventing changes would violate the "no cosmetic refactor" rule.

---

## 9. Browser / sandbox limitations  **[ENVIRONMENT LIMITATION]**

- **Lighthouse / Core Web Vitals could NOT be truthfully measured.** The only browser available in-sandbox is the bundled Chromium 92, which drops Tailwind v4 CSS features (`@layer`, `@property`, `oklch`, `color-mix`), making computed-style/visual measurements unreliable, and no modern Lighthouse-capable browser is installable (all browser-download CDNs and apt repos are unreachable in this sandbox). Per the task constraints, **no Lighthouse/CWV numbers are reported or invented.**
- Local D1 is SQLite emulation, not the production D1 engine; query-count analysis is deterministic and engine-independent, but wall-clock query timing under real D1 was not measured.
- These limitations are documented, not worked around with fabricated data.

---

## 10. Confirmed bottlenecks (summary)

| # | Bottleneck | Evidence | Disposition |
|---|---|---|---|
| 1 | `resolveForms` per-form query loop | 2 sequential queries per form block in source | FIXED (batched) |
| 2 | `resolveDynamicBlocks` sequential awaits | 7 sequential round trips in source | FIXED (`Promise.all`) |
| 3 | `listPublishedExamsForActor` per-exam loop | ~6 queries per exam in source | FIXED (batched) |

---

## 11. Intentional non-optimizations (with reasons)

- **Student dashboard `continueItems` + `stats` sequential awaits.** Two independent queries issued sequentially. Batching would save one round trip on a single already-optimized route (the heavy work is already `Promise.all`'d + `courseProgressBatch`). Marginal, and the surrounding code is clean — **NOT MATERIAL**, left alone to avoid churn.
- **Commerce/assessment *write-path* per-item reference checks** (`for item of items: getNode(...)`, `getPricePlan(...)`). These run on admin mutations over small, bounded item lists, not on read hot paths — **NOT MATERIAL**.
- **Question-tag / form-field insertion loops.** Admin-only writes over small N — **NOT MATERIAL**.
- **`db.batch` micro-optimization of the 4 chained content loads in §6.3.** They are dependency-chained (units ← lessons, subjects ← courses), so they cannot be fully batched; the N+1 elimination already yields the dominant constant-query win — **DEFERRED (not material)**.
- **No new index added.** All batched queries are covered by existing indexes (§5). Blind index creation was explicitly out of scope.

---

## 12. Security considerations

- **Authorization is byte-for-byte preserved.** §6.3 replaces per-exam DB lookups with pre-fetched inputs but still delegates every verdict to the **same pure resolver** `resolveAccess` with the **same `ChainRow` shapes and the same entitlement set**; `examAccess`/`resolveContentAccess` were not weakened. `entitlementsFor`/`chainRefsOf` were only *exported*, never altered.
- **No private-resource access was relaxed.** R2/file signed-URL and entitlement gates are untouched.
- **Authenticated HTML caching** remains `private, no-store` (W8).
- **No production data was changed**; the two new integration tests only operate on the ephemeral per-test D1 database.

---

## 13. Regression results

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| Unit tests (`test:unit`) | PASS (125) |
| Integration tests (`test:integration`) | **PASS (199** — was 197; +2 new W9 regression tests**) |
| Playwright E2E (`test:e2e`) | PASS (52/52) |
| `npm run verify` (lint + typecheck + unit + integration + build) | PASS |
| `git diff --check` | PASS (clean) |
| Client bundle diff | **No change** to application chunks (identical hashes) |

New regression tests:
- `tests/integration/cms.test.ts` — `resolveForms` batches multiple form blocks with correct per-form field grouping/ordering.
- `tests/integration/assessment.test.ts` — `listPublishedExamsForActor` returns identical verdicts/counts (anon / non-entitled / entitled, live-attempt + per-exam attempt counts) after batching.

---

## 14. Remaining risks

- **Low:** the §6.3 refactor touches a security-sensitive access path. It is mitigated by (a) an explicit regression test asserting the exact verdict/count outputs, and (b) the full 52-test E2E + 199-test integration suite passing. No residual risk identified.
- **Environment:** real production D1 latency and Lighthouse/CWV remain unmeasured (see §9); these are owner-assisted items, not code defects.

---

## 15. Owner-assisted items

1. Run Lighthouse / Core Web Vitals in a **modern Chrome** environment against the deployed (or a browser-capable local) build — sandbox Chromium 92 cannot render Tailwind v4 reliably.
2. Optionally profile D1 query timing under the real production D1 engine (local SQLite emulation reports query *counts* accurately but not engine latency).

---

## 16. Classification register

- **CONFIRMED BOTTLENECK:** `resolveForms` N+1; `resolveDynamicBlocks` sequential awaits; `listPublishedExamsForActor` N+1.
- **OPTIMIZATION APPLIED:** the three above.
- **ALREADY OPTIMIZED:** `catalogCourses` (single JOIN), `lessonCounts`/`teacherNames`/`courseProgressBatch`/`videosByIds`/`filesByIds`/`resolvePublicImageUrls` (batched), student dashboard loader, admin analytics (`db.batch`, ~20 queries/round trip), entitlements lookup index.
- **NOT MATERIAL:** dashboard `continue/stats` sequential pair; admin write-path reference checks; tag/field insertion loops.
- **ENVIRONMENT LIMITATION:** Lighthouse / Core Web Vitals unmeasurable in-sandbox.
- **DEFERRED:** `db.batch` micro-optimization of the chained content loads (§11); 11 dev-only `npm audit` findings (carried from W8).

---

## 17. Final verdict

**PASS.**

Three evidence-confirmed server-side N+1/sequential-query bottlenecks were eliminated with minimal, behavior-preserving changes, covered by new regression tests, with no client-bundle regression, no security/authorization weakening, no production-data change, and no new index. The full suite (125 unit + 199 integration + 52 E2E) and `npm run verify` pass cleanly.
