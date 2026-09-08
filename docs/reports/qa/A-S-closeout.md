# A–S final local smoke closeout — 2026-09-06

**Environment:** wrangler local `:5173` + local D1 (migrations through `0008_cms_customization.sql`) + seed.  
**Browser:** Playwright Chromium 153 via `playwright.qa.config.ts` (not vendored e2e Chromium 92).  
**Suite:** `npx playwright test --config=playwright.qa.config.ts` → **19 passed / 1.3m**.  
**Verify:** `lint:imports` clean, `typecheck` OK, unit **146**, integration **203**, `npm run build` OK.  
**`git diff --check`:** no whitespace errors.  
**SHA:** `4ddfb92a3f2027f7bceab6cb0018ceea8c3f4d74` (dirty local working tree; not pushed).  
**Not done (forbidden):** push, PR, merge, production deploy.

Language switcher was Chromium-click proven (POST `/set-locale`, full-document `lang`/`dir`, reload persistence) and did not regress.

---

## Local DEV credentials (this closeout)

| Field | Value |
|---|---|
| **LOCAL ADMIN EMAIL** | `admin@educore.local` |
| **PASSWORD** | `E2e-Admin-2026!` |
| **PASSWORD TYPE** | **fixed** — `scripts/e2e-reset.mjs` overwrites the super-admin hash after seed so Playwright can log in. Not generated, not environment-supplied at runtime. |
| **LOGIN RESULT** | **PASS.** UI login → `/admin`. `/admin/security` &lt;400. GET `/logout` → **405**. POST logout via the admin form → `/login`. Subsequent `/admin` redirects to login. |

`admin@educore.local` is a **DEV-only** identity (`ENVIRONMENT=development` / `ADMIN_BOOTSTRAP_EMAIL`). It is not a production identity. Production admin email must come from `ADMIN_BOOTSTRAP_EMAIL` / environment. Seed never prints a production password.

How to obtain/reset locally: `node scripts/e2e-reset.mjs` (forces the known DEV password above). Production: `scripts/bootstrap-admin.mjs` — password is shown once to the operator, then change under Profile → Security. Do not invent one.

---

## A. Desktop Arabic RTL (1440×900)

**PASS.** Fresh visitor with `Accept-Language: en-US` still gets `html lang=ar dir=rtl`.  
No user-facing “EduCore”. Copy includes الفلسفة / علم النفس / مصطفى تيتو. Hero visual attached and decoded. Horizontal overflow ≤2px.  
Screenshots: `01-desktop-ar-rtl.png`, `smoke-1440-ar.png`, `lang-click-01-ar.png`.

## B. Desktop English LTR (1440×900)

**PASS.** Clicking the real switcher POSTs `/set-locale`, sets `edu_locale=en` (HttpOnly, no `Secure` on localhost), full document `lang=en dir=ltr`. H1 “Welcome to your platform!”. Philosophy / Dr mostafa tito. Overflow ≤2px.  
Screenshots: `02-desktop-en-ltr.png`, `smoke-1440-en.png`, `smoke-desktop-en.png`, `lang-click-02-en.png`.

## C. Mobile Arabic RTL (390×844)

**PASS.** `lang=ar dir=rtl`. Sticky header menu (`aria-controls=mobile-nav`) opens `nav#mobile-nav`. Switcher is in the sticky header, not inside `#mobile-nav`. Register CTA at 390 is the mobile-nav / hero path (`hidden sm:inline-flex` on the header register link is intentional).  
Screenshots: `03-mobile-ar-rtl.png`, `03b-mobile-ar-nav-open.png`, `smoke-390-ar.png`.

## D. Mobile English LTR (390×844)

**PASS.** Real switcher click → `lang=en dir=ltr`.  
Screenshots: `04-mobile-en-ltr.png`, `smoke-mobile-en.png`, `lang-click-04-mobile-en.png`.

## E. Language: explicit choice beats Accept-Language

**PASS (root cause, not a test-only patch).** Clicked the real UI in Chromium.

