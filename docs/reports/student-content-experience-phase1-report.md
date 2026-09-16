# Student Content Experience — Phase 1 (Student Content Listing)

**Branch:** `arena/01a0aa42-tito` · **Base:** `12153777bd469486d7ea2c225fec68e3255edca5` (`main`)
**Prior phase:** `docs/reports/content-platform-restructure-report.md` (Year → Grade → Subject → Term → Lesson backend)
**Verification:** lint ✓ · typecheck ✓ · unit 38 files / 454 tests ✓ · integration 30 files / 336 tests ✓ · E2E 91 tests ✓ · `npm run build` ✓

---

## 1. Executive summary

The academic spine from the previous phase (السنة الدراسية → الصف → المادة → الترم → الدرس → محتوى الدرس)
already existed on the server. This phase delivered the **student-facing experience of that spine**: a real
content hub, a real subject page grouped by term, and a **lesson list item** that shows — from real rows only —
the lesson's number, title, available content types, Free/Paid state and the single correct action.

Three things are true end-to-end after this phase:

1. **Every paid lesson is visible.** Nothing is hidden behind a paywall wall: a locked lesson is rendered with
   «للمشتركين», its real materials and its purchase/activation path.
2. **Nothing is invented.** No lesson, price, count, badge or academic year is hardcoded — the pages render the
   owner's rows. A term with no published lesson says so; a lesson with no uploaded material says so.
3. **Authorization is still server-side.** The list is presentation only; opening a lesson still goes through
   `/learn/:courseSlug/:lessonSlug` → `resolveAccess` verdict.

---

## 2. What changed (files)

| File | Change |
|---|---|
| `server/content/service.server.ts` | `studyHub` now returns per-subject academic years (`years[]`) from live term containers; lesson stats are one grouped query; `subjectStudyView` lessons carry `contentKinds[]`; new `lessonContentSummaries` / `LESSON_CONTENT_KINDS` / `contentKindForFileKind` |
| `app/lib/study-view.ts` **(new)** | Pure view-model: content-kind mirror + ordering, lesson state → badge/CTA/tone, term grouping, unit headings, lesson numbering, term state summary, grade grouping, Arabic plural counts, term completion. No `~server/*` import (lint-enforced) |
| `app/components/study/LessonCard.tsx` **(new)** | The lesson list item (number spine, state chip, material chips, CTA pair, stretched title link, `data-lesson-state`) |
| `app/components/study/ContentTypeChips.tsx` **(new)** | Material chips + the honest "no material yet" note |
| `app/components/study/SubjectCard.tsx` **(new)** | Subject card: grade/programme chips, term/lesson/free counts, academic years, decorative rings, reserved portrait slot |
| `app/components/study/StudyRule.tsx` **(new)** | Gold hairline + solid diamond heading ornament (the app-wide ornament reads as an "×" at this scale) |
| `app/routes/public.study.tsx` | Rewritten hub: السنة الدراسية/الصف grouping, subject cards, empty state |
| `app/routes/public.study.$subjectSlug.tsx` | Rewritten subject page: term navigation, per-term progress/unlock blocks, lesson list |
| `app/routes/public/layout.tsx` | «المحتوى التعليمي» nav link is now rendered for **every** visitor (it was signed-in only, so anonymous students could not reach the content at all) |
| `scripts/seed.mjs` | Demo header item `/courses` ("الكورسات") → `/study` ("المحتوى التعليمي"); demo resources copy "كورسات" → "الدروس" |
| `server/seo/inventory.server.ts` | `/study` + `/study/:subjectSlug` (anti-thin: subject needs a published lesson) |
| `app/locales/ar.ts`, `app/locales/en.ts` | `study` namespace expanded (CTAs, material kinds, plural counts) |

Routes/ids preserved: `/study`, `/study/:subjectSlug`, `study-subjects`, `study-subject-<slug>`, `study-term-<slug>`,
`study-lessons-<slug>`, `study-lesson-<slug>`, `study-subscribe-<slug>`, `study-activate-<slug>`; added
`study-grade-<key>`, `study-term-nav`, `study-term-progress-<slug>`, `study-term-unlock-<slug>`, `study-no-terms`,
`study-no-lessons-<slug>`, `study-no-offer-<slug>`, `study-empty`, `study-subject-context`.

---

## 3. The lesson list item (the core of the phase)

