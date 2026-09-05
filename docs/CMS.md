# CMS / Page Builder guide (Phase 3)

> Audience: the platform owner/admin (part 1) and developers (part 2).
> Architecture rationale: `DECISIONS.md` ADR-019 (CMS model), ADR-020 (production content policy). Security: `SECURITY.md` §15.

---

## Part 1 — Admin guide

Everything below requires an admin account. Each area additionally requires its CMS permission (§Permissions). **Nothing here ever requires a code deployment.**

### Pages — `/admin/cms`

- **List**: all pages with status (draft / published / archived), slug, updated date. Create, duplicate, archive, delete (soft), reorder, publish/unpublish from here.
- **Editor** (`/admin/cms/pages/:id`): the page builder.
  - **Sections**: add, edit settings (background, padding, container width, columns 1–4, gap, alignment, visibility), move up/down, duplicate, delete.
  - **Blocks inside sections**: add from a grouped palette (layout / content / media / CTA / data / form / social), edit every field, move up/down, hide/show, duplicate, delete.
  - **Text fields** are bilingual (Arabic / English) everywhere; leaving one language empty falls back to the other at render time.
  - **Save** stores the draft. Drafts are **never visible to the public**.
- **Preview** (`/admin/cms/preview/:pageId`): renders the current draft exactly as the public would see it, with an amber "preview" banner. Admin-only. Validation problems are listed instead of crashing.
- **Publish**: validates every block, sanitizes rich text, freezes a snapshot, and records a version. The public site renders **only published snapshots** — publishing is instant, no deploy.
- **Versions**: every publish (and every restore) appends an immutable version (who / when / note). **Restore** copies a version back into the draft (your current draft is auto-saved as a version first — nothing is lost). Review, then publish again.
- **SEO** (per page, needs `cms.manage_seo`): title, description, canonical, OG title/description/image, robots directive. All validated.
- Slug rules: lowercase letters/digits/hyphen, reserved words (`admin`, `api`, `files`, …) rejected. The page with slug `home` is the site homepage (`/`); any other published page lives at `/p/<slug>`.

### Block palette (38 types, grouped)

| Group | Blocks |
|---|---|
| Layout | `section` (container: background/padding/width/columns/gap/alignment), `divider`, `spacer` |
| Content | `hero`, `text`, `rich_text`, `faq`, `accordion`, `announcement`, `countdown`, `testimonials`, `statistics`, `teacher_profile`, `promo_banner` |
| Media | `image`, `image_text`, `gallery`, `logo_cloud`, `video` |
| CTA | `buttons`, `login_cta`, `register_cta`, `whatsapp_cta`, `telegram_cta` |
| Data (dynamic, server-resolved) | `feature_cards`, `icon_feature`, `icon_grid`, `pricing_cards`, `course_cards`, `subject_cards`, `program_cards`, `free_content`, `featured_content`, `latest_lessons` |
| Forms | `form_block`, `newsletter_form` |
| Social | `social_links`, `contact_info` |

Notes:
- **Dynamic blocks** (course/subject/program cards, latest lessons, free/featured content) pull real data server-side, filtered by what is actually published; if there is nothing to show, the block renders its empty state or nothing — never fake content. Card visibility toggles come from Appearance → Presentation.
- **Deferred by design** (registry is extensible, adding them later is one entry + one renderer, no rewrite): exam-related blocks (`latest_exams`, `question_bank_cta`, `student_results` → Assessment phase), `package_cards` (Commerce phase). **Custom HTML blocks are intentionally NOT offered** — the security model forbids arbitrary HTML/JS (ADR-019).
- **Icons**: picked from a built-in registry of safe identifiers (`book-open`, `play-circle`, `graduation-cap`, …) with size/color-role options. Raw SVG/HTML can never be stored.
- **Images**: picked from Files (uploaded to R2 via `/admin/files`). Every image field has alt text; empty image → element omitted or empty state, never a placeholder.

### Appearance — `/admin/appearance`

- **Identity**: platform short name, owner name/title/photo, logo, favicon, hero/about images, contact phone/email/address, social links (Telegram, Facebook, YouTube, Instagram, TikTok, Twitter/X, LinkedIn), copyright line. All bilingual where text.
- **Theme** (needs `cms.manage_theme`): validated design tokens only — primary/secondary/accent/background/surface/text/muted/border/success/warning/error colors (`#rrggbb`), radius scale (base/button/card), shadow preset, density, font scale. Served as CSS variables at `/theme.css`. **Arbitrary CSS is not possible by design.**
- **Presentation**: how content data is displayed (data itself stays in the content tables):
  - Course cards: show image/teacher/lesson-count/subject/badge, CTA label (ar/en), layout preset (standard/compact/wide).
  - Subject cards: show image/course-count, CTA label.
  - Lesson page: show description/attachments/prev-next; video: poster/title/description/speed/fullscreen.
  - Known limitation: `lesson.showRelated` is stored and validated but the learn page does not render a related-lessons block yet (documented, not silent).
