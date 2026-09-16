# PHASE 1 — Audit: Content Model, Access, Subscription, Activation Codes

**Date:** 2026-09-16
**Branch:** `arena/01a0a9db-tito`
**Working-tree base SHA (local clone):** `81ccf0bd21e723d7694a104a988587ad9355f5ca` ("Merge pull request #8 from drmostafatito-alt/arena/01a0a746-tito")

> The sandbox clone is a **single-commit (depth-1) checkout**. The SHAs quoted in the
> task brief (`origin/main = 0f523550…`, `5801a776…`) are **not present in this
> clone's object store** — `git log --all` returns exactly one commit. The fixes
> attributed to `5801a776` were verified **by reading the code**, not by SHA:
> physics demo is `--with-demo`-gated in `scripts/seed.mjs`, no `#exams` dead link
> (legacy `exam` lesson items are filtered out in the learn route), learning-journey
> destinations resolve, no InstaPay number anywhere in the tree
> (`tests/unit/seed-public-content.test.ts` guards it), external exam platform is
> behind `questionPlatformEnabled` / `questionPlatformUrl`.

---

## 1. Current database schema (verified by reading `server/db/schema/*` + `migrations/`)

12 migrations (`0000…0011`). Relevant tables:

| Domain | Tables | Notes |
|---|---|---|
| Content | `programs`, `grades`, `subjects`, `courses`, `units`, `lessons`, `lesson_items`, `course_prerequisites`, `videos`, `files` | Hierarchy **program → grade → subject → course → unit → lesson → lesson_items**. No DB FKs on content tables; referential integrity is enforced in `server/content/service.server.ts` (`ContentReferenceError`). |
| Curriculum/SEO | `curriculum_lessons`, `curriculum_contents` | SEO hub data (48 real lesson names from the owner CSV). **Not** the LMS content tree. Has free-text `subject/grade/term/unit/chapter` columns. |
| Access | `entitlements` | `resource_type ∈ subject|course|lesson|product|plan`, `status`, `starts_at`, `expires_at`, `metadata` JSON. |
| Commerce | `products`, `product_items`, `price_plans`, `orders`, `order_items`, `payments`, `payment_events`, `refunds`, `subscriptions`, `subscription_events`, `discount_codes`, `discount_redemptions`, `activation_code_batches`, `activation_codes`, `activation_code_redemptions` | Full manual-payment rail already implemented. |
| Platform | `settings` (typed JSON groups), `audit_logs` | `payments` settings group already exists. |
| Assessment | `assessment_*`, `assignments*` | **Untouched** by this work (PART 24). |

### What does NOT exist
- **No academic-year entity.** Nothing models "2026/2027".
- **No term entity.** "الترم الأول / الترم الثاني" exists only as free text inside the SEO `curriculum_lessons` table.
- **No structured manual-payment methods.** `settings.payments` has only `manualEnabled`, `manualInstructionsAr/En` (free text), `orderTtlMinutes`, `refundWindowDays`. No InstaPay / Vodafone Cash / Etisalat Cash records, no per-method enable/disable, no destination fields.
- **No order ↔ activation-code link.** `activation_codes` has `batch_id` only.
- **No WhatsApp receipt hand-off** on the order page (the platform `whatsapp` setting exists and drives a homepage floating button only).

---

## 2. Current content model & lesson relationships

`server/content/service.server.ts` (1109 lines) is the single content-tree service:
`createProgram/Grade/Subject/Course/Unit/Lesson/LessonItem`, `updateNode` (allow-list `MUTABLE`),
`archiveNode`, `duplicateNode`, `moveNode`, `adminTree`, `catalogCourses`, `chainForLesson`,
`chainForCourse`, `chainForSubject`, `coursePrereqGate`.

Lesson content types already supported by `lesson_items.item_type`:
`video`, `file` (pdf/doc/image/…), `link` (canonicalised Google Form), `exam`
(**legacy — retained in DB, never rendered**; the exam platform is external).
Video is **not** mandatory; a lesson with only a PDF already works.