Every lesson row is: **number** (`01`, `02`, …) · **title** · **material chips built from its own
`lesson_items`** · **state chip** · **one primary action**.

| Situation | State chip | Action |
|---|---|---|
| Free for everyone | مجانًا | ابدأ الدرس |
| Free for registered students, visitor anonymous | مجانًا | سجّل الدخول (→ `/login?next=…`) |
| Paid, no grant | للمشتركين | اشترك الآن **if a real published offer exists** — otherwise إدخال كود التفعيل |
| Paid, student entitled | (none) | ابدأ / تابع / راجع الدرس (by progress) |
| Scheduled | متاح قريبًا | **no CTA** (there is nothing honest to link to) |
| Not published / expired | غير متاح حاليًا | **no CTA** |

- The list is grouped by term, and by unit **only when the term really has units** — otherwise a single «الدروس».
- Materials are shown as chips (فيديو / PDF / ملف / تدريبات); a lesson with nothing uploaded renders
  «لم يتم رفع محتوى لهذا الدرس بعد» instead of an empty chip row, and legacy `exam` items are never advertised.
- Video is **not** the axis: a lesson with only a PDF is a first-class lesson row.
- The secondary action appears only when it can succeed (a locked lesson that also has no offer shows one path,
  not two identical buttons).

---

## 4. Academic year & terminology

- The academic year (e.g. `2026/2027`) is an **admin-created row** (`create-academic-year`, owner-typed start/end
  years, single "current" flag). It is displayed from live term containers only — the UI contains no year literal.
- Student vocabulary: المادة، الصف، المرحلة، السنة الدراسية، الترم، الوحدة، الدرس، المحتوى، الفيديو، الكتاب،
  المذكرة، الملفات، التدريبات، الاشتراك، كود التفعيل. The string «كورس» appears **nowhere** in `/study` or
  `/study/:subjectSlug` (asserted in E2E).
- Remaining «كورس» occurrences in the repo are the legacy `/courses` catalogue, the CMS home preset and starter
  templates — outside this phase's surface and deliberately untouched.

---

## 5. Drafts, SEO & the public surface

- The hub is driven by **published** term containers whose subject/grade/programme are published and not deleted;
  the subject view excludes draft lessons and unpublished containers. Draft content therefore cannot reach a
  student page, the sitemap, or SEO metadata.
- `indexablePublicUrls` gained `/study` (only when at least one real subject exists) and `/study/:subjectSlug`
  (only when the subject has at least one published lesson) — the same anti-thin rule the catalogue already used.
  Lessons remain excluded (`/learn/*` is private + `noindex`).

---

## 6. Mobile, RTL, accessibility

Verified with a real browser at 320/360/390/414/768/1024/1280/1440 (Arabic RTL): `scrollWidth - clientWidth = 0`
at every width — no horizontal overflow anywhere on the content surface. Rows stack on mobile with a stretched
title link, actions are ≥44px, the breadcrumb/term navigation are real `<nav>` landmarks, headings are ordered
(`h1 → h2 → h3`), decorative art is `aria-hidden`, and every state is communicated by text as well as by colour.

---

## 7. Real-content policy

Nothing was inserted into the database by this phase: no lessons, videos, prices or students. The pages render the
owner's rows, and every count is a real `COUNT`. The 48 lessons of the brief were **not** created — they are the
owner's content to add through Admin → Content, which is unchanged and fully capable of it.

---

## 8. Testing & verification

- **Unit** `tests/unit/study-view.test.ts` (18): content-kind ordering mirrored against the server list, state
  resolution for every combination (free/locked/entitled/anon/scheduled/expired), CTA selection, term grouping and
  unit headings, lesson numbering, Arabic plural counts, term completion.
- **Integration** `tests/integration/study-content.test.ts` (14): hub counts + draft exclusion, term grouping, real
  materials from `lesson_items` (empty lesson claims nothing, legacy `exam` hidden), file-kind mapping, anon vs
  signed-in verdicts, term-scoped activation code opening exactly its term, a real 25000 EGP offer.
  `tests/integration/seo-crawl.test.ts` (+1): `/study` URLs appear only while real published lessons exist and
  disappear when the lesson or the container goes back to draft.
- **E2E** `tests/e2e/study-content.spec.ts` (3): the owner builds السنة الدراسية → الترم → المادة → container →
  three lessons **through the admin UI**, then the anonymous visitor and the registered student see the correct
  states, and the lesson page opens for a registered student.
