# Competitive audit + owner-control implementation — evidence report

Date: 2026-09-08 · Branch `arena/01a080e8-tito` · Baseline at start: `567aa8c`

## 1. What was researched, and what evidence was actually found

**Important caveat:** the specific platforms named in the brief did **not** surface in search
results. Rather than claim capabilities for them, I documented only platforms for which I found
real evidence. Everything below comes from fetched pages, not inference.

| Platform | Evidence found |
|---|---|
| teachmaster.org (TeachMaster) | Schedules, ≤50 students, groups, exams, finances/debt, fast attendance, **WhatsApp alerts to parents**, handouts store, reports |
| student-track.net | Per-student barcode/QR attendance, payment tracking, reports, **automatic WhatsApp notifications to parents**, parent follows child via barcode link |
| eltamam.com (التمام) | Web + parent portal + teacher mobile, **roles (owner/admin/secretary/teacher)**, QR self-check-in, AI-assisted grading, paper+online exams with ranking, booking, **WhatsApp notifications**, parent portal via secure link, **public registration page** |
| center.tgo-eg.com (TGO) | Attendance + collection, **dedicated parent app (سنجاب)**, financial dashboard, monthly report |
| edsentre.com | Barcode attendance, **AI exam generation from PDF**, bable-sheet grading by camera, **gamification/points**, offline-then-sync, **white-label apps**, digital library |
| almenasa-ar.com | **WhatsApp OTP verification**, WhatsApp task/event notifications, payment reminders, **tiered WhatsApp message quotas** |
| shattor.com/ar, shater.net | WhatsApp to students+parents, **public "virtual demo center" tour**, exportable reports, EN/عربي switch, tiered plans |
| noor-plus.com | Grade/skill recording, absence management, exam committees, **instant WhatsApp notifications** |
| engazmedia.com | Selling courses/subscriptions, **discount coupons**, electronic payment or bank transfer, **automatic post-purchase messages**, course→course upsell |
| bedayaonline.com | **Parent dashboard** — performance follow-up, periodic reports (strengths/weaknesses), notifications, attendance monitoring |

**Category note that shaped scope:** nearly all of these are **center-management** products
(attendance, dues, rooms, parents), not content/LMS platforms like this one. Attendance/QR/
bable-sheet AI grading is a different product category and was deliberately not pulled in.

The one capability that is **universal** across every platform found, and that is squarely a
content-platform concern for us, is **WhatsApp as the contact channel**. That drove the choice of
what to build.

## 2. Audit result: most of the brief's targets already existed

This is the most consequential finding of the audit, and it changed the plan. Before building
anything I read the existing implementation:

| Brief item | Finding |
|---|---|
| Owner-controlled social URLs | **Already existed.** `server/settings/schema.ts` identity group has `telegram/facebook/youtube/instagram/tiktok/twitter/linkedin` (all `httpsOrEmpty`-validated) **plus** a data-driven `socialLinks[]` (max 20: `network`, `url`, `labelAr/En`, `enabled`, `sortOrder`, `showHeader/Footer/Home/Contact`), edited by the `SocialHub` repeater in `/admin/appearance?tab=identity`. |
| Owner-controlled contact details | **Already existed.** `contactPhone`, `contactEmail`, `contactAddressAr/En`, `copyrightAr/En`; rendered in the public footer (`tel:` link, mailto, address). |
| Hard-coded user-facing content | **None found on the homepage.** `app/routes/public/home.tsx` renders the CMS page with slug `home`; zero hardcoded marketing strings (grep for lorem/BUY-NOW style text returns 0). Header/footer nav come from the admin menu builder; identity/branding from settings. |
| Homepage owner control | **Already existed** via the CMS builder (39 block types, verified by counting `labelKey: "cms.blocks."`). |
| Floating WhatsApp button | **Genuinely missing.** `platform.whatsapp` existed and was consumed by the footer, the student dashboard support card and a page-level `whatsapp_cta` block — but there was no floating button anywhere (`grep` for `wa.me`/`fixed bottom`/`floating` found only those three). |

