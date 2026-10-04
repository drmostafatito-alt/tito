# TITO — Full end-to-end product audit, repair and polish

**Date:** 2026-10-04
**Branch:** `arena/01a10087-tito` (from `main` @ `dda0f95`)
**Design source of truth:** `cde5bbe3` (original Muse interface)
**Worker:** `dr-mostafa-tito` · **Production:** https://dr-mostafa-tito.drmostafatito.workers.dev

Everything below was produced by driving a real Chromium against a real build of
the app (local Worker runtime, local D1, local R2), not by reading code. Where a
claim could not be verified in a browser it is marked as such.

---

## A. ROOT CAUSES

The defects found cluster into six real root causes, not forty unrelated bugs.

| # | Root cause | What it produced |
|---|---|---|
| 1 | **CMS context could resolve a link to nothing, and the renderer still emitted an `<a>`.** `resolveCmsHref` returns `""` for "render the item but it has no destination" (e.g. the question platform is disabled, or no WhatsApp number is configured). | Social/contact "links" that looked clickable and did nothing — the `#`-style dead icons reported on the live site. |
| 2 | **Identity/settings gaps were rendered as empty UI instead of being omitted.** The settings table genuinely has no TikTok/YouTube/Telegram and no WhatsApp number, locally *and* in production. | Empty social slots, an empty hero photo stage holding half a grid column, dead contact cards. |
| 3 | **Counts were built by string concatenation, so Arabic plurals were wrong and the noun being counted was wrong.** Grade chips counted *courses/terms* while the label said "محتوى تعليمي". | "2 محتوى تعليمي" on the homepage against "24 درس" on `/study` — the 48 real lessons looked like they had disappeared. |
| 4 | **The Muse layer (`.mk`) was authored at one desktop width.** Fixed `gap:28px` nav, `right:6%` ornaments, `repeat(2,1fr)` grade grid, 34px social circles. | Nav wrapping under the login button at 1280–1440, a handwriting ornament drawn through the primary CTA, a stranded half-empty grade row, sub-target social icons. |
| 5 | **The two consoles (admin + student) were built as dense desktop tables with bare inline links.** 16–22px pointer targets. | 1 000+ WCAG 2.5.8 (Target Size Minimum, AA) violations across the admin and student matrices. |
| 6 | **Accessible names were assumed from visible text that icon-only / filter controls do not have.** | Unnamed icon buttons and three unnamed filter controls on `/admin/assignments`. |

Two further "defects" turned out to be **harness bugs, not product bugs**, and are
recorded here so they are not re-reported later:

- A reported `h1 → h3` heading skip on `/study/:slug` — the intervening `<h2>` is
  `sr-only`, which is a legitimate outline step. The probe was filtering headings
  by *visual* visibility; it now reads the accessibility tree.
- A reported "the social editor cannot add or remove rows" — `SocialHub`
  (`app/routes/admin.appearance.tsx`) has had add / remove / reorder all along.

---

## B. FIXES

33 files changed, 8 added — **473 insertions / 290 deletions** on top of `dda0f95`.
Every change is a refinement of the Muse design; no design preset was swapped, no
page was redesigned.

### Links, social icons and dead controls
- `app/cms/social.ts`, `server/cms/render.server.ts`, `app/components/cms/blocks.tsx`
  — an item whose href resolves to `""` renders through `SmartLink` as a `<span>`,
  never as an `<a>`. **No element on the site is an anchor without a destination.**
- Social links are sourced only from `ctx.identity.socials` (CMS/settings). Networks
  that are not configured are omitted rather than rendered empty. **No URL was invented.**
- Every contact card (`.scard`) is now a real full-card link with link affordances
  and a 148px minimum target, instead of a decorative card with a link inside it.
- Video cards get one stretched link over the whole card, so the 16:9 thumbnail and
  the play button are genuinely clickable on a phone.

### Counts and Arabic plurals (the "missing 48 lessons")
- New `app/lib/plural.ts` + `t(locale, key, params)` support for `PluralForms`
  leaves, resolved through a cached `Intl.PluralRules(locale)`.
- `home.chipSubjects|chipTerms|chipLessons|chipVideos` and
  `study.termsCount|lessonsCount` are now real plural forms:
  `مادة واحدة / مادتان / 5 مواد / 24 مادة`.
- The homepage grade chips now count what they say they count, so the homepage and
  `/study` agree. The 48 lessons are reachable from the homepage.