- Full runs: unit 454, integration 336, E2E 91 — all green; `npm run build` ✓.

One pre-existing E2E assertion was corrected (`tests/e2e/commerce.spec.ts`): it still expected the generic
"requires an access grant" sentence on the lesson page, which the previous phase had replaced with the subscriber
card («هذا المحتوى متاح للمشتركين فقط»). The assertion now matches the copy students actually see.

---

## 9. Deliberately not done

- No lesson-page redesign, no homepage redesign, no admin redesign, no new admin screens.
- No schema/migration changes, no payment-rail changes, no internal exam engine.
- No images generated (visual system analysed only — see below).

---

# VISUAL PLAN — NO IMAGE GENERATION

No asset was generated. Everything below is a **placement specification** for a later, separately ordered phase.

**Global rules**

- The visual system is **navy/white with gold as an accent only**; the thinkers are line-art/engraving-style
  portraits (single ink colour, no frames, no drop shadows, no photographs of real people other than
  د/ مصطفى تيتو himself).
- Layering: every portrait sits **under** the text layer, inside a container with `overflow-hidden`, positioned on
  the **end-side** of the card (the left in RTL) so it never crosses Arabic text. Text containers stay on an
  opaque or near-opaque surface.
- Crop: always **partially cropped** — head/shoulder cropped by the card edge (top or side), never a full centred
  bust. Watermark feel: opacity 0.06–0.12 for portraits behind text, 0.16–0.24 for portraits inside an otherwise
  empty decorative band; multiply-style blending, no colour tint beyond the navy/gold ramp.
- Non-predictability: the mapping subject → thinker is data-driven (an image slot per subject/card), not a rule
  like "the first card always gets سقراط"; on a grid of cards the eye must not find a pattern.
- Sizes: hub subject card ~120–160px wide, cropped to ~40% of the card height; subject-page header ~200–260px,
  cropped to one corner; term/unit headings none (text-only). Mobile (≤640px) reduces opacity by ~⅓ and never
  overlaps the CTA row.
- Accessibility: purely decorative → `alt=""` + `aria-hidden`, `loading="lazy"`, `pointer-events-none`, and never
  the only carrier of meaning. Content clarity outranks decoration everywhere.

**Where the real photo of د/ مصطفى تيتو goes**

- Location: the **homepage "عن المنصة"/owner block** (the existing identity area driven by Admin → Appearance →
  Identity) and the **/about page**. Real photo only — no AI replacement, no stylisation. Cropped 4:5 or 1:1 with
  a navy-100 ring and the gold hairline; it is the one human photograph on the site and should stay that way.
- The study hub/subject pages intentionally keep **no** owner photo: they are study surfaces, and the decorative
  layer there is reserved for the thinker portraits.

**Per-area slots (to be filled when images are ordered)**

| Area | Character type | Suggested size / crop | Opacity | Layering |
|---|---|---|---|---|
| Hub header (المحتوى التعليمي) | 1 rotating classical mark (e.g. سقراط أو أرسطو) or the existing rings watermark | 180px, cropped by the end edge | 0.08 | behind heading, none over text |
| Subject card — فلسفة ومنطق | Aristotle-style bust (Greek) | 140px, cropped by card end + bottom | 0.10 | behind chips, above card tint |
| Subject card — علم النفس | Freud-style bust (Viennese) | 140px, cropped by card end + bottom | 0.10 | same |
| Subject page header | the subject's philosopher, larger | 220px, one-corner crop | 0.12 | behind the title block |
| Term band / unit heading | none (typography only) | — | — | — |
| Lesson rows | none — legibility first | — | — | — |
| Locked-term panel (gold-tinted) | 1 small classical motif (kolon/scroll) | 80px | 0.14 | behind the CTA row, never under the price |
| Homepage "فلسفة" entry card | Aristotle (already cited in the brief as the example) | 160px, cropped | 0.10 | behind heading |
| Homepage "علم النفس" entry card | Freud | 160px, cropped | 0.10 | same |
| /about or bio band | Marx / ابن رشد / ابن سينا near the biography text (a rotating set) | 200px | 0.08 | behind text column, end-side crop |

Candidate set (all line-art, no photographs): سقراط، أفلاطون، أرسطو، ديكارت، كانط، نيتشه، ابن رشد، ابن سينا، ماركس،
فرويد — a many-thinker system rather than a single mascot, so the platform reads as a philosophy & psychology
platform rather than a single-subject site.
