# SEO Master Phase Report — Dr Mostafa Tito (د/ مصطفى تيتو)

**Date:** 2026-09-14 · **Base commit:** `a624948` (main) · **Final commit:** `fe1cb0f` (this branch)
**Branch:** `arena/01a0a125-tito` · **Method:** AUDIT → DESIGN → IMPLEMENT → TEST → FIX → RETEST → DOCUMENT (autonomous, 8 batches)
**Scope discipline:** no visual redesign, no business-logic changes (auth, payments, activation codes, receipt-proof, WhatsApp workflow, question-platform integration all untouched). Nothing was invented: no credentials, stats, fake pages, or year pages.

---

## 1. Executive summary

The platform went from "no robots.txt, no sitemap, zero structured data, indexable auth pages, weak homepage metadata" to a **complete, honest, data-driven, admin-visible SEO system**:

- 51 files changed, +4,276/−66 across 8 commits (7 shipped batches + report).
- All 14 baseline audit findings (section 5 of `docs/reports/seo-forensic-audit.md`) are **fixed, documented, or explicitly dispositioned as correct-by-architecture** (hreflang).
- Full test stack green: **unit 291 (27 files) + integration 285 (26 files) + e2e 80 (20 specs, real headless Chromium, AR/EN, desktop + mobile viewports)**; `tsc --noEmit` clean.
- One regression found and fixed in this phase (batch 7): the batch-2 `noindex` layout meta silently dropped document titles from all authed pages under RR7 leaf-meta semantics — surfaced by the pre-existing axe e2e gate, fixed by adding layout-level titles.
- Owner/external work (GSC verification, sitemap submission, domain, real content/images, deployment) is **separated and NOT claimed** — §8.

## 2. Route inventory & keyword universe

Full tables in the audit baseline: `docs/reports/seo-forensic-audit.md` §1 (route inventory, 22 route families with index state, title/desc/canonical/structured-data as found) and §3–§4 (keyword universe A–J + final cluster map).

Key facts that shaped every implementation decision:

- **Model:** program → grade → subject → course → unit → lesson. Public catalog = published rows with published ancestors.
- **One canonical target per intent cluster.** Combined/grade+subject intents resolve to the *subject* page (title + description carry the grade); brand → `/` + `/about`; year intents → metadata-only strategy (§5.5).
- **Production starts content-empty.** Every SEO surface is data-driven and empty-first: no subject/grade page exists without a published row; sitemap mirrors publish state exactly.
- **Locale = cookie on shared URLs** (`edu_locale`, `POST /set-locale`). There are no `/ar|/en` equivalents ⇒ **no hreflang** (it would be false). `lang`+`dir` on `<html>` + one absolute canonical per URL is the correct handling — documented, not a defect.

## 3. What was implemented (per batch)

| Batch | Commit | Scope |
|---|---|---|
| 0 | `a039d58` | Forensic audit baseline + keyword universe + route inventory (`docs/reports/seo-forensic-audit.md`), live-sweep script `scripts/seo-audit.mjs` |
| 1 | `98b25b2` | Crawl foundation: dynamic `/robots.txt` (origin-aware Sitemap line, private-path Disallow list), DB-driven `/sitemap.xml` (published-only, no query strings, `lastmod`), `/p/home` dedup, `server/seo/inventory.server.ts` single source of truth |
| 2 | `2b861cf` | Deterministic metadata system: `app/cms/seo.ts` title/description resolution (owner fields → fallbacks, brand suffix, **no `<meta keywords>`**), absolute `<link rel="canonical">` everywhere, noindex on auth/admin/student routes, 404 brand fallback, CMS per-page SEO validation |
| 3 | `5865738` | Honest JSON-LD via `app/cms/jsonld.ts` (reusable server helpers): Organization + Person (entity, only real fields), WebSite + potentialAction omitted (no fake search), WebPage, Course (no fake rating/price), VideoObject (https-only URLs), BreadcrumbList (last crumb item-less per schema.org). ItemList on `/courses`. Zero invented entities |
| 4 | `bd883e2` | `/about` entity page (Person + ProfilePage, gated on real owner identity — photo only from owner file, sameAs only from owner socials; **no invented credentials/stats**), `/grades/:slug` data-driven grade pages, reserved-slug protection (`about`, `grades`, `programs`, `products`, `subjects`), breadcrumbs + grade context on subject pages, image-alt fixes |
| 5 | `9b415be` | Homepage: discovery section (published subjects/grades/courses with AR anchor text, rendered below CMS content, null-safe when empty), hero image alt semantics (owner image keeps `imageAlt || heading`; platform fallback illustration is decorative `alt=""` + `aria-hidden`) |
| 6 | `501c664` | **Admin SEO dashboard `/admin/seo`** — factual crawl-readiness audit (read-only, rank≥3 per `/admin/appearance` precedent, no new permission): findings each naming their rows (missing descriptions, duplicate titles per type, maintenance mode, missing owner identity, drafts), 7-stat content counts, sitemap inventory table rendered from the SAME `indexablePublicUrls(db)` function as `/sitemap.xml` (lockstep invariant + robots-overlap check), quick links + GSC owner steps. Nav item + full `seoAdmin.*` i18n (ar+en) |
| 7 | `fe1cb0f` | Browser QA: e2e coverage for `/admin/seo` (inventory == `/sitemap.xml` `<url>` count in a real browser, no query strings/private prefixes/leaks, non-reveal redirect); **fixed batch-2 title regression** on admin/student layouts |

