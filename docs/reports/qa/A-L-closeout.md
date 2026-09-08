# A–L live QA closeout — 2026-09-06

**Environment:** wrangler local `:5173` + local D1 (migrations through `0008_cms_customization.sql`) + seed.  
**Browser:** Playwright Chromium 153.0.8010.12 (not the vendored e2e Chromium 92).  
**Suite:** `npx playwright test --config=playwright.qa.config.ts` → **14 passed / 50.8s**.  
**Verify:** `lint:imports` clean, `typecheck` OK, unit **146**, integration **203**, `npm run build` OK.  
**`git diff --check`:** no whitespace errors.  
**Not done (forbidden):** push, PR, merge, production deploy.

Language switcher was Chromium-click proven before this closeout and did not regress.

---

## A. Desktop Arabic RTL (1440×900)

**PASS.** Fresh visitor with `Accept-Language: en-US` still gets `html lang=ar dir=rtl`.  
No user-facing “EduCore”. Copy includes الفلسفة / علم النفس / مصطفى تيتو. Hero visual attached.  
Screenshot: `01-desktop-ar-rtl.png`, `lang-click-01-ar.png`.

## B. Desktop English LTR (1440×900)

**PASS.** Clicking the real switcher POSTs `/set-locale`, sets `edu_locale=en` (HttpOnly, no `Secure` on localhost), full document `lang=en dir=ltr`. Nav: Home / Courses / Exams / Resources / FAQ / Contact. H1 “Welcome to your platform!”.  
Screenshot: `02-desktop-en-ltr.png`, `lang-click-02-en.png`.

## C. Mobile Arabic RTL (390×844)

**PASS.** `lang=ar dir=rtl`. Sticky header menu (`aria-controls=mobile-nav`) opens `nav#mobile-nav`. Switcher is in the sticky header, not inside `#mobile-nav`.  
Screenshots: `03-mobile-ar-rtl.png`, `03b-mobile-ar-nav-open.png`.

## D. Mobile English LTR (390×844)

**PASS.** Switcher click → `lang=en dir=ltr`.  
Screenshot: `04-mobile-en-ltr.png`, `lang-click-04-mobile-en.png`.

## E. Language: explicit choice beats Accept-Language

**PASS (root cause, not a test-only patch).**

| Check | Result |
|---|---|
| Fresh context, `Accept-Language=en-US` | Arabic RTL |
| Click English | POST `/set-locale`, 302, `edu_locale=en`; visible English copy |
| Reload | Stays English |
| Click عربي | Restores `lang=ar dir=rtl` |
| Cookie | HttpOnly, `Path=/`, `Max-Age=31536000`, `SameSite=Lax`, **no Secure** on localhost |
| Layout | `<html lang dir>` from `useLoaderData()` (SSR) |

Layout no longer trusts a stale client locale over the loader. `LanguageSwitcher` uses `reloadDocument`.

## F. Performance (homepage)

See `performance.json` (this run: wall **511 ms**, HTML TTFB **~153 ms**, **25** requests, **0** duplicate URLs).

Chunked wrangler responses omit `Content-Length` for HTML/CSS/JS (bytes recorded as 0 in Playwright). Prior curl sizing:

- HTML `/` ~44.6 kB
- CSS `root-*.css` ~81 kB + `/theme.css` ~1.4 kB
- Hero WebP `/files/…` **35.7 kB**
- Fonts this capture: IBM Plex (heading font was switched during Admin QA; seed default is Cairo)

No duplicate asset URLs. Hero is a real CMS file, not a huge bitmap.

## G. Admin appearance

**PASS** (one login; 1-device policy — sessions/devices cleared between admin tests).

- Platform name: د/ مصطفى تيتو / Dr mostafa tito; tagline الفلسفة وعلم النفس
- Logo + hero image selected from uploaded files; header image visible on `/`
- Data-driven YouTube social (`https://youtube.com/@qa-not-a-claim`) shown in footer when enabled
- Theme primary `#0f766e`; heading font IBM Plex Sans Arabic; body Cairo
- `/theme.css` contains `IBM Plex Sans Arabic` and `0f766e`

No invented credentials, student counts, or physics branding.

## H. Admin CMS builder (FAQ)

**PASS.** Add section, add `rich_text`, toolbar + token color `rt-c-brand`, save settings, duplicate, delete, reorder, publish (`qa-publish`), preview link `/admin/cms/preview/…`, restore version.

Rich text is the sanitized allowlist editor (no arbitrary HTML/CSS/JS). Closed `<details>` hid fields; tests open the visible summary before Save.

## I. Templates (independent snapshot)

**PASS.**

1. Apply built-in `starter-simple` to FAQ (confirm checkbox).
2. Stamp section heading **QA-TEMPLATE-A**, publish.
3. Save page as template “QA Snapshot”.
4. Apply that snapshot to Contact, publish → `/p/contact` contains **QA-TEMPLATE-A**.
5. Edit FAQ heading to **QA-TEMPLATE-B**, publish.
6. `/p/faq` contains **QA-TEMPLATE-B**; `/p/contact` still **QA-TEMPLATE-A**, not B.

Applying a template copies an independent draft snapshot; later source edits do not mutate already-applied pages.

## J. Tablet (768×1024)

**PASS.** AR RTL + EN LTR. Screenshots: `05-tablet-ar-rtl.png`, `06-tablet-en-ltr.png`.

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

FAQ/contact public bodies after template QA show `QA-TEMPLATE-*` plus starter rich-text placeholders. Resources / courses / login remain CMS or i18n as classified. No EduCore in the public chrome.

## L. Axe, invalid login, files, RTE, logout

| Item | Result |
|---|---|
| axe homepage AR | **0** violations (`axe-home-ar.json`) |
| axe homepage EN | **0** violations (`axe-home-en.json`) |
| Invalid login | Stays `/login`; uniform incorrect-credentials copy (no user enumeration). `07-invalid-login.png` |
| Files admin | Upload 1×1 PNG + AR/EN alt, replace, unused-usage list, delete unused. Used-hero delete skipped (usage copy not asserted) |
| RTE toolbar | B / I / U / Link / token color clicked; formatted HTML saved |
| Logout | POST `/logout` only (GET is 405). Device slot persists (ADR-005) |

---

## Fixes landed this closeout (no redesign)

- Locale: SSR `lang`/`dir` from loader; localhost locale cookie without `Secure`; explicit POST `/set-locale` wins over Accept-Language.
- QA specs under `tests/qa/` with `playwright.qa.config.ts` (Chromium 153). Do not put these under `tests/e2e` (old Chromium).
- Template independence covered by closeout test 7. Heading stamp opens the section `<details>` summary (closed details made Playwright `fill`/`getByRole` hang).

## Known local-only notes

- Wrangler can crash mid-suite (`ERR_CONNECTION_REFUSED`); restart `npm run dev` and re-run. Not a product bug.
- FAQ/contact drafts were mutated by QA templates; re-seed (`node scripts/e2e-reset.mjs`) to restore demo CMS copy.
- `admin@educore.local` is DEV-only when `ENVIRONMENT=development`. Production admin email comes from `ADMIN_BOOTSTRAP_EMAIL`. Never printed.

## How to re-run

```
node scripts/e2e-reset.mjs
npm run dev          # leave running
npx playwright test --config=playwright.qa.config.ts
```