- **Student dashboard**: welcome message (ar/en) + module toggles/order (`my_courses`, `quick_actions`, `support`). Modules only ever show data the student is entitled to — access stays server-side; `support` appears only when a contact email/phone/WhatsApp is configured.

### Navigation — `/admin/cms/menus` (needs `cms.manage_navigation`)

- Locations: **header** (public top nav, with one dropdown level), **footer**, **student**, **legal**.
- Items: bilingual label, link (internal `/route` or external `https://`), icon, order, visibility, one nesting level.
- Link safety: `javascript:`, `data:`, and plain `http://` URLs are rejected. Links cannot bypass authorization — hidden/private routes still enforce their own server-side checks; a menu link to `/admin` for a student simply redirects to login.
- Header/footer chrome (logo, socials, copyright, contact) comes from Appearance → Identity.

### Forms — `/admin/cms/forms` (needs `cms.manage_forms`)

- Create forms with slug, bilingual title, success/failure messages, optional consent checkbox (+ privacy text), enable/disable.
- Fields: text, email, phone, number, textarea, select, multiselect, radio, checkbox, date, hidden. Per field: bilingual label/placeholder/help, required, enabled, order, options (for choice fields), declarative validation (min/max length, min/max value, pattern).
- Embed on any page with the `form_block` / `newsletter_form` blocks.
- Submissions are validated server-side, rate-limited (10/hour/IP), and stored; **form config can never execute code**, and visitor file uploads are not accepted.

### Audit

Every CMS mutation (page/block/menu/form/theme/settings create, edit, reorder, visibility, publish, unpublish, restore, delete) writes an `audit_logs` row: actor, action (`cms.*`), entity, before/after where practical, IP hash.

### Permissions

`cms.read` · `cms.create` · `cms.edit` · `cms.publish` · `cms.delete` · `cms.manage_theme` · `cms.manage_navigation` · `cms.manage_forms` · `cms.manage_seo`. Granted per role in `role_permissions`; **super_admin always has all**. Admin (rank 3) gets all nine by the Phase-3 seed migration; finer splits can be set per role later without code.

### Production content rules (owner policy, ADR-020)

- Production starts **content-empty**: no demo accounts, courses, pages, forms, images, or placeholder text. Empty areas show polished empty states.
- Dev seed/smoke data is local-only and clearly labeled; it cannot be deployed.
- Before every production deploy run: `npm run check:production-readiness` (or `--remote` against production D1). It fails the deploy on demo accounts, seed/smoke content, mock video provider, placeholder media, template branding, empty owner identity, lorem text in published pages, unapplied migrations, missing CMS permissions, or no active super_admin.

---

## Part 2 — Technical reference

### Data model (D1, `server/db/schema/cms.ts`)

```
pages(id, slug UNIQUE, title_ar/en, status[draft|published|archived], seo JSON,
      published_snapshot JSON NULL, published_at, sort_order, created_by,
      created_at, updated_at, deleted_at)                    idx(status, sort_order)
page_versions(id, page_id, version_no, snapshot JSON, note, created_by, created_at)
                                                             uidx(page_id, version_no)
blocks(id, page_id, parent_id NULL=section, type, props JSON, sort_order,
       visible, created_at, updated_at)                      idx(page_id, sort_order), idx(parent_id)
menus(id, location UNIQUE[header|footer|student|legal], updated_at)
menu_items(id, menu_id, parent_id, label_ar/en, href, external, icon,
           sort_order, visible, …)                           idx(menu_id, sort_order)
forms(id, slug UNIQUE, title_ar/en, action_type[contact|newsletter|generic],
      store_submissions, success/failure _ar/_en, consent_required, consent _ar/_en,
      status[active|disabled], …)
form_fields(id, form_id, name, type[11 kinds], label/placeholder/help _ar/_en,
            required, enabled, options JSON, validation JSON, default_value,
            sort_order)                                      uidx(form_id, name)
form_submissions(id, form_id, data JSON, ip_hash, created_at) idx(form_id, created_at)
role_permissions(role_id, permission, granted_at)
```

