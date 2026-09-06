# Phase 8 — W7 RTL + Mobile Audit Report

Date: 2026-09-06 · Branch: `arena/01a07397-tito` · Scope: RTL + mobile audit and minimal remediation (no redesign, no functionality change, no feature expansion).

---

## 1. Pages / routes audited

| Surface | Routes reviewed |
|---|---|
| Public / Auth | `/` (home), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/courses`, `/courses/:slug`, `/programs/:slug` |
| Student | `/dashboard`, `/courses`, `/courses/:slug`, `/learn/:course/:lesson`, `/exams`, `/exams/:slug`, `/exams/:slug/attempt`, `/results`, `/results/:attemptId`, `/checkout/:product`, `/orders`, `/orders/:orderNumber`, `/notifications`, `/profile` |
| Admin | `/admin` (+ `layout.tsx` chrome), `/admin/users`, `/admin/users/:id`, `/admin/announcements`, `/admin/analytics`, `/admin/security`, `/admin/audit`, `/admin/commerce`, `/admin/cms`, `/admin/cms/forms|menus|pages/:id`, `/admin/appearance`, `/admin/assessment`, `/admin/assessment/exams/:id`, `/admin/assessment/questions/:id`, `/admin/content`, `/admin/content/:type/:id`, `/admin/entitlements`, `/admin/files`, `/admin/videos` |

## 2. Viewport matrix

| Viewport | Method |
|---|---|
| 320×568, 375×667, 390×844, 414×896, 768×1024, desktop (≥1280) | Static review of responsive Tailwind classes (`sm:`/`md:`/`lg:` breakpoints, logical spacing, `flex-wrap`, `overflow-x-auto`, `grid-cols-*` collapse) + DOM-level Playwright assertions |

> **Visual-measurement limitation (see §5):** the sandbox browser (self-contained Chromium 92) cannot apply Tailwind v4 CSS, so pixel-level overflow/overlap/clipping could not be measured directly. The audit therefore combines (a) exhaustive static analysis of responsive utilities and (b) DOM/attribute assertions that are independent of CSS. Every structural conclusion below is from static reasoning over the actual class strings, not from a CSS-applied render.

## 3. RTL findings

### 3.1 What is already correct (verified)

- **Document direction** — `root.tsx` sets `<html lang dir>` from `dirOf(locale)`; Arabic → `dir="rtl"`/`lang="ar"`, English → `ltr`/`en`. Confirmed by regression tests.
- **No physical directional utilities** — zero occurrences of bare `ml-*`/`mr-*`/`pl-*`/`pr-*`/`text-left`/`text-right`/`border-l`/`border-r`/`left-*`/`right-*` in `app/**`. The codebase uses logical utilities (`ms-`/`me-`/`ps-`/`pe-`, `text-start`/`text-end`) or paired `ltr:`/`rtl:` variants exclusively (e.g. dropdown menus `ltr:left-0 rtl:right-0`, floating CTA `ltr:right-5 rtl:left-5`).
- **LTR-only tokens** — emails, phones, URLs, order numbers, counts, durations, discount codes, prices all carry `dir="ltr"` (40+ instances verified across admin/student/checkout).
- **Mixed Arabic/English** — `formatDate` uses `ar-EG-u-nu-latn` (Latin digits), and `dir="ltr"` isolates LTR data within RTL pages.

### 3.2 Confirmed defects (FIXED) — literal directional arrows

Navigation arrows rendered as literal `←`/`→` glyphs do **not** flip in RTL (a "back" arrow should point right in Arabic; a "forward/next" arrow should point left). 11 instances fixed by wrapping the glyph in `<span aria-hidden="true" class="inline-block rtl:rotate-180">` (consistent with the existing pattern in `blocks.tsx` / `public.courses.tsx`), and adding `inline-flex min-h-6 items-center` where the link lacked a tap target:

| File | Link |
|---|---|
| `student/exams.$slug.attempt.tsx` (×2) | `← backToExams` (no-questions + locked states) |
| `student/dashboard.tsx` | `{securityLink} →` |
| `admin.appearance.tsx` | `← backToPages` |
| `admin.assessment.exams.$id.tsx` (×2) | `← examsTab` (new + existing exam) |
| `admin.assessment.questions.$id.tsx` | `← questionsTab` |
| `admin.cms.forms.tsx`, `admin.cms.menus.tsx`, `admin.cms.pages.$id.tsx` | `← backToPages` |
| `admin.content.$type.$id.tsx` | `← navContent` |

### 3.3 Directional icons

`arrow-right`/`arrow-left` icons are defined in `app/cms/icons.tsx` but **unused** — no icon-rotation fix needed. The `chevron-down` dropdown indicators use `group-open:rotate-180` (open/closed state, direction-neutral). The `↗` external-open glyph is direction-neutral and correctly left unflipped.

## 4. Mobile / responsive findings

### 4.1 What is already correct (verified)

- **Navigation reachable** — public, student, and admin layouts each provide a hamburger toggle (`aria-expanded`, `aria-controls`, `aria-label`) plus a full mobile nav panel containing every link and logout.
- **Exam controls** — sticky header (exit/title/countdown/save) and sticky footer (prev/next/submit) with `shrink-0`/`min-w-0 truncate`; question navigator `grid-cols-8 sm:grid-cols-10`; answer choices `min-h-11 w-full`; icon-only prev/next named via `aria-label`.
- **Forms** — login/register/checkout use `max-w-md px-4` + full-width submit; inputs/selects/textarea forced ≥16px font (`app/app.css`) to prevent iOS focus zoom.
- **Lists (no `<table>` elements exist)** — admin lists use `flex flex-wrap` rows, so they wrap instead of overflowing; pagination is prev/next links with `justify-between`.
- **Video player** — `<video class="h-auto w-full">` (intrinsic responsive).
- **No fixed large widths** — no `w-[N≥100px]`/`min-w-[N≥100px]`/`w-64|72|80|96` utilities; no non-responsive `grid-cols-N` (only `grid-cols-1` fallback values in a mapping).

### 4.2 Confirmed defect (FIXED) — admin nav overflow at tablet

The admin header renders **14** nav links in a single non-wrapping `sm:flex` row. Arithmetic: even at minimal widths (14 links × ~60px + padding/gaps ≈ 850px, plus logo + language switcher + logout), the row cannot fit at `sm` (640px) or `md` (768px), causing horizontal overflow/clipping at tablet widths. The hamburger only appeared below `sm`.

**Fix (minimal, standard):** raised the breakpoint from `sm` → `lg` for the desktop nav (`hidden lg:flex`), the hamburger (`lg:hidden`), and the mobile panel (`lg:hidden`), so tablet widths now use the hamburger menu — consistent with the pattern already used by the public/student layouts (which gate their smaller navs behind `md:`).

## 5. Issues proven to be browser/sandbox limitations

1. **Visual layout measurement (overflow / overlap / clipping / fixed-element occlusion / broken tables)** cannot be performed: the only available browser is self-contained Chromium **92.0.4512.0** (Playwright `browser.version()`), which drops Tailwind v4 output entirely — `CSS.supports("color","oklch(...)")` is `false`, and the built stylesheet uses `@layer`/`@property`/`color-mix()`/`oklch()`/`oklab()` (Chrome ≥99/≥111). The page renders unstyled (body = Times New Roman), so scrollWidth/clientWidth and geometry APIs reflect block-level unstyled layout, not the real responsive layout.
2. **Consequence:** pixel-exact confirmation of the §4.2 overflow was not possible *at runtime*; the finding and fix are based on arithmetic + the known Tailwind breakpoint behavior, not a CSS-applied screenshot. A modern-browser re-run is the correct final confirmation (sandbox blocks all browser download CDNs).

## 6. Automated test results

- New `tests/e2e/rtl-mobile.spec.ts` — **11 tests**, all passing (document direction ar/en; student+admin RTL; student+admin mobile-nav toggle ARIA; RTL-flipped arrows on exam/lesson/admin back links; LTR email tokens; Arabic exam prev/next accessible names).
- Full Playwright suite — **52 passed** (was 41; +11 W7 regressions). No regressions from the admin breakpoint change (existing admin specs continue to pass).
- `npm run verify` — **PASS**: lint:imports, typecheck, unit **122 passed / 14 files**, integration **197 passed / 11 files**, build OK.
- `git diff --check` — **PASS**.

## 7. Owner-assisted limitations

None. No fix required owner input, production data, credentials, or an environment change. (The visual-layout confirmation is a *sandbox* limitation, not an owner action.)

## 8. Remaining low-priority follow-ups (not fixed — out of minimal-change scope)

1. **Flow/range arrows** (sequence semantics, not navigation direction; flipping is debatable):
   - `admin.assessment.exams.$id.tsx` — `{unpublish} → {save}` (info sentence).
   - `admin.entitlements.tsx` — `→ {expiresAt}` ("until" marker).
   - `admin.users.$id.tsx` — `{startsAt} → {expiresAt}` (date range; already inside `dir="ltr"`, so correct).
2. **Localization gap** — `admin.content.tsx` `CardHeader description="Program → Grade → Subject → Course → Unit → Lesson"` is hardcoded English even in the Arabic UI (should be an i18n key).
3. **Admin literal-arrow back links with text only** — `admin.users.$id.tsx` "Back to users" has no arrow at all (minor inconsistency vs other admin back links); optional.
4. **W6 carry-over** — remaining admin pagination/`hover:underline` inline links below 24px (target-size); recommend a sweep in a modern browser.

## 9. Final verdict

**PASS** — RTL is structurally correct (logical utilities, correct `dir` handling, LTR-token isolation); the only real RTL defects (11 directional arrows) are fixed with regression coverage. Mobile/responsive is sound (hamburger navs, flex-wrap lists, responsive grids, sticky-but-non-overlapping exam chrome, full-width controls); the one confirmed mobile defect (admin nav tablet overflow) is fixed. All tests and `npm run verify` pass. The only unverifiable area is pixel-exact visual layout, which is a documented sandbox-browser limitation requiring a modern-browser re-run to confirm visually (no code change expected).