| Check | Result |
|---|---|
| Fresh context, `Accept-Language=en-US` | Arabic RTL |
| Click English | POST `/set-locale`, 302, `edu_locale=en`; visible English copy |
| Reload | Stays English |
| Click عربي | Restores `lang=ar dir=rtl` |
| Reload | Stays Arabic |
| Repeat at 390×844 | Same |
| Cookie | HttpOnly, `Path=/`, `Max-Age=31536000`, `SameSite=Lax`, **no Secure** on localhost |

## F. Performance (homepage)

See `performance.json` (this run: wall **561 ms**, HTML TTFB **~221 ms**, **25** requests, **0** duplicate URLs).

Chunked wrangler responses omit `Content-Length` for HTML/CSS/JS (bytes recorded as 0 in Playwright).

- Hero WebP `/files/…` **35.7 kB**
- Fonts this capture: **Cairo** self-hosted (`/fonts/cairo/*.woff2`, 8 files, **~116 kB**). Seed default is Cairo for heading + body; IBM Plex remains the fallback stack and is not the selected heading after seed.
- No duplicate asset URLs. Hero is a real CMS file.

## G. Admin appearance

**PASS** (one login; 1-device policy — sessions/devices cleared between admin tests).

- Platform name: د/ مصطفى تيتو / Dr mostafa tito; tagline الفلسفة وعلم النفس
- Logo + hero image selected from uploaded files; header image visible on `/`
- Data-driven YouTube social shown in footer when enabled (QA URL was then wiped by e2e-reset)
- Theme primary `#0f766e`; heading font switched to IBM then **reverted to Cairo** so IBM is not left as a QA override
- `/theme.css` after revert: `--font-heading:"Cairo"`
- Admin font controls work (poll `/theme.css` after save — do not trust a leftover “Saved” toast)

No invented credentials, student counts, or physics branding on the public site.

## H. Admin CMS builder (FAQ)

**PASS.** Add section, duplicate, delete, hide/show, reorder, heading edit, add `rich_text`, toolbar (bold / italic / underline / link / align / token color `rt-c-brand`), save settings, publish, preview link `/admin/cms/preview/…`, restore version.

Rich text is the sanitized allowlist editor (no arbitrary HTML/CSS/JS). Closed `<details>` hid fields; tests open the visible summary before Save.

## I. Templates (independent snapshot)

**PASS.**

1. Apply built-in `starter-simple` to FAQ (confirm checkbox).
2. Stamp section heading **QA-TEMPLATE-A**, publish.
3. Save page as template “QA Snapshot”.
4. Apply that snapshot to Contact, publish → `/p/contact` contains **QA-TEMPLATE-A**.
5. Edit FAQ heading to **QA-TEMPLATE-B**, publish.
6. `/p/faq` contains **QA-TEMPLATE-B**; `/p/contact` still **QA-TEMPLATE-A**, not B.

Applying a template copies an independent draft snapshot; later source edits do not mutate already-applied pages. All QA stamps were then removed by the final `e2e-reset`.

## J. Tablet (768×1024)

**PASS.** AR RTL + EN LTR. Overflow ≤2px. Screenshots: `05-tablet-ar-rtl.png`, `06-tablet-en-ltr.png`, `smoke-768-ar.png`.

## K. Public copy classification

**PASS.** See `copy-classification.json`.

| Surface | Source |
|---|---|
| Homepage hero / trust / features | CMS published snapshot |
| Header nav | CMS menus |
| Platform name / tagline | `settings.platform` |
| Footer phone / socials | identity settings (data-driven; no icon if URL unset) |
| Login / register / switcher labels | i18n locales |
| Physics catalog rows | demo/fixture LMS seed — **not** site identity |

## L. Axe, invalid login, files, RTE, logout

| Item | Result |
|---|---|
| axe homepage AR | **0** violations (`axe-home-ar.json`) |
| axe homepage EN | **0** violations (`axe-home-en.json`) |
| Invalid login | Stays `/login`; uniform incorrect-credentials copy (no user enumeration). `07-invalid-login.png` |
| Files admin | Upload 1×1 PNG + AR/EN alt, replace, unused-usage list, delete unused. Seeded `hero-philosophy.webp` was **not** deleted |
| RTE toolbar | B / I / U / Link / token color clicked; formatted HTML saved |
| Logout | POST `/logout` only (GET is 405). Device slot persists (ADR-005) |