So the only real gap in the brief's list was the floating button. Building a second social/contact
settings system would have created the "competing CMS" the brief explicitly forbade.

## 3. What was implemented

### Floating WhatsApp button (homepage only)

`app/components/WhatsAppFab.tsx`, mounted **only** by `app/routes/public/home.tsx`.

**Owner controls added** (`server/settings/schema.ts`, platform group; UI in
`/admin/appearance?tab=system`):

| Setting | Type | Purpose |
|---|---|---|
| `whatsapp` | string (already existed) | The number; digits-only for `wa.me` |
| `whatsappFloating` | boolean, **default `false`** | Nothing appears until the owner opts in |
| `whatsappMessage` | string ≤300 | Optional pre-filled first message, URL-encoded into `?text=` |

**Collision avoidance.** `IntersectionObserver` maintains the set of `video, iframe, form, table,
[data-avoid-fab]` elements anywhere in the viewport; a rAF-throttled rect test checks those against
the corner the button reserves. No timers. A `MutationObserver` picks up blocks added after first
paint. `[data-avoid-fab]` lets any future surface opt in without the component knowing about it.

The reserved corner is **derived from the button's known geometry** (56px, 16px inset, 12px slack),
not measured from the DOM, so the dodge decision does not depend on a stylesheet having loaded and
stays identical while the button is faded out. RTL-aware (mirrors to bottom-start).

While dodging it is `opacity-0 pointer-events-none`, plus `aria-hidden="true"` and `tabIndex={-1}`
so keyboard and screen-reader users are not handed an invisible control.

## 4. Two real bugs found and fixed during this work

Both were found by measurement, not by reading code, and both would have shipped silently.

1. **`rootMargin: "0px 0px -45% 0px"`** — my first version shrank the observed region to the top of
   the viewport "to keep the set small". That excluded the bottom corner where the button actually
   lives, so collisions would **never** have been detected. Fixed to the full viewport.
2. **Inline styles are dropped in production.** I pinned the button's geometry with a `style`
   attribute. Testing showed `getComputedStyle(el).position === "static"` and `width: auto` even
   though the attribute was present in the DOM; a freshly created element given the same attribute
   behaved identically. Cause: `server/http/headers.server.ts` sends
   `style-src 'self'` **without** `'unsafe-inline'` outside dev, so the browser refuses inline
   styles. Weakening CSP was not an option, so all styling moved back to classes and the geometry
   became constant-derived. This also removed the E2E environment's Tailwind-v4-in-old-Chromium
   limitation from the critical path.

## 4b. Phase 3/8/9 completed: hard-coded user-facing copy

A scan of `app/routes` and `app/components` for Arabic literals outside
`app/locales` and the CMS registry found 11 files. Most were benign — the
`(عربي)` suffix on Admin editor fields is editor chrome meaning "this input is
for Arabic", and default `صواب/خطأ` option text on a new true/false question is
an owner-editable default.

Three were genuine user-facing copy sitting inline in components, invisible to
translation and impossible to keep consistent. They now live in the
dictionaries:

| Was | Now |
|---|---|
| `blocks.tsx` — CMS form submit button `"إرسال"/"Submit"` inline | `common.cmsFormSubmit` |
| `blocks.tsx` — form failure fallback `"تعذر إرسال النموذج."` inline | `common.cmsFormFailed` |
| `student/dashboard.tsx` — four role labels as inline ternaries | `dashboard.roleStudent` / `roleTeacher` / `roleAdmin` / `roleSuperAdmin` |
| `student/security.tsx` — device notice inline | `security.devicesAdminOnly` |

