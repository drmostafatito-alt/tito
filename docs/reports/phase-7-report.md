# Phase 7 Report — Admin Platform

**Date:** 2026-09-05 · **Code commit:** `cc362a2` · **Report commit:** immediately follows (separate, per project pattern)
**Baseline:** Phase 6 complete at `7cc2e44` (code) / `8a9340a` (report). Phase 7 builds ON the existing domains — nothing was rebuilt, redesigned or replaced. No `git push` was performed.

---

## 1. What was implemented

A real admin platform inside the EXISTING admin architecture (same `/admin` layout, RBAC, audit, settings systems):

- **Admin dashboard v2** (`/admin`) — every metric is real D1 data (users, learning, video, exams, commerce incl. integer-minor-unit revenue), range switcher (today/7d/30d/all), recent registrations, recent audit + activity rows.
- **User management** (`/admin/users`, `/admin/users/:id`) — server-side search/status/role filters + pagination; aggregated detail (entitlements, progress, attempts, orders, security events); audited idempotent actions: suspend/reactivate, role change, force logout, device reset, session revoke, entitlement revoke.
- **Announcements** (`/admin/announcements` → student `/notifications`) — draft→publish→unpublish/archive lifecycle, audiences, schedule + expiry windows, lazy read receipts, student inbox with unread badges (nav + list). This IS the v1 in-app notification system (ADR-025).
- **Analytics** (`/admin/analytics`) — windowed deep-dive over learning/video/exam/commerce aggregates + most-watched videos.
- **Security center** (`/admin/security`) — security-event viewer (type/q filters) + active sessions with revoke.
- **Audit viewer** (`/admin/audit`) — read-only, searchable, paginated trail over the existing append-only `audit_logs`.
- **Supporting services** — `server/analytics/` (aggregation + pure ranges), `server/users/`, `server/announcements/`, `server/audit/query.server.ts`, `server/auth/permissions.server.ts` (`canPlatform` + escalation guards).
- **Migration `0007_little_aqueduct`** (additive), 6 new permissions (floor 22 → 28), i18n ar+en (6 new namespaces), readiness-gate updates, tests (unit +14, integration +35), smoke §17 (+44 checks).

## 2. Reused architecture (nothing rebuilt)

| Existing system | How Phase 7 uses it |
|---|---|
| CMS/content tree (P3) | untouched — content admin stays at `/admin/content`; P7 adds no parallel content UI |
| Auth/RBAC (`requireRole`, `role_permissions`, sessions) | every P7 loader/action gated via `canPlatform` on the SAME permission table; suspend reuses `revokeAllUserSessions` |
| Entitlement resolver (P2/P6) | entitlement revoke on user detail calls the EXISTING `revokeEntitlement` — no new grant/revoke path; order-status edits never grant access |
| Progress (P4) | dashboard/analytics aggregate `lesson_progress`/`video_progress`/`video_watch_sessions`/`events` — read-only |
| Assessment (P5) | assessment admin hub + user-detail attempts read `exam_attempts` only; no engine change; no answer-key exposure |
| Commerce (P6) | `/admin/commerce` untouched; P7 adds platform views reading `orders`/`payments`/`refunds`/`activation_code_redemptions`; revenue = paid `total_minor` only |
| Audit (`logAudit`) | every P7 mutation writes through it; the viewer is a pure read layer (route exports NO action) |
| Security events (P1) | suspend/escalation attempts record events; viewer paginates the existing table |
| Settings (P1/P3) | dashboard module ids extended additively (`announcements`, `expiry`); rate-limit settings unchanged |

**No parallel analytics tracking exists.** Analytics writes nothing; it aggregates the tables that already record reality.

## 3. Admin dashboard

