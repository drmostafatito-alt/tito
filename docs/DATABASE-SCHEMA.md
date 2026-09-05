# Database Schema (Cloudflare D1 / SQLite via Drizzle)

> Source of truth for data design. Tables are **documented here first**, then implemented with
> Drizzle migrations in the phase marked `P#`. Status legend: ◻ planned · ◐ partially implemented · ✅ implemented.
> This file is updated in the same phase as any schema change.

## Conventions

- IDs: `TEXT` UUIDv4 generated in app code (D1 has no native uuid fn).
- Timestamps: `INTEGER` ms since epoch (UTC). Money: `INTEGER` minor units (piasters for EGP).
- Enums: `TEXT` + `CHECK` constraint; never booleans-as-ints for state machines.
- Soft delete: `deleted_at INTEGER NULL` where history matters (users, questions, content).
- FKs enforced (`PRAGMA foreign_keys = ON`) — **with one documented exception**: the Phase 2 content-domain tables (migration 0001: programs…lesson_items, videos, files, entitlements) ship WITHOUT DB-level FK constraints. Adding them later requires SQLite table-rebuild migrations on live data; until then referential integrity is enforced at the application layer (`ContentReferenceError` + `assert*Ref` guards in every create path, regression-tested; ADR-017). Identity-domain tables (migration 0000) DO have real FKs. Hot query paths indexed (listed per table).
- Every mutation that spans tables runs in a D1 transaction (`batch`).
- JSON columns: `TEXT` validated by Zod at the code boundary — the DB stores, the app validates.

## Domains

| Domain | Tables | Phase |
|---|---|---|
| Identity & security | roles, users, teacher_profiles, sessions, devices, security_events, rate_limit_counters | P1 |
| Platform / CMS | settings, pages, blocks, page_versions, menus, menu_items, forms, form_fields, form_submissions, role_permissions, announcements, audit_logs | P1 core · CMS tables P3 |
| Content | programs, grades, subjects, courses, units, lessons, lesson_items, videos, files | P2 |
| Progress | lesson_progress, video_progress, video_watch_sessions, events | P3 |
| Assessment | questions, question_choices, tags, question_tags, exams, exam_questions, exam_attempts, exam_answers | P4 |
| Commerce | products, product_items, price_plans, orders, order_items, payments, payment_events, refunds, subscriptions, subscription_events, discount_codes, discount_redemptions, activation_code_batches, activation_codes, activation_code_redemptions | P5 |
| Access | entitlements | P1 (core) → P5 (purchase sources) |
| Notifications | notifications | P3 |

---

## Identity & security (P1)

```
roles            id TEXT PK (student|teacher|admin|super_admin) · label · rank INTEGER
users            id PK · email TEXT UNIQUE (normalized lowercase) · password_hash TEXT
                 · full_name · phone TEXT NULL · locale_pref TEXT DEFAULT 'ar'
                 · role_id FK roles · status TEXT CHECK(active|suspended) 
                 · email_verified_at NULL · last_login_at NULL
                 · created_at · updated_at · deleted_at NULL            idx: email, role_id, status
teacher_profiles id PK · user_id FK users UNIQUE · bio_ar/en · photo_file_id NULL (P2+) · updated_at
sessions         id PK · user_id FK · device_id FK devices · token_hash TEXT UNIQUE (sha-256)
                 · ip_hash · user_agent_hash · created_at · last_seen_at
                 · expires_at · revoked_at NULL · revoked_reason NULL   idx: user_id, expires_at
devices          id PK · user_id FK · key_hash TEXT (sha-256 of device key) · label TEXT
                 · platform TEXT · user_agent_hash · status TEXT CHECK(active|revoked)
                 · first_seen_at · last_seen_at · revoked_at NULL
                 UNIQUE(user_id, key_hash)                              idx: user_id+status
security_events  id PK · user_id NULL FK · type TEXT  (login_success|login_failed|device_added|
                 device_evicted|device_limit_block|suspicious_login|password_reset_requested|
                 password_changed|session_revoked|rate_limited|permission_denied)
                 · ip_hash · metadata JSON · created_at                 idx: user_id+created_at, type+created_at
rate_limit_counters  bucket TEXT · window_start INTEGER · count INTEGER
                 PRIMARY KEY(bucket, window_start)                      TTL sweep on write
```

## Platform (P1 core)

