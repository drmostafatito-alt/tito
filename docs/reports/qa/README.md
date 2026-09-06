# Live QA closeout — 2026-09-06

**A–L results:** [`A-L-closeout.md`](./A-L-closeout.md) — 14/14 Playwright QA tests passed (Chromium 153).

Captured against wrangler local + cold D1 (migrations 0000–0008 including `0008_cms_customization.sql`) + `npm run db:seed:local`. Playwright Chromium 153.

## Screenshots (seed homepage, before Admin mutations)

| File | Viewport |
|---|---|
| `01-desktop-ar-rtl.png` | 1440×900 Arabic RTL |
| `02-desktop-en-ltr.png` | 1440×900 English LTR |
| `03-mobile-ar-rtl.png` | 390×844 Arabic RTL |
| `03b-mobile-ar-nav-open.png` | 390×844 Arabic, mobile nav open |
| `04-mobile-en-ltr.png` | 390×844 English LTR |

## Performance

See `performance.json`. Chunked responses omit `Content-Length`; measured body sizes via curl:

- HTML `/` 44.6 kB (TTFB ~166 ms)
- CSS `/assets/root-*.css` 81.0 kB + `/theme.css` 1.4 kB
- JS `home-*.js` 1.4 kB, `entry.client` 186 kB, `blocks` 36.8 kB
- Hero WebP `/files/…` 35.7 kB
- 26 requests, **no duplicate URLs**

Font files in that capture were IBM Plex (headingFont switched during later Admin QA). Seed default is Cairo.

## How to re-run

```
node scripts/e2e-reset.mjs
npm run dev          # leave running
npm run test:qa
```
