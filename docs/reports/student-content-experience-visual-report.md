# المحتوى التعليمي — Visual phase report (white-first modern RTL)

Base commit: `d133f1b8ffe4e453fd7eebe825b7ee0fea40e523` (phase 1 delivery).

## 1. What this phase changed

The student content surface was re-skinned to the white-first modern RTL design
described in the brief, without touching the content architecture, the teacher
photo chain, authentication, commerce, entitlements, the external exam platform
or the admin area.

* **Hub** (`/study`): white hero card (soft blue glow, faint dotted lattice, one
  reserved philosopher slot), real count chips, the real academic year as a chip,
  the teacher identity panel bound to `settings.identity` (photo or monogram),
  two CTAs (`استعرض المواد` anchor + `إدخال كود التفعيل`), grade-grouped subject
  cards, an honest "available content types" section, a three-step explanation of
  the academic path, and a soft-blue knowledge band carrying the Marx slot.
* **Subject page** (`/study/:subjectSlug`): white header card with the subject
  icon, real chips (program · grade · years), real counts (terms · lessons ·
  free), a soft-blue term switcher, term bands, unit headings, and lesson cards
  whose number spine is soft blue (gold tint only when completed).
* **Navigation**: `المحتوى التعليمي` in the public header became a soft-blue pill
  with a book icon (same link, same test id, same destination).
* `StudyRule` (the old dark rule strip) was removed; nothing referenced it.

## 2. Honesty rules kept

* Every number comes from published rows: `studyHub()` for the subject cards and
  hero counts, `studyMaterialKinds()` (new, published-only chain) for the
  content-type section, `listAcademicYears(publishedOnly)` for the year chip.
* A section disappears when its data does not exist (materials, steps stay
  structural; the year chip and the offer UI are conditional on real rows).
* The academic year is never hardcoded: it is the owner's `academic_years` row,
  and it is not rendered when no year is published.
* Locked lessons keep the phase-1 state machine: free → `ابدأ الدرس`,
  guest → `سجّل الدخول للبدء`, locked with a real offer → `الاشتراك الآن` +
  price, locked without an offer → `إدخال كود التفعيل` + the honest
  "لم يتم فتح الاشتراك لهذا النطاق بعد" note, entitled → `ابدأ`/`تابع`/`راجع`.
* No `كورس` / `Course` wording anywhere in the student surface
  (`grep -c` on the rendered HTML of both study routes = 0).

## 3. Philosopher slots (no imagery generated)

`app/components/study/PhilosopherSlot.tsx` reserves the geometry for the future
line-art: Aristotle on فلسفة ومنطق, Freud on علم النفس, Marx in the knowledge
band, Socrates in the hub hero, with a stable hash fallback for any other subject.
Every slot is `aria-hidden`, `pointer-events-none`, marked
`data-visual-slot` / `data-visual-slot-state="empty"` and rendered as a soft tint
plus ring decoration. No bitmap ships, and `src` is the single future drop-in
point.

## 4. Teacher photo

Untouched. `identity.ownerPhotoFileId` → `resolvePublicImageUrls` is read
read-only by the hub and rendered by `TeacherPanel` with the same
`object-cover` crop the CMS `teacher_profile` block and `/about` already use.
When the owner has not uploaded a photo the panel shows a typographic monogram of
the real configured name — never a substitute portrait.

## 5. Verification

| Gate | Result |
| --- | --- |
| `npm run lint` (module boundaries) | ✓ clean |
| `npm run typecheck` | ✓ |
| `npm run test:unit` | ✓ 38 files / 454 tests |
| `npm run test:integration` | ✓ 30 files / 336 tests |
| `npx playwright test` | ✓ 91 passed (4.3 m) |
| `npm run build` | ✓ |

Responsive QA at 320 / 360 / 375 / 390 / 414 / 768 / 1024 / 1280 / 1440 (ar + en):
`scrollWidth − clientWidth = 0`, no element crossing the viewport, every section
present, no broken image, no console error, no 5xx. Accessibility: decorative
slots hidden from assistive tech, one focusable element per subject card
(stretched title link), `min-h-11` touch targets on all real controls, visible
focus rings kept, correct `dir="rtl"` and `lang="ar"`.