- `tests/unit/plural.test.ts` (6 cases) and the recursive ar/en key-parity test in
  `tests/unit/i18n.test.ts` lock this in.

### Muse layer responsiveness (`app/app.css`)
- `.mk .nav` — `flex-wrap:nowrap`, 16px fixed gap, `white-space:nowrap`, 44px rows.
  A `vw`-based gap was tried first and rejected: the container is capped at 1180px,
  so a gap that grew with the viewport broke 1366px while 1280px looked fine.
- New `961–1199px` breakpoint: the full nav cannot fit beside the brand and two auth
  CTAs, so the burger + overlay drawer carries navigation there.
- `.mk .scribble` ornaments moved into the page gutter (`right:1.25rem`) and hidden
  below 1280px — they were being drawn through the primary CTA.
- `.mk .grades` → `auto-fit, minmax(min(100%,300px),520px)` so a single published
  grade is not stranded in a half-empty row.
- `.mk .gcard .giant` constrained to a short glyph + new `.gbadge` eyebrow: a program
  title rendered at 9rem was swallowing the whole card.
- `.mk .hero-grid--solo` — with no owner photo configured the hero uses the measure
  instead of holding an empty photo stage.
- Social circles 34 → 40px; `.mk .btn` gets `min-height:48px`, `justify-content:center`,
  `white-space:nowrap`; footer links get 44px rows.

### Pointer targets (WCAG 2.5.8 AA) — the one global rule
Rather than restyle forty call sites, a single documented floor was added at the end
of `app/app.css`, scoped to the two console roots (`.console` for admin,
`.pub-root` for public **and student** — the student layout root is `pub-root`, which
is why the first console-only attempt missed three student links):

- `button`/`summary` get `min-block-size: 1.5rem` (they are already inline-block).
- Plain inline `<a>` gets `padding-block: .25rem`. Padding on an inline box grows the
  hit area but does **not** change the line box, so dense tables, truncated cells and
  wrapped prose keep their exact layout. Anchors that already opt into a box layout
  (`flex`/`grid`/`block`/`h-`/`min-h`/`p*` utilities) are excluded — they size themselves.
- `input[type=checkbox|radio]` get a 1.5rem floor **unconditionally**. An exemption for
  checkboxes inside a `<label>` was written first and then removed: the bulk-select
  checkboxes in `/admin/users` and `/admin/files` sit inside a label whose only other
  content is `sr-only` text, so the label box was also 16px and the exemption was unsound.

### Accessibility
- `/admin/assignments` — the search input and the status / course selects now carry
  `aria-label` (reusing existing translated strings, no new copy).
- Every icon-only control reachable in the matrices has an accessible name; the audit
  asserts this on all 342 route×viewport combinations.

### Philosopher imagery (§6)
Decorative philosopher portraits were removed as decoration. `ThinkerPortrait.tsx`,
`app/lib/thinkers.ts` (12 WebPs) and the `.thinker-*` CSS are retained, and the dead
`THINKER_BLOCK_TYPES` list was deleted. **The only surviving portrait render is the
owner-selected `figure` inside `quote_cards` — i.e. attribution of a quotation to its
author, which is editorial, not ornament.**

---

## C. UI / DESIGN FIDELITY

`git diff cde5bbe308dc09f5756959e184d9ad14201a4ca6 <working tree>` over the design-critical
paths (`app/app.css`, `app/components/cms`, `app/routes/public`, `app/components/ui`)
was read line by line.

**Kept, unchanged:** Muse identity, TITO branding, Arabic RTL, academic character,
white-first interface, navy/academic blue, restrained gold, the Aref Ruqaa display
accents, the teacher-led identity, the hero watermark, the blob/doodle hero
composition, the gold active-nav underline.

**Not introduced:** no new gradients, no added decorative blobs, no enlarged hero, no
giant portraits, no fake metrics, no marketing-agency styling, no CMS preset swap.
`home-preset.json` was **not** treated as the design source (and editing it alone would
not change production anyway — the live homepage is a published D1 snapshot; the preset
is only read at seed / new-page time).

**Changed, and only as refinement:** spacing and wrapping rules so the existing design
survives 320–1440px, target-size floors, link affordances on things that were already
meant to be links, and the removal of empty states that the original never anticipated
(no owner photo, one grade instead of two).

Typography was left on its existing scale; the only type changes are
`line-height:1.25` + centring inside `.mk .btn` and the new `.gbadge` eyebrow that
replaced an illegible 9rem watermark.

