# Phase 3 report — CMS / Page Builder (delivered 2026-09-05)

Phase 3 was redefined by the owner as "production-grade, admin-controlled UI/CMS/page builder" (old P3–P7 renumbered to P4–P8, ADR-018). Delivered in 10 controlled stages. Commits: `2bcc821` (stages 1–2, after `53b4b92`), `3cdaaad` (5–6), `01ba4f0` (7–8), `ee2c577` (docs), `ddf6cc9` (9–10). Baseline: Phase 2 @ `3014b97`.

## 1. What was implemented

**CMS core (stage 1)** — D1 schema `0002` (pages, page_versions, blocks, menus, menu_items, forms, form_fields, form_submissions, role_permissions) + `0003` (admin `cms.*` permission seed). Draft tree = `blocks` rows; publish = validate (zod) + sanitize (HTMLRewriter allowlist) + freeze into `pages.published_snapshot` + append immutable `page_versions` row. Public renders ONLY snapshots. Restore copies a version back into the draft (auto-snapshotting the current draft first — nothing destroyed). Block registry (`app/cms/registry.ts`, client-safe): **38 block types**, each with zod schema, defaults, field descriptors, group; adding types later = one registry entry + one renderer case (no migration/route change). `safeHref`, reserved slugs, SEO schema, icon-id registry (no raw SVG ever stored).

**Admin builder (stage 2)** — `/admin/cms` pages list (create/duplicate/archive/soft-delete/reorder/publish/unpublish/slug/SEO); `/admin/cms/pages/:id` builder (sections + blocks: add from grouped palette, edit generated settings forms, move up/down, hide/show, duplicate, delete; save-draft/publish; version list with restore); `/admin/cms/menus` (header/footer/student/legal, one nesting level, icon picker, safeHref-enforced); `/admin/cms/forms` (fields, 11 types, options, declarative validation, consent, success/failure messages, submissions view); `/admin/appearance` (identity/branding incl. owner name+photo, logo, favicon, socials, copyright; theme tokens; presentation toggles; dashboard modules; **System tab** — platform name/tagline/support/maintenance + super-admin-only video provider policy). All routes: `requireRole(3)` + granular `canCms` (`cms.read/create/edit/publish/delete/manage_theme/manage_navigation/manage_forms/manage_seo`); every mutation audited.

**Branding & homepage (stage 3)** — homepage = CMS page `home` (empty-first: clean empty state until published; no hard-coded marketing text anywhere). `/p/:slug` for other pages. `/theme.css` emits validated tokens as CSS variables; `/favicon.ico` serves the configured file or 204 (empty-first). Per-page SEO meta (title/description/canonical/OG/robots).

**Navigation/footer/forms (stage 4)** — public header/footer/student/legal nav rendered from menus; public form submission pipeline (`handleCmsFormAction`): server validation per field, consent, disabled-form refusal, rate limit 10/hour/ipHash, stored submissions; no code execution, no visitor file writes.

**Student dashboard modularization (stage 5)** — settings-driven modules (`my_courses` entitlement-resolved, `quick_actions`, `support` shown only when contact configured); admin config can never expose unauthorized data (entitlements remain server-side).

**Course/lesson presentation (stage 6)** — catalog + course pages apply `presentation.courseCard/subjectCard` toggles and CTA labels; learn page applies `presentation.lesson` (description/attachments/prev-next) and video options (poster/title/description/speed/fullscreen) — player enforces `nofullscreen` + pins playback rate when disabled.

**Responsive/mobile (stage 7)** — audit + fixes: admin header mobile nav toggle (44px targets), builder tool buttons 44px on small screens; confirmed `viewport-fit=cover`, `pt/pb-safe` utilities, `dvh` (no `100vh`), mobile-first grid presets for all blocks + section columns, safe-area-aware floating CTAs, public mobile nav. Honest scope: static/code-level audit in sandbox — real-device matrix remains owner-assisted (TEST-PLAN §5).

**Draft/preview/publish + versions (stage 8)** — admin-only preview route `/admin/cms/preview/:pageId` (draft render + amber banner + validation issue list); publish/version/restore lifecycle as above; builder Preview button.

**Security/access audit (stage 9)** — documented in SECURITY §15; findings clean (see §5 below).

**Regression + production verification (stage 10)** — full suites + cold runtime smoke 126/126 + readiness gate verified in BOTH directions + `scripts/bootstrap-admin.mjs` (production first-admin, content-free) + corrected deploy runbook.

## 2. Files changed

72 files, +14,846/−237 vs Phase 2 baseline. Key areas: `app/cms/*` (registry 1058 lines, icons, formdata, seo, render-types), `app/components/cms/*` (blocks 816 lines, fields), `server/cms/*` (service, sanitize, render, page-render), `server/settings/*` (identity/theme/presentation/dashboard groups), `server/db/schema/cms.ts`, `app/routes/*` (6 new admin CMS routes, `p.$slug`, `theme.css`, `favicon.ico`, rewritten home/layout/dashboard/catalog/learn), `migrations/0002–0003`, `scripts/*` (smoke §12, check-production-readiness, bootstrap-admin), `tests/unit/cms-registry.test.ts`, `tests/integration/cms.test.ts`, docs (CMS.md new; ADR-018/019/020; renumbering across 9 docs).