The security notice also **leaked internal roadmap language to students**: it
read *"admin-side in Phase 1 and opens to students in Phase 3"*. The new string
says only that device management is handled by the administration and to contact
support. Both the unit and E2E tests assert `/Phase\s*[13]/` and `المرحلة` do
not appear.

`app/locales/en.ts` is declared `export const en: Dictionary` where
`Dictionary = typeof ar`, so a key added to Arabic but not English fails
typecheck — parity is compiler-enforced, not convention.

Deliberately left alone: `public/home.tsx`'s fallback platform name duplicates
the schema defaults in `platformSettingsSchema` and only renders if settings are
empty; the `؟` avatar-initial fallback; and `RichTextEditor.tsx` admin chrome.

## 5. What was deliberately NOT implemented

| Skipped | Reason |
|---|---|
| A second social/contact settings system | Already existed and is validated; duplicating it is the "competing CMS" the brief forbids |
| Floating button on any non-homepage route | A fixed overlay would cover video controls, exam questions and submit buttons. Enforced by mounting it in the homepage route only, and asserted across 9 routes |
| WhatsApp OTP verification, message quotas, bulk WhatsApp broadcast (seen on almenasa-ar.com) | Require a paid WhatsApp Business API sender id and credentials. Not faked |
| Parent/guardian portal, QR/barcode attendance, bable-sheet AI grading | Different product category (center management), and a redesign the brief forbids |
| Discount coupons, white-label apps, AI exam generation from PDF | Out of scope for this mission; each is a substantial subsystem, not an owner control |
| Moving `devices`/`security`/`assessment` settings into owner control | Anti-sharing, session/rate-limit and grading defaults are technical/security-sensitive |

## 6. E2E coverage (real Chromium)

`tests/e2e/whatsapp-fab.spec.ts` — 2 tests:

| Scenario | Assertion |
|---|---|
| Owner enables + sets number and Arabic message | Button appears on `/`; `href` is `https://wa.me/<digits>?text=<urlencoded>` and decodes back to the exact Arabic message; `target=_blank`; `rel` contains `noopener` |
| AR label | `aria-label` contains `واتساب` |
| EN + mobile (390×844) | `aria-label` matches `/WhatsApp/i` |
| **Homepage only** | Count is 0 on `/courses`, `/courses/:slug`, `/exams`, `/p/contact`, `/login`, `/dashboard`, `/learn/:course/:lesson`, `/admin`, `/admin/cms` |
| Number changed | `href` becomes `https://wa.me/<new digits>` |
| Disabled | Button absent |
| Enabled but no number | Button absent |
| Collision | Owner creates a form in `/admin/cms/forms`, adds a `form_block` to the homepage and publishes; visitor scrolls it into the reserved corner → `data-dodging="true"`, `aria-hidden="true"`, `tabindex="-1"` |
| Return after collision | Scroll away → `data-dodging="false"`, `aria-hidden` removed |

`tests/e2e/identity-contact.spec.ts` — 1 test:

| Scenario | Assertion |
|---|---|
| Contact phone | `footer a[href="tel:01153719506"]` visible to an anonymous visitor |
| Social URL | `footer a[href="<facebook url>"]` visible, `target=_blank` |
| URL changed | New URL present, **old URL count is 0** (replaces, does not accumulate) |
| `javascript:alert(1)` | Refused — the stored value does not start with `javascript:` |
| Row disabled | Footer link gone; phone link still present |

AR/EN homepage content, hide/show, reorder, and templates are covered by the existing
`tests/e2e/cms-builder.spec.ts` (5 tests); YouTube, Google Forms and free content by
`youtube-content.spec.ts`, `free-content.spec.ts`. All were re-run green below.

`tests/e2e/i18n-copy.spec.ts` — 2 tests: student dashboard role label renders `Role: Student` in EN
and `الدور: طالب` in AR (asserting the role line specifically, because the seeded student's display
name is itself Arabic); the security page shows the translated notice in both languages with no
`Phase 1`/`Phase 3` or `المرحلة`.

