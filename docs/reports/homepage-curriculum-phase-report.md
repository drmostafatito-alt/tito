# Phase report — Premium homepage + public SEO curriculum pages

**Branch** `arena/01a0a1f8-tito` · **Baseline** `e4a121d` (merged `main`) ·
**Delivered head** `9cea46a` (report commit; feature head `056371a`) · **Remote** `9cea46af45246e488579540cdf161f42cdffbc69`
**Companion document** `docs/reports/homepage-curriculum-phase-audit.md` (audit A1–A12)

مراجعة سريعة بالعربي: تم رفع واجهة الصفحة الرئيسية إلى مستوى Premium بهوية الكحلي/الذهب، وإضافة صفحات نبذة عن المنهج (فلسفة ومنطق + علم النفس) للفهرسة في جوجل بروابط مباشرة فقط — بدون أي ظهور في الرئيسية أو القوائم، وبدون أي محتوى مُختلق، وبدون المساس بأي وظيفة قائمة (الطلاب، الإدارة، الكورسات، الفيديوهات، الكتب، المدفوعات، منصة الامتحانات الخارجية).

---

## 1. Audit findings (executed first, before any code)

The forensic audit (`d77c16c`, `docs/reports/homepage-curriculum-phase-audit.md`) mapped the
existing homepage, design system, route table, data model, SEO implementation, assets and the
48-lesson mapping. Findings and dispositions:

| # | Finding | Disposition |
|---|---|---|
| A1 | Homepage was a violet 4-section CMS page; no شرح/فيديوهات/كتب/امتحانات split | New data-driven blocks + new published composition |
| A2 | No public block rendered videos (`videos` never read by the renderer) | New `video_showcase` (real ready videos, resolved through `lesson_items`) |
| A3 | No public block rendered books/products | New `product_cards` (active products + lowest active plan price — the same data `/products/:slug` shows) |
| A4 | No block rendered grades | New `grade_cards` (published grades only) |
| A5 | External exams card existed on the student dashboard only | New `exam_platform` block → `https://exams.mansa-eg.workers.dev/`, renders nothing unless enabled + valid https |
| A6 | No journey / benefits / closing banner | New `journey_steps`, `benefit_list`, `cta_banner` |
| A7 | Theme had no navy/gold | New stable identity tokens `--color-navy-*` / `--color-gold-*`; owner theme system untouched |
| A8 | No academic decorative system | `app/components/visuals/PhilosophyDecor.tsx` — SVG/CSS only, no raster assets |
| A9 | No public curriculum pages | New `/curriculum/:slug`, derived **only** from `REAL_LESSONS` |
| A10 | Seed-only improvements never reach the owner's production DB | Admin action **"apply recommended homepage"** — versioned, revertible, idempotent, through the existing CMS service |
| A11 | Existing tests pin hero hooks (`[data-hero-visual]`, `h1`, `nav#mobile-nav`, locale cookie) | Every hook preserved; all suites re-run |
| A12 | Grades were reachable only from a legacy discover block | `grade_cards` seeded with a CTA to the real `/grades/:slug` route |

## 2. Design changes

- **Identity palette**: navy/deep-blue + white + gold + light-blue accents as *stable identity
  tokens* (A7) used by the new surfaces and the public chrome; the admin theme/appearance system
  and the owner's brand tokens remain functional and are not overwritten by the preset.
- **Academic decorative language**: gold hairlines, geometric rings, low-opacity watermarks and
  soft gradients (`DecorRings`, `DecorHairline`, `WatermarkVisual`, `Decor` band/hero/cta/page
  variants). Opacity ≤ 0.14, `aria-hidden`, never over body text; the existing abstract
  illustration (`public/hero-philosophy.webp`) is the only image used decoratively.
- **Chrome**: desktop header (logo, identity name, nav, login/register CTA, socials, gold underline
  for the active page), mobile drawer with 44px targets, footer rebuilt on navy-950 with gold
  hairline, brand block, real socials, contact block and dynamic copyright.
- **No rejected design language** (المجلس / SIGNAL) was reintroduced; no new image assets, no AI
  imagery, no generated portraits.

## 3. Homepage sections — new vs. changed

Published composition (11 sections, `server/cms/home-preset.json`):