Admin UI: `/admin/content` (tree + hub-level create) and `/admin/content/:type/:id`
(node editor: titles, slug, status, visibility, `accessLevel`, `freePreview`, ordering,
archive, duplicate, children, lesson items).

## 3. Current subscription / payment system (reusable as-is)

- Student: `/checkout/:productSlug` → `createOrder()` (server re-reads price; client never
  supplies an amount) → `orders` + `order_items` (frozen `entitlement_spec`) + a **pending
  manual `payments` row** carrying a frozen instructions snapshot.
- Student: `/orders/:orderNumber` → `confirmManualPayment()` (transfer reference, note,
  optional proof screenshot into `PRIVATE_FILES`, sender name, date, amount-must-match)
  → payment `under_review`. **Grants nothing.**
- Admin: `/admin/commerce?tab=payments` + `/admin/commerce/orders/:id` →
  `approveManualPayment()` / `rejectManualPayment()`. Approval runs `fulfillPaid()` —
  one atomic claim (`under_review → paid`) then entitlement rows + optional `subscriptions`
  row. Double approval / replay grants exactly once.
- Order/payment state machines (`ORDER_TRANSITIONS`, `PAYMENT_TRANSITIONS`) + TTL sweeps exist.

⇒ **"Subscription requests" already exist** as orders/payments in `pending` / `under_review`.
What is missing is scope legibility (year/grade/subject/term) and post-approval code issuance.

## 4. Current activation-code system (reusable as-is)

`server/commerce/money.ts`: `normalizeCode()` (case/dash/space-insensitive),
`generateActivationCode()` — crypto RNG over a 31-char ambiguity-free alphabet,
format `EDU-XXXX-XXXX-XXXX` (~59 bits).
`server/commerce/service.server.ts`: `generateActivationBatch()` (SHA-256 of the normalized
code stored, plaintext returned **once**, never logged), `redeemActivationCode()`
(pre-checks → **conditional `use_count` claim as the race gate** → `UNIQUE(code_id, student_id)`
→ compensation on same-student race), `setActivationCodeStatus()` (active/disabled/revoked),
`listActivationBatchesAdmin()`, `activationBatchDetail()`.
Student surface: `/activate`. Admin surface: `/admin/commerce?tab=codes` + batch detail.

⇒ PART 7/8/9/10/17/31 requirements are **already satisfied** except:
scope is expressed as raw `grants[]` (course/subject ids) with no year/term semantics,
no full-year rule, no order linkage, and the code prefix is `EDU-` not `TITO-`.

## 5. Current entitlements / authorization

`server/entitlements/resolver.server.ts` — **pure** `resolveAccess()`; single decision point.
Order: lifecycle (`published`, `publishAt`, `expiresAt`) → admin bypass (rank ≥ 3) →
`accessLevel` (`public` / `authenticated` / `entitled`) → `freePreview` → `entitlementCovers()`.
`entitlementCovers()` matches an entitlement against the **ancestry chain**
(lesson → unit → course → subject), so a subject-level or course-level grant opens everything below it.
`server/entitlements/access.server.ts` — DB-backed wrapper (`entitlementsFor`, `chainRefsOf`,
`resolveContentAccess`). Server-side only; UI renders the verdict.

`accessLevel` already encodes FREE/PAID:
- `public` = free for everyone
- `authenticated` = free for any registered student ← **"FREE"** in the brief
- `entitled` = requires an entitlement ← **"PAID"** in the brief

⇒ PART 5/18 need **no new access level**; they need (a) admin UX that says مجاني/مدفوع,
(b) student UX that shows paid-but-locked with a CTA, and (c) an explicit full-year scope rule.

## 6. Current routes

- Public: `/`, `/p/:slug`, `/about`, `/programs`, `/programs/:slug`, `/grades/:slug`,
  `/subjects/:slug`, **`/courses`**, **`/courses/:slug`**, `/courses/:slug/units/:unitId`,
  `/curriculum/:slug`, `/products/:slug`, auth routes.
