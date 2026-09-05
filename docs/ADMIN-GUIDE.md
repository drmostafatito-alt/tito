# Admin Guide

> Status: **complete (Phase 7).** Every admin surface below is live, RBAC-gated server-side and audited. The CMS/page-builder guide lives in `docs/CMS.md` (Phase 3).

## 1. First-run (end of Phase 1)
1. Operator runs the seed (DEPLOYMENT.md §6): creates the super_admin account with a one-time generated password.
2. First login forces password change.
3. Super admin: manage admins (role grant), review security settings defaults.

## 2. Defaults applied at Phase 1 (settings → `security`/`devices` groups)
- 1 active device per student; new logins beyond the limit are **blocked** (admin can switch to replace-oldest).
- Sessions: 30-day sliding expiry.
- Rate limits on auth endpoints (per-IP + per-account windows).

## 3. Content management (live — Phase 2, `/admin/content`)
- The tree page shows the full hierarchy (programs → grades → subjects → courses → units → lessons) with slug + status per node; create buttons spawn each level; archived/draft nodes stay visible to admins but never surface in the public catalog.
- The node editor (`/admin/content/:type/:id`) edits titles (ar/en), description, status (draft/published/archived), and — per type — visibility, access level (public/authenticated/entitled), publish/expiry windows, thumbnail (from uploaded image files), free-preview flag (lessons). Slug is generated on create (Arabic-aware) and unique.
- Ordering: `move up` / `move down` per sibling (positions normalize to 0..n-1; moving past the boundary is a safe no-op).
- Lessons attach items (video / file / exam-later) with a required flag; attaching a non-existent reference is rejected with a validation error (ADR-017 app-layer integrity).
- Every mutation writes an audit-log row (actor, action, entity, before/after).

## 4. Files & videos (live — Phase 2, `/admin/files`, `/admin/videos`)
- Files: upload stores into the PRIVATE R2 bucket; the listing shows a freshly signed **view URL** per private file (short TTL — reload the page for a new one). `download_allowed` controls whether students get an attachment-disposition download link in addition to inline view. Public-visibility files get a plain unsigned URL.
- Videos: `register mock` creates an instantly-ready dev video (mock provider). `ingest master` uploads through the ACTIVE provider (settings `video.provider`): with `mock` it succeeds offline; with `mux` and no credentials configured it fails loudly with a `VideoNotConfiguredError` detail (the row stays `pending` — never playable — and there is NO silent fallback to mock). `sync` polls provider status for pending/preparing rows.
- Playback for students is minted only by `POST /api/playback/:videoId` after a server-side entitlement check; tokens live ≤45s (settings-capped ≤60s).

## 5. Entitlement grants (live — Phase 2, `/admin/entitlements`)
- Grant by student email + resource (subject / course / lesson) + duration in days (blank = permanent) + note; revoke per row. Grants take effect immediately server-side: the student's lesson pages flip from locked to signed-URL/file/playback access on next request (verified in smoke §10). Source type is `admin_grant`; all grants/revokes are audited.

## 6. Question bank & exams (live — Phase 5, `/admin/assessment`)
- Hub: question bank (status/type/text filters) + exam list with attempt counters. Gated by `assessment.read/create`.
- Question editor: bilingual stems/explanations, choices with correct toggles + per-choice feedback, difficulty, points, topic links, tags (inline create), status workflow draft→in_review→published→archived, duplicate, delete-with-confirm (refused while attached to an exam).
- Exam builder: basics + lesson/course attachment, full policy form (duration, pass %, attempts cap, cooldown, randomization, partial credit, results/review visibility, availability window), attached-questions manager (reorder/points/remove), publish gate is fail-closed (needs ≥1 attached published objective question, or a resolvable pool).
- Platform-level attempt visibility ships in Phase 7 (§9/§11): recent attempts + per-student attempt history are on the user detail page and the assessment hub — the answer key never leaves the server before submission.

## 7. Orders, payments, subscriptions, codes (live — Phase 6, `/admin/commerce`)
- Hub with 6 tabs: products, orders (search/status filter + totals), payments (review queue: evidence, exact-amount approve, reject with reason), subscriptions (renew/pause/resume/cancel), codes (batch generation — plaintext shown ONCE; batch list), discounts.
- Order detail: items with frozen entitlement spec, payment trail, approve/reject, FULL refund inside the refund window (refund revokes entitlements automatically).
- Rules the admin must know: approving a payment is what grants access (the payment itself never does); amounts must match EXACTLY; replays are idempotent; activation codes are atomic per student; money is integer minor units everywhere.

