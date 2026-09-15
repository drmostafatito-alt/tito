# Audit — Homepage UI/UX + Public SEO Curriculum Pages (Phase A)

**Date:** 2026-09-14 · **Branch:** `arena/01a0a1f8-tito` · **Base commit:** `e4a121d` (main)
**Method:** repository forensic audit (code, schema, seed, tests, docs, assets) — no assumptions, every statement below is traceable to a file in this repository.
**Rule applied:** nothing may be claimed that the repository does not contain. Where the owner's brief asks for something that has **no source in the repo**, it is listed in §7 as *needs a source* — never invented.

---

## 1. What the platform actually is

| Layer | Reality in this repo |
|---|---|
| Runtime | React Router 7 framework mode on Cloudflare Workers (`workers/app.ts`), D1 + R2, Tailwind v4, vite 8 |
| Identity | `د/ مصطفى تيتو` / `Dr mostafa tito`, tagline `الفلسفة وعلم النفس` / `Philosophy & Psychology` (`scripts/seed.mjs`, `server/settings/schema.ts` defaults) |
| Domain model | program → grade → subject → course → unit → lesson (+ `lesson_items`: video/file/exam/link), commerce (`products` kinds: `course｜subject｜bundle｜subscription_plan`, `price_plans`), entitlements, activation codes, manual payments (Cash / Installments / InstaPay) with receipt proof, CMS (pages/blocks/menus/forms/templates), settings, audit |
| Content policy | **empty-first**: no placeholder assets, no fake demos, no invented statistics. Missing optional data renders nothing |
| Locales | `ar` (default, RTL) + `en`; locale is a **cookie on shared URLs** (`edu_locale`) → no hreflang, one canonical per URL |
| Exams | internal question bank **retired**; single **external** questions platform entry, admin-configured (`platform.questionPlatformEnabled` + `questionPlatformUrl`, https-only, disabled/unsafe → entry hidden) — `app/lib/question-platform.ts`, `app/components/QuestionPlatform.tsx` |
| Video | provider-neutral (`videos.provider` = mock/mux/bunny/cfstream/youtube), playback advertised server-side with short-lived tokens |

## 2. Current homepage mechanism (critical finding)

The homepage is **not** hardcoded JSX. It is the CMS page with slug `home`:

- `app/routes/public/home.tsx` → `getPageBySlug(db, "home")` → `renderSnapshot()` → `PageView`.
- With **no published `home` row** the route renders a branded empty state (`EmptyState`) — that is the production behaviour of a fresh database.
- `scripts/seed.mjs` publishes exactly **4 sections** today:
  1. `hero_showcase` (eyebrow `الفلسفة وعلم النفس`, heading `أهلاً بيكم في منصتكم!`, rich-text subtitle, CTAs → `/register` + `/login`, 3 floating badges, hero image = the seeded `hero-philosophy.webp` **or empty**),
  2. `statistics` (`style: bar`) — offering labels, **no invented numbers**,
  3. `feature_cards` (5 cards: lectures/notes/assignments/resource library/progress),
  4. `buttons` (closing CTA).
- Below the CMS content, `home.tsx` renders a code-level additive block `HomeDiscover` (published subjects/grades + catalog link) — the only SEO-oriented surface on the homepage; it renders nothing when there is no published content (integration test `tests/integration/seo-home.test.ts` asserts this contract).
- The seeding path is **local-only** (`db:seed:local` → `getPlatformProxy`). There is no remote seed command (`scripts/bootstrap-admin.mjs --remote` is the only `--remote` script).

**Consequence for this phase:** improving the homepage in code is not enough — the owner's live `home` page is a DB row. Deliverable must therefore include (a) better block types + (b) a composition that can be applied to *their* DB, not only a seed file.

## 3. Design system as found

- `app/app.css` `@theme`: `--color-brand-*` (violet `#7c3aed` ramp), `--color-accent-*` (indigo), `--radius-card`, fonts (IBM Plex Sans Arabic + self-hosted Cairo), safe-area utilities, RTL-aware base.
- **Owner-controlled theme**: `/theme.css` emits `--color-brand-*`, `--color-accent-*`, page bg/surface/ink/line/success/warning/error, radii, shadows, density, font scale from `settings.theme` (validated hex/enums only, `admin.appearance.tsx`). Schema defaults are violet (`#7c3aed`), seed writes violet.
- There are **no navy or gold tokens** anywhere in the repo. The brief's "Navy / Deep Blue + White + Gold" identity therefore has no existing implementation.
- Blocks use semantic tokens only (`bg-brand-*`, `text-slate-*`, `rounded-[var(--radius-card)]`), no inline styles (CSP `style-src 'self'`), no arbitrary CSS injection.
- Primitives available: `app/components/ui/{Button,Card,Input,Modal,Badge,Alert,EmptyState,ImagePicker}`, `app/cms/icons.tsx` (85 controlled icon ids, inline SVG, no icon library).

## 4. Visual assets actually present