- Gated lesson page: `/learn/:courseSlug/:lessonSlug`.
- Student: `/dashboard`, `/orders`, `/orders/:orderNumber`, `/checkout/:productSlug`,
  `/activate`, `/profile`, `/assignments`, `/notifications`, `/profile/security`.
- Admin: `/admin` + content, cms, seo, appearance, files, videos, entitlements, commerce,
  users, teachers, analytics, audit, security, announcements, assignments, search.

**Terminology problem (PART 27/34):** the header carries a hardcoded `/courses` link and the
student-facing label is "الكورسات" (`content.catalogTitle`, breadcrumbs, subject-page meta
fallback, CMS home preset). There is **no** student surface organised as
year → grade → subject → term → lesson.

## 7. CMS / settings / RBAC

- CMS: `server/cms/*` + `app/cms/registry.ts` (blocks incl. `course_cards`), home preset JSON.
- Settings: typed Zod groups in `server/settings/schema.ts`, deep-merged over defaults on read
  (`getSettings`), validated on write (`updateSettingsGroup`), audited. `ADMIN_ONLY_GROUPS`
  includes `payments`.
- RBAC: rank ≥ 4 bypass; rank 3 needs a `role_permissions` row. Content admin uses
  `requireRole(…, 3)`; commerce uses `canCommerce(db, auth, "commerce.*")`.

## 8. External exam integration

`settings.platform.questionPlatformEnabled` + `questionPlatformUrl`
(https-validated, fail-closed), rendered via `app/components/QuestionPlatform.tsx` and
`server/curriculum/constants.ts`. Legacy internal `exam` lesson items are filtered out of
rendering. **Not touched.**

---

## 9. Verdict — reuse vs. change

### Reuse unchanged
`entitlements` table + pure resolver, `activation_codes` (hashed, atomic, single-use),
`orders`/`payments`/`approveManualPayment`/`rejectManualPayment`, `products`/`price_plans`
(real prices only — none invented), `lesson_items` (video/file/link), `settings` groups,
`audit_logs`, RBAC, assessment, external exam platform, CMS.

### Minimal additive changes required
1. **New tables** `academic_years`, `terms` (+ nullable `courses.academic_year_id`,
   `courses.term_id`). A `courses` row that carries a year + term **is** the internal
   "term offering" container — the student UI calls it **الترم** and never "كورس".
   This keeps the existing chain (lesson → unit → course → subject) and therefore the
   existing resolver, learn route, progress and prerequisites untouched.
2. `activation_codes.order_id` (nullable) — links a code to the subscription request.
3. Explicit **scope** object (`term` / `full_year`) on the entitlement spec + entitlement
   metadata, and an explicit `full_year` rule in the pure resolver (ID comparison, never
   string matching).
4. **Structured payment methods** inside the existing `payments` settings group
   (InstaPay / Vodafone Cash / Etisalat Cash), all defaults empty — no number is ever
   hardcoded; an unconfigured or disabled method is invisible publicly.
5. **WhatsApp click-to-chat receipt hand-off** built server-side from real order data
   (no automation claimed).
6. **Student IA**: `/study` + `/study/:subjectSlug` (year → grade → subject → term → lessons
   with free/locked badges), header link moved off `/courses`, lesson page gets a real
   locked CTA (subscribe + activation code).
7. **Admin**: academic years, terms, term containers with year+term pickers, free/paid
   wording, payment-method editor, scope-aware subscription-request queue, and
   "generate activation code" on an approved order.
8. Code prefix `EDU-` → `TITO-` (brand alignment with the brief's example).

### Explicitly NOT changed
No homepage/visual redesign, no philosopher imagery, no image generation, no payment
gateway, no assessment changes, no production deploy/D1/secret/admin-account changes,
no deletion of legacy tables or migrations.