## 7. Art phase — engraved line-art distributed across the platform

After explicit owner approval the platform now ships its own engraved ink
line-art (the earlier "slots only" phase is superseded).

**Pipeline** (`qa-out/art-src/process.sh`, local tool):
generated as antique book-plate etchings (black ink on white) → converted to
monochrome navy-900 ink with real alpha → trimmed → resized → WebP (72, alpha 55).
The whole set is **740 KB** for 10 files, every one `loading="lazy"` +
`decoding="async"` with intrinsic width/height, so nothing blocks or shifts.
Because the ink carries alpha, the same file tints correctly on white cards, on
the soft-blue sections, and (inverted) on the navy footer.

**Registry**: `app/lib/art.ts` (single manifest, no hardcoded paths elsewhere) and
`app/components/visuals/Art.tsx` (always `aria-hidden`, `alt=""`,
`pointer-events-none`, `tone="light"` inverts for navy surfaces).

Assets: `public/art/philosopher-{socrates,plato,aristotle,descartes,kant,freud,marx}.webp`,
`emblem-{book,scroll}.webp`, `frieze-columns.webp`.

**Distribution** — never two of them side by side, always cropped into a corner
behind the copy, faded, `hidden sm:block` (phones keep the breathing room):

| Surface | Art | Weight |
| --- | --- | --- |
| Hub hero | Socrates | 0.12 |
| Subject card فلسفة ومنطق | Aristotle | 0.12 → 0.20 on hover |
| Subject card علم النفس | Freud | 0.12 → 0.20 on hover |
| Knowledge band | Marx + colonnade hairline | 0.15 / 0.06 |
| Material cards | per kind: columns / book / scroll / descartes | 0.08 → 0.14 hover |
| Steps cards | book / scroll / aristotle | 0.07 → 0.13 hover |
| Subject page header | subject-mapped thinker | 0.13 |
| Footer (navy) | colonnade + Aristotle (inverted) | 0.07 / 0.08 |
| About identity card | Plato + colonnade | 0.09 / 0.05 |
| Catalogue headers (courses, programs, programs/:slug, grades/:slug, subjects/:slug, courses/:slug, units) | book / columns / plato / socrates / aristotle / kant / scroll | ~0.09 |
| Auth pages (login, register, forgot, reset) | Kant + scroll | 0.07 |
| Student dashboard | Descartes + colonnade | 0.08 |
| Activation page | scroll + colonnade | 0.08 |
| Empty states (study, CMS pages, assignments, catalogue) | book / scroll | 0.07 |
| CMS section templates | one engraving per block type (hero, statistics, feature_cards, course/subject/program/grade/product cards, video_showcase, exam_platform, journey_steps, benefit_list, cta_banner) + inverted on dark/brand bands | 0.07–0.12 |

Unchanged by design: `teacher_profile` and every form block get **no** art, the
teacher photo keeps its own slot untouched, and `hero_showcase` was left alone
because it already renders the owner's own hero illustration.

**Verification of this phase**: typecheck ✓ · lint ✓ · unit 454 ✓ · integration
336 ✓ · Playwright 91 ✓ · zero horizontal overflow at 320/768/1024/1440 for
`/study` and `/` · zero console errors (the platform CSP is `style-src 'self'`, so
the art uses Tailwind opacity utilities only — no inline style anywhere).

## 8. Not done, on purpose

No stock/AI substitute for the teacher photo, no production deploy,
no production data change, no migration, no admin redesign, no payment gateway,
no homepage rewrite.

```
NO TEACHER PHOTO REPLACEMENT
NO FAKE CONTENT
NO COURSE TERMINOLOGY IN STUDENT UI
NO PAYMENT GATEWAY
NO PRODUCTION DEPLOY
NO PRODUCTION DATA CHANGES
```