```
settings         key TEXT PK (group name) · value JSON (Zod-validated per group)
                 · updated_by FK users NULL · updated_at                read: all · write: admin only
announcements    id PK · title_ar/en · body_ar/en · audience TEXT(all|students|teachers)
                 · publish_at · expires_at NULL · created_by FK · created_at
audit_logs       id PK · actor_user_id NULL · actor_role · action TEXT (dot.separated)
                 · entity_type · entity_id · before JSON NULL · after JSON NULL
                 · ip_hash · created_at                idx: entity(type,id), actor+created_at, created_at
```

## CMS (P3 — live; the P0 sketch `homepage_sections`/`menus.items` was replaced by this model, ADR-019)

```
pages            id PK · slug UNIQUE · title_ar/en · status(draft|published|archived)
                 · seo JSON (zod) · published_snapshot JSON NULL (the ONLY public render source)
                 · published_at NULL · sort_order · created_by · created/updated_at · deleted_at NULL
                 idx: (status, sort_order)
page_versions    id PK · page_id · version_no · snapshot JSON · note · created_by · created_at
                 uidx: (page_id, version_no)          append-only; restore copies INTO draft
blocks           id PK · page_id · parent_id NULL(section)|section(component) · type (registry key)
                 · props JSON (zod-validated per type) · sort_order · visible BOOL · created/updated_at
                 idx: (page_id, sort_order), (parent_id)
menus            id PK · location UNIQUE(header|footer|student|legal) · updated_at
menu_items       id PK · menu_id · parent_id NULL (one nesting level) · label_ar/en
                 · href (internal '/' route or https external — safeHref-validated) · external BOOL
                 · icon (registry id, never raw SVG) · sort_order · visible · created/updated_at
                 idx: (menu_id, sort_order)
forms            id PK · slug UNIQUE · title_ar/en · action_type(contact|newsletter|generic)
                 · store_submissions BOOL · success_ar/en · failure_ar/en · consent_required BOOL
                 · consent_ar/en · status(active|disabled) · created/updated_at   idx: status
form_fields      id PK · form_id · name ([a-z][a-z0-9_]{0,39}) · type(text|email|phone|number|textarea|
                 select|multiselect|radio|checkbox|date|hidden) · label/placeholder/help _ar/_en
                 · required · enabled · options JSON · validation JSON (declarative: minLen/maxLen/
                 min/max/pattern — NO code) · default_value · sort_order
                 uidx: (form_id, name) · idx: (form_id, sort_order)
form_submissions id PK · form_id · data JSON (validated answers) · ip_hash · created_at
                 idx: (form_id, created_at)           rate-limited: 10/hour/ipHash
role_permissions role_id · permission (cms.read|create|edit|publish|delete|manage_theme|
                 manage_navigation|manage_forms|manage_seo) · granted_at   super_admin (rank 4) bypasses
```

Integrity policy mirrors ADR-017: plain TEXT references + app-layer guards in `server/cms/service.server.ts` (every referenced page/parent/menu/form/file validated before insert; `CmsReferenceError` → validation error).

## Content (P2)

```
programs   id PK · slug UNIQUE · title_ar/en · description_ar/en · status(draft|published|archived)
           · sort_order · created_at · updated_at · deleted_at NULL
grades     id PK · program_id FK · slug UNIQUE · title_ar/en · status · sort_order · timestamps
subjects   id PK · grade_id FK · slug UNIQUE · title_ar/en · description_ar/en
           · thumbnail_file_id FK files NULL · status · sort_order · timestamps
courses    id PK · subject_id FK · teacher_id FK users NULL · slug UNIQUE · title_ar/en
           · description_ar/en · thumbnail_file_id NULL
           · access_level TEXT CHECK(public|authenticated|entitled) DEFAULT 'entitled'
           · status · visibility(hidden|catalog|featured) · sort_order · publish_at · expires_at NULL · timestamps
units      id PK · course_id FK · title_ar/en · sort_order · status · timestamps
lessons    id PK · unit_id FK · slug UNIQUE · title_ar/en · description_ar/en
           · access_level · free_preview INTEGER(0/1) · status · sort_order
           · publish_at · expires_at NULL · timestamps
lesson_items id PK · lesson_id FK · item_type TEXT(video|file|exam) · video_id FK NULL
           · file_id FK NULL · exam_id FK NULL · sort_order · required INTEGER(0/1)
videos     id PK · provider TEXT(mux|mock|bunny|cfstream) · provider_asset_id · playback_id
           · status TEXT(pending|preparing|ready|errored) · duration_seconds INT NULL
           · thumbnail_url NULL · thumbnail_file_id NULL · byte_size NULL · width/height NULL
           · master_r2_key TEXT NULL (R2 video-masters/…) · metadata JSON · created_at · updated_at
files      id PK · r2_key UNIQUE · kind TEXT(pdf|image|doc|audio|archive) · original_filename
           · mime · byte_size · checksum_sha256 · visibility TEXT(public|private)
           · download_allowed INTEGER(0/1) DEFAULT 0 · created_by FK · created_at
```