| Asset | Status |
|---|---|
| `public/hero-philosophy.webp` | 35 KB abstract philosophy/psychology illustration (book + brain + scales), violet/purple. Seeded into R2/files when present; used as the `hero_showcase` fallback visual. |
| `public/fonts/cairo/*` (8 woff2) | self-hosted Cairo |
| Doctor's photo | **No image file exists in the repo.** Owner photo is a *setting* (`identity.ownerPhotoFileId` → `/files/:id` or R2 public URL), empty by default (`render.server.ts` → `ownerPhoto: null`, "never a placeholder"). `app/routes/public/about.tsx` is identity-gated on it. |
| Philosopher images (Aristotle, Plato, Socrates, Kant…) | **None exist** — verified by filename scan + content grep (`فلاسفة|philosopher|سقراط|أرسطو|أفلاطون|كانط` → 0 hits outside docs). |
| QA screenshots | 19 PNGs under `docs/reports/qa/` (test evidence, not design assets) |

**Consequence:** the "philosopher visual system" (§16 of the brief) cannot use philosopher portraits — they do not exist and the brief forbids generating images. It will be implemented as a **decorative academic visual system** built from CSS/SVG (concentric rings, classical column/arch motifs, gold rules, soft gradient washes) + the existing abstract illustration used as a low-opacity watermark. No new raster files, no invented portraits.

## 5. Public routes actually registered (`app/routes.ts`)

`/` · `/p/:slug` · `/about` · `/programs` · `/programs/:slug` · `/grades/:slug` · `/subjects/:slug` · `/courses` · `/courses/:slug` · `/courses/:slug/units/:unitId` · `/products/:slug` · `/login` · `/register` · `/forgot-password` · `/reset-password` · `/verify-email-change` · `/set-locale` · `/learn/:courseSlug/:lessonSlug` (gated, noindex) · `/files/:id` · `/api/*` · `/webhooks/*` · `/theme.css` · `/robots.txt` · `/sitemap.xml` · student area (`/dashboard`, `/profile`, `/assignments`, `/orders`, `/checkout/:productSlug`, `/activate`, `/notifications`) · admin area.

Notable **absences** (must not be linked from the homepage): no `/products` index, no `/exams` route (external platform only), no `/contact` route (CMS page `/p/contact` is the seeded one), no `/videos` index, no `/books`.

## 6. SEO system as found (already strong — extend, don't rebuild)