| # | Section (AR) | Block | Status |
|---|---|---|---|
| 1 | البطل: "أهلاً بيكم في منصتكم!" | `hero_showcase` | **upgraded** (split composition, CTAs ابدأ رحلتك الآن / تواصل معنا, doctor photo slot, decorative layer) |
| 2 | — | `statistics` | kept, renders only real data |
| 3 | كل ما تحتاجه في مكان واحد | `feature_cards` | **upgraded** — الشرح / الفيديوهات / الكتب والمذكرات / الامتحانات والتدريبات |
| 4 | الكورسات | `course_cards` | kept (DB-driven) |
| 5 | فيديوهات الشرح | `video_showcase` | **new** |
| 6 | الكتب والمذكرات | `product_cards` | **new** |
| 7 | الامتحانات والتدريبات | `exam_platform` | **new** (external platform, unchanged integration) |
| 8 | اختر صفك للبدء | `grade_cards` | **new** |
| 9 | رحلتك على المنصة | `journey_steps` | **new** |
| 10 | لماذا المنصة؟ | `benefit_list` | **new** (no invented numbers/testimonials) |
| 11 | مستقبلك يبدأ من هنا | `cta_banner` | **new** |

Every one of them is **empty-safe**: with an empty database the section renders nothing at all
(verified by `DATA_DRIVEN_BLOCKS` + `blockIsEmpty()` + the integration suite), which is the state
production starts in.

## 4. SEO curriculum pages

- Route family `/curriculum/:slug` rendering a real, indexable page: `h1` "نبذة عن محتوى المنهج"
  + grade/subject line, an honest نبذة generated from the mapped curriculum data, unit/chapter/lesson
  structure (terms → units → chapters → lesson counts), real CTAs ("استكشف الدروس" → the real
  course/lesson routes, "الصفحة الرئيسية" → `/`).
- **Source of truth is the repo's confirmed list only** (`server/seo/realLessons.server.ts`; skills
  cross-checked against `docs/seo/keyword-universe.*`). No self-authored science text, no invented
  units, no numbers that are not in the data.
- Per page: unique `<title>`, unique meta description, canonical, OpenGraph + Twitter tags,
  breadcrumbs, `WebPage` + `BreadcrumbList` + `Organization` + `WebSite` JSON-LD (`ItemList` only
  when a real course exists; no review/rating/aggregate data), correct `lang`/`dir`, sitemap
  inclusion, unknown slug → **404** (never a redirect to the homepage), and **zero** links to these
  pages from the homepage, the header, the footer or any homepage section.

## 5. URLs

| URL | Purpose |
|---|---|
| `/` | Premium homepage (CMS-driven) |
| `/curriculum/falsafa-manteq-grade-1-secondary` | الصف الأول الثانوي – فلسفة ومنطق |
| `/curriculum/psychology-baccalaureate` | مرحلة البكالوريا المصرية – علم النفس |
| `/curriculum/<unknown>` | 404 |
| `/sitemap.xml` | lists both curriculum URLs (verified live) |

## 6. What students see

RTL Arabic by default, navy header with the identity name, hero with the headline, two CTAs and the
visual column, then services → courses → videos → books → exams → grade picker → journey → benefits
→ closing banner → footer with contact and socials. Every CTA points at a route that really exists;
every list shows real published content and disappears when there is none. English LTR works through
the same components (locale switcher preserved).

## 7. What is NOT in the homepage (deliberate)

- No curriculum-page links (verified: `grep -c "/curriculum/"` on the rendered `/` HTML = **0**).
- No curriculum entry in the header nav, mobile drawer or footer menu.
- No invented statistics ("100 ألف طالب"، "رقم 1"، "99%"), no fabricated testimonials, no fake
  reviews, no prices that the system does not store, no fabricated courses/videos/books.
- No physics content as identity (the local physics fixture exists only for tests).
- No annual/doorway URLs (`/2026/…`), no hidden text, no keyword blocks, no lesson-name stuffing.

## 8. How the 48 lessons were used

Reference source only (`REAL_LESSONS`: فلسفة ومنطق/الأول الثانوي 24 + علم النفس/البكالوريا 24):

- Curriculum pages summarise **units → chapters → lesson counts** from that data (e.g. philosophy
  "وحدتان و6 فصول و24 درسًا"; psychology "12 درسًا" per part with no chapters, since the source has
  none).
- **No** 48 separate pages; **no** lesson names on unrelated pages; **no** renaming of any lesson in
  the data model; the 48 lessons are **not** listed as a block anywhere, and no keyword block was
  created from them.
- Semantic keywords are used only as synonym-level relevance inside the two real pages, and
  `unmappedCurriculumGroups()` is asserted empty so no lesson can silently fall out of the mapping.

## 9. SEO preservation

