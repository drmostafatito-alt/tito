# Platform-Owner Controllability Audit

**Scope:** could the platform owner run this site from the Admin dashboard, without a
developer editing code? This is a different question from "do the features work" — a value
can be CMS-backed and still be uneditable if no Admin surface writes it.

**Method:** real-browser inventory of every public + authenticated surface (Arabic RTL and
English LTR, desktop and mobile, following rendered links rather than a route list), then a
control-by-control trace from each user-visible element to its source of truth, to the Admin
surface that writes it, to the public page that renders it.

**Result:** 2 genuine gaps found and fixed. Both are now covered by regression tests,
including real-browser Admin → public loops.

---

## Verification run

| Check | Command | Result |
|---|---|---|
| Module boundaries, unit, integration, both builds | `npm run verify` | exit 0 — boundaries clean, **167/167** unit, **306/306** integration, builds ok |
| Real-browser suite | `npm run test:e2e` | **67 passed, 0 failed** (was 64 before this audit) |

Baseline before this audit: 155 unit / 295 integration / 61 E2E.

---

## Controllability table

"Verified" means the loop was actually closed in this audit — value changed through the real
Admin UI (or its real mutation path) and observed on the public page. "Inherited" means the
control is present and exercised by pre-existing tests, and the surface was re-confirmed
rendering correctly in the inventory, but the loop was not re-driven here.

| User-facing area | Owner-editable? | Admin location | Verified frontend reflection | Action |
|---|---|---|---|---|
| Homepage hero (title, subtitle, CTA, media) | Yes | `/admin/cms` → `home` → blocks | Inherited (`homepage-content.spec.ts`) + inventory | none |
| Homepage sections, order, visibility | Yes | `/admin/cms` → sections (drag/reorder, publish) | Inherited + inventory | none |
| Homepage feature/trust/stat cards | Yes | `/admin/cms` → `feature_cards`, `icon_feature`, `icon_grid`, `pricing_cards` | Inherited + inventory | none |
| Homepage dynamic cards (courses/subjects/programs/free/featured/latest) | Yes | `/admin/cms` → dynamic blocks + underlying catalog | Inherited + inventory | none |
| Header nav / footer nav / student nav / legal nav | Yes | `/admin/cms/menus` (4 menus) | Inventory: rendered links match menu builder | none |
| Branding (name, tagline, logo, favicon, social links, contact) | Yes | `/admin/appearance` → Identity | Inventory: footer social + `tel:` from identity | none |
| Theme (colours, radii, shadow, density, fonts) | Yes | `/admin/appearance` → Theme → `/theme.css` | Inherited | none |
| Presentation + dashboard modules | Yes | `/admin/appearance` → Presentation / Dashboard | Inherited | none |
| Announcements | Yes | `/admin/announcements` | Inherited (`announcements.spec.ts`) | none |
| Catalog presentation (courses/subjects/programs/products) | Yes | `/admin/content` | Inherited | none |
| Units, lessons, exams, assignments | Yes | `/admin/content`, teacher authoring | Inherited (`teacher-authoring.spec.ts`) | none |
| Video / media references | Yes | `/admin/videos`, `/admin/files` | Inherited (`lesson-video.spec.ts`) | none |
| Forms (contact etc.) | Yes | `/admin/cms/forms` (11 field types) | Inherited | none |
| **SEO title / description / OG image / robots / canonical on content routes** | **Was: no** | `/admin/cms` SEO tab + `/admin/content` | **Verified** (`seo-meta.spec.ts`, 3 tests) | **Gap 1 — fixed** |
| **Platform default language + which languages are offered** | **Was: no** | `/admin/appearance?tab=system` → Language | **Verified** (`locale-settings.spec.ts`, 3 tests) | **Gap 2 — fixed** |
| Device limits, session/rate-limit policy, assessment defaults | Deliberately no | — (system-controlled) | n/a | none — see §C |
| Video provider + payment rail secrets | Partially | `/admin/appearance?tab=system` (rank ≥ 4) | n/a without real credentials | see §D |

---

## A. Already correctly configurable

Confirmed present, Admin-writable, and reflected on the frontend — no change made:

