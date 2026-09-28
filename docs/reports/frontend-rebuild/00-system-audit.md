# Frontend rebuild — system audit & backend contract

Date: 2026-09-28 · Branch: `arena/01a0e765-tito`

The frontend is being rebuilt from zero. The backend is **not** being rebuilt: it is
treated as a stable product API/data layer. This document is the map that the new
frontend is built against. Nothing here was assumed — every line was read from the
actual implementation.

---

## 1. Runtime & architecture

| Concern | Reality |
|---|---|
| Framework | React Router 7 **framework mode**, SSR on, `future.v8_middleware` |
| Runtime | Cloudflare Workers (`workers/app.ts`) + wrangler; classic build (`build/client`, `build/server`) |
| DB | Cloudflare D1 + Drizzle ORM (`server/db/schema/*`) |
| Storage | R2 — `PUBLIC_ASSETS`, `PRIVATE_FILES`, `VIDEO_MASTERS` |
| Styling | Tailwind v4 (`@theme` tokens in `app/app.css`) + an admin-emitted `/theme.css` |
| i18n | `app/locales/{ar,en}.ts` + `t(locale, key)`; `ar` default, RTL via `<html dir>` in `root.tsx` |
| Boundary lint | `scripts/check-imports.mjs` — only `app/routes/**` and `app/root.tsx` may import `~server/*` |

**Key consequence for the rebuild:** there is no REST API layer for the product UI.
Data reaches the UI through **route loaders** and mutations through **route actions**.
"Consuming the backend" therefore means calling the existing `server/*` services from
the existing loaders — not inventing `/api/*` endpoints.

### Two design layers already exist (and must stay separated)

* **Layer B** — `--color-brand-*`, `--color-accent-*`, `--radius-*`: emitted by
  `/theme.css` from the owner's Appearance settings. Drives the **admin console**.
* **Layer A** — the public identity tokens. Frozen, never emitted by `/theme.css`.
  **This is the layer the rebuild replaces.** Admin keeps Layer B untouched.

---

## 2. Route inventory (`app/routes.ts`)

### Public (inside `routes/public/layout.tsx`)