## 4. Mapping: 14 baseline findings → dispositions

| # | Finding (audit §5) | Disposition |
|---|---|---|
| 1 | No robots.txt (404) | **FIXED** — dynamic route, origin-aware, private paths Disallowed (batch 1) |
| 2 | No sitemap.xml (404) | **FIXED** — dynamic, DB-driven, published-only, `lastmod` (batch 1) |
| 3 | Zero structured data | **FIXED** — honest JSON-LD on all public pages, entity data only (batch 3) |
| 4 | Auth pages indexable | **FIXED** — noindex,follow on auth + student + admin layouts, labelled titles (batches 2, 7) |
| 5 | `/learn` + unit pages without route meta | **FIXED** — `/learn` noindex + full meta; unit pages full meta + canonical (batch 2) |
| 6 | Homepage weak title/desc/no discovery | **FIXED** — deterministic title/desc (batch 2), discovery section (batch 5) |
| 7 | No public grade pages | **FIXED** — `/grades/:slug`, empty-first (batch 4) |
| 8 | No `/about` entity page | **FIXED** — identity-gated, no invented facts (batch 4) |
| 9 | Subject title lacks grade | **FIXED** — grade in title/description chain (batch 4) |
| 10 | Image alt gaps | **FIXED** — course/subject thumbnails + hero semantics (batches 4, 5) |
| 11 | Breadcrumbs partial | **FIXED** — home crumb + BreadcrumbList schema + grade context (batches 3, 4) |
| 12 | 404 generic title | **FIXED** — brand fallback from official identity (batch 2) |
| 13 | No admin SEO health view | **FIXED** — `/admin/seo` factual dashboard (batch 6) |
| 14 | hreflang absent | **CORRECT BY ARCHITECTURE** — cookie locale, shared URLs; documented in audit + this report |

## 5. Design decisions (final)

1. **Canonical = `<link rel="canonical">`** (never `<meta>`), absolute, query strings stripped, CMS override preserved. Verified in rendered HTML by e2e.
2. **No `<meta name="keywords">`** anywhere. Titles ≤ 60 chars target, descriptions 120–160 chars, deterministic: owner field → localized fallback → brand suffix. No keyword stuffing; spelling variants map to the same page, never duplicate pages.
3. **Structured data is honest**: Person/ProfilePage only from real owner settings (photo only from an owner-uploaded https file; sameAs only from owner-provided links; no invented credentials, affiliations, stats, or certificates). Course without rating/price (no fake offers). No Product LD (prices stay server-side). No SearchAction (no fake search). VideoObject only for real https sources.
4. **Security over indexing**: `/learn`, student area, admin area, `/files/:id`, APIs all noindex or Disallowed; signed media URLs and video tokens are https-only and HMAC-gated; no student names/progress/receipts/activation codes reachable in indexable output (e2e leak assertions on admin SEO page + security specs).
5. **Academic year**: not modeled in the schema ⇒ no year pages (that would be fake content). Year targeting happens in owner-editable SEO title/description metadata; URLs stay permanent (no churn). `/admin/seo` + CMS SEO tab make this a no-dev-owner action.
6. **One inventory function** (`server/seo/inventory.server.ts`) feeds `/sitemap.xml`, the admin dashboard, and the robots-overlap invariant — the three can never disagree.
7. **No fake scores**: the admin SEO panel reports counts and names rows; it never fabricates a "health percentage".

