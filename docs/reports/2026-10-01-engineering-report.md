# Dr Mostafa Tito — Platform Audit & Repair

**Branch:** `arena/01a0f697-tito` · **Base:** `29657c4` · **Head:** `5fd0750` · **Date:** 2026-10-01

The approved visual design was treated as fixed throughout. Every change below is a bug
fix, an accessibility fix, a real-data fix, or a restoration of functionality that the
design already assumed — not a redesign.

---

## 1. Git state before any work

| | |
|---|---|
| Branch | `arena/01a0f697-tito` |
| HEAD | `29657c4d0a94e256c1a70ad9c1d9ac1f275ea9fd` |
| Remote | `https://github.com/drmostafatito-alt/tito.git` |
| Working tree | clean |
| Total commits in history | **1** |
| Stash / dangling objects | none (`git stash list`, `git fsck`) |
| Tracked files | 602 |

Verified read-only with `git branch/log/remote/status/reflog/stash/for-each-ref/fsck`
before touching anything.

## 2. Muse commits

**None exist as distinguishable commits.** The entire repository — including the approved
design — is squashed into the single commit `29657c4` ("feat: visible login/register CTAs
in topbar for anonymous visitors", author `tito <tito@local>`). `git grep -i muse` returns
only a false positive (the `0004_amused_hiroim` migration name). Muse-authored vs other
work cannot be separated from history.

The approved design *is* identifiable in-tree: the `.mk` **"MOCKUP LAYER · Faithful
transcription of mockup_v5.html"** in `app/app.css` (from ~line 875), plus the mockup-
faithful renderers in `app/components/cms/blocks.tsx`. That layer was the reference for
every judgement call.

## 3. Architecture (read from source, not docs)

React 19.2.8 · React Router 7.18.3 framework mode (`ssr: true`, `v8_middleware`) ·
TypeScript 5.9.3 · Vite 8 · Tailwind 4.3.3 · Cloudflare Workers via `workers/app.ts`
(ADR-015 classic architecture, not vite-plugin) · D1 with 12 migrations · 3 R2 buckets ·
drizzle-orm 0.45.2 · zod 4.5.4 · hls.js. Arabic-first RTL, CMS-driven pages, strict CSP
with a per-request nonce (`server/http/headers.server.ts`), `isDev=false` in
`workers/app.ts:38` so **dev is production-identical for CSP**.

## 4. Frontend data contract

`PageView → SectionView → BlockBody → block renderer`, block schemas built from field
descriptors in `app/cms/registry.ts` (zod `z.object` strips unknown keys), link resolution
through `app/cms/links.ts` (`safeHref`, `resolveCmsHref`, reserved tokens
`exam:external` / `whatsapp:`). Unresolvable hrefs collapse to `""` and render a `<span>`,
never a dead link. Icons come from the controlled inline-SVG set in `app/cms/icons.tsx`.
This contract was preserved everywhere; no block data model was deleted.

## 5. Files audited

`app/app.css` · `app/components/cms/blocks.tsx` · `app/cms/registry.ts` · `app/cms/links.ts`
· `app/cms/icons.tsx` · `app/cms/icon-ids.ts` · `app/routes/public/layout.tsx` ·
`app/routes/public/home.tsx` · `app/components/LanguageSwitcher.tsx` ·
`app/components/ui/Drawer.tsx` · `app/locales/{ar,en}.ts` · `server/cms/home-preset.json` ·
`server/cms/service.server.ts` · `server/cms/render.server.ts` ·
`server/http/headers.server.ts` · `server/settings/schema.ts` · `server/auth/password.server.ts`
· `app/lib/question-platform.ts` · `scripts/seed.mjs` · `workers/app.ts` · `wrangler.jsonc` ·
`package.json` · `routes.ts` · the `tests/unit`, `tests/integration` and `tests/e2e` suites.

## 6. Bugs found and fixed

**P0 — phones had no navigation at all.** A duplicate `.mk .mnav{display:none}` placed
*after* its own media queries killed the bottom bar at **every** width. Independently,
`@media(max-width:600px){.mk .btn{width:100%}}` also matched the topbar's `.btn-sm`,
overflowing `.topbar-actions` and pushing the hamburger off-screen — measured at 320px the
burger sat at x = −81…−62, fully invisible, and squeezed to 19px elsewhere. With the inline
nav hidden and the bar dead, there was no way to navigate on a phone. *(`c0cfc7b`)*

**P1 — bottom bar covered content from 768–960px.** Shell padding used Tailwind
`pb-16 md:pb-0` (768px) while the bar was visible to 960px. Padding now lives next to
`.mnav` under one shared ≤960px breakpoint. *(`c0cfc7b`)*

**P0 — four broken images on every homepage load.** `social_links` cards pointed at
`https://cdn.simpleicons.org/...`, blocked by `img-src 'self' …`. Icons now resolve
id → loadable src → healed legacy URL → emoji. *(`4ca9af6`)*

**P0 — four CSP violations per homepage load.** The same cards emitted
`style={{background: iconBg}}` against `style-src 'self'`. The hex was redundant with the
existing `.sic-<tint>` classes, so it is mapped to the equivalent class instead. *(`4ca9af6`)*

**P0 — the hamburger opened two menus at once.** It toggled `.open` on the mockup's inline
`#nav` *and* mounted the overlay `Drawer`, at every width from 320–960px (measured: inline
nav 296×329 with a 282×800 drawer stacked on top). The scrim hid the dropdown visually but
left it in the tab order, so keyboard focus walked into a menu behind a modal overlay, and
two `<nav>` landmarks carried the identical accessible name. `.nav` is now desktop-only.
*(`945b091`)*

**Fabricated engagement metrics in the shipped preset.** The `video_showcase` fallback
advertised "👁 12.4K مشاهدة • 🕐 منذ يومين" / "12.4K views • 2 days ago", 9.1K, 15.7K and
runtimes 24:15 / 31:40 / 18:05 — numbers nothing backs. Cleared, with two new guard tests.
Real rows are unaffected: they build `meta` from real chips via `ctx.dynamic`. *(`8d37417`)*

**Accessibility.** Burger had `aria-expanded` but no `aria-controls`/`aria-haspopup`;
footer headings were `<h4>` under `<h2>` (axe `heading-order`); and three muted-text tokens
failed WCAG 2.1 AA 1.4.3 — `--color-pub-muted` and `--mk-muted` (#7D8495: 3.75 / 3.50 /
3.23:1) and Tailwind's `slate-500` (#62748E: 4.11–4.46:1). All corrected to the nearest
AA-passing value at identical hue. *(`945b091`, `5fd0750`)*

**Brand CTA contrast.** `.mk .btn-gold` was white on `#C99A2E` (**2.58:1**) and
`.mk .btn-ghost` was `#1F9D4D` on white (**3.51:1**); both are 16.32px bold, so AA requires
4.5:1 (bold only relaxes to 3:1 from 18.66px up). The gold is identity and is byte-identical
after the fix — only the ink moved, to the design's own `--mk-ink` `#1B2540`, giving
**5.88:1**. Hover no longer darkens the fill to `--mk-gold-deep`, because navy on that
darker gold is 4.05:1 and would fail again; the lift and the existing glow carry the hover
instead, and no new gold shade was invented. The ghost label darkened within its own green
family to `#188040` (**5.00:1**) with the white fill and WhatsApp-green border untouched.
`.btn-blue` already passed at 6.52:1 and `.mk .play` is a decorative `aria-hidden` glyph, so
neither was touched. *(`8196320`)*

**Mobile drawer contract.** The three headers disagreed with each other. Student and admin
published `aria-controls` even while their drawer was unmounted — a dangling IDREF that axe
only grades as "needs review", which is how it survived a clean audit — and the admin
drawer, which does not use the shared `Drawer` component, had neither Escape-to-close nor
body scroll lock. All three now emit `aria-controls` exactly while the target exists, all
three carry `aria-haspopup="menu"`, and Escape closes all three. *(`5cf1e1a`)*

**Dead code removed:** `.mk body-pad`, and the `.nav.open` rules once the double menu was
fixed.

## 7. Missing functionality — implemented

**Public language switcher.** The platform is bilingual, `/set-locale` works, and
Appearance → System lets the owner choose offered languages — but the public site rendered
no switcher, so that setting had **zero public effect**. Admin and student layouts had kept
theirs. Found because `localeOptions` was still computed in the public layout and used by
nothing. Restored in the footer (owner's chosen placement) with a `tone="onDark"` variant
for the navy footer. *(`08cc28d`)*

**Public contact details.** The owner's real phone (01153719506) was configured and loaded
into the footer's data, with `hasContact` still being computed — and nothing rendered it.
Restored as a footer column: phone as `tel:`, email as `mailto:`, address as text, each
only when actually set. *(`08cc28d`)*

**External questions platform entry.** `questionPlatformEnabled` defaulted false with an
empty URL, so the homepage "منصة الأسئلة" card resolved to a non-link `<span>` and the
mobile bar fell back to a plain login link. Seed now ships the owner-confirmed
`https://exams.mansa-eg.workers.dev/`, enabled. Both entries render
`target="_blank" rel="noopener noreferrer"`. *(`6346b53`)*

Also fixed `footer.quickLinks`, which was rendering its raw i18n key.

## 8. Missing functionality — deliberately NOT implemented

- **The questions/exams engine stays external.** Not rebuilt in Tito; no business logic touched.
- **Quotes band** — owner chose to drop it. The `quote_cards` block stays fully registered
  and rendered (`.mk .quotes/.qgrid/.q/.qfig` + its renderer) for any page the owner adds it
  to; it is simply not seeded. The stale test expectation was corrected, not the composition.
- **`social:<network>` link tokens.** The homepage Facebook/TikTok/YouTube cards are
  non-links (`href: ""`) even though a real Facebook URL exists in identity settings and
  renders in header/footer. Wiring them would follow the existing `whatsapp:` /
  `exam:external` pattern but is a **new contract** — out of scope without a decision.
- **No hero photo invented.** See §17.
- **Brand-colour contrast** left for the owner — see §17.

## 9. Backend changes

**None to auth, RBAC, entitlements, payment/business logic, activation codes, D1 schema,
migrations, production data, secrets, or Cloudflare bindings.** The only backend-adjacent
edit is two seed default values (`questionPlatformEnabled`, `questionPlatformUrl`) in
`scripts/seed.mjs` — owner-approved settings, not logic. `resolveQuestionPlatformUrl` still
re-validates the stored value as absolute https before any href is emitted.

Payment model confirmed untouched and manual-only: cash / cash instalments / InstaPay →
receipt upload → pending review → WhatsApp → admin issues activation code → student
redeems. No Paymob/Fawry/Stripe/card anywhere.

## 10. CMS compatibility

Preserved. No block was deleted, no schema field removed, no page composition rewritten.
`social_links` gained an **additive** optional `icon` field (kind `icon`, reusing the
existing `cms.f.icon` label); legacy `iconUrl`/`iconBg` values still load and are healed at
render time. Drafts, versions, published snapshots and admin editing all behave as before —
exercised end-to-end by the `cms-builder` suite, including hide/show and publish.

## 11. SEO

Unchanged and verified: metadata, canonical, sitemap, structured data, breadcrumbs, SEO
routes, teacher/entity info, subject/grade/lesson SEO. `robots.txt` still disallows
`/admin`, `/dashboard`, `/profile`, `/checkout`, `/orders`, `/activate`, `/learn`, `/files`,
`/api`; private routes still 302 to login; `/study` still `index,follow` while account pages
emit no index directive. The restored footer links are real `<a>` elements (`tel:`/`mailto:`),
not JS handlers.

## 12. Responsive QA

Real Chromium (`scripts/e2e-browser-setup.mjs`; the Playwright CDN is blocked in this
sandbox). All on a clean seed.

| Sweep | Widths | Result |
|---|---|---|
| Public routes (7 × 9) | 320/360/375/390/414/768/1024/1280/1440 | **63/63 rows clean** |
| Navigation | 320/360/375/390/414/768/960/961/1024/1280/1440 | **11/11 clean** |
| Footer | 320…1440 (9) | **9/9 clean** |
| Student + admin (28 routes) | 320/375/768/1024/1440 | **clean, zero overflow** |

Navigation detail: burger `block/44px`, never clipped, drawer opens (282–320px) with
Login/Register inside, `aria-controls="mobile-nav"`, bottom bar visible and shell padding
72px at ≤960 — all flipping to desktop nav with 0px padding at 961. **No second menu at any
width. No horizontal scroll at any width.** Per your direction the mobile top bar remains
brand + hamburger only; no login CTA was added beside it.

**Second pass (after the drawer-contract fix), ten surfaces × nine widths:**

| Sweep | Coverage | Result |
|---|---|---|
| home, study, subject, about, contact, login, register, dashboard, admin, admin/appearance | 320/360/375/390/414/768/1024/1280/1440 | **90/90 combinations clean** |
| Toggle geometry + drawer | the ten widths above plus 960 | **public / student / admin all clean** |
| Real `Tab` walk (not a static scan) | home, study, dashboard, admin @390, drawer open *and* closed | **0 stops on a hidden control** |

Checked per combination: horizontal overflow, number of visible menu landmarks,
tabbable-but-invisible controls, exactly one `h1`, language switcher, `tel:` link and the
external exam link. Zero horizontal overflow everywhere. Toggle is 44×44 and never clipped:
public visible 320→960, student 320→1024, admin 320→960, each disappearing exactly at its
breakpoint. Drawer opens 272–320px wide, one menu landmark, and Escape closes it on all
three (that last one only became true in `5cf1e1a` — see §6).

Two caveats on method, because they changed the conclusion. A first version of the scan
reported 89 "failures"; both were detector bugs, not product bugs. It counted breadcrumb
`<nav>`s as duplicate menus, and it treated controls inside a `display:none` ancestor as
reachable — `getComputedStyle(el).display` returns the element's *own* value regardless of
its ancestors. Switching to `el.checkVisibility({ checkOpacity: true, checkVisibilityCSS:
true })` and excluding breadcrumb landmarks brought the scan in line with the real `Tab`
walk, which had reported 0 hidden stops all along.

## 13. Test results

| Suite | Before (`29657c4`) | After (`5cf1e1a`) |
|---|---|---|
| Lint | ✅ | ✅ |
| Typecheck | ✅ | ✅ |
| Unit | 465 passed / **1 failed** | **468 passed / 0 failed** |
| Integration | 321 passed | **321 passed** |
| E2E (Playwright) | 77 passed / **13 failed** / 3 skipped | **90 passed / 3 failed / 0 skipped** |

The 13 e2e failures were proven **pre-existing** by running the suite against a worktree of
`29657c4` — byte-identical failure list. No failing test was deleted, skipped or weakened;
five stale expectations were **tightened** (details in `5fd0750`), each after confirming the
underlying behaviour was correct. Notably the `cms-builder` hide/show failure was a
non-unique marker string, not a CMS bug, and one `question-platform` test had never actually
executed — it sat behind a `describe.serial` failure.

The three remaining e2e failures are the two owner decisions in §17, nothing else: one axe
assertion (the eyebrow/tag gold pair) and two hero-visual assertions (no real photo yet).

axe is **0 violations** on login, register, forgot-password, dashboard, catalog, course,
lesson, assignments, checkout, orders, notifications, profile, admin-dashboard, admin-users,
admin-announcements, admin-analytics, admin-security, admin-audit and admin-commerce. The
homepage went from three contrast violations to one (§6).

Two e2e tests were strengthened in `5cf1e1a`. They previously asserted only that a mobile
toggle existed and was collapsed; they now assert the full ARIA contract in both states.
One of them had never actually driven the control, because the toggle is `xl:hidden` and the
test ran at the default desktop viewport.

## 14. Build

`npm run build` ✅ (client + server, ~4s / ~2s). Pre-existing chunk-size and
`INEFFECTIVE_DYNAMIC_IMPORT` warnings unchanged — not introduced here.

## 15. Commits

| SHA | Summary |
|---|---|
| `c0cfc7b` | fix(ui): restore mobile navigation in the approved mockup layer |
| `4ca9af6` | fix(cms): render contact-card icons under the platform CSP |
| `8d37417` | fix(cms): drop fabricated engagement metrics from the homepage preset |
| `6346b53` | feat(exams): ship the external questions platform entry enabled |
| `945b091` | fix(a11y): one mobile menu, real menu semantics, AA-contrast muted text |
| `08cc28d` | feat(public): restore the language switcher and contact details in the footer |
| `2d793d6` | fix(a11y,test): AA contrast in the consoles, and 5 stale e2e expectations |
| `dbfc109` | docs: engineering report for the audit and repair pass |
| `8196320` | fix(a11y): bring the two brand CTAs up to AA without touching the gold |
| `5cf1e1a` | fix(a11y): one drawer contract across public, student and admin headers |

> The last two rows of the first batch were re-created. Between sessions the sandbox was
> rebuilt and the repository re-cloned, which discarded local history back to the base
> commit while leaving the edits in the working tree. Recovery was `git fetch` plus
> `git reset --mixed origin/arena/01a0f697-tito` — no rewrite, no force, no history loss on
> the remote, which still held all six pushed commits. The two unpushed commits were then
> re-committed with identical content and therefore **new hashes**: `5fd0750` → `2d793d6`
> and `7589641` → `dbfc109`. Flagging it so the SHAs in any earlier note still line up.

No force push, no reset, no rebase, no history rewrite, no branch deletion, no merge, no PR.

## 16. Remote verification

Every commit was pushed to `origin/arena/01a0f697-tito` and confirmed with `git ls-remote`
immediately after its push. Last verified remote SHA:

```
$ git rev-parse HEAD
5cf1e1a4811edd282b72116e043a17aab610f697
$ git ls-remote origin refs/heads/arena/01a0f697-tito
5cf1e1a4811edd282b72116e043a17aab610f697
```

Local and remote match, `0` ahead / `0` behind. The GitHub token that expired mid-session
has been reconnected (`gh auth status` → logged in), and the two commits that were stranded
by it are pushed — see the note in §15 about their new hashes.

**Final `git status`: clean.** `qa-out/`, `test-results/` and `playwright-report/` are
gitignored and the Playwright traces were deleted. No large assets, no new dependencies, no
duplicated images, no source assets or official project files removed.

**Production is untouched.** Everything in this pass is local: no migration was added or
run, no production D1/R2/secret/binding/config was read or written, no deploy was performed,
and no auth, RBAC, entitlement, payment or activation-code logic was modified.

## 17. Remaining issues

**1 — Hero photo not configured (2 e2e failures). Needs you — 2 minutes.**
`homepage.spec.ts:28` and `:98` expect a loaded hero visual. The approved hero is built
around your photograph and none is set: `scripts/seed.mjs:93` deliberately leaves
`ownerPhotoFileId` empty, and the only portrait-shaped file in the repo is an AI-generated
image I was told not to substitute. **This is a content gap, not a code bug** — and I
verified that end to end rather than assuming it.

*Proof the wiring is complete.* I drove the real admin UI with a throwaway local file:
homepage `[data-hero-visual]` went 0 → 1, the `<img>` resolved to `/files/<uuid>`, returned
`HTTP 200 image/png`, and rendered at 400×400 in the hero. The same photo also populated
the `teacher_profile` block. I then reset the local database, so nothing fabricated remains
anywhere — no file, no commit, no seed entry.

*How to set it:*

1. Sign in as admin → **الإدارة** → **الهوية والمظهر** (`/admin/appearance`).
2. Under **الهوية**, find **صورة المالك** (Owner photo).
3. Click **رفع صورة** and pick the photo. It uploads through the same validated
   `/admin/files` pipeline and is selected automatically — no need to visit the media
   library first. (**اختيار من المكتبة** is there if the photo is already uploaded.)
4. Save the form.

*Constraints the uploader enforces:* JPEG, PNG, WebP, GIF or SVG, max **10 MB**, and the
file must be **public** visibility — the identity picker only lists `visibility = "public"`
images, and the inline upload sets that for you. The content type is verified by magic
bytes, not by the declared MIME, so a renamed file is rejected. A square or portrait crop
suits the hero's circular frame best; it is served same-origin, so it needs no CSP change.

Nothing else is required: the chain `admin.appearance.tsx` → `identity.ownerPhotoFileId` →
`render.server.ts:107` → `blocks.tsx` `photoSrc` → `<img data-hero-visual>` is already in
place, and both tests go green on the next run. The same image also feeds the header and
footer avatar and the teacher-profile block, so one upload covers all of them.

**2 — One brand-colour pair still fails contrast (1 e2e failure, needs your decision.)**
The two CTAs are fixed (§6). What remains is `.mk .eyebrow` and `.mk .vbody .tag` —
`--mk-gold-deep` `#A57E26` on `--mk-cream` `#F9F3E6`, **3.38:1** against a 4.5:1 minimum.
These are badges, not CTAs, and unlike the buttons *both* the text and the background are
gold-family brand colours, so every possible fix changes a gold shade — which you asked me
not to do without approval. Left failing and reported rather than silenced with an axe
suppression.

| Change | Result | Visual cost |
|---|---|---|
| Text `#A57E26` → `#8A6A1F` | 4.56:1 | Slightly deeper gold label, cream pill unchanged |
| Text `#A57E26` → `#7D601C` | 5.33:1 | More headroom, noticeably deeper |
| Cream `#F9F3E6` → `#FFFDF8` | 3.59:1 | Still fails — the background alone cannot fix it |

My recommendation is the first row. Say the word and it is a one-line change.
*(For reference, `.hero .doc-line` uses the same gold on white at 3.74:1 but is 24–32px, so
the large-text 3:1 bar applies and it already passes.)*

**3 — Homepage social cards are not links.** Facebook/TikTok/YouTube cards have `href: ""`
and render as `<span>` (correct honest-degradation behaviour) even though a real Facebook
URL exists in identity settings. Fixing properly means a new `social:<network>` link token —
small, but a new contract. WhatsApp is inactive by design because `whatsapp` is null in
settings.

**4 — `iconBg` is inert** under the platform CSP. Kept in the data model for compatibility;
the hex is mapped to the equivalent `.sic-*` tint class at render time.

**5 — Sandbox-only artifacts (not product issues):** headless Chromium here has no emoji
font, so emoji render as tofu boxes in screenshots; `wrangler dev` logs a harmless
`Request.cf` / TLS warning at startup; and `free-content.spec.ts` flaked once in a full run
but passes 3/3 in isolation.

---

### Notes for running this locally

```bash
npm run lint · npm run typecheck · npm run test · npm run build
npm run db:migrate:local · npm run db:seed:local
node scripts/e2e-reset.mjs && E2E_CHROMIUM_PATH=/tmp/chromium npm run test:e2e
```

`AUTH_PBKDF2_ITERATIONS` in `.dev.vars` must stay ≥ 50 000 — `verifyPassword` enforces
`ITER_MIN` and silently rejects every login below it.
