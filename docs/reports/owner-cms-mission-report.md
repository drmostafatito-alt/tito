# Owner / Admin CMS Mission — Final Report

**Repository:** `drmostafatito-alt/tito` · **Branch:** `arena/01a080e8-tito`
**Starting main:** `bc714796f7ba960a9d45c61feb0d9940f49fc2a1`

Scope of this mission: prove the owner can *operate* the platform from Admin — not merely
that an Admin page exists — and close the gaps where they could not.

---

## 1. Owner control matrix

"Browser verified" = the loop was driven through the real Admin UI in Chromium and the result
observed on the public/student page during this mission.

| Capability | Admin UI | Save works | Persistence | Frontend reflection | Browser verified | Status |
|---|---|---|---|---|---|---|
| Homepage text (AR + EN) | `/admin/cms` → Home → block settings | ✅ | ✅ (published snapshot) | ✅ | ✅ | Working |
| Homepage hero image | `/admin/cms` → hero block → `f.image` | ✅ | ✅ | ✅ | inherited (`homepage.spec.ts` loads the hero image) | Working |
| Add / delete / hide / reorder section & block | `/admin/cms` page editor | ✅ | ✅ | ✅ | ✅ (hide + reorder) | Working |
| Duplicate block / section | page editor toolbar | ✅ | ✅ | ✅ | inherited | Working |
| Create page, templates, preview, versions | `/admin/cms`, `/admin/cms/templates` | ✅ | ✅ | ✅ | ✅ (save as template) | Working |
| Publish / unpublish | page editor → Publish | ✅ | ✅ | ✅ | ✅ | Working |
| Menus (header/footer/student/legal) | `/admin/cms/menus` | ✅ | ✅ | ✅ | inherited | Working |
| Forms (11 field types) + submissions | `/admin/cms/forms` | ✅ | ✅ | ✅ | inherited | Working |
| Branding, social links, contact | `/admin/appearance` → Identity | ✅ | ✅ | ✅ | inherited | Working |
| Theme tokens | `/admin/appearance` → Theme → `/theme.css` | ✅ | ✅ | ✅ | inherited | Working |
| Platform language (default + offered) | `/admin/appearance?tab=system` → Language | ✅ | ✅ | ✅ | ✅ (`locale-settings.spec.ts`) | Working (added earlier this branch) |
| SEO title/description/OG/robots/canonical | `/admin/cms` SEO tab + `/admin/content` | ✅ | ✅ | ✅ | ✅ (`seo-meta.spec.ts`) | Working |
| **Add a YouTube video by URL** | `/admin/videos` → YouTube | ✅ | ✅ | ✅ | ✅ | **Implemented** |
| **Attach a YouTube video to a lesson** | lesson → Add item → Video | ✅ | ✅ | ✅ | ✅ | **Implemented** |
| **Attach a Google Form / quiz to a lesson** | lesson → Add item → External quiz | ✅ | ✅ | ✅ | ✅ | **Implemented** |
| Create free course / unit / lesson (AR+EN) | `/admin/content` | ✅ | ✅ | ✅ | ✅ | Working |
| Video upload (active provider) | `/admin/videos` → Upload master | ✅ | ✅ | ✅ | inherited (`lesson-video.spec.ts`) | Working |
| Media upload / replace / rename / alt AR+EN / usage | `/admin/files` | ✅ | ✅ | ✅ | inherited | Working |
| Delete media that is still referenced | `/admin/files` | blocked by design | — | shows usage | code-verified (`in_use` guard) | Working |
| Courses / subjects / programs / products | `/admin/content` | ✅ | ✅ | ✅ | ✅ + inherited | Working |
| Question bank, exams, attempts | `/admin/assessment` | ✅ | ✅ | ✅ | inherited (`exam.spec.ts`) | Working |
| Assignments + grading | `/admin/assignments` | ✅ | ✅ | ✅ | inherited | Working |
| Announcements | `/admin/announcements` | ✅ | ✅ | ✅ | ✅ (`announcements.spec.ts`) | Working |
| Commerce: products, orders, batches | `/admin/commerce` | ✅ | ✅ | ✅ | inherited (`commerce.spec.ts`) | Working |
| Users, teachers, entitlements | `/admin/users`, `/admin/teachers`, `/admin/entitlements` | ✅ | ✅ | ✅ | ✅ (`teacher-authoring.spec.ts`) | Working |
| Audit log, security center, analytics | `/admin/audit`, `/admin/security`, `/admin/analytics` | read-only | — | — | ✅ (all load) | Working |
| Device limits, session/rate limits, assessment defaults | **no UI (deliberate)** | — | — | enforced server-side | ✅ | Intentional — §9 |
| Mux / payment provider credentials | `/admin/appearance?tab=system` (rank ≥ 4) | ✅ | ✅ | needs real credentials | not verifiable here | Owner-only — §9 |

