# SEO Forensic Audit + Keyword Universe — Dr Mostafa Tito

Phase: **SEO Master Phase** (forensic baseline — captured 2026-09-14 against
`main` @ `a624948`, before any code change).

Method: full source inspection + live HTTP sweep of a migrated & seeded local
worker (`wrangler dev`, real D1) via `scripts/seo-audit.mjs` (kept in-repo for
re-runs). No guesses — every row below is observed or read from code.

---

## 1. Route inventory (observed)

| ROUTE | PAGE TYPE | PUBLIC/PRIVATE | INDEX/NOINDEX (as found) | LANG | INTENT | CLUSTER | CANONICAL | HREFLANG | TITLE (as found) | DESC (as found) | H1 | STRUCTURED DATA | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | CMS homepage (`home` slug) | public | index (default meta) | ar/en (cookie) | branded + course discovery | BRAND | ✓ link, self, abs | n/a | `الرئيسية` (**weak**) | ∅ | ✓ (CMS hero) | ∅ | FIX: brand title/desc fallback, discovery links, JSON-LD |
| `/p/:slug` | CMS page (resources, faq, contact, …) | public | index | ar/en | informational / navigational | per-page | ✓ | n/a | page title only (no brand suffix) | ∅ (seed pages) | ✓ sr-only | ∅ | FIX: brand-suffixed fallback title, desc fallback, WebPage LD |
| `/courses` | catalog index | public | index | ar/en | course discovery | SUBJ/COURSE | ✓ | n/a | `الدورات التدريبية — د/ مصطفى تيتو` | tagline | ✓ | ∅ | FIX: ItemList LD |
| `/courses/:slug` | course | public (content gated) | index | ar/en | course discovery / lesson discovery | COURSE | ✓ | n/a | `course — brand` | course desc | ✓ | ∅ | FIX: Course LD, BreadcrumbList, thumb alt, home crumb |
| `/courses/:slug/units/:unitId` | unit | public (lessons gated) | index (root default meta) | ar/en | lesson discovery | LESSON | **∅** | n/a | brand-only (root default) | ∅ | ✓ | ∅ | FIX: full meta (title/desc/canonical) |
| `/programs` | program index | public | index | ar/en | course discovery | PROGRAM | ✓ | n/a | `البرامج — brand` | tagline | ✓ | ∅ | OK (+WebSite/Org via layout) |
| `/programs/:slug` | program (e.g. الثانوية العامة) | public | index | ar/en | grade/program discovery | PROGRAM/GRADE | ✓ | n/a | `program — brand` | program desc (∅ when unset) | ✓ | ∅ | FIX: BreadcrumbList, WebPage LD, home crumb |
| `/subjects/:slug` | subject (e.g. الفلسفة) | public | index | ar/en | subject discovery / grade+subject | SUBJECT + GRADE+SUBJECT | ✓ | n/a | `subject — brand` (**grade missing**) | subject desc (∅ when unset) | ✓ | ∅ | FIX: add grade to title/desc, BreadcrumbList, thumb alt |
| `/grades/:slug` | **MISSING — no public grade page** | — | — | — | grade discovery / grade+subject | GRADE | — | — | — | — | — | — | BUILD (data-driven, empty-first) |
| `/products/:slug` | public storefront product | public | index | ar/en | commercial discovery | COURSE/PRODUCT | ✓ | n/a | `product — brand` | product desc | ✓ | ∅ | OK (no fake price LD — prices stay server-side; Product LD deferred to owner real-content phase to avoid fake offers) |
| `/learn/:courseSlug/:lessonSlug` | lesson player | **PRIVATE** (anon → 302 login; entitled → gated) | root default (indexable when logged in) | ar/en | lesson content | LESSON | **∅** | n/a | brand-only | ∅ | ✓ | ∅ | FIX: noindex + title/desc/canonical (per-user progress rendered → must not index) |
| `/about` | **MISSING — no public profile page** | — | — | — | branded (entity) | BRAND/PERSON | — | — | — | — | — | — | BUILD (identity settings + real catalog; Person LD) |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email-change` | auth | public | **index (no robots meta — accidental)** | ar/en | navigational | — | ∅ | n/a | brand-only (root default) | ∅ | ✓ | ∅ | FIX: noindex + labelled title |
| `/set-locale` | POST action | n/a | 405 on GET | — | — | — | — | — | — | — | — | — | OK |
| `/dashboard`, `/profile`, `/profile/security`, `/assignments(/:id)`, `/checkout/:slug`, `/orders(/:n)`, `/activate`, `/notifications` | student area | private (anon → 302) | index (no robots meta when logged in) | ar/en | — | — | ∅ | n/a | root default | ∅ | varies | ∅ | FIX: noindex (defense-in-depth; redirects already block bots) |
| `/admin*` (24 routes) | admin | private (rank≥3, anon → 302) | index (no robots meta when logged in) | ar/en | — | — | ∅ | n/a | root default | ∅ | varies | ∅ | FIX: noindex (defense-in-depth) |
| `/files/:id` | signed file stream | gated (HMAC + entitlement) | n/a (binary) | — | — | — | — | — | — | — | — | — | OK (robots Disallow) |
| `/api/playback/:videoId`, `/api/mock-stream/*`, `/beacons/progress`, `/webhooks/payments/:provider` | API | gated/secret | n/a (JSON) | — | — | — | — | — | — | — | — | — | OK (robots Disallow) |
| `/theme.css`, `/favicon.ico` | assets | public | n/a | — | — | — | — | — | — | — | — | — | OK |
| `/robots.txt` | **MISSING → 404 HTML** | — | — | — | — | — | — | — | — | — | — | — | BUILD (dynamic route; origin-aware Sitemap line) |
| `/sitemap.xml` | **MISSING → 404 HTML** | — | — | — | — | — | — | — | — | — | — | — | BUILD (dynamic, DB-driven, published-only) |
| `*` unmatched | 404 | public | 404 status ✓ | ar | — | — | ∅ | n/a | `منصة تعليمية` (fallback; root loader data unavailable in error context) | ∅ | ✓ | ∅ | FIX: brand fallback title |

Observed facts from the live sweep (seeded local D1):

- Canonical is already correct where emitted: real `<link rel="canonical">`
  element, absolute, **query strings excluded** (`/courses?sort=latest` →
  canonical `/courses`). No canonical loops. CMS canonical override supported.
- **Zero JSON-LD on every page** (`json-ld: 0` across the sweep).
- **Zero hreflang** — and none is possible today: locale is a **cookie**
  (`edu_locale` via `POST /set-locale`), both languages serve the **same URL**.
  There are no `/ar/…` or `/en/…` URL equivalents, so hreflang/x-default would
  be false. Correct handling: `lang`+`dir` on `<html>` (already present) and a
  single canonical per URL; hreflang documented as N/A by architecture.
- SSR waits for full content for bots (`isbot` in `entry.server.tsx`) — crawler
  HTML is complete.
- Auth redirect chain: `/learn`, `/dashboard`, `/admin` → `302 /login?next=…`.
- Seeded demo catalog (physics 3s) is explicitly **not** the production
  identity (README + `check:production-readiness.mjs` rejects it). Production
  starts **content-empty** (owner publishes real philosophy/psychology content
  via Admin → Content). ⇒ All SEO surfaces must be **data-driven and
  empty-first**: a subject/grade/grade-subject page exists only when the owner
  publishes that row; the sitemap reflects publish state.
- Academic year: **not modeled anywhere** (no year column in
  `programs/grades/subjects/courses`). Current academic year for the Egyptian
  secondary cycle in the platform's own data: none represented ⇒ **no
  year-specific pages** (creating "فلسفة 2026" pages would be fake). Strategy:
  permanent subject/grade URLs (no year in path) + owner-editable SEO
  title/description fields so a year can be added/changed in metadata without
  URL churn (see final report §15).

## 2. Content reality (source of truth for the keyword universe)

From code + seed + settings schema + production-readiness gate:

- Official identity (settings defaults, owner-confirmed in seed):
  `د/ مصطفى تيتو` / `Dr mostafa tito`, tagline `الفلسفة وعلم النفس` /
  `Philosophy & Psychology`. Facebook page URL configured (identity.socials).
  ownerTitle / ownerPhoto / bio: **empty until the owner provides them** —
  nothing may be invented.
- Content hierarchy: **program → grade → subject → course → unit → lesson →
  lesson items** (schema `content.ts`). Public catalog = published +
  catalog/featured + publish-window + published ancestors (`catalogCourses`).
- CMS: `home` + subpages (`resources`, `faq`, `contact` in the local seed) are
  owner-composed; menus are data-driven; per-page SEO tab exists
  (title/description/canonical/og/robots) and is **already working** (canonical
  as `<link>`, verified in HTML).
- Subjects actually supported in the local fixture: `physics-3s` (demo only).
  **Philosophy / psychology / logic subjects exist in production only when the
  owner publishes them** — the platform code supports any subject row equally.
  No `منطق` (logic) rows exist in the repo ⇒ **no logic landing pages are
  built**; they appear automatically if/when the owner publishes a logic
  subject (documented owner action).
- Grades in the fixture: `grade-3-secondary` (الصف الثالث الثانوي) under
  program `al-Thanawiya-al-3amma` (الثانوية العامة). Only **published** grades
  get pages.
- External Questions Platform: admin-configured https URL, entry point
  renders only when enabled + valid (dashboard area). Untouched by this phase.

## 3. Keyword universe (Egyptian Arabic search behavior)

Built against the reality above. Clusters marked **dynamic** resolve to
data-driven pages that appear when the owner publishes the matching row; that
is the anti-doorway guarantee — every page in the universe maps to a row in
the DB, and none can exist without content.

### A) BRAND (→ `/` + `/about`)
مصطفى تيتو · مستر مصطفى تيتو · دكتور مصطفى تيتو · مستر دكتور مصطفى تيتو ·
مدرس مصطفى تيتو · مصطفى تيتو فلسفة · مصطفى تيتو علم نفس · مصطفى تيتو منطق (only
once a logic subject exists) · منصة مصطفى تيتو · منصة مستر مصطفى تيتو ·
د/ مصطفى تيتو

### B) GENERAL SUBJECT — فلسفة (dynamic → `/subjects/:slug` per published subject row)
فلسفة · مادة الفلسفة · شرح الفلسفة · دروس الفلسفة · منهج الفلسفة · مراجعة
فلسفة · مراجعات فلسفة · أسئلة فلسفة (→ external Questions Platform link, not a
Tito page) · تدريبات فلسفة (→ external) · امتحانات فلسفة (→ external) · ملخص
فلسفة · شرح مادة الفلسفة · فلسفه (spelling variant — same target page, no
duplicate page)

### C) PSYCHOLOGY (dynamic → `/subjects/:slug`)
علم النفس · علم نفس · مادة علم النفس · شرح علم النفس · دروس علم النفس · منهج
علم النفس · مراجعة علم النفس · مراجعات علم النفس · أسئلة علم النفس (→ external)
· تدريبات علم النفس (→ external) · امتحانات علم النفس (→ external) · ملخص علم
النفس · شرح مادة علم النفس

### D) LOGIC (dynamic → `/subjects/:slug` — ONLY if the owner publishes a logic
subject; none exists today ⇒ no pages, documented as owner action)
منطق · المنطق · مادة المنطق · شرح المنطق · دروس المنطق · منهج المنطق · مراجعة
المنطق · مراجعات المنطق · أسئلة المنطق (→ external) · تدريبات المنطق (→
external) · امتحانات المنطق (→ external) · ملخص المنطق · شرح مادة المنطق

### E) COMBINED SUBJECTS (→ subject pages + cross-links; no combined pages —
each subject keeps its own canonical; combined queries are served by the
subject pages that exist, plus the grade pages listing both)
فلسفة ومنطق (only when both exist) · فلسفة وعلم نفس · فلسفة وعلم النفس ·
فلسفة ومنطق وعلم نفس

### F) GRADE (dynamic → `/grades/:slug` per published grade row; only supported
grades ever render — today's fixture is 3rd secondary)
الصف الأول الثانوي · أولى ثانوي · اولى ثانوي (variant) · الصف الثاني الثانوي ·
تانية ثانوي · ثانية ثانوي · تانيه ثانوي (variant) · الصف الثالث الثانوي ·
تالتة ثانوي · تلاتة ثانوي (variant) · الثانوية العامة (→ program page
`/programs/:slug` — exists as real content) · ثانوية عامة (variant)

### G) GRADE + SUBJECT (high-value; canonical target = the **subject page** for
the published subject-under-grade row — its title carries grade + subject; the
grade page cross-links to each subject)
أولى ثانوي فلسفة / فلسفة أولى ثانوي · أولى ثانوي علم نفس · أولى ثانوي منطق (if
published) · تانية ثانوي فلسفة · تانية ثانوي علم نفس · تانية ثانوي منطق (if
published) · تالتة ثانوي فلسفة · تالتة ثانوي علم نفس · تالتة ثانوي منطق (if
published) — combinations that have no published row produce no page and are
covered by the grade page's subject list when partial.

### H) INTENT MODIFIERS (mapped to the correct existing page — NO new pages)
- شرح / شرح مبسط / شرح كامل / محاضرة / فيديو → course page (course IS the
  lecture content)
- درس / دروس → course page (unit list) / subject page
- المنهج / الوحدة / الباب → subject page (course list) or course page
- مراجعة / مراجعة نهائية → course page (revision courses are published as
  courses)
- ملخص / مذكرات → subject page + `/p/resources` (resource library)
- حل / أسئلة / تدريبات / امتحان / امتحانات → **external Questions Platform**
  (professional entry point; Tito never hosts questions — kept intact)
- أونلاين / مدرس / مدرس اونلاين / أفضل مدرس / كورس → homepage + subject pages
  (identity/brand claim; no "best teacher" superlative pages)

### I) ACADEMIC-YEAR (no year in the content model ⇒ no year pages, no year in
URLs)
فلسفة 2026 · فلسفة 2026 2027 · علم النفس 2026 · علم نفس 2026 2027 · منطق 2026 ·
أولى ثانوي فلسفة 2026 · تانية ثانوي فلسفة 2026 · منهج الفلسفة 2026 ·
منهج علم النفس 2026
⇒ served by the same dynamic pages; owner may add the current year to the
subject/grade SEO title/description via the Admin SEO fields (no developer
needed, no URL change when the year rolls over).

### J) QUERY VARIANTS (understanding only — never duplicate pages)
فلسفه/فلسفة · علم نفس/علم النفس · المنطق/منطق · اولى/أولى · تانيه/ثانية/تانية/
تانية/ثالثه/ثالثة · مدرس فلسفه · مدرس فلسفة · مدرس علم نفس · مستر فلسفة ·
مستر علم نفس · ثانوية عامة/الثانوية العامة
⇒ canonical dedup handles these at the URL level; no variant pages, no
hidden-variant text.

## 4. Keyword → page cluster map (final)

| CLUSTER | INTENT | SEARCHER | PRIMARY KEYWORD | SECONDARY | CANONICAL TARGET | INDEX | CONTENT SOURCE |
|---|---|---|---|---|---|---|---|
| brand-core | navigational/branded | branded, student, parent | مصطفى تيتو | مستر/دكتور/مستر دكتور variants, د/ مصطفى تيتو | `/` | index | platform settings + CMS home |
| brand-entity | branded/informational | branded, parent | دكتور مصطفى تيتو | مدرس مصطفى تيتو, شرح مصطفى تيتو | `/about` | index (only when owner identity is set) | identity settings + real catalog |
| brand-subject | branded+educational | student, parent | مصطفى تيتو فلسفة | مصطفى تيتو علم نفس | `/subjects/<philosophy slug>` (per published row) | index | subject row |
| subject-philosophy | educational | student, parent, teacher | فلسفة | مادة الفلسفة, شرح الفلسفة, دروس/منهج/مراجعة/ملخص فلسفة, فلسفه | `/subjects/:slug` | index | subject row (+grade in title) |
| subject-psychology | educational | student, parent, teacher | علم النفس | علم نفس, مادة/شرح/دروس/منهج/مراجعة/ملخص علم النفس | `/subjects/:slug` | index | subject row |
| subject-logic | educational | student, parent, teacher | منطق | المنطق, مادة/شرح/دروس/منهج/مراجعة/ملخص المنطق | `/subjects/:slug` **iff published** | index | subject row (owner action) |
| combined-subjects | educational | student | فلسفة وعلم نفس | فلسفة ومنطق (iff), علم النفس والمنطق | grade page + both subject pages | index | grade/subject rows |
| grade-program | navigational/educational | student, parent | الثانوية العامة | ثانوية عامة, الصف الثالث الثانوي, تالتة ثانوي | `/programs/:slug` (program) + `/grades/:slug` (grade) | index | program/grade rows |
| grade-{g} | navigational/educational | student, parent | الصف N الثانوي | N ثواني/ثانوي variants | `/grades/:slug` | index | grade row |
| grade-subject | educational (top value) | student, parent | {g} {subject} (both orders) | شرح/مراجعة/دروس {subject} {g} | `/subjects/:slug` (title carries "{subject} — {grade} — brand") | index | subject+grade rows |
| course | course discovery | student, parent | {course name} | كورس/محاضرة/شرح {course} | `/courses/:slug` | index | course row |
| lesson | lesson discovery (gated) | student | {lesson name} | درس {lesson} | `/learn/…` | **noindex** (private) | lesson row (public listing lives on course page) |
| questions/exams | review/practice | student, parent | أسئلة {subject}, امتحانات {subject}, تدريبات {subject} | حل أسئلة, بنك أسئلة | **external Questions Platform** (Tito entry point) | n/a (external) | external platform |
| resources | informational | student | ملخص {subject}, مذكرات {subject} | ملفات {subject} | `/p/resources` + subject page | index | CMS page + subject row |
| academic-year | educational (time-bound) | student, parent | {subject} 2026 | منهج {subject} 2026, {g} {subject} 2026 | same dynamic pages (year in metadata only, owner-editable) | index | subject/grade rows + admin SEO fields |
| auth | navigational | student, parent | دخول, إنشاء حساب, تسجيل حساب | استعادة كلمة المرور | `/login`, `/register`, … | **noindex** | — |
| faq/contact | informational | parent, student | — | — | `/p/faq`, `/p/contact` | index | CMS pages |

Cannibalization decisions:
- grade+subject intent ⇒ subject page wins (grade appears in its title &
  breadcrumbs); the grade page targets the pure grade intent and cross-links.
- "أسئلة/امتحانات/تدريبات" ⇒ external platform, never a Tito page.
- spelling variants ⇒ same canonical page (no duplicates, no hidden text).
- academic year ⇒ same page, metadata-level (no /2026/ doorway pages).

## 5. Baseline technical findings (what this phase fixes)

1. No `robots.txt` (404 HTML served).
2. No `sitemap.xml` (404 HTML served).
3. No structured data anywhere (0 JSON-LD).
4. Auth pages indexable by default (no robots meta) → duplicate brand titles.
5. `/learn` + unit pages: no route meta (root-default title, no canonical).
6. Homepage: weak title `الرئيسية`, no description, no og:image, no discovery
   links to subject/grade pages.
7. No public grade landing page (grade rows exist with slugs but no route).
8. No public `/about` entity page for Dr Mostafa Tito (identity settings exist).
9. Subject title lacks its grade (grade+subject cluster under-served).
10. Image alt gaps: course thumbnails on subject page (`alt=""`) and course
    page hero (`alt=""`).
11. Breadcrumbs partial (no home crumb; no BreadcrumbList schema; no crumbs
    context for grades).
12. 404 title falls back to generic `منصة تعليمية`.
13. No admin SEO health view; CMS SEO tab has no validation warnings.
14. hreflang: correctly absent — architecture is cookie-locale on shared URLs
    (documented; not a defect).