| Route | File | Auth | Notes |
|---|---|---|---|
| `/` | `public/home.tsx` | anon | **CMS-driven** (page slug `home`) |
| `/p/:slug` | `p.$slug.tsx` | anon | CMS page |
| `/about` | `public/about.tsx` | anon | 404 when no owner identity configured |
| `/programs`, `/programs/:slug` | `public.programs*.tsx` | anon | |
| `/grades/:slug` | `public.grades.$slug.tsx` | anon | |
| `/subjects/:slug` | `public.subjects.$slug.tsx` | anon | |
| `/study` | `public.study.tsx` | anon | learning-content index |
| `/study/:subjectSlug` | `public.study.$subjectSlug.tsx` | anon | year → term → unit → lesson |
| `/courses`, `/courses/:slug`, `/courses/:slug/units/:unitId` | `public.courses*.tsx` | anon | legacy catalog |
| `/curriculum/:slug` | `public.curriculum.$slug.tsx` | anon | SEO curriculum pages (static `REAL_LESSONS`) |
| `/products/:slug` | `public.products.$slug.tsx` | anon | |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email-change` | `public/*` | anon | |
| `/set-locale` | `public/set-locale.tsx` | anon | POST only, guarded by `settings.locale.enabled` |

### Standalone

`/logout`, `/theme.css`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml`,
`/learn/:courseSlug/:lessonSlug`, `/files/:id`, `/api/playback/:videoId`,
`/beacons/progress`, `/webhooks/payments/:provider`, `/api/mock-stream/:videoId/:file`.

### Student (inside `routes/student/layout.tsx`, `requireUser`)

`/dashboard`, `/profile`, `/profile/security`, `/assignments`, `/assignments/:id`,
`/checkout/:productSlug`, `/orders`, `/orders/:orderNumber`, `/activate`,
`/notifications`.

### Admin (`/admin/**`) — out of scope for this rebuild, untouched.

---

## 3. Backend contract — service → UI use case

The new frontend calls these and nothing else. `DB` = drizzle client from
`getDb(getEnv(context))`.

### Settings & identity — `server/settings/service.server.ts`
| Call | Returns | Auth | UI use |
|---|---|---|---|
| `getSettings(db)` | `{ platform, identity, locale, presentation, dashboard, payments, video, seo, … }` | none | site name/tagline, maintenance mode, WhatsApp, support contacts, owner photo/name, presentation toggles, dashboard modules |

`settings.identity` carries `ownerNameAr/En`, `ownerTitleAr/En`, `ownerPhotoFileId`,
`aboutImageFileId`, `logoFileId`, contact + socials. **The teacher photo is a CMS/settings
binding — the frontend renders it, never substitutes it.**

### CMS — `server/cms/service.server.ts`, `server/cms/render.server.ts`
| Call | Returns | UI use |
|---|---|---|
| `getPageBySlug(db, slug)` | page row + `publishedSnapshot` | `/`, `/p/:slug` |
| `renderSnapshot(db, snapshot, { settings, locale })` | `{ sections, ctx }` | resolves dynamic blocks (courses/subjects/grades/videos/products/study_subjects/free_content/latest_lessons) + images + forms + identity |
| `menuItemsFor(db, location)` | `{ items, topLevel }` for `header` \| `footer` \| `student` | navigation |
| `resolvePublicImageUrls(db, ids)` | `fileId → /files/:id` | images |
| `handleCmsFormAction(db, env, request)` | form submission result | CMS `form_block` |

**Block registry** = `app/cms/registry.ts` (single source of truth for allowed block
types + props + zod). `app/components/cms/blocks.tsx` is the **renderer**. The rebuild
replaces the renderer, not the registry → the CMS stays the content source and every
already-published page keeps rendering.

Registered block types (50): `section`, `hero`, `hero_showcase`, `text`, `rich_text`,
`faq`, `accordion`, `announcement`, `countdown`, `divider`, `spacer`, `image`,
`image_text`, `gallery`, `logo_cloud`, `video`, `buttons`, `icon_feature`, `icon_grid`,
`feature_cards`, `pricing_cards`, `statistics`, `testimonials`, `teacher_profile`,
`login_cta`, `register_cta`, `promo_banner`, `social_links`, `contact_info`,
`whatsapp_cta`, `telegram_cta`, `form_block`, `newsletter_form`, `course_cards`,
`subject_cards`, `program_cards`, `free_content`, `featured_content`, `latest_lessons`,
`video_showcase`, `product_cards`, `study_subjects`, `grade_cards`, `exam_platform`,
`journey_steps`, `benefit_list`, `cta_banner`.

### Content — `server/content/service.server.ts`
| Call | Returns | UI use |
|---|---|---|
| `studyHub(db)` | `StudySubjectCard[]` (slug, titles, grade, program, termCount, lessonCount, year) | `/study` index + `study_subjects` block |
| `subjectStudyView(db, slug)` | subject + grade + program + `years[] → terms[] → lessons[]` | `/study/:subjectSlug` |
| `catalogCourses(db)` | published catalog rows | `/courses` |
| `courseBySlug`, `unitsForCourse`, `lessonsForUnit`, `allLessonsForCourse`, `lessonBySlug`, `itemsForLesson` | content rows | `/courses/:slug`, `/learn/...` |
| `chainForLesson(db, lessonId)` | full ancestor chain | access resolution |
| `videosByIds`, `filesByIds` | asset rows | lesson viewer |
| `coursePrereqGate(db, subject, courseId)` | `{ locked, missing }` | prerequisite gate |
| `academicScopeOptions(db)` | years/terms/grades/subjects | admin + scope labels |

`StudyLesson.itemKinds` is real (`video` \| `pdf` \| `file` \| `quiz`) — computed from
actual `lesson_items`. The UI may show kind glyphs **only** from this.

### Access control — `server/entitlements/*`
| Call | Returns | UI use |
|---|---|---|
| `resolveContentAccess(db, subject, chain)` | `{ allowed, reason }` — `anon` \| `not_entitled` \| … | every lesson/term render |
| `entitlementsForStudent(db, studentId)` | entitlement rows | dashboard "what I can open" |

**Rule enforced by the rebuild:** the server verdict decides. Signed file URLs and video
playback credentials are minted only when `verdict.allowed`. The UI never renders a
protected asset URL it was not given.

### Progress — `server/progress/service.server.ts`
`continueLearning(db, studentId, limit)`, `courseProgress`, `courseProgressBatch`,
`lessonProgressMap`, `videoProgressMap`, `progressStats`, `setLessonCompleted`,
`recordBeacon` (POST `/beacons/progress`).

### Commerce — `server/commerce/service.server.ts`
`publicProductBySlug`, `purchasableFor`, `getPricePlan`, `ordersForStudent`,
`subscriptionsForStudent`, order creation + manual payment proof upload,
activation-code redemption. Money is **integer minor units**; `formatMoney` renders it.

Payment rails actually implemented (`server/payments/providers/`): **manual** (cash /
cash instalments / InstaPay with uploaded receipt + admin review) and a **mock** gateway
used only by tests. No Stripe/Paymob/Fawry exists — and none is introduced.

### Activation codes — `/activate` (`routes/student/activate.tsx`)
Server-validated redemption → real entitlement. The UI shows the true server result.

### External exam platform — `app/lib/question-platform.ts` + `settings.platform`
`resolveQuestionPlatformUrl(platform)` returns an https URL **or null**. Everything that
links to exams renders only when it is non-null. The exam platform is never rebuilt
inside Tito.

### Announcements / notifications
`visibleAnnouncements(db, user, now, limit)`, `unreadAnnouncementsCount(db, user)`.

### SEO — `app/cms/seo.ts`, `server/seo/*`, `/robots.txt`, `/sitemap.xml`
`seoMeta`, `contentSeoMeta`, `siteEntitiesMeta`, `rootMetaFrom`, `jsonld.ts`.
Protected routes already emit `noindex` (student layout, `/learn/...`). Preserved as-is.

### Security — `app/root.tsx` middleware
CSRF same-origin evidence on all mutations, body-size caps, CSP nonce, security headers,
private cache-control for authenticated responses. **Untouched** by the rebuild.

---

## 4. Gaps found (no backend rewrite needed)

1. **No API gap.** Every screen the brief asks for has a server call already.
2. `subject_cards` and `newsletter_form` blocks are `deprecated: true` in the registry —
   their renderers must keep working for already-published snapshots, but they stay out
   of the palette. The rebuild honours this.
3. `/courses` (legacy catalog) and `/study` (owner content model) overlap. The rebuild
   keeps both routes alive (existing links, sitemap, tests) but makes `/study` the
   primary discovery surface and presents `/courses` as the catalog view of the same data.

---

## 5. Frontend conclusions

* Rebuild = **new design system + new shells + new page compositions + new CMS renderer**.
* Loaders keep their service calls; only the returned view-model shape may widen where a
  new UI needs an extra real field (e.g. lesson `itemKinds` on `/learn`).
* `app/app.css` Layer A is replaced wholesale. Layer B stays so `/admin` is unaffected.
* Nothing is invented: every number, name, price, count and lesson on screen comes from a
  service call above, and every absent value renders a designed empty state.