`/robots.txt`, `/sitemap.xml` and `indexablePublicUrls()` keep working and now include the two new
URLs; canonical, breadcrumb, OG/Twitter, `lang`/`dir` and indexability are emitted server-side;
`security.txt`, CSP and structured-data helpers are untouched. Regressions are pinned by
`tests/integration/seo-crawl.test.ts` (path allowlist extended) and `tests/integration/seo-curriculum.test.ts`
(metadata shape, JSON-LD accumulation, sitemap inclusion, homepage linking = 0).

## 10. Files changed

39 files, **+3458 / −251** versus the baseline (`git diff --stat e4a121d..HEAD`):

- **App**: `app/app.css`, `app/cms/links.ts`, `app/cms/registry.ts`, `app/cms/render-types.ts`,
  `app/components/BrandMark.tsx`, `app/components/cms/blocks.tsx`,
  `app/components/visuals/PhilosophyDecor.tsx` (new), `app/lib/curriculum-format.ts` (new),
  `app/locales/ar.ts`, `app/locales/en.ts`, `app/root.tsx`, `app/routes.ts`,
  `app/routes/admin.cms.tsx`, `app/routes/public.curriculum.$slug.tsx` (new),
  `app/routes/public/layout.tsx`, generated `.react-router/types/*`.
- **Server**: `server/cms/home-preset.json` (new), `server/cms/home-preset.server.ts` (new),
  `server/cms/render.server.ts`, `server/seo/curriculum-pages.server.ts` (new),
  `server/seo/inventory.server.ts`, `server/settings/schema.ts`.
- **Scripts**: `scripts/seed.mjs`.
- **Tests**: `tests/unit/curriculum-pages.test.ts` (new), `tests/unit/cms-registry.test.ts`,
  `tests/integration/seo-curriculum.test.ts` (new), `tests/integration/seo-crawl.test.ts`,
  `tests/integration/cms.test.ts`, `tests/e2e/cms-builder.spec.ts`,
  `tests/e2e/whatsapp-fab.spec.ts`, `playwright.config.ts`.
- **Docs/QA**: `docs/reports/homepage-curriculum-phase-audit.md`,
  `docs/reports/qa/*.jpg` (6 jpeg shots, ~0.7 MB total).

## 11. Routes changed

Exactly one line added — `app/routes.ts:15` → `route("curriculum/:slug", "routes/public.curriculum.$slug.tsx")`.
**No** route removed, renamed or repurposed; no auth/student/admin/course/product/checkout route
touched; the external exams integration is unchanged.

## 12. Tests

| Gate | Result |
|---|---|
| `npm run lint:imports` (module boundaries) | ✅ clean (one violation found and fixed: a server module re-exported client code) |
| `npm run typecheck` (typegen + tsc) | ✅ 0 errors |
| Unit (vitest) | ✅ **346 passed / 31 files** |
| Integration (vitest in workerd + real D1) | ✅ **295 passed / 27 files** |
| E2E (Playwright, real Chromium 153) | ✅ **80 passed / 0 failed** |
| axe (Playwright + axe-core) | ✅ **0 violations** across 20 public/student/admin pages |
| `npm run verify` (imports → typecheck → tests → build) | ✅ green |

E2E hardening in this phase (all real flake, not cosmetic):
- the CMS builder specs now probe section order through **exact heading text inside `<main>`** (whole-body
  and body-`indexOf` probes were unsound — the hero CTA contains the word "الكورسات"), pick the pair
  from the public page and locate it in the builder by heading, and **verify the draft before
  publishing** (save → reload → assert) so a lost save or a publish racing the save can never look
  like a broken visitor page;
- the WhatsApp FAB collision spec scrolls instantly to the computed offset on a 390×844 phone
  viewport (a `mouse.wheel` animation could leave the form short of the reserved corner, and at
  1440px the centred column and the `end-4` button can never overlap).

## 13. Build

`npm run build` → ✅ client **3.00 s** / server **1.66 s**. Client route chunk for the new page:
`public.curriculum._slug-*.js` **8.13 kB (gzip 2.63 kB)**; global CSS **87.05 kB (gzip 14.97 kB)**;
`build/client` total **2.2 MB** including the pre-existing fonts. No new runtime dependency, no new
raster asset, no duplicate build output committed.

## 14. E2E (what was actually exercised in a browser)