## 8. Admin dashboard (live — Phase 7, `/admin`)
- All-real metrics from D1 (nothing hardcoded), each tile carries `data-testid="home-metric-*"`: Users (total/students/admins/new registrations), Learning (enrolled, active learners, completed lessons, watched videos), Video (watch time, starts, completions), Exams (attempts, submissions, pass rate, avg score), Commerce (orders, paid, pending, gross/refunded/net revenue in EGP minor units, pending payments, activation redemptions).
- Range switcher (today / 7 days / 30 days / all) re-renders server-side — the numbers are windowed in SQL, not in the browser.
- Recent registrations, recent audit activity and platform activity rows sit below the tiles. Actors without `analytics.read` see a graceful "metrics denied" state instead of numbers.
- Revenue = PAID orders only; refunds subtract into net. Pending payments never count as revenue.

## 9. User management (live — Phase 7, `/admin/users`, `/admin/users/:id`)
- List: server-side search (name/email), status filter (active/suspended), role filter, pagination (20/page). Needs `users.read`.
- Detail: profile (email, role, status, registration date — never password material), entitlements (source/start/end/status), enrollments & course progress, exam attempts, orders, recent security events for that user.
- Actions (need `users.manage`; every action audited + idempotent):
  - **Suspend / reactivate** — suspending instantly revokes ALL of the user's sessions (their next request redirects to login); a revoked session does NOT come back on reactivation — the user logs in again.
  - **Role change** — student/admin/super_admin.
  - **Force logout** — revokes sessions without suspending.
  - **Reset devices** — clears device registrations (then sessions), useful for shared-account cleanup.
  - **Revoke entitlement** — goes through the existing entitlement resolver; access flips on the student's next request.
- Escalation safety (server-enforced, not UI): you cannot act on a user of equal/higher rank; you cannot target yourself with status/role/force-logout/reset; only super_admin (rank 4) can grant super_admin; the last active super admin cannot be demoted or suspended.

## 10. Announcements (live — Phase 7, `/admin/announcements` → students at `/notifications`)
- Create (always lands as DRAFT), edit (draft or published; archived is frozen), publish, unpublish (back to draft), archive. There is no delete — announcements are permanent operational records.
- Audience: all / students / teachers (teachers reserved until the role ships). Optional schedule (`publish_at`) and expiry (`expires_at`); publishing with an expiry already in the past is rejected.
- Students see ONLY published announcements inside their window and audience — drafts never leak. Unread badge in the student nav + notification center with mark-read / mark-all-read (read state is lazy per ADR-025 — publishing is instant regardless of audience size).
- Bodies are plain text (bilingual ar/en); every lifecycle mutation is audited (`announcements.*`).

## 11. Analytics (live — Phase 7, `/admin/analytics`)
- Deep-dive over the SAME windows: learning funnel (enrolled → active → completions), video (watch time, starts, completions, most-watched), exams (attempts, submissions, pass rate, avg score), commerce (orders, revenue minor units, refunds, redemptions, active subscriptions).
- Definitions (fixed, event-sourced): video start = `video_start` event; video completion = `video_complete`; lesson completion = `lesson_complete`; exam submission = a submitted attempt; watch time = summed watch-session seconds; revenue = paid orders only. Page views are never counted as learning.
- No parallel tracking exists — analytics reads existing tables and writes nothing. Needs `analytics.read`.

## 12. Security & audit (live — Phase 7, `/admin/security`, `/admin/audit`)
- Security center (`security.read`): security events (logins, failures, rate limits, permission denials, suspensions, device actions) with type + free-text filters; active sessions list with per-session revoke (`users.manage`).
- Audit viewer (`audit.read`): append-only trail — actor, action, entity type/id, timestamp, metadata diff; search across actor/action/entity + entity-type filter, 30/page. The viewer is strictly READ-ONLY (the route has no action) — audit rows cannot be edited or deleted from any UI.

## 13. Permission quick-reference (rank 3 `admin` seeded set; super_admin rank 4 bypasses)
Exact seeded set (28 rows, readiness-gate enforced): `cms.read/create/edit/delete/publish/manage_forms/manage_navigation/manage_seo/manage_theme` (9) · `assessment.read/create/edit/delete/publish/grade` (6) · `commerce.read/products/orders/payments/refunds/codes/discounts` (7) · **P7:** `users.read` · `users.manage` · `analytics.read` · `security.read` · `audit.read` · `announcements.manage` (6). Files/videos/entitlements surfaces have no granular rows — they are rank-gated (rank ≥ 3). super_admin (rank 4) bypasses permission checks in code.