- **CMS pages/sections/blocks/versions/SEO** at `/admin/cms`, with `/admin/cms/preview/:pageId`
  and `/admin/cms/templates`. 38 block types; adding one is a registry entry + a renderer, no
  migration and no route change. Publish freezes a snapshot, so draft/published is real.
- **Menus** (`/admin/cms/menus`): header, footer, student, legal — the inventory confirmed the
  rendered header/footer links come from these, not from hardcoded markup.
- **Identity** (25 fields) including up to 20 social links with per-link
  `showHeader/showFooter/showHome/showContact`, `sortOrder`, and Arabic + English labels
  independently.
- **Theme** (19 fields) emitted as CSS variables by `/theme.css`; **presentation** (3) and
  **dashboard** (3) module toggles/order.
- **Announcements**, **catalog**, **units/lessons**, **exams/assignments**, **videos**,
  **files**, **forms**.
- Every CMS and settings mutation writes `audit_logs`, and the 9 `cms.*` permissions gate the
  surfaces (verified by `security.spec.ts`: a student cannot reach the audit viewer, the
  commerce hub, or the security center).

Settings groups with an Admin write path: **8 of 11** — `platform`, `identity`, `theme`,
`presentation`, `dashboard`, `locale` (added here), `video`, `payments`.
(Evidence: the complete set of `updateSettingsGroup` call sites is
`app/routes/admin.appearance.tsx` and `app/routes/admin/home.tsx`.)

---

## B. Missing controls implemented

### Gap 1 — SEO and social preview existed only on `/` and `/p/:slug`

**What was wrong.** Every other public and student route rendered a bare
`<title>د/ مصطفى تيتو</title>` with no description, no Open Graph, no Twitter card, and no
canonical. Worse, **every page emitted two `<title>` elements**, because the root `Layout`
hardcoded one *and* rendered `<Meta/>`.

A second, subtler defect: the CMS SEO tab's canonical field had been **inert since it was
built**. React Router 7's `<Meta/>` only emits a `<link>` for a descriptor carrying
`tagName: "link"`; a bare `{rel, href}` silently renders as `<meta rel="canonical" …>`, which
no crawler honours. Confirmed before the fix:

```
$ curl -s localhost:5173/courses | grep -o '<[^>]*canonical[^>]*>'
<meta rel="canonical" href="http://127.0.0.1:5173/courses"/>
```

**What was done.** Added `rootMetaFrom` / `metaDescriptionText` / `contentSeoMeta` to
`app/cms/seo.ts` and gave six content routes a `meta()` that reads the owner-editable SEO row
(or the catalog row) rather than a new config surface. Removed the duplicate root `<title>`.
`seoMeta` now emits `{ tagName: "link", rel: "canonical", href }`.

No new source of truth was introduced: the owner edits the same SEO fields they always could —
they now reach every page.

**Verified** (live, Arabic):

| Route | `<title>` count | canonical | og:title | robots |
|---|---|---|---|---|
| `/` | 1 | `…/` | الرئيسية | index,follow |
| `/courses` | 1 | `…/courses` | الدورات التدريبية | index,follow |
| `/courses/physics-3s-full` | 1 | `…/courses/physics-3s-full` | مراجعة شاملة — فيزياء… | index,follow |
| `/programs` | 1 | `…/programs` | البرامج — د/ مصطفى… | index,follow |
| `/subjects/physics-3s` | 1 | `…/subjects/physics-3s` | الفيزياء — د/ مصطفى… | index,follow |
| `/products/physics-3s-full-access` | 1 | `…/products/…` | فيزياء ٣ث — وصول كامل… | index,follow |
| `/p/contact` | 1 | `…/p/contact` | تواصل معنا | index,follow |

`og:image` upgrades the Twitter card to `summary_large_image` when the row has a public
thumbnail. Catalog indexes intentionally carry no OG image. `/courses/study-skills` has no
description because the seeded row has none — empty-first by design, owner-fillable.

### Gap 2 — the `locale` settings group had no Admin UI

**What was wrong.** The platform's default language and the set of languages offered lived in
a settings row that nothing in the Admin dashboard could write. Changing what language
visitors are served required a deployment. `locale.enabled` was also only advisory.