## 6. Verification (final state, `fe1cb0f`)

| Layer | Result |
|---|---|
| `tsc --noEmit` | clean |
| Unit (vitest, 27 files) | **291 passed** (incl. `jsonld.test.ts` 17, `seo-inventory.test.ts` 10) |
| Integration (vitest + real D1, 26 files) | **285 passed** (incl. `seo-crawl` 11, `seo-jsonld` 9, `seo-batch4` 10, `seo-home` 4, `seo-admin` 7) |
| E2E (Playwright, real headless Chromium, 20 specs) | **80 passed / 0 failed** (3.1 min) — incl. seo-meta AR+EN desktop+mobile, RTL/mobile, axe (only measured-not-asserted target-size, pre-existing Chromium-91 CSS limitation), security IDOR, and the new `/admin/seo` lockstep + non-reveal tests |
| Live SSR spot-checks (curl + DOM parse) | `/admin/seo` 200 for admin (AR + EN), inventory 13 rows == sitemap, 302 `/login?next=` unauthenticated, dashboard text/leak checks clean |

**Regression found & fixed in this phase (batch 7):** batch 2 added `meta(): [{robots: noindex,follow}]` to the admin/student layouts. Under React Router 7 leaf-meta semantics that became the leaf-most meta on every authed route, silently dropping the root default `<title>` and failing the pre-existing axe `document-title` gate. Fix: layout meta now carries a localized document title (`nav.adminLabel` / `common.dashboard` + owner site name via `rootMetaFrom`). Re-run: axe green, full suite 80/80.

## 7. What was NOT changed (constraint compliance)

- No visual redesign, no new design system, no approved-UI rewrites.
- Auth, payments (Cash / Cash Installments / InstaPay), activation codes, receipt-proof, WhatsApp review workflow, courses/lessons/video engine, CMS business logic, external Questions Platform: untouched.
- No force push, no history rewrite; every batch: status → diff → tests → commit → push → remote-SHA verification.

## 8. Owner / external work (NOT code-completable — not claimed)

1. **Google Search Console**: verify property ownership, submit `https://<domain>/sitemap.xml`, review Coverage (surfaced in `/admin/seo` "Owner actions").
2. **Domain/DNS**: point the production domain; the sitemap/robots origin is request-derived (works on any origin).
3. **Real content & identity**: publish philosophy/psychology subjects, grades, courses with real descriptions (the audit findings then resolve in `/admin/seo`); set owner title/photo/bio/socials in Appearance → Identity (unlocks `/about` richness).
4. **Deployment**: production deploy per `docs/DEPLOYMENT.md` (env secrets, `bootstrap-admin`).
5. No "Google #1" promise — this phase makes the site fully crawlable, indexable, entity-clear, and admin-auditable; ranking outcomes depend on the above + time.

## 9. Final area status

| Area | Status |
|---|---|
| Route inventory + keyword universe + clustering | PASS (audit doc) |
| robots.txt + sitemap (published-only, no private/query strings) | PASS |
| Deterministic titles/descriptions, no meta keywords | PASS |
| Canonical as `<link>`, absolute, clean | PASS |
| hreflang (N/A by architecture, documented) | PASS |
| Structured data (Org/Person/WebSite/WebPage/Course/VideoObject/BreadcrumbList/ItemList) | PASS |
| Homepage SEO + discovery | PASS |
| Subject / grade / grade+subject pages + slugs | PASS |
| Course / unit / lesson pages | PASS |
| `/about` entity page (no invented facts) | PASS |
| Breadcrumbs (UI + schema) | PASS |
| Image alt semantics | PASS |
| Academic-year strategy (no fake year pages) | PASS |
| Admin SEO panel + validation | PASS |
| Security (noindex private, no leaks) | PASS |
| Automated tests vs rendered HTML (unit + integration + e2e AR/EN desktop/mobile) | PASS (291 + 285 + 80) |
| Browser QA | PASS (80/80 e2e incl. axe, RTL/mobile) |
| Final report + changelog | PASS (this file + `docs/CHANGELOG.md`) |