- `server/seo/inventory.server.ts` = single source of truth for indexable URLs → feeds `/sitemap.xml`, `/admin/seo` dashboard, robots-overlap invariant. Published-only, no query strings, no private areas, unit pages included when their course is in the catalog.
- `app/cms/seo.ts` — deterministic title/description resolution, brand fallbacks, **no `<meta keywords>`**, absolute canonical as `<link>`; `app/cms/jsonld.ts` — Organization/Person/WebSite/WebPage/Course/VideoObject/BreadcrumbList/ItemList/**DefinedTermSet** helpers, honest-only (no fake ratings/prices/SearchAction).
- `/grades/:slug` and `/subjects/:slug` already enrich metadata + `DefinedTermSet` from the real 48-lesson dataset via `server/seo/realLessonsMapping.server.ts`; **no lesson list is shown in the UI** (that was a deliberate, documented decision).
- `docs/reports/seo-content-map.md` defines the canonical strategy and explicitly names the intended public slugs of the two real curriculum entities: `/subjects/falsafa-manteq-1st` (فلسفة ومنطق — الصف الأول الثانوي) and `/subjects/psychology-bac` (علم النفس — مرحلة البكالوريا المصرية). **These DB rows do not exist in the local seed** (the only seeded catalog row is the physics LMS fixture `grade-3-secondary` / `physics-3s`, explicitly labelled a fixture, not site identity).

## 7. The 48-lesson source of truth (verified, unchanged)

`docs/seo/keyword-universe.{csv,md,json}` → `server/seo/realLessons.server.ts` (**48 rows**, generated by `scripts/import-curriculum.mjs`, "do not edit manually"):

| Grade | Subject | Terms | Units | Chapters | Lessons |
|---|---|---|---|---|---|
| الصف الأول الثانوي | فلسفة ومنطق | الترم الأول، الترم الثاني | 2 (الوحدة الأولى: الفلسفة · الوحدة الثانية: المنطق) | 4 (الفصل الأول/الثاني per unit) | 24 |
| مرحلة البكالوريا المصرية | علم النفس | الجزء الأول، الجزء الثاني | 6 | 6 (chapter label = unit label) | 24 |

`docs/seo/lesson-contents.json` holds per-lesson `summaryAr/reviewAr = null`, `status: "draft"` for all 48 → **no lesson-level explanations exist**. So curriculum pages may show structure (term/unit/chapter/lesson names) and semantic keywords, and must **not** show invented summaries or explanations.

## 8. Findings & dispositions (gaps to close in this phase)

| # | Finding (evidence) | Impact on the brief | Disposition |
|---|---|---|---|
| A1 | Homepage composition is a Violet 4-section CMS page; no service split (شرح/فيديوهات/كتب/امتحانات) | §1/§6 of the brief unmet | New data-driven blocks + new published composition |
| A2 | No block renders **videos** for the public (only `video` (single) + `latest_lessons`); `videos` table is never read by the renderer | §8 unmet | New `video_showcase` block resolving real ready videos via `lesson_items` |
| A3 | No block renders **products/books** (only static `pricing_cards`); `public.products.$slug` exists and shows prices publicly | §9 unmet | New `product_cards` block (active products + min active plan price, same data the product page shows) |
| A4 | No block renders **grades** (`program_cards`/`subject_cards`/`course_cards` exist; grades don't) | §11 unmet | New `grade_cards` block (published grades + subject/service counts) |
| A5 | External exams platform has a card component (`QuestionPlatformCard`) used on the student dashboard only | §10 unmet on the public homepage | New `exam_platform` block; renders **nothing** unless enabled + valid https |
| A6 | No journey/steps, benefits and premium closing-banner blocks | §12–§14 unmet | New `journey_steps`, `benefit_list`, `cta_banner` blocks |
| A7 | Theme has no navy/gold; brief demands Navy/White/Gold identity | §1/§2 unmet | New **stable identity tokens** (`--color-navy-*`, `--color-gold-*`) in `app.css` used by the new surfaces; seed theme switched to navy/gold (admin theme system untouched — owner can still change brand tokens) |
| A8 | No academic decorative system; hero has 3 blurred blobs only | §16 unmet | New SVG/CSS decorative components (`PhilosophyDecor`) — no raster assets |
| A9 | No public curriculum landing pages | §17–§25 unmet | New route family `/curriculum/:slug` derived **only** from `REAL_LESSONS` |
| A10 | Homepage improvement cannot reach the owner's DB through the seed (local-only) | §1 delivered but invisible in production | New idempotent **admin action "apply recommended homepage"** publishing through the existing CMS service (page versions = rollback), plus the same composition in `seed.mjs` |
| A11 | `seo-home`/`homepage.spec` tests pin hero hooks (`[data-hero-visual]`, `h1`, `nav#mobile-nav`, locale cookie copy) | regression risk | Preserve every hook; verify with the existing suites |
| A12 | No student-facing "grade picker" section exists; grades are only reachable via `HomeDiscover` text links | §11 unmet | `grade_cards` seeded with a clear CTA → `/grades/:slug` (real route) |

## 9. What must NOT change (verified constraints from the brief + repo)

Auth/sessions/devices, payments (manual rails, receipt upload/review, activation codes, entitlements), video provider abstraction and playback tokens, CMS business logic, external exams integration, admin area, `/robots.txt`, `/sitemap.xml` and `indexablePublicUrls()` integrity, RTL-first behaviour, CSP (no inline styles/scripts), tests, migrations, existing routes. No Paymob/Fawry/Stripe. No internal question bank. No force push/history rewrite.

## 10. Test surface that constrains this phase

`npm run typecheck` (tsc) · unit (vitest, 14 files) · integration (vitest in workerd + real D1, 26 files, incl. `seo-home`, `seo-meta`, `seo-crawl`, `year`/`cms`) · e2e (Playwright, 22 specs, real Chromium, AR/EN desktop+mobile, axe) · `npm run verify` (imports → typecheck → tests → build) · `scripts/smoke.mjs` (HTTP runtime suite against a live dev worker).

## 11. Implementation plan (batches, each committed + pushed separately)

1. **B1 — Audit (this document)** + design tokens (navy/gold) + decorative academic visual system + seed theme.
2. **B2 — Premium homepage blocks**: `video_showcase`, `product_cards`, `grade_cards`, `exam_platform`, `journey_steps`, `benefit_list`, `cta_banner` + visual upgrade of `hero_showcase`/`feature_cards`/`statistics`/card grid (registry + renderer + resolver + labels), preserving all existing props/DOM hooks.
3. **B3 — New homepage composition**: seed + admin "apply recommended homepage" action (versioned, revertible, idempotent).
4. **B4 — Public curriculum pages** `/curriculum/:slug` (2 pages, from the 48-lesson source), metadata/canonical/OG/breadcrumbs/JSON-LD, sitemap inclusion, internal links (curriculum → grade/subject/courses → home) and **zero** homepage/nav exposure.
5. **B5 — Chrome polish** (header/footer visuals), accessibility/responsive pass, tests, visual QA at 320→1440, final report.

## 12. Needs an owner-supplied source (NOT invented — no source in repo)

1. **Doctor photo** for the hero (the hero currently falls back to the abstract illustration; the owner uploads via Appearance → Identity → owner photo). The brief's "preserve the doctor's existing real image" is satisfied by *not* replacing it: no fake/AI portrait will ever be rendered.
2. **Philosopher portraits**, if the owner wants actual historical figures (none exist in the repo; CSS/SVG decoration is used instead).
3. **Real lesson summaries/reviews** for the 48 lessons (`docs/seo/lesson-contents.json` → `summaryAr`, `reviewAr`, `concepts`) — without them, curriculum pages show structure only.
4. **Real published grades/subjects/courses/products/videos** in D1 — every data-driven homepage section collapses while its table has no published rows (empty-first, by design).
5. **External exams URL** — already a setting; the exams section stays hidden until it is enabled.