## Access resolution model (spans content + commerce)

Every content node carries `access_level`:
- `public` — anyone; `authenticated` — any logged-in user; `entitled` — requires an entitlement covering it.

`entitlements` rows cover a resource explicitly or via an ancestor (lesson → unit → course → subject) or via a **plan** (subscription product) that includes the subject/course (through `product_items`). The resolver (one server function) also honors: content status/publish window, admin override rows, trial windows, device policy verdicts. UI renders the verdict; it never computes it.

```
entitlements  id PK · student_id FK users · source_type TEXT(order_item|subscription|activation_code|
              admin_grant|trial|import) · source_id NULL · resource_type TEXT(subject|course|lesson|
              product|plan) · resource_id NULL (NULL for plan/global) 
              · status TEXT(active|expired|revoked) · starts_at · expires_at NULL (NULL = permanent)
              · granted_at · granted_by NULL · revoked_at NULL · revoke_reason NULL · metadata JSON
              idx(student_id, resource_type, resource_id, status), (expires_at) for sweep jobs
```

## Progress & analytics (P4)

```
lesson_progress  id PK · student_id · lesson_id · status(in_progress|completed) · completed_at NULL
                 · last_activity_at    UNIQUE(student_id, lesson_id)
video_progress   id PK · student_id · video_id · lesson_id NULL · watch_count INTEGER
                 · position_seconds INTEGER · max_position_seconds · completed INTEGER(0/1)
                 · completed_at NULL · last_watched_at    UNIQUE(student_id, video_id)
video_watch_sessions id PK · video_progress_id FK · started_at · ended_at NULL
                 · watched_seconds · device_id NULL       (replay accounting / audit)
events           id PK · type TEXT(login|logout|registration|video_start|video_complete|lesson_complete|
                 exam_start|exam_submit|purchase|subscription_*(…)|activation_redeem|device_change|
                 security_*) · user_id NULL · resource_type/id NULL · props JSON · created_at
                 idx(type, created_at), (user_id, created_at)      append-only, no PII in props
```

## Assessment (P5)

```
questions        id PK · type TEXT(mcq|true_false|multi_select|essay) · stem_ar/en · explanation_ar/en NULL
                 · difficulty TEXT(easy|medium|hard) · points_default REAL
                 · subject_id FK NULL · course_id FK NULL · unit_id FK NULL · lesson_id FK NULL
                 · status TEXT(draft|in_review|published|archived) · created_by FK · reviewed_by FK NULL
                 · created_at · updated_at · deleted_at NULL
                 idx(status,type,subject), (lesson_id), FTS5 shadow table for stem search
question_choices id PK · question_id FK · content_ar/en · is_correct INTEGER(0/1) · sort_order · feedback NULL
tags             id PK · slug UNIQUE · label_ar/en
question_tags    (question_id, tag_id) composite PK
exams            id PK · slug UNIQUE · title_ar/en · description_ar/en · course_id FK NULL · lesson_id FK NULL
                 · config JSON  ← full policy object (see FEATURE-SPEC §exams)
                 · status(draft|published|archived) · created_by · timestamps
exam_questions   (exam_id, question_id) composite PK · sort_order · points REAL      (manual mode)
exam_attempts    id PK · exam_id FK · student_id FK · attempt_number INTEGER
                 · status TEXT(in_progress|submitted|grading|graded|expired|cancelled)
                 · started_at · deadline_at NULL (server-computed) · submitted_at NULL
                 · time_used_seconds NULL · score NULL · max_score NULL · passed NULL
                 · grading_status TEXT(auto|needs_manual|complete) · random_seed · metadata JSON
                 UNIQUE(exam_id, student_id, attempt_number)
                 PARTIAL UNIQUE(exam_id, student_id) WHERE status='in_progress'   ← one live attempt
exam_answers     id PK · attempt_id FK · question_id FK · choice_ids JSON NULL · text_answer NULL
                 · points_earned REAL NULL · is_correct NULL · graded_by NULL · graded_at NULL · feedback NULL
                 · version INTEGER (autosave) · updated_at
                 UNIQUE(attempt_id, question_id)
```