---

## D. ADMIN — every control proven to reach the public site

`qa/admin-roundtrip.mjs` drives the real admin UI and then re-reads the **public**
HTML as an anonymous visitor. **15/15 PASS**, and every setting it touched is restored
at the end of the run (asserted, not assumed).

| Setting | Proven effect on the public site |
|---|---|
| `identity.shortNameAr` | header brand |
| `identity.taglineAr` | hero tagline |
| `identity.footerAboutAr` | footer about column |
| `platform.whatsapp` | real `wa.me/<digits>` link — and **clearing it removes the link** rather than leaving a dead one |
| `platform.questionPlatformEnabled` | exams anchors appear / disappear, with no leaked `platform` strings in the HTML when off |
| `theme.primary` | `--color-brand-*` custom properties in `/theme.css` |
| `cc.showLessonCount` | public course cards |
| `dashboard.welcomeAr` | student dashboard |
| social link add → render → remove | renders publicly **with an accessible name**, and removal leaves no orphan icon |

**Admin form inventory** (every tab opened and counted in the browser):
`?tab=identity` 21 fields incl. the `SocialHub` row editor with add/remove/reorder ·
`?tab=theme` 19 · `?tab=presentation` 21 · `?tab=dashboard` 9 · `?tab=system` 136 ·
`/admin/cms` 23 forms · `/admin/content` 21 · `/admin/videos` (mock-register, master
upload, YouTube) · `/admin/security` filter-only.

**No dead controls were found.** One surface deserves an explicit note: `/admin/seo` is a
**read-only diagnostics report by design** — it reports on SEO state rather than setting
it, so it is not a dead control and was left as is.

**Lesson creation / video workflow (§16, §17):** the admin never has to handle a technical
id. Images are chosen through a visual `ImagePicker` with inline upload that posts through
the *existing* validated `/admin/files` action (same R2 / validation / audit pipeline, no
duplicated storage logic) and auto-selects the result.

**CMS edit → save → publish → public chain (`qa/cms-publish-chain.mjs`) — 7/7 PASS:**
the home page is editable from `/admin/cms`; a draft edit persists in the editor; the
unpublished draft does **not** leak to the public page; the admin preview *does* show it;
publishing pushes it to the public page; the QA edit was reverted and re-published.

**Media / R2 (§18) — `qa/media-chain.mjs`, 17/17 PASS:** an admin uploads an image from
`/admin/files` → it is listed → `/files/:id` returns 200 with the exact uploaded bytes and
`image/png` → a **private** upload returns 404 to an anonymous visitor → the owner photo is
chosen from the visual library (never by id) → saving puts it on `/`, `/about` and `/study`
with a real alt text (`د/ مصطفى تيتو`) → the original photo is restored and every QA upload
is deleted. **No test record is left behind.**

---

## E. AUTH & AUTHORIZATION

Verified in the browser (`qa/interactions.mjs`), nothing disabled or bypassed:

- A student logs in and reaches `/dashboard`.
- **Session persists in a new browser tab** (`/profile` loads authenticated).
- **A student is blocked from `/admin`** → redirected to `/dashboard?error=forbidden`.
- An admin logs in and reaches `/admin`.
- Invalid credentials do **not** navigate away from `/login` and a real error message is shown.
- The login email field has a real `<label>`, and inputs are ≥16px so iOS does not zoom.
- **Device trust is intact** — the QA harness has to persist one storage state per account
  precisely because the device-change policy blocks repeated new-device logins. That policy
  was not weakened to make testing easier.
- **Private media is authorisation-checked at the edge**, not just hidden in the UI (above).

---

## F. BROWSER QA — per-viewport PASS/FAIL

`qa/product-audit.mjs` loads each route at each width in a real Chromium and checks, per
combination: horizontal overflow · element collisions · anchors with no destination ·
controls with no accessible name · broken or alt-less images · console errors · failed
network requests · heading-order skips (read from the **accessibility tree**) · `h1` count ·
`main` count · pointer-target size (WCAG 2.5.8 AA, 24×24 CSS px).

**342 route × viewport combinations. Zero failures at every width.**

