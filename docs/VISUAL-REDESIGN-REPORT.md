# Visual Redesign Report — Dr. Mostafa Tito Platform
**Branch:** `arena/01a082d4-tito` · **HEAD:** `90b8c70` · **Date:** 2026-09-09
**Scope:** full visual transformation (homepage + all surfaces) · **Approach:** visual layer only — no business-logic, auth, payment, progress, assessment, or CMS-model changes.

---

## 1. Design direction — «المجلس» (The Majlis)

A premium **editorial-academic** identity for a philosophy & psychology educator: quiet prestige, ink-on-paper, brass accents — the opposite of generic SaaS/AI aesthetics. Approved direction: `majlis` · Arabic display font: `El Messiri` · scope: `full`.

**Explicitly removed:** violet/indigo gradients, glassmorphism, pill nav, card-grid-everything, template hero sections, blue links, emoji bullets.

## 2. References that shaped the system

| # | Source | Takeaway applied |
|---|--------|------------------|
| 1 | School of Life (theschooloflife.com) | Typographic hero, narrow measure, whitespace dividers; Sage archetype |
| 2 | Stripe Press / Tiempos-era editorial | Hairline rules, small caps kickers, near-black on paper |
| 3 | Bowdoin / Amherst / Carleton sites | Quiet institutional prestige, sparse color, real photography |
| 4 | Aesop / Apple retail analyses | Whitespace as luxury signal; 2–3 colors max |
| 5 | Sage-archetype brand research | Deep green + gold = educator trust palette |
| 6 | Arabic typography research | El Messiri (modern display), Amiri (scholarly Naskh), Cairo (UI), Reem Kufi (headings-only) — all OFL, self-hosted |
| 7 | RTL guides (arabic layouts) | Logical properties, logo at inline-start, flip only directional icons, 44px targets, Arabic +20–30% length |

## 3. Palette (final, verified from `/theme.css` + `@theme`)

| Token | Hex | Role |
|---|---|---|
| `brand-950` `#04221e` | Deep pine | Header band, footer, seal, admin sidebar |
| `brand-800` `#0f2d2a` / `brand-700` `#143c38` | Pine | Headings on tint, primary buttons, links |
| `brand-500` `#0e6b5e` → `brand-50` `#e7f0ef` | Pine scale | Progress, fills, tints |
| `accent-500` `#b78a1c` / `accent-700` `#8b6915` / `accent-800` `#715611` | Brass/gold | Hairlines, kickers, seals, active-nav underlines |
| `paper` `#f6f1e7` / `parchment` `#fffdf8` | Warm paper | Page bg / raised surfaces |
| `ink` `#211b14` / `ink-soft` `#4a4238` / `ink-muted` `#6f6455` | Warm ink | Body / secondary / meta |
| `line` `#e3daca` / `sand-100…400` | Hairlines, wells | Dividers, zebra, chips |
| `success` `#047857` / `error` `#b91c1c` / `warning` `#b45309` | States | Unchanged semantics |

**Contrast (WCAG AA, computed on final hex):** body 15.2 · secondary 8.8 · muted 5.1 · links 10.8 · brass text 6.1 · kicker 5.0 · primary button 11.9 · seal 16.5 — **all ≥ 4.5, no failures.**

## 4. Type system

| Role | Arabic-first stack | Latin-first stack |
|---|---|---|
| Display (`font-display`) | El Messiri → Fraunces Variable → Georgia → serif | Fraunces Variable → El Messiri → Georgia → serif |
| Body/UI | Cairo/system (existing) | system (existing) |

- 24 self-hosted `.woff2` files emitted as separate assets; **zero `data:`-URI fonts** (CSP-clean).
- Editorial rhythm: `tito-kicker` (brass, letterspaced) → display headline → brass rule → 65ch measures (`max-w-prose`), drop caps + pull quotes in lesson reading room.
- Radii: `--radius-btn: 10px`, `--radius-card: 16px` (owner-editable in Appearance).

## 5. What changed (112 files, +2330/−1692)

| Commit | Content |
|---|---|
| `e191156` | Foundation: official naming «د. مصطفى تيتو»/Dr. Mostafa Tito, majlis tokens, fonts + design-system CSS |
| `38b9c09` | Brand seal (م/T medallion) + editorial header (pine band + brass hairline) / footer chrome |
| `1b46f7f` | CMS blocks → editorial composition (hero, sections, quotes, CTAs) |
| `32346c7` | Shared UI components in majlis language |
| `0620cd1` | Automated route migration to majlis tokens |
| `7581f71` | Course surfaces: catalog, detail, units, lesson reading-room, programs, product; blue links eliminated repo-wide |
| `22c864e` | `AuthShell` (seal + brass rule + display titles on all 4 auth routes), dashboard, student surfaces, exam-attempt controls |
| `8d65936` | Admin chrome seal; **fixed pre-existing bug:** mobile topbar brand was white-on-light (invisible) |
| `6ca0411` | Root title fallback branded (404/error default) |
| `90b8c70` | Fixed broken `*-soft0` classes from automated migration (transparent WhatsApp CTA, analytics bars, attempt markers) + RTL `file:me-3` |

**Untouched:** `server/` business logic (1-line locale comment n/a), auth/payments/progress/assessment flows, CMS data model, all owner controls (Appearance, CMS, menus, settings, videos, forms, blocks stay fully dynamic).

## 6. Verification

| Check | Result |
|---|---|
| `typecheck` | ✅ exit 0 |
| `lint:imports` | ✅ module boundaries clean |
| Unit tests | ✅ 24 files / 258 tests pass |
| Integration tests | ✅ 23 files / 306 tests pass |
| `npm run build` | ✅ clean (pre-existing chunk warnings only) |
| HTTP smoke (live `wrangler dev` + seeded D1) | ✅ 12 public + 4 student + 9 admin pages: exactly 1 `<main>`, 1 `<h1>`, 0 inline `style=`, 0 `gradient`, branded `<title>` |
| Auth flows | ✅ student login → dashboard; admin reset (dev token) → login → /admin |
| CMS compatibility | ✅ homepage/CMS pages render owner content in new composition; Appearance/brand controls untouched |
| RTL | ✅ `lang/dir` correct ar+en; logical properties + `ltr:/rtl:` variants; directional arrows `rtl:rotate-180`; no stray physical props |
| Mobile | ✅ viewport/safe-area meta, 44px targets, responsive grids; ⚠️ no screenshot device (see §7) |
| Browser rendering | ⚠️ sandbox network blocks browser download — verified via DOM/CSS/contrast analysis + LIVE PREVIEW for human review |
| Residue scan | ✅ 0 `bg-gradient`, 0 blue links, 0 `soft0`, 0 emerald/violet/indigo classes |

## 7. Known limits / follow-ups

1. **Visual screenshots:** no headless browser available in this sandbox (npm registry is the only reachable host; Debian mirrors + browser CDNs blocked). Human visual pass via the LIVE PREVIEW on this branch is recommended before merge.
2. E2E browser suite must run in CI (needs Playwright browsers).
3. Social buttons keep brand colors (WhatsApp `success`, Telegram sky) — intentional recognition, not residue.
4. Owner can still restyle everything via Appearance → theme (tokens are CSS vars; `radius-btn/card`, palette all live).

---

*Report generated from branch `arena/01a082d4-tito` @ `90b8c70`. All file changes are visual-layer only; no functionality was added, removed, or altered.*
