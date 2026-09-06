# Homepage Design Implementation Report

Date: 2026-09-06 · Branch: `arena/01a07397-tito` · Platform: **الفلسفة وعلم النفس (Philosophy & Psychology)** — no physics content anywhere.

---

## 1. Summary

Implemented a premium, CMS-driven, Arabic-first responsive homepage that matches the uploaded visual reference **as design language only**. The reference image is a *layout/styling* target (split hero, gradient band, floating feature cards, statistics/trust bar, "what you'll find" card grid, closing CTA); the **actual platform content is philosophy & psychology**, and no physics text, subject names, icons, or claims were introduced anywhere.

Every element is real and editable through the existing CMS — no static mockup, no hardcoded JSX, no fake buttons/video thumbnails, no non-functional cards, no invented statistics or identity. The homepage is composed and published as the CMS page with slug `home`, exactly like any other page the owner builds in **Admin → CMS → Pages**.

**Key result:** a `hero_showcase` hero + a purple-gradient trust bar + six tinted feature cards + a closing CTA, all driven by typed, schema-validated, bilingual block schemas that the admin builder already renders forms for.

---

## 2. Approach

The platform is CMS-first (Phase 3): `public/home.tsx` renders the published snapshot of the page with slug `home` via `PageView`. Block schemas and their bilingual admin labels are self-contained in `app/cms/registry.ts` (`BLOCKS` + `CMS_LABELS`); the admin page builder (`admin.cms.pages.$id.tsx` + `app/components/cms/fields.tsx`) auto-generates editing forms from those descriptors. No new CMS, no route changes, no rebuild.

To represent the split-hero composition (which the existing centered `hero` block cannot express), a **new reusable block `hero_showcase`** was registered, and two existing blocks (`feature_cards`, `statistics`) were extended with the fields the design needs (per-card tint, statistics style + per-item link). This follows the "only add block types when existing blocks cannot represent the design" rule.

Everything else — add/delete/reorder sections, edit all text/buttons/links, upload/change/remove images/videos, hide/show blocks, section spacing, draft/preview/publish/versions/restore — is the **existing** CMS machinery, unchanged.

---

## 3. Files changed

| File | Change |
|---|---|
| `app/cms/registry.ts` | Added 8 icon ids (`brain`, `scale`, `lightbulb`, `landmark`, `pencil`, `puzzle`, `compass`, `scroll`); added `badgePosOpts`; registered `hero_showcase`; added `feature_cards` per-item `tint`; added `statistics` `style` (`cards`/`bar`) + per-item `href`; added matching `CMS_LABELS` keys (ar/en). |
| `app/cms/icons.tsx` | Added inline SVG glyphs for the 8 new icon ids; added an `invert` (white) icon color role for the dark trust bar. |
| `app/components/cms/blocks.tsx` | Added `hero_showcase` renderer (split hero + optional video CTA + floating feature badges); enhanced `feature_cards` (tinted icon chips) and `statistics` (gradient `bar` style + per-item links); added a `main` prop to `PageView`. |
| `app/routes/public/home.tsx` | Pass `main={false}` to `PageView` (the public layout already supplies the page `<main>` landmark). |
| `scripts/seed.mjs` | Seed the `home` page (4 sections), 3 minimal CMS subpages (`resources`, `faq`, `contact`), and the header navigation (6 items) — idempotent, keyed by fixed slugs/menu location. |
| `tests/unit/cms-registry.test.ts` | 3 new tests: `hero_showcase` schema (refs/links/icon validation), `statistics` style+href, `feature_cards` tint enum. |
| `tests/integration/cms.test.ts` | 2 new tests: compose+publish the homepage via the CMS service and assert `renderSnapshot` output; empty-first hero (no image/video) still renders. |

---

## 4. Homepage composition (all CMS-editable)

Four sections, published as the `home` page snapshot:

1. **Hero (`hero_showcase`)** — eyebrow `"الفلسفة وعلم النفس"`, headline `"أهلاً بيكم في منصتكم!"`, rich-text subtitle, two CTAs (`استكشف الكورسات` → `/courses`, `إنشاء حساب` → `/register`), an **empty** real-video field (`videoLabel`/`videoId` — the owner wires a real video from the existing video system; nothing fake is seeded), an **empty** hero image (no placeholder substitution — see §7), and three floating feature badges (courses/psychology/question-banks) with icons + positions.
2. **Trust bar (`statistics`, `style: "bar"`)** — a purple gradient band. It shows **platform offerings, not fabricated numbers** (value = offering, label = neutral descriptor, icon, optional link). No years/student-counts/ratings are invented; the owner replaces values with verified statistics later.
3. **"ماذا ستجد في المنصة؟" (`feature_cards`)** — section heading + subtitle + six tinted cards (Philosophy courses, Psychology courses, Notes & summaries, Question banks, Online tests, Comprehensive reviews). The two course cards link to `/courses`; the rest have no link (honest — no dead links).
4. **Closing CTA (`buttons`)** — heading `"ابدأ رحلتك اليوم"` + `استكشف الكورسات` / `إنشاء حساب` buttons, centered, stacked on mobile.

