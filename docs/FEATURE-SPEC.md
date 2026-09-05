# Feature Specification

> Status: **Phase 0 v1** — behavioral contracts per module, focused on rules that must not drift.
> This file grows per phase; when implementation and spec disagree, either the code changes or
> this file changes **in the same phase**, with the reason recorded.

Global rules applying everywhere: Arabic/English with RTL · loading/empty/error states standardized · server-side authorization · all list views paginated with search/filter/sort · destructive admin actions require confirmation + are audited.

## 1. Auth & account (P1)
- Register: email + full name + password (min 8, checked against top-common list; no password rules leaked in responses). Rate-limited. Welcome notification.
- Login: uniform errors (no user-existence leak); device policy applied **before** session issue; suspicious patterns logged.
- Forgot/reset: single-use 60-min token; reset revokes all sessions.
- Profile: name, phone, locale, password change (requires current). Email change: requires password + creates notification (verification flow Phase 3+).
- Roles: student / teacher / admin / super_admin; only super_admin manages admins & system settings.

## 2. Student dashboard (P3)
Cards: active courses w/ progress %, continue-watching (last lesson + position), upcoming exams (availability window), recent results, expiring subscriptions (≤14d warning), unread announcements/notifications. All sections admin-toggleable via settings.

## 3. Catalog & content (P2)
- Hierarchy Program→Grade→Subject→Course→Unit→Lesson→items(video/file/exam). Slugs unique; status draft/published/archived; visibility hidden/catalog/featured; publish_at scheduling + optional expires_at.
- Catalog shows published+visible only; entitled badges computed by resolver; free_preview lessons playable logged-in (watermarkable UI note).
- Language fallback: content title shown in active locale, falls back to other locale, then slug.

## 4. Learning experience (P3)
- Lesson page: ordered items; video (resume, replay policy, optional speed, PiP where supported), files (view/download per permission), quiz links.
- Progress: lesson completes when required items complete; course % = completed required lessons/total; per-video completion threshold (setting, default 90%).
- Watch history + resume positions per student (not per device), portable within device policy.

## 5. Question bank (P4)
- Types: mcq (single), true_false, multi_select (partial credit supported), essay (manual grading). Explanation per question (visibility per exam policy). Difficulty, tags, topic links to subject/course/unit/lesson (all optional).
- Workflow: draft → in_review → published → archived; duplicate; bulk tag/status; FTS search. Teachers author; admins publish (permission matrix configurable).

## 6. Exams (P4) — `exams.config` contract
```
duration_minutes: int|null          availability: {starts_at, ends_at}
selection: { mode: manual | pool,
             pools: [{ filters:{subject?,unit?,lesson?,tags?,difficulty?}, count }],
             max_questions, randomize_questions, randomize_choices }
attempts:  { max: int|null, cooldown_minutes, manual_extra_allowed: bool }
scoring:   { pass_percent, partial_credit_multiselect: bool, essay_points }
results:   { show: immediate|after_end|manual, show_answers: bool, show_explanations: bool,
             review_mode: bool }
```
Attempt rules: server deadline; autosave 3s debounce + pagehide beacon; idempotent submit; expiry auto-submits per policy (`submitted` with what's answered); reconnect resumes exactly; grace window (setting, default 30s) absorbs network loss; randomization seeded per attempt (review shows the student's own order).

## 7. Commerce (P5)
- Products: course/subject access, bundles (product_items), subscription plans; multiple price_plans per product (monthly/term/annual/custom days/fixed end date); promo pricing (compare-at + window).
- Checkout: server-computed totals; discount codes (percent/fixed, windows, caps, per-user limits); activation codes as payment rail (see PAYMENTS.md).
- Subscriptions: status server-driven; renew (manual v1), cancel (keeps access till period end), pause (admin), expire sweep; plan coverage via entitlements on plan product.
- Student views: orders history, active subscriptions + expiry, receipts.

## 8. Devices & security center (P1/P3/P6)
Student: device list (label, last seen), sign-out device, request replace (if policy allows). Admin: force logout, revoke, reset list, change policy, review security events. Policies: max devices (default 1), on-limit behavior, change limits per 30d.

## 9. Notifications & announcements (P3/P6)
In-app always (unread counts, mark read); announcements broadcast by admin to audiences with publish/expiry windows. Email channel: provider-abstracted, enabled only after verification ADR (Phase 3+). WhatsApp: only official Meta WhatsApp Business Platform, only after legal/technical verification (deferred, not promised).

## 10. Analytics (P6)
Events per brief §24; admin dashboards: active students, video engagement, exam performance, revenue (manual+gateways), code usage, security overview. No invasive tracking: first-party events only, no third-party pixels by default.

## 11. Search (per phase)
Courses/subjects/lessons (catalog, FTS), questions (bank, FTS), students/orders/payments/codes (admin, indexed filters). Architecture leaves room for an external engine later without schema change.

## 12. Admin platform (P6) — sections
Overview · Students · Teachers · Content tree (program→lesson) · Videos · Files · Question bank · Exams · Results · Orders · Payments · Subscriptions · Activation codes · Discount codes · Notifications · CMS (homepage/menus/footer/contact/social/WhatsApp) · Settings · Security (devices/sessions/events) · Audit log · Analytics. Every list: search/filter/sort/pagination. Every mutation: audited.

## 13. Maintenance & platform settings
Maintenance mode (admins bypass, friendly page for others); site name/logo/locale defaults; theme tokens within safe palette; SEO basics (titles/descriptions from settings); legal pages (CMS).