Integrity: ADR-017 style — app-layer reference guards (`CmsReferenceError`) in the service, no DB-level FKs on CMS tables.

### Module map

| Module | Role |
|---|---|
| `app/cms/registry.ts` | **Single source of truth** (client-safe): 38 block defs (zod schema, default props, field descriptors, group, dynamic resolver id), `FORM_FIELD_TYPES`, `ICON_IDS`, `safeHref`, `validPageSlug`, `RESERVED_SLUGS`, `seoSchema`, `cmsLabel` |
| `app/cms/icons.tsx` | Icon registry: id → inline SVG component (fixed set, size/color-role props) |
| `app/cms/formdata.ts` | `readPropsFromForm`: FormData → typed props per block schema (repeaters via `__idx`, datetime-local → epoch, ref-picker filtering) |
| `app/cms/seo.ts` | `asSnapshot`, `parseSeo`, `seoMeta` (client-safe; `meta()` never imports `.server`) |
| `app/components/cms/blocks.tsx` | `PageView` + all renderers; responsive presets only; no inline styles (CSP) |
| `server/cms/service.server.ts` | All mutations + queries: pages, blocks, publish/preview/versions/restore, menus, forms, submissions, `canCms`; every mutation audited |
| `server/cms/sanitize.server.ts` | HTMLRewriter allowlist sanitizer for `lrichtext` fields |
| `server/cms/render.server.ts` | `renderSnapshot` (snapshot → view models; dynamic resolvers: course/subject/program cards, latest lessons, free/featured), `resolvePublicImageUrls` (PUBLIC_ASSETS only) |
| `server/cms/page-render.server.ts` | `handleCmsFormAction` (rate limit + submit), `requestLocale` |
| `server/settings/*` | Settings groups incl. `identity`, `theme`, `presentation`, `dashboard` (zod-validated); `/theme.css` route emits CSS variables |

### Render paths

- Public `/` and `/p/:slug`: load page → require `status='published'` + snapshot → `renderSnapshot` → `PageView`. One indexed row read; drafts 404.
- Preview `/admin/cms/preview/:pageId`: `requireRole(3)` + `cms.read` → `previewSnapshot` (validates draft, lists issues as `CmsValidationError`) → same `PageView`.
- Publish: validate all blocks (zod) → sanitize rich text → snapshot JSON `{v:1, page, sections[]}` → `page_versions` insert + `pages.published_snapshot` update, audited.
- Restore: auto-snapshot current draft as a version → delete draft rows → re-insert from snapshot with fresh ids → admin reviews → publishes again.

### Validation choke points

1. **Create/update block**: zod parse of props (`updateBlockProps` also sanitizes rich-text fields immediately).
2. **Publish/preview**: full-tree revalidation; failures raise `CmsValidationError{issues:[{blockId,type,path,message}]}` surfaced in the admin UI — a broken block can never crash or half-render a public page.
3. **Render**: snapshot is trusted (already validated at publish); unknown types skipped defensively.
4. **Settings**: `updateSettingsGroup` zod-validates the whole group; theme tokens are hex/range/enum-checked → no CSS injection.
5. **Links**: `safeHref` everywhere (blocks, menu items, SEO canonical/OG); icons validated against `ICON_IDS`; images must be existing PUBLIC_ASSETS file ids.

### Testing & gates

- Unit: `tests/unit/cms-registry.test.ts` (registry, safeHref, slug/SEO schemas, FormData round-trips).
- Integration: `tests/integration/cms.test.ts` (sanitizer semantics, draft→publish→version→restore, unsafe-link publish rejection, dynamic resolvers + presentation toggles, image URL resolution, form validation, menu href safety).
- Runtime smoke: `scripts/smoke.mjs` §12 (theme.css/favicon, page create→draft-404→blocks→publish→anonymous render, preview admin-only, header menu, form create/validate/messages end-to-end over HTTP).
- Deploy gate: `scripts/check-production-readiness.mjs` (ADR-020).

### Adding a new block type (developer)

1. `app/cms/registry.ts`: add entry — label key, group, zod schema (`zodForBlock`), `defaultPropsFor`, field descriptors, optional `dynamic` resolver id.
2. `app/components/cms/blocks.tsx`: add renderer case (responsive preset classes only; no inline styles).
3. If dynamic: add resolver in `server/cms/render.server.ts`.
4. Add i18n label keys (`app/locales/ar.ts`, `en.ts`). No migration, no route change. Add unit coverage.