Owner → database → public loop for the CMS (rename, hide/show, reorder, template, student denial), the
WhatsApp FAB (enable/disable, homepage-only, collision avoidance), the SEO specs (meta, crawl
allowlist, homepage carries no curriculum links), auth, student area, admin area, payments flow and
the accessibility audits — all in a real Chromium, AR and EN, desktop/tablet/mobile, with
`test-results/` artifacts kept small (no video, no traces on success).

## 15. Performance notes

Measured in the sandbox against the local worker (cold, no CDN) with Playwright + PerformanceObserver:

- Home at 390×844: **LCP 764 ms, FCP 764 ms, CLS 0**, DOMContentLoaded 591 ms.
- Home at 1440×900: LCP 744 ms, CLS 0.
- Fonts: the two Cairo Arabic faces that cover body and bold copy are now `<link rel="preload">`ed
  (`app/root.tsx`), which removed the swap wait and dropped the font transfer on warm navigation
  (188 kB → 125 kB in the same run).
- The hero illustration is served with `fetchpriority="high"` + `decoding="async"`; every below-fold
  image is `loading="lazy"`; all decoration is SVG/CSS (zero image requests).
- No background video, no animation library, no new bundle weight for the new sections.

## 16. Accessibility notes

- axe-core: **0 violations** on all 20 audited pages — public/auth (login, register, forgot-password,
  homepage), student (dashboard, catalog, course, lesson, assignments, checkout, orders,
  notifications, profile) and admin (dashboard, users, announcements, analytics, security, audit,
  commerce).
- Fixed a real defect found by the modern browser: when the owner has no logo yet, the footer brand
  label rendered slate-900 on navy (1.02:1). `BrandMark` now takes a `tone` (`onLight` / `onDark`)
  and the footer asks for the dark-surface variant (`text-white`).
- Semantic landmarks (`header`/`nav`/`main`/`footer`), one `h1` per page with a clean `h1→h4`
  hierarchy, `aria-label` on every icon-only control, decorative SVGs/images `aria-hidden` with empty
  alt, visible focus rings, ≥44px touch targets, `prefers-reduced-motion` honoured
  (`app/app.css`), RTL-first layout with logical properties.

## 17. Limitations

1. QA was run in the sandbox, not on the production domain; measurements are local-worker numbers.
2. The sandbox's assembled legacy Chromium (~92) cannot parse Tailwind v4 output, so CSS-dependent
   visual/a11y measurement needs a modern binary — `playwright.config.ts` now accepts
   `E2E_CHROMIUM_PATH` (Chromium 153 was used for every number above).
3. Production starts **content-empty**: the data-driven homepage sections collapse to nothing until
   the owner publishes grades, courses, videos and products, and the exams section stays hidden until
   the external URL is enabled.
4. The doctor photo is not present in the repository, so the hero uses the existing abstract
   illustration in its place. Nothing was generated or substituted — per the identity constraint the
   real photo is uploaded by the owner (Appearance → Identity) and then renders in the same slot.
5. The two curriculum pages deliberately describe structure only; without owner-supplied lesson
   summaries they remain honest-thin rather than invented-rich.

## 18. Content needing an owner source (nothing invented)

1. **Doctor photo** for the hero (upload via Appearance → Identity).
2. **Published grades / subjects / courses / products / videos** — each unlocks the matching homepage
   section.
3. **Real lesson summaries/reviews** (`docs/seo/lesson-contents.json` → `summaryAr`, `reviewAr`,
   `concepts`) — would deepen the two curriculum pages without changing their structure.
4. **External exams URL** — enable it in settings and the "الامتحانات والتدريبات" section appears
   (integration already exists and was left untouched).
5. Optional: philosopher portraits, if the owner wants real figures instead of the CSS/SVG decoration.

## 19. Commit SHA

`9cea46af45246e488579540cdf161f42cdffbc69` (this report)
`056371ad20d116585cb1b0aa6a4886b784ff0ca4` (feature head — app/server/tests)
(phase history: `d77c16c` audit · `6cbca778` tokens+decor · `674d76c` premium blocks · `7076f25`
recommended homepage · `ef91c54` curriculum pages · `6cf5b67` navy/gold chrome · `bc10ba1` E2E
hardening · `056371a` modern-browser a11y/perf fixes · `9cea46a` this report)

## 20. Remote SHA

`9cea46af45246e488579540cdf161f42cdffbc69` — `refs/heads/arena/01a0a1f8-tito`
(verified with `git ls-remote origin refs/heads/arena/01a0a1f8-tito`; local `HEAD` matches; no force
push, no history rewrite, no PR, `main` untouched at `e4a121d`).