Header navigation (via the existing **menu builder**, location `header`): الرئيسية `/`, الكورسات `/courses`, الاختبارات `/exams`, مكتبة المصادر `/p/resources`, الأسئلة الشائعة `/p/faq`, تواصل معنا `/p/contact`. The three subpages are minimal published CMS pages (single section + lead text) so every link resolves; their copy is an explicit placeholder the owner replaces.

---

## 5. Content integrity (no invented claims)

- **Platform/owner identity** — only the verified facts from the seed are used: owner `د/ مصطفى تيتو` / `Dr mostafa tito`, phone `01153719506`, Facebook `https://www.facebook.com/mr.mostafa.tito.philosophy/`. The hero does **not** assert a title, bio, specialty, years of experience, student counts, testimonials, ratings, or photos.
- **No physics content** — the correction to philosophy & psychology is respected end-to-end: no physics terms, subject names, icons, categories, or `"منصة الفيزياء"` branding. Icons are generic/academic (book, brain, list, check-circle, sparkles, file-text) and remain CMS-configurable.
- **Statistics** — the trust bar carries offerings (structural, allowed examples: كورسات الفلسفة، كورسات علم النفس، بنوك أسئلة، اختبارات إلكترونية), never fabricated counts.
- **Images/videos** — hero image and intro video are **empty** (empty-first: missing optional data renders nothing). No owner photo, no fake demo video, no generated asset is inserted. R2/media authorization rules are unchanged.

---

## 6. Visual language

- Semantic design tokens only — `bg-brand-*`, `text-brand-*`, `bg-accent-*`, `text-slate-*`, `rounded-[var(--radius-card)]`, `shadow-sm/md`, `--density` spacing. **No inline styles, no hardcoded hex, no arbitrary values that bypass CSP/theming.**
- The premium **purple/indigo** language is achieved through the existing **Admin → Appearance → Theme** tokens, not hardcoded. Default tokens render teal/amber; to match the reference set `primary` to an indigo (e.g. `#6366f1`), `secondary` to a deeper indigo (e.g. `#4f46e5`), and `accent` to a purple (e.g. `#8b5cf6`). The homepage picks up the change automatically because it uses semantic classes.
- Subtle gradients (`bg-gradient-to-*`), rounded cards, soft shadows, large typography (`text-3xl→5xl` hero, `text-2xl→3xl` headings), generous whitespace, hierarchy, and a responsive split that collapses to a single column on mobile.

---

## 7. Accessibility, RTL, performance

- **Landmarks (fixed)** — seeding the `home` page exposed a pre-existing nested-`<main>` issue: `PageView` rendered `<main>` inside the public layout's `<main>`. Fixed by giving `PageView` a `main` prop (`main={false}` on the home route). axe now reports zero non-`target-size` violations on the homepage.
- **Headings/landmarks/controls** — semantic `h1` (hero) + section `h2`, one `main`, `aria-hidden` decorative gradients, real `<button>`/`<a>` with accessible names, `dir="auto"` on stat values, `rtl:rotate-180` on directional arrows (existing pattern).
- **RTL/mobile** — logical utilities (`ms-`/`me-`, `start`/`end`), no horizontal scroll (hero bleeds via `-mx-4 px-4` on mobile, becomes a rounded card ≥ `sm`), columns collapse (`grid-cols-1 → sm:2 → lg:3/4`), CTAs full-width on mobile (`max-sm:w-full`), floating badges flow as an inline/grid row below `lg` so they never overlap. Touch targets `min-h-11`.
- **Performance** — server-rendered (no client JS for static content); the hero video is a lazy, on-demand player (no autoplay, no N+1); images are `loading="lazy" decoding="async"` below the fold; no heavy UI library.

---

## 8. Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ pass |
| `npm run test:unit` | ✅ 128 passed (14 files) |
| `npm run test:integration` | ✅ 201 passed (11 files) |
| `npm run test:e2e` (full Playwright) | ✅ 52 passed (accessibility axe, RTL/mobile, catalog, security, CSP, exam, lesson-video, commerce, auth, admin, announcements) |
| `npm run verify` (lint:imports + typecheck + test + build) | ✅ pass |
| `git diff --check` | ✅ clean |
| Manual render (dev server `curl`) | ✅ `home`, `/courses`, `/p/resources`, `/p/faq`, `/p/contact` → 200; nav links resolve; `/exams` → 302 to login |

The only axe findings are `target-size` (WCAG 2.5.8), which the audit measures but deliberately does not assert — the sandbox's self-contained Chromium (92) drops Tailwind v4 `oklch`/`@layer`/`color-mix` output, so all controls measure unstyled (~19–21px) regardless of their real `min-h-*`/`py-*` size. In a modern browser these resolve to 32–44px. No visual/pixel measurement or Lighthouse was possible in this environment (documented limitation).

---

## 9. Owner next steps (no code needed)

1. **Theme** — set Appearance → Theme primary/secondary to indigo and accent to purple to match the reference palette.
2. **Hero image** — upload the real hero/owner image in the page builder (the `hero_showcase` → image field); it will render in the split column with the floating badges.
3. **Intro video** — pick a real video in `hero_showcase` → video; the "watch" CTA reveals the real, entitlement-aware player.
4. **Statistics** — replace the trust-bar offerings with verified numbers (value/label/icon/link), or keep the offerings bar.
5. **Subpages** — replace the placeholder copy on `resources` / `faq` / `contact`.