| Width | anon (15 routes) | student (7 routes) | admin (16 routes) |
|------:|:----------------:|:------------------:|:-----------------:|
| 320  | PASS 15/15 | PASS 7/7 | PASS 16/16 |
| 360  | PASS 15/15 | PASS 7/7 | PASS 16/16 |
| 375  | PASS 15/15 | PASS 7/7 | PASS 16/16 |
| 390  | PASS 15/15 | PASS 7/7 | PASS 16/16 |
| 414  | PASS 15/15 | PASS 7/7 | PASS 16/16 |
| 768  | PASS 15/15 | PASS 7/7 | PASS 16/16 |
| 1024 | PASS 15/15 | PASS 7/7 | PASS 16/16 |
| 1280 | PASS 15/15 | PASS 7/7 | PASS 16/16 |
| 1440 | PASS 15/15 | PASS 7/7 | PASS 16/16 |

The anonymous matrix reports **NO FINDINGS** of any class whatsoever. The student and admin
matrices report **zero pointer targets below the 24px AA floor**; what remains is an
*informational* band of targets between 24px and the 44px comfort target — 36 instances in
the student console and 929 in the admin console. These are above the AA requirement and are
an accepted density trade-off for a desktop operations console; they are listed in REMAINING
ISSUES rather than silently dropped.

**Mobile navigation (§20) — re-verified:** at 375px the burger is visible, the drawer opens,
and in RTL **both** the public drawer and the admin drawer are anchored at `x = 0`, i.e. the
**physical left edge**. `aria-expanded` flips to `true`, focus moves into the drawer, Escape
closes it, and focus returns to the burger. The mobile bottom bar is visible at 375px and
every item has an accessible name. Every in-page anchor resolves to a real target element.

---

## G. TESTS

All green on the final tree:

| Gate | Result |
|---|---|
| `npm run lint` (module boundaries) | **PASS** — boundaries clean |
| `npm run typecheck` | **PASS** |
| `npm run test:unit` | **474 / 474** across 40 files |
| `npm run test:integration` | **323 / 323** across 29 files |
| `npm run build` | **PASS** |
| `qa/interactions.mjs` | **21 / 21** |
| `qa/admin-roundtrip.mjs` | **15 / 15** |
| `qa/cms-publish-chain.mjs` | **7 / 7** |
| `qa/media-chain.mjs` | **17 / 17** |
| `qa/product-audit.mjs` × 3 roles | **342 / 342** combinations |

Note for future runs: unit tests must be invoked through `npm run test:unit`
(`vitest.unit.config.ts`). `npx vitest run --config vitest.config.ts` fails with
`UNRESOLVED_ENTRY` — that config is not the unit config.

**New committed QA harness** (6 scripts, `qa/*.mjs`, local-dev only, ~76 KB total):
`product-audit.mjs` (the matrix, writes `qa-out/audit-<tag>/report.json` + a class-rollup
`summary.md`), `link-crawl.mjs`, `interactions.mjs`, `admin-roundtrip.mjs`,
`cms-publish-chain.mjs`, `media-chain.mjs`, plus shared `lib.mjs`. All scratch probes written
during the audit were deleted. Output goes to `qa-out/`, which is gitignored.

---

## H. PRODUCTION

Production was **read** through the browse tool and its current state is documented below,
but **it was not deployed to and could not be re-tested after a deploy.**

**Why:** this sandbox has no Cloudflare API token and no `wrangler` OAuth session, so
`wrangler deploy`, `--remote` D1 queries and `wrangler secret put` are all impossible.
Sandbox egress is also allowlisted: `curl` to `dr-mostafa-tito.drmostafatito.workers.dev`
fails TLS (`exit 35`) on every attempt, so no scripted browser can drive production from here.
**Step 26 (production verification in a browser) is therefore outstanding and must be done
after a deploy from a machine that holds the Cloudflare credentials.**

What was confirmed about production by reading it:

- The homepage renders the owner photo (`/files/e0b38c19-…`), "اختر صفك للبدء" with two
  data-bound grade cards, "أحدث الدروس" (3 cards), the 4 feature cards, the about block,
  the contact block and the final CTA.
- **The 48 real lessons are live.** `/study` lists فلسفة ومنطق and علم النفس, each
  "2 ترم · 24 درس"; `/study/falsafa-manteq` lists 9 numbered real lessons for الترم الأول
  and gating works (locked lessons show "للمشتركين" + an "إدخال كود التفعيل" → `/activate` CTA).
  They were simply not surfaced correctly from the homepage — fixed in B.