Unit: `tests/unit/whatsapp-fab.test.ts` — 17 tests (digits-only normalisation, message encoding
including Arabic, wa.me URL cannot be redirected by the message, collision selector contents,
`fabZone` LTR/RTL/mobile geometry and overlap truth table, schema defaults and length cap). `tests/unit/i18n-copy.test.ts` — 7 tests (new dictionary keys
resolve in both locales, roadmap wording absent, and a source-level guard that the three components
no longer contain the old literals).

## 7. Verification actually run

| Check | Result |
|---|---|
| `npm run verify` (= `lint:imports` + `typecheck` + `test` + `build`) | exit **0** |
| Unit (`vitest.unit.config.ts`) | **258 passed** (24 files) — baseline 234, **+24** |
| Integration (`vitest.integration.config.ts`) | **306 passed** (23 files) — baseline 306, unchanged |
| `npm run test:e2e` (full suite) | **80 passed, 0 failed** (3.6m) — baseline 75, **+5** |

Code paths these executed: `WhatsAppFab.recompute`/`fabZone`/`whatsAppHref` (unit + the collision
spec driving a real `form_block` into the reserved corner), the `save-system` action branch in
`admin.appearance.tsx` writing `whatsappFloating`/`whatsappMessage` via `updateSettingsGroup`,
`fabFrom(settings.platform)` and the `<WhatsAppFab/>` mount in `home.tsx`, and the `save-identity`
action's `socialLinks`/`namedSocialsFromLinks` path.

**Not verified:** painted appearance. The E2E Chromium is `HeadlessChrome/92.0.4512.0`, which
predates Tailwind v4's `@layer` output, so utility classes do not apply and visual assertions are
unreliable. All assertions therefore read DOM state (`data-dodging`, `aria-hidden`, `href`,
presence), not painted boxes. Colour, hover state and the fade transition are unverified visually.

## 8. Git state

| Ref | SHA |
|---|---|
| `arena/01a080e8-tito` (local = remote) | tip of this mission's commits — see `git log 567aa8c..HEAD` |
| `main` (remote) | `567aa8c17a0ca541225e768d16fae75b4d573ba5` — **unchanged** |

Commits this mission:

- `8673861` feat(home): owner-controlled floating WhatsApp button with collision avoidance
- `cdd8cff` test(e2e): prove owner-controlled social links and contact details
- `d2c0855` i18n: move user-facing copy out of components into the dictionaries
- (the commit containing this file's final update)

Working tree clean. No resets, rebases, force-pushes, squashes or amended commits. No PR opened.
`main` was **not** integrated — the brief allows that only on explicit authorisation.

## 9. What remains open

Honestly stated, rather than presented as finished:

- **Phases 8–9 are now complete** as an audit: 29 admin routes and the student surfaces were
  inventoried, the hard-coded-copy scan was run across `app/routes` and `app/components`, and every
  genuine finding was fixed (section 4b). No further owner-control gap was found that the existing
  CMS/settings architecture does not already cover, so nothing else was added — adding settings the
  UI does not need is the feature explosion the brief forbids.
- **Teacher-facing surfaces are thin by design, not by omission.** There is no separate teacher app;
  teachers are managed in `admin.teachers.tsx` and use the admin surface with scoped permissions.
  Building a distinct teacher portal would be a redesign, which the brief forbids.
- Competitor capabilities needing real credentials remain unimplemented and unfaked: Mux streaming
  keys, Paymob/Fawry/Stripe keys + webhooks, transactional email, Google OAuth/Forms API for
  question import, YouTube Data API metadata, WhatsApp Business API.
- **Not visually verified** anywhere in this report: the E2E Chromium is `HeadlessChrome/92`, which
  predates Tailwind v4's `@layer` output, so utility classes do not apply. Colour, hover and fade
  transitions are unverified; all assertions read DOM state instead.