## M. Session / Profile-Security / protected admin

**PASS.** After UI login: dashboard `/admin` 200. `/admin/security` &lt;400 (security-events / Profile→Security surface). GET `/logout` rejected (405, POST-only). After UI logout, `/admin` is blocked (redirect to `/login`).

## N. Fonts (Cairo default)

**PASS after a local wiring fix.** Seed `/theme.css` emits `--font-heading:"Cairo"` and `--font-body:"Cairo"` (IBM may appear only as fallback in the stack). Self-hosted files at `/fonts/cairo/*.woff2` return 200. Performance capture loaded Cairo, not IBM, as the active family. Admin heading/body selects work; QA does not leave IBM as an override after revert + e2e-reset. English remains readable (latin Cairo subset).

## O. Homepage overflow / three viewports

**PASS after a local clip fix.** 1440×900, 768×1024, 390×844, AR then EN: `documentElement.scrollWidth − clientWidth ≤ 2`. RTL header cluster + hamburger box + hero blur orbs previously produced **11px** overflow at 1440; public chrome root now has `overflow-x-hidden` (no redesign).

## P. Media library

**PASS.** Public upload, bilingual alt, in-place replace (same id), usage “unused”, delete unused. Seeded homepage hero was not deleted.

## Q. Production vs demo/fixture

| Kind | What | Action |
|---|---|---|
| **Production identity** | د/ مصطفى تيتو / Dr mostafa tito; philosophy + psychology; Arabic-first; seeded Cairo theme; CMS homepage | keep |
| **Demo / fixture** | physics catalog (`physics-3s-full`, `electrostatics-check`); `*.educore.local` users; mock video; demo PDF | classify, do **not** delete schema |

## R. Post-reset leftover check

**PASS.** Final `node scripts/e2e-reset.mjs` after the 19-test suite. Live `/`, `/p/faq`, `/p/contact` contain **none** of: `QA-TEMPLATE-A/B`, `QA Snapshot`, `qa-not-a-claim`, `qa-pixel`, temp names/assets/theme. `/theme.css` heading is Cairo. No user-facing EduCore.

## S. Summary

**NO PRODUCT BUGS FOUND** remaining after the two local-only fixes below.

---

## Fixes landed this closeout (no redesign)

- Public layout: `overflow-x-hidden` on the chrome root — clips the 11px RTL overflow at 1440 without changing header/hero structure.
- Cairo `@font-face` in `app/app.css` for the already-present `/fonts/cairo` woff2 files (docs/ADMIN-CUSTOMIZATION §5). Heading/body tokens named Cairo but the faces were never loaded; IBM was the only webfont.
- QA specs: `tests/qa/final-smoke.spec.ts` (login, locale click, 3 viewports, appearance/CMS/templates/files). Register assertion uses `visible=true` (header register is `hidden sm:inline-flex` at 390). Appearance revert polls `/theme.css` so a leftover “Saved” toast cannot race. Known cosmetic `font-src` + `data:font` console noise is filtered (same exception as `tests/e2e/csp.spec.ts`).

## Known local-only notes (not product bugs)

- Vite inlines tiny IBM latin-ext subsets as `data:` URLs; CSP `font-src 'self'` blocks that fallback. Real fonts load from `/assets/…woff2` and `/fonts/cairo/…woff2`. Documented in SECURITY.md §18 / `tests/e2e/csp.spec.ts`. CSP was **not** weakened.
- Wrangler can crash mid-suite (`ERR_CONNECTION_REFUSED` / workerd OOM). Restart `npm run dev` and re-run. Not an application bug.
- `admin@educore.local` is DEV-only. Never printed production secrets.

## How to re-run

```
node scripts/e2e-reset.mjs
npm run dev          # leave running
npx playwright test --config=playwright.qa.config.ts
# then e2e-reset again if the local DB must not keep QA template stamps
```