---

## 2. Content architecture (final)

```
Homepage / CMS pages
  └─ page (draft | published)  ── published snapshot is what visitors get
       └─ section block (bg, padding, container, heading AR/EN)
            └─ content block  (hero_showcase, text, rich_text, image, gallery,
                               buttons, feature_cards, course_cards, free_content,
                               latest_lessons, testimonials, … 39 types)

Catalog (the one content hierarchy — free and paid share it)
  program → grade → subject → course → unit → lesson → lesson_items
                                                       ├─ video   → videos row
                                                       ├─ file    → files row
                                                       ├─ exam    → exams row
                                                       └─ link    → external Google Form   ← new

Videos (provider-neutral registry)
  videos.provider = mock | mux | bunny | cfstream | youtube      ← youtube is new
    upload providers : R2 master → asset lifecycle → signed, TTL'd playback token
    youtube          : no upload, no token; embed URL rebuilt from a validated id

Free content = a course with accessLevel = "authenticated" (or "public").
  No parallel "free" table. The homepage `free_content` block surfaces free lessons.

Assessment
  native:  question bank → exam → attempt → result
  external: Google Form attached as a lesson "link" item (embed + external-open)
```

**No competing hierarchies were introduced.** YouTube became a provider on the existing
`videos` registry; the external quiz became a fourth `lesson_items.item_type` alongside
video/file/exam.

---

## 3. Gaps found and closed

### Gap 1 — no way to add a YouTube video

- **Missing:** `/admin/videos` offered only "Register mock video" and "Upload master". An
  owner whose content already lives on YouTube had no path at all. Confirmed in a real
  browser, not inferred from source.
- **Why it mattered:** the single most common way an educator publishes video was unsupported.
- **Implementation:** strict URL parser (`server/video/youtube.ts`), a `youtube` provider
  adapter, a new `PlaybackInfo` type `embed`, an Admin form (URL + AR/EN title/description),
  an iframe branch in `VideoPlayer`, and `frame-src https://www.youtube-nocookie.com` in the
  CSP — without which `default-src 'self'` silently blocked the player.
- **Routes affected:** `/admin/videos`, `/admin/content/:type/:id`, `/learn/:course/:lesson`,
  `/api/playback/:videoId`.
- **No migration** — `videos.provider` is plain TEXT with no CHECK constraint.
- **Tests:** `tests/unit/youtube.test.ts` (41), `tests/e2e/youtube-content.spec.ts` (2).

### Gap 2 — no way to attach an external Google Form / quiz

- **Missing:** lesson items could only be video, file or native exam.
- **Why it mattered:** owners build quizzes in Google Forms and had nowhere to put them.
- **Implementation:** `server/content/external-links.ts` validator; migration `0014` (additive
  columns `link_url`, `title_ar/en`, `description_ar/en`); `item_type` `"link"`; Admin form;
  student rendering as a sandboxed `docs.google.com` iframe **plus** an explicit
  open-in-new-tab link; `frame-src https://docs.google.com`.
- **Question import into the native question bank is deliberately NOT implemented** — it
  requires Google OAuth + Forms/Drive API credentials. Stated in the Admin hint, not faked.
- **Routes affected:** `/admin/content/lesson/:id`, `/learn/:course/:lesson`.
- **Tests:** `tests/unit/external-links.test.ts` (26), `tests/e2e/free-content.spec.ts` (1).

### Gap 3 — the CMS page builder had zero real-browser coverage

- **Missing:** `homepage.spec.ts` only asserted the seeded page renders. Nothing proved that
  editing in Admin reaches visitors.
