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

## 6. Not done, on purpose

No image generation, no stock/AI asset, no new image file, no production deploy,
no production data change, no migration, no admin redesign, no payment gateway,
no homepage rewrite.

```
NO TEACHER PHOTO REPLACEMENT
NO IMAGE GENERATION
NO FAKE CONTENT
NO COURSE TERMINOLOGY IN STUDENT UI
NO PAYMENT GATEWAY
NO PRODUCTION DEPLOY
NO PRODUCTION DATA CHANGES
```