- Tiles (each `data-testid="home-metric-*"`): users-total/students/admins/new-users · enrolled/active-learners/completed-lessons/watched-videos · watch-time/video-starts/video-completions/lesson-completions · attempts/submissions/pass-rate/avg-score · orders/paid-orders/pending-orders/gross/refunded/net/pending-payments/redemptions.
- No hardcoded numbers anywhere; empty DB renders honest zeros/empty states.
- Range switch is a server-side GET re-render (no client-side recomputation).
- Actors lacking `analytics.read` get a `metrics-denied` state instead of data.
- Money is integer minor units end to end; formatted only at the edge (`~server/commerce/money` — client-safe).

## 4. Analytics architecture

- `adminOverview` issues ~20 COUNT/SUM queries in **one `db.batch` round trip** — no N+1, no per-student/per-course loops; `analyticsDetail` and `topWatched` follow the same discipline.
- Definitions (fixed + integration-tested): video starts = `events.video_start`; completions = `video_complete`; lesson completions = `lesson_complete`; exam submissions = `exam_attempts.submitted_at`; watch time = `SUM(video_watch_sessions.watched_seconds)`; revenue = `orders.total_minor` WHERE status `paid`; net = gross − refunds. Page views are never substituted; exactly-once domain events are never double-counted.
- Windows are pure functions (`server/analytics/ranges.ts`, unit-tested): today/7d/30d/all, computed from `now` in ms — all filtering happens in SQL.
- 3 new indexes justify the windows: `video_watch_sessions(started_at)`, `exam_attempts(started_at)`, `orders(status, created_at)`.

## 5. User management

- List: q (name/email LIKE), status, role filters + 20/page — SQL-side, indexed lookups; detail page batches all aggregates (no per-section queries).
- Never exposes: password hashes, session tokens, device keys, activation-code hashes/plaintext — asserted in integration tests and smoke (`$2b$`, `password_hash`, `passwordHash` needle scans).
- Actions (all `users.manage`, audited, idempotent): `setUserStatus` (suspend ⇒ sessions revoked + `user_suspended` security event + audit; reactivate), `setUserRole`, `forceLogoutUser`, `resetUserDevices` (devices THEN sessions), `revokeSessionAdmin`.
- **Escalation matrix (service-enforced, not UI):** target-rank ≥ actor-rank rejected; self-targets rejected; granting `super_admin` requires actor rank 4; last active super admin cannot be demoted/suspended. Proven by integration tests + smoke §17 (rank-3 self-escalation denied, nothing changed, self force-logout denied, self-suspend denied).

## 6. Entitlement management

- User detail shows every grant with source (`admin_grant`/`order_item`/`subscription`/`activation_code`), start/end, status.
- Revoke goes through the EXISTING entitlement service (`revokeEntitlement`) with reason `admin_revoke:<userId-route>` semantics + audit `users.entitlement_revoke`; access flips on the student's next request (resolver untouched).
- No new entitlement system, no order-status shortcut: editing an order never grants/revokes access (P6 invariant, re-asserted by smoke §16 regression).

## 7. Assessment admin (platform visibility only)

- `/admin/assessment` (P5) keeps bank/exam management; P7 adds platform visibility: attempts/submissions/pass-rate/avg-score on the dashboard + analytics, recent attempts list, and per-student attempt history on the user detail page.
- No engine rebuild, no answer-key exposure anywhere (attempt views carry score/status only), RBAC-gated (`assessment.read` / `analytics.read`), student IDOR on attempts already 404-shaped since P5 (regression-tested).

## 8. Commerce admin (platform operational views)