## 3. Database changes

- `0002_yellow_centennial.sql` — CMS domain tables + indexes (additive only).
- `0003_cms_permission_seed.sql` — idempotent `role_permissions` seed (9 `cms.*` perms for `admin`).
- Applied to local dev D1 (fresh cold run 4/4) and to an isolated fresh DB (migrations-only → bootstrap → readiness PASS). No destructive steps; no data migrations needed.

## 4. Environment variables added

None required. Script conveniences (no worker env changes): `PERSIST_DIR` (bootstrap/readiness isolated state dir), `D1_NAME` (remote readiness override), `--email=` flag for bootstrap; `ADMIN_BOOTSTRAP_EMAIL` pre-existing.

## 5. Security considerations

- No arbitrary HTML/JS/CSS execution paths: allowlist sanitizer (scripts/styles/iframes/forms removed wholesale; unlisted tags unwrapped; `on*` stripped; URLs via `safeHref` — `javascript:`/`data:`/http rejected; `rel=noopener` enforced), icon registry ids only, zod-validated theme tokens → CSS variables, declarative-only forms, zero inline styles (CSP `style-src 'self'` intact).
- Draft isolation: public = published snapshots only (draft/unpublished → 404); preview admin-gated (`cms.read`); no public preview tokens.
- Authorization: granular `cms.*` checks on every loader AND action; menu links cannot bypass authorization (target routes enforce their own server-side checks); `resolvePublicImageUrls` maps only PUBLIC_ASSETS rows (private files stay behind signed `/files/:id`).
- Validation choke points: create/update, publish (full-tree revalidation; `CmsValidationError` surfaces per-block issues), settings groups, links/icons/images.
- Abuse: form submissions rate-limited (10/h/ipHash); visitor uploads not accepted.
- Audit: every content/config mutation logged (`cms.*` actions, before/after where practical). By-design exceptions: idempotent bootstrap seeders (`seedCmsPermissions`, `seedSettingsDefaults`, `ensureMenu` container) and visitor form submissions (the submission row is itself the record).
- Production content policy (ADR-020) enforced by gate: seeded dev DB → exit 1 (6 findings); clean production-sim → exit 0. Bootstrap refuses dev-placeholder emails; seed script is LOCAL-ONLY and never referenced by production routes/migrations.

## 6. Tests performed (results)

- **Static**: `npm run verify` exit 0 — lint:imports ✓, tsc 0 errors, unit **61/61** (9 new), integration **46/46** (9 new), production build ✓.
- **Runtime smoke** (cold seeded local D1+R2, live `wrangler dev`): **126/126** — all Phase 1–2 regressions (headers/CSP, CSRF layers, auth/sessions/devices, RBAC 404-shape, signed-URL tamper matrix, playback token discipline, entitlement flip, revocation, rate limits) + §12 CMS (theme.css tokens, favicon 204, page create → draft-404 → section/blocks → publish → anonymous render, preview admin-only, header menu visibility, form create/embed/invalid→failure/valid→success, System-tab zero-deploy platform rename visible to anonymous).
- **Readiness gate, both directions**: dev DB → 6 FAIL exit 1; isolated fresh DB (migrations + bootstrap-admin + owner-config settings only) → 10/10 PASS exit 0.
- **Integration highlights**: sanitizer semantics (script content discarded, unwrap keeps text, rel added), publish rejects unsafe-link props, restore brings published visibility back + auto-version, presentation toggles change view models not content, form validation matrix (invalid email/consent/disabled/unknown option), menu href rejection.

## 7. Known limitations (honest)

1. `presentation.lesson.showRelated` is stored/validated but the learn page renders no related-lessons block yet.
2. Blocks deferred by design pending their phases: exam blocks (`latest_exams`, `question_bank_cta`, `student_results` → P5), `package_cards` (→ P6). Custom-HTML block intentionally NOT offered (security model).
3. Forms: no visitor file uploads (brief lists as optional); no email delivery yet (P4+ verification ADR).
4. Page builder uses move up/down (no drag-and-drop); builder forms are uncontrolled with remount keys.
5. iPhone/mobile checks are code-level (presets, safe areas, dvh, 44px targets) — no real device in sandbox; owner-assisted device matrix outstanding (TEST-PLAN §5).
6. Version history records snapshots + actor/time/note; field-level diff view not built (audit rows carry before/after).
7. Remote readiness/bootstrap modes execute SQL via `wrangler d1 execute` (values inlined with quote-escaping) — fine for one-row operations, not for bulk data.
8. Smoke runs create `smoke-`-prefixed rows; readiness gate flags them by design (run smoke only against dev/preview, or clean before launch).

## 8. Next phase

**Phase 4 — Student experience** (per renumbered plan): progress & resume tracking, secure playback flow refinements (replay rules, completion threshold), watch history, device management UI, in-app notifications & announcements. Per owner instruction, work STOPS here — Phase 4 does not start automatically.