- Production reproduces the two defects fixed here: the homepage grade chips say
  "2 محتوى تعليمي" against `/study`'s "24 درس", and in the contact block
  واتساب / فيسبوك / تيك توك / يوتيوب are **not** links while "اشترك الآن" and "منصة الأسئلة" are.
- Production settings have the same identity gap as local: only `contactPhone 01153719506`
  and a Facebook URL are configured. No TikTok / YouTube / Telegram URL exists anywhere,
  which is why those icons have no destination. **They were not invented.** To make them
  live, the real URLs must be entered in `/admin/appearance?tab=identity`.
- Decorative thinker WebPs are still present in the production markup
  (`kant-sm.webp`, `descartes.webp`, `aristotle.webp`, `jung.webp`, `nietzsche-sm.webp`);
  the fix for that is in this branch and ships with the deploy.

**Deploy checklist for whoever has the credentials** — only to the `dr-mostafa-tito` Worker,
and only after the gates in G (all already green here):
`npm run check:deploy-config` → `npm run build` → `npm run deploy` → re-run the browser tour
against the production origin → confirm the grade chips, the contact block and the absence of
decorative philosopher imagery.

---

## I. GITHUB

- Branch: `arena/01a10087-tito`, committed and pushed to `origin`. No force push, no rebase,
  no history rewrite, no new repository, no remote change.
- 33 files modified, 8 added. `git diff --stat` and `git diff --name-only` are in the commit.
- **Cleanliness check before committing:** no `.env`, no `.dev.vars`, no API key, no credential,
  no `node_modules`, no Playwright video / trace / screenshot, no large artifact. Untracked
  additions total **76 KB**. `qa-out/` is gitignored (`.gitignore:24`).
- `npm run audit:secrets` reports 5 candidates; **all five are pre-existing false positives**
  in files this audit did not touch — three are the literal strings
  `"-----BEGIN PRIVATE KEY-----"` used for *format detection* in the Mux adapter and its unit
  test, two are the deliberate `https://user:password@app.example` fixtures in
  `tests/unit/security-boundaries.test.ts`.
- `package-lock.json` carries a 48-line diff that is **not** a dependency change: npm 10.9.8
  strips 16 `"libc": ["glibc"]` blocks on every install. It is reverted in the commit.

---

## J. REMAINING ISSUES

| # | Issue | Severity | Why it is still open |
|---|---|---|---|
| 1 | **Production has not been deployed or re-tested in a browser** (§26). | **Blocking for sign-off** | No Cloudflare API token / OAuth in this environment, and egress to the Worker origin is TLS-blocked. Must be done by someone holding the credentials; checklist in H. |
| 2 | **TikTok, YouTube and Telegram have no URL** in settings, locally and in production. | Medium | Deliberately **not** fixed: inventing a social URL is explicitly out of bounds. The icons are now correctly omitted instead of rendering dead. Enter the real URLs in `/admin/appearance?tab=identity` and they appear immediately. |
| 3 | `platform.whatsapp`, `platform.supportPhone`, `platform.supportEmail` are null. | Medium | Same reasoning. The WhatsApp FAB and `wa.me` link are proven to work the moment a number is entered (round-trip test in D). |
| 4 | **929 admin + 36 student pointer targets sit between 24px and 44px.** | Low (above AA) | WCAG 2.5.8 AA is met everywhere. Closing the gap to the 44px comfort target would mean materially re-laying-out dense operational tables — a redesign, which is out of scope here. Recorded as an accepted trade-off. |
| 5 | `package.json` `name` is still `educore`. | Cosmetic | Renaming the npm package is unrelated to the product and touches the lockfile; left alone deliberately. |
| 6 | Repo-root clutter — `.art-lab-loop.png`, `ChatGPT Image Sep 14, 2026, 04_18_54 AM.png` (1.6 MB), `screencapture-exams-mansa-eg-….png` (5.7 MB), `tito_seo_keyword_universe.csv/.md`. | Cosmetic | Pre-existing tracked files. Deleting tracked assets is a judgement call for the owner, not an audit fix; none were added by this work. |
| 7 | `content.lessonsCount` and `curriculum.lessonsCount` are still plain strings. | Low | They are not currently rendered on a surface where the Arabic dual form shows; converting them to `PluralForms` is a small, safe follow-up. |
| 8 | Two Rollup `INEFFECTIVE_DYNAMIC_IMPORT` warnings (`server/audit/log.server.ts`, `VideoPlayer.tsx`). | Low | Pre-existing build-size hygiene, not a correctness issue. |