- Orders view (`/admin/commerce` orders tab, P6) + dashboard commerce group: orders count, paid, pending, gross/refunded/**net revenue from verified/paid orders only** — never frontend totals, never pending money.
- Payments review queue, activation-code batch views, redemption counts stay as delivered in P6; P7 adds the aggregated platform lens (analytics commerce section: revenue windows, refunds, active subscriptions, redemptions).
- All commerce mutations remain P6's audited RBAC paths — P7 introduced none.

## 9. Notifications / announcements (FEATURE-SPEC §9, ADR-025)

- Two tables: `announcements` (plain-text bilingual, audience `all|students|teachers`, status draft/published/archived, `publish_at`/`expires_at`/`published_at`) + `announcement_reads` (UNIQUE lazy receipts).
- Lifecycle: create ⇒ always draft; update on draft+published (archived frozen); publish rejects past expiry; unpublish ⇒ draft (keeps `publishedAt`); archive terminal; **no delete path**.
- Visibility computed server-side at read time: published + window open + audience match (admins match `all` only). Drafts never reach students — smoke-proven (draft invisible → publish → visible).
- Student surface: `/notifications` center (unread badges, mark-read, mark-all-read ≤100 rows/call) + nav unread badge (`nav-unread-badge`).
- No fan-out table, no `server/notifications/` module, no email/WhatsApp (verification-gated like payment gateways — ADR-024 discipline). Nothing invented beyond spec.

## 10. Audit & activity

- Every P7 mutation writes an audit row through the existing infrastructure: `users.status_change/role_change/force_logout/reset_devices/session_revoke/entitlement_revoke`, `announcements.create/update/publish/unpublish/archive`.
- Viewer (`/admin/audit`, `audit.read`): actor/action/entity/timestamp/metadata, q-search across actor+action+entity, entityType filter (populated from DISTINCT), 30/page newest-first.
- **Append-only:** the audit route exports NO action; no UI can edit/delete audit rows; smoke asserts the `announcements.publish` trail appears after publishing.
- Dashboard "recent activity" + security center surface the same underlying rows/events read-only.

## 11. Security

Tested (integration + smoke §17), all server-side:
- **IDOR:** student → `/admin/users/:id` denied (302, no data); user isolation via URL holds on every P7 route.
- **Role escalation:** rank-3 → super_admin denied twice (other + self) with "nothing changed" assertion; low-priv actions bounded by the rank guard matrix above.
- **Session enforcement:** suspend kills live sessions immediately (next request 302); revoked sessions stay revoked after reactivation (honest behavior — user must log in again).
- **Secrets:** no password hashes/tokens/device keys/code hashes/provider secrets in any admin payload (needle scans + explicit column exclusion in services).
- **Analytics/audit authorization:** every surface 403s without its read permission; student denied ALL 6 admin paths in smoke.
- **Audit immutability:** read-only viewer (no action export).
- **Commerce state protection:** unchanged P6 invariants regression-verified (paid ≠ authorized without fulfillment; forged webhook rejected).

## 12. Database changes (additive only)

`drizzle/0007_little_aqueduct.sql` (+ migrations copy + manifest): 2 tables (`announcements`, `announcement_reads`), 4 indexes (`announcements_status_publish_idx`, `watch_sessions_started_idx`, `exam_attempts_started_idx`, `orders_status_created_idx`), 6 `INSERT OR IGNORE` permission rows. **No DROP, no rename, no data rewrite, no destructive statement.** Verified: local `.wrangler` cold apply (8/8), isolated fresh DB `--persist-to /tmp/p7-fresh` (8/8, permissions 28/28), integration suite re-applies all migrations to a cold DB every run.

## 13. Tests

- **Unit +14 = 108/108** (`tests/unit/admin-platform.test.ts`): range-window math, `parseRange` defaults, `isVisibleToRole` status/audience/window matrix, money formatting, helpers.
- **Integration +35 = 187/187** (`tests/integration/admin-platform.test.ts`): exact aggregate values over seeded fixtures (users 6/3/2, watch 600s, starts 2, attempts 3/submissions 2/pass 50%/avg 60, gross 10000/refunded 2000/net 8000 minors, redemptions 1); +40d order lands in `all` only; escalation matrix; suspend side effects (sessions/security/audit); announcement lifecycle + visibility + lazy reads + markAllRead cap; user list/detail + no-secret assertions; audit filters; route-level loader 403 / action denial.
- Seed fixture discipline: all analytics test data is isolated test data in the integration DB — never production-like analytics fabrication.

## 14. Full verify

`npm run verify` — **exit 0**: check-imports (boundaries) ✓ · typegen + tsc 0 errors ✓ · unit 108/108 ✓ · integration 187/187 ✓ · production build (client + SSR) ✓.

## 15. Smoke (cold, live `wrangler dev` runtime)

Full cold reset (`rm -rf .wrangler` + jars) → migrations → seed → **273/273 passed, 0 failed** (Phases 1–6 regressions 229 + §17 admin platform 44). §17 journey: Super Admin login → dashboard real metrics (extracted from `home-metric-*` tiles; range switch re-render) → users search → student detail (no secret leak) → promote → rank-3 CAN view users/analytics → rank-3 escalation denied ×3 + nothing changed → suspend → session dies → badge `موقوف` on the user's own badge → reactivate → badge `نشط` → revoked session stays revoked → demote cleanup → IDOR denied → announcement draft invisible → publish → student inbox → unread badge + nav count → mark-read → audit trail `announcements.publish` → analytics/security/sessions/assessment/commerce/audit surfaces → student denied all admin paths. §13 rate-limit checks still run LAST with their full budget.

**Defect found & fixed during smoke development (real cause, not weakened checks):** the first §17 draft registered 2 fresh users and re-logged one in — colliding with the register limiter (5/hour/IP; the run already spends 5) and the login limiter (10/min; earlier sections spend ~9), producing one genuine failure (`reactivated user logs in again — got 200`) and a vacuous session-death check. §17 was rewritten to consume ZERO register/login budget (reuses the §14 student jar + promotes it to admin for the escalation matrix), and status-badge assertions were changed from page-text matching (false-positive risk from filter-dropdown option labels) to the user's own badge element.

Gate (`check-production-readiness.mjs`): permission floor raised to 28 (verified 28/28 both on the seeded DB and the fresh migrate-only DB); new deploy-blocking scan for smoke/demo announcements (`Smoke %`/`إعلان Smoke%`); fresh migrate-only DB passes ALL content/data scans (empty-first provable); the smoked dev DB fails content scans BY DESIGN (demo/smoke rows present).

## 16. Known limitations (honest)

1. Revenue aggregation assumes a single platform currency (EGP); multi-currency would need per-currency grouping.
2. `teachers` audience is reserved — behaves as "no matching users" until a teacher role ships.
3. Analytics renders numbers/tables — no charts yet (brief §27 "charts" deferred; numbers are the source of truth and are all real).
4. User search is LIKE-based (no FTS5 on users) — fine at target scale, index-backed prefix paths where possible.
5. `markAllRead` caps at 100 rows per call (bounded Workers write) — a second click finishes larger backlogs.
6. Role management edits users' roles within the fixed set (student/admin/super_admin); custom-role/permission-matrix editing UI is not shipped (permission rows are migration-seeded).
7. No CSV/export from audit/analytics (view-only surfaces).
8. Sessions viewer lists active sessions platform-wide with revoke; no per-IP grouping.

## 17. Remaining work

- **Phase 8 (hardening & release)** — NOT started per owner instruction: security review & pen checklist, performance pass, accessibility audit, i18n/RTL final pass, Playwright e2e regression suite, real-device matrix, backup/restore rehearsal, deploy runbook, docs finalization.
- Deferred by design: external notification channels (email/WhatsApp — verification-gated, ADR-025), analytics charts, real payment gateway adapter (ADR-024 gate).

## 18. Commits

- **Phase 7 code + docs:** `cc362a2` — "Phase 7: admin platform — real-metrics dashboard, user management with escalation guards, announcements (in-app notifications, ADR-025), read-only analytics aggregation, security center, audit viewer" (52 files, +11,126/−61).
- **Phase 7 report:** this file, committed separately immediately after (project pattern).
- **NOT pushed** — `git push` from the sandbox is forbidden by owner instruction; both commits live on local `main` on top of `8a9340a`.