## Commerce (P6)

```
products         id PK · kind TEXT(course|subject|bundle|subscription_plan) · name_ar/en · description_ar/en
                 · active INTEGER · sort_order · metadata JSON · timestamps
product_items    id PK · product_id FK · resource_type(subject|course) · resource_id   (bundles & plans)
price_plans      id PK · product_id FK · currency TEXT DEFAULT 'EGP' · amount_minor INTEGER
                 · kind TEXT(one_time|recurring) · period TEXT(monthly|term|annual|custom|fixed_date) NULL
                 · period_days INTEGER NULL · label_ar/en NULL
                 · compare_at_minor NULL · promo_price_minor NULL · promo_starts/ends NULL · active
orders           id PK · order_number TEXT UNIQUE · student_id FK · status TEXT(pending|awaiting_payment|
                 paid|cancelled|expired|failed|refunded|partially_refunded)
                 · currency · subtotal_minor · discount_minor · total_minor
                 · discount_code_id FK NULL · source TEXT(self|admin|manual) · created_by NULL · timestamps
order_items      id PK · order_id FK · product_id FK · price_plan_id FK · title_snapshot_ar/en
                 · unit_price_minor · entitlement_spec JSON (frozen at purchase)
payments         id PK · order_id FK · provider TEXT(manual|paymob|fawry|stripe|…) · method TEXT NULL
                 · amount_minor · currency · status TEXT(pending|under_review|paid|failed|cancelled|
                 expired|refunded|partially_refunded) · reference TEXT NULL (gateway tx id)
                 · instructions JSON NULL (manual rail) · reviewed_by NULL · reviewed_at NULL
                 · paid_at NULL · idempotency_key UNIQUE NULL · metadata JSON · timestamps
                 idx(order_id), (provider, reference)
payment_events   id PK · payment_id NULL · provider · event_type · provider_event_id UNIQUE NULL
                 · signature_valid INTEGER · payload JSON (sanitized) · received_at · processed_at NULL
                 · processing_result TEXT          (webhook inbox — idempotent processing)
refunds          id PK · payment_id FK · amount_minor · reason · created_by · created_at
subscriptions    id PK · student_id FK · price_plan_id FK · plan_snapshot JSON
                 · status TEXT(pending|active|paused|cancelled|expired) · started_at
                 · current_period_start · current_period_end · expires_at NULL (fixed end)
                 · auto_renew INTEGER(0/1) · cancelled_at NULL · timestamps
subscription_events (audit trail) id PK · subscription_id FK · type · at · by · metadata
discount_codes   id PK · code_hash UNIQUE (sha-256 normalized) · prefix TEXT (display hint)
                 · type(percent|fixed) · value INTEGER · max_uses NULL · used_count · per_user_limit NULL
                 · min_order_minor NULL · applies_to JSON NULL · starts_at · ends_at NULL
                 · active · created_by · timestamps
discount_redemptions id PK · code_id FK · order_id FK · student_id · amount_minor · created_at
activation_code_batches id PK · name · note NULL · spec JSON · count · created_by · created_at
activation_codes id PK · batch_id FK NULL · code_hash UNIQUE · prefix
                 · product_id FK NULL · entitlement_spec JSON (resource + duration_days|fixed_expires_at)
                 · max_uses INTEGER DEFAULT 1 · use_count · status TEXT(active|disabled|revoked|exhausted)
                 · created_by · timestamps                     idx(batch_id), (status)
activation_code_redemptions id PK · code_id FK · student_id FK · entitlement_id FK
                 · created_at · ip_hash      UNIQUE(code_id, student_id)
```

## Referential notes

- `order_items.entitlement_spec` freezes what was purchased; grant code reuses this spec — price changes never rewrite history.
- Payment → entitlement grant happens in ONE transaction (see PAYMENTS.md state machine).
- Activation/discount codes stored **hashed**; `prefix` (first 4 chars) kept for admin search/support.
- Content cascade: deleting (soft) a course hides descendants; entitlements are never silently deleted — they expire/revoke explicitly.
- Search: SQLite FTS5 shadow tables for `questions.stem`, `lessons.title`, `courses.title` (P4/P6); regular indexes elsewhere. Architecture permits an external search engine later without schema change.