- **Why it mattered:** the CMS is the platform's core; an untested core is an unverified claim.
- **Implementation:** `tests/e2e/cms-builder.spec.ts` — change text (AR + EN) → publish →
  visitor sees it; hide → disappears → show → returns; reorder sections → public order flips →
  restores; save as template; student blocked from `/admin/cms`.
- **Tests:** 5 new E2E tests.

---

## 4. Bugs found

| # | Reproduction | Root cause | Fix | Commit |
|---|---|---|---|---|
| 1 | `curl /courses` emitted `<meta rel="canonical" …>` instead of a `<link>`; the CMS canonical field had been inert since it was built | React Router 7's `<Meta/>` only emits a `<link>` for descriptors carrying `tagName:"link"` | `{ tagName:"link", rel:"canonical", href }` in `app/cms/seo.ts` | `191e4e4` |
| 2 | Every page emitted **two** `<title>` elements | root `Layout` hardcoded one *and* rendered `<Meta/>` | removed the hardcoded title | `191e4e4` |
| 3 | The `locale` settings group had no Admin UI; changing the site language needed a deployment | group existed in the schema with no write path | Language fieldset on the System tab + schema refine + switcher/`/set-locale` enforcement | `81a5bc0` |
| 4 | Settings validation failures showed the owner a raw Zod JSON dump | `err.message` returned verbatim | surface Zod issue paths/messages | `81a5bc0` |
| 5 | A video the owner had just registered appeared at the **bottom** of both the Video list and the lesson picker, so they could not confirm the save | `listVideos` ordered by `createdAt` ASC | order DESC (newest first) | `747242f` |
| 6 | A YouTube video listed as "video" everywhere in Admin | item label used `playbackId ?? "video"`, and YouTube rows have no playbackId | locale-aware label from the owner's title | `918eedb` |

Test-harness defects found and fixed (not product bugs, recorded so they are not rediscovered):
`browser.newContext()` inherits `storageState` inside `test.use({storageState})`, so a "fresh
visitor" was actually the admin; uncontrolled form inputs are lost if filled before React
commits a client-side navigation; `save-block` forms exist for section wrappers *and* children
while only children get a "Block settings" `<summary>`, so summary index ≠ form index.

---

## 5. E2E acceptance results

```
npm run test:e2e   →  75 passed, 0 failed   (baseline at mission start: 67)
```

New this mission: `cms-builder.spec.ts` (5), `youtube-content.spec.ts` (2),
`free-content.spec.ts` (1). Earlier on this branch: `locale-settings.spec.ts` (3),
`seo-meta.spec.ts` (3).

Mapping to the requested acceptance tests:

| Requested | Where |
|---|---|
| 1 Admin changes homepage text → visitor sees it | `cms-builder.spec.ts` |
| 2 Admin changes homepage image → visitor sees it | hero image load asserted in `homepage.spec.ts`; the same `f.image` field is edited by the builder path |
| 3 Admin creates a YouTube video → page shows it | `youtube-content.spec.ts` |
| 4 Admin creates free content + YouTube → student sees it | `free-content.spec.ts` |
| 5 Admin attaches a Google Form → student sees it safely | `free-content.spec.ts` |
| 6 Admin reorders → new order | `cms-builder.spec.ts` |
| 7 Admin hides/unpublishes → gone | `cms-builder.spec.ts` |
| 8 Arabic change → Arabic frontend | `cms-builder.spec.ts` |
| 9 English change → English frontend | `cms-builder.spec.ts` |
| 10 Student cannot modify owner-only settings | `cms-builder.spec.ts` + `security.spec.ts` |

---

## 6. Unit / integration / build / typecheck / lint

```
npm run verify  →  exit 0
  ✓ module boundaries clean            (scripts/check-imports.mjs)
  ✓ unit          234 passed  (22 files)      baseline 167
  ✓ integration   306 passed  (23 files)      baseline 306
  ✓ client build  ok
  ✓ server build  ok
  ✓ tsc           no errors
```

---

## 7. Real browser routes and journeys tested

All 20 admin surfaces were opened in Chromium and returned 200 with rendered content:
`/admin`, `/admin/videos`, `/admin/files`, `/admin/content`, `/admin/cms`,
`/admin/cms/templates`, `/admin/cms/menus`, `/admin/cms/forms`, `/admin/assessment`,
`/admin/assignments`, `/admin/announcements`, `/admin/appearance?tab=system`,
`/admin/teachers`, `/admin/users`, `/admin/commerce`, `/admin/security`, `/admin/audit`,
`/admin/entitlements`, `/admin/analytics`, `/admin/search`.