**What was done.**
- `/admin/appearance?tab=system` gains a **Language** fieldset: default language + which
  languages are offered. Gated at rank ≥ 3 (`cms.manage_theme`) — deliberately *not*
  super-admin only, matching the rest of that tab.
- `localeSettingsSchema` now rejects a default that is not offered, and an empty offer list,
  so the platform cannot be configured into a state where no visitor can be served.
- The root loader exposes `localeOptions`; `LanguageSwitcher` hides itself when fewer than two
  languages are offered instead of rendering a dead control; `/set-locale` refuses a language
  the owner stopped offering (server-side, not just hidden).
- Settings validation errors now report the actual Zod issue path and message
  (`default: the default language must also be offered to visitors`) instead of a raw JSON
  dump. This improves every tab on that form, not just the new one.

**Verified** by real-browser loop (`tests/e2e/locale-settings.spec.ts`):
change the default in the Admin UI → a brand-new visitor is served it, in the right
direction, and it survives a reload; un-offer a language → the public switcher disappears;
offer it again → it returns; submit an inconsistent combination → refused with a reason and
nothing persisted.

---

## C. Intentionally system-controlled (no Admin UI, by design)

Three settings groups have no write path in the Admin dashboard. This is deliberate: each is a
security or integrity control where an owner mistake in a text field would be
self-locking or unsafe, and each already has a schema-validated default.

| Group | Fields | Why not owner-editable |
|---|---|---|
| `devices` | `maxPerStudent`, `onLimit`, `changeLimitPer30d` | Anti-account-sharing policy. Raising it from the UI defeats the control; the E2E suite depends on the 1-device limit. |
| `security` | `sessionDays`, `resetTokenMinutes`, `rateLimits.{login,register,forgot}` | Session lifetime and brute-force thresholds. A mis-set value can lock everyone out or disable rate limiting entirely. |
| `assessment` | assessment default | Grading integrity; changing it retroactively would invalidate recorded attempts. |

All three remain readable and are enforced server-side
(`server/auth/service.server.ts`, `server/assessment/service.server.ts`,
`server/users/emailchange.server.ts`). If the owner later needs one exposed, the pattern is now
established by the `locale` work: a fieldset on the System tab, a schema constraint, and an
enforcement point — not a raw number box.

---

## D. Owner-only production configuration (needs real credentials)

These have Admin surfaces but cannot be end-to-end verified here, because doing so requires
live third-party credentials that must not be fabricated:

- **Video provider** — `/admin/appearance?tab=system` (rank ≥ 4) selects `mock` or `mux` and
  sets playback/file TTLs. Verifying `mux` requires real `MUX_TOKEN_ID` /
  `MUX_TOKEN_SECRET` / signing key. The `mock` path is fully tested
  (`lesson-video.spec.ts`, `api.mock-stream`).
- **Payment rails** — same tab configures manual-transfer instructions and order/refund
  windows; provider webhooks live at `/webhooks/payments/:provider`. Live verification needs
  real gateway credentials. See `docs/PAYMENTS.md`.

Everything reachable without those credentials is verified.

---

## Notes for whoever extends this

- **`browser.newContext()` inherits `storageState` inside a `test.use({ storageState })`
  block.** A "fresh visitor" created that way carries the admin session *and* its pinned
  `edu_locale=en` cookie, so platform-default behaviour is never exercised. Pass
  `{ storageState: { cookies: [], origins: [] } }` explicitly. This cost real debugging time
  here: the symptom was a public page rendering English while the database said Arabic.
- **`resolveLocale` deliberately ignores `Accept-Language`** (cookie → user preference →
  platform default), so a fresh visitor always gets the owner's choice regardless of browser
  language. See `server/settings/locale.server.ts`.
- **`getSettings` silently falls back to schema defaults when a stored row fails to parse.**
  A new schema constraint can therefore make a stored row invisible rather than loud. Keep
  write-side validation and read-side parsing in mind together.
- Scratch browser/trace artefacts must stay out of `qa-out/` as `.ts` — `tsc` picks them up and
  `npm run verify` fails on them.