Journeys driven end to end this mission:

1. **Owner → YouTube → student.** Paste `youtube.com/watch?v=…&t=42s` → save → only the
   11-char id is stored → attach to a lesson → student's player renders
   `https://www.youtube-nocookie.com/embed/<id>` with tracking params stripped; CSP permits
   the frame; an anonymous request to `/api/playback` is refused.
2. **Owner → free content → student.** Create course "القسم المجاني / Free Content"
   (published, members-only) → unit → lesson → attach a YouTube video and a Google Form →
   student finds the course in `/courses`, opens the lesson, and both the YouTube embed and
   the `docs.google.com/forms/…?embedded=true` iframe render, each with an external-open link.
3. **Owner → CMS → public.** Edit a heading in AR and EN → publish → anonymous visitor
   (platform default `ar`) sees the Arabic copy, an `edu_locale=en` visitor sees the English
   copy → hide the block → it disappears → show → it returns → reorder sections → the public
   order flips → restore.
4. **Rejections.** A non-YouTube URL and a Google *Sheets* URL are both refused with a
   message and nothing is stored; a student cannot reach `/admin/cms`,
   `/admin/cms/templates` or `/admin/cms/menus`.

---

## 8. Final git state

| | SHA |
|---|---|
| Local `HEAD` (`arena/01a080e8-tito`) | `b4e8f9d…` (this report's correction commit) |
| `arena/01a080e8-tito` on GitHub | `747242f…` |
| `main` on GitHub | `bc71479…` |
| Working tree | **clean** |

Commits made this mission, in order:

| SHA | Content | Pushed? |
|---|---|---|
| `918eedb` | YouTube videos end to end | ✅ |
| `747242f` | Google Form quizzes + free-content journey | ✅ |
| `4cb23a4` | CMS page-builder E2E coverage | ❌ |
| `b4e8f9d` | this report | ❌ |

**`4cb23a4` and `b4e8f9d` are committed locally but NOT pushed** — see the blocker below. No
history was rewritten: no reset, rebase, amend, squash or force-push at any point.

> **BLOCKER — GitHub authentication expired mid-session.**
> Pushes of `918eedb` and `747242f` succeeded earlier. Later in the session the token became
> invalid:
> ```
> gh auth status →  X github.com: authentication failed
>                   The github.com token in GH_TOKEN is no longer valid.
> gh api /rate_limit → "Bad credentials"
> git push → remote: Invalid username or token. Password authentication is not supported
>            fatal: Authentication failed for 'https://github.com/drmostafatito-alt/tito.git/'
> ```
> `main` was **not** updated to the new commits, because doing so requires a push. The remote
> SHAs above are taken from the successful push outputs, not from a fresh remote query —
> reads fail too. GitHub needs to be reconnected in Arena; then
> `git push origin arena/01a080e8-tito` and the fast-forward of `main` complete the job.

---

## 9. Owner-only limitations (genuinely require external credentials)

These are **not** implementable without owner-supplied secrets, and none of them were faked:

| Capability | Requires |
|---|---|
| Real video streaming via Mux | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY` |
| Live payment capture (Paymob / Fawry / Stripe) | provider API keys + webhook secrets |
| Transactional email (password reset, email-change verification) | an email provider (SMTP/API) |
| Importing Google Forms **questions** into the native question bank | Google OAuth + Forms/Drive API. The credential-free path — embed the live form or open it externally — **is** implemented. |
| YouTube Data API metadata (real duration, real thumbnails beyond `i.ytimg.com`) | a YouTube API key |
| Production hardening | Cloudflare production configuration, real D1/R2, `ENVIRONMENT=production` |

Everything else in the matrix above works without credentials.

**Deliberately not owner-editable** (security/integrity controls where a mistake in a text
field would be self-locking): `devices` (anti-sharing policy), `security` (session lifetime,
rate limits), `assessment` (grading defaults — changing them would invalidate recorded
attempts). All three are still enforced server-side and have schema-validated defaults. The
pattern for exposing one later is established by the `locale` work: a fieldset on the System
tab, a schema constraint, and an enforcement point.
