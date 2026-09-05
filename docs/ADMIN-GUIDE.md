# Admin Guide

> Status: **skeleton + live Phase 2 sections (§3–§5 below).** Grows with each phase; complete walkthrough ships with Phase 6.

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

## 6. Section guides (links resolve as sections ship)
- Student & device management — Phase 3
- Question bank & exams — Phase 4
- Orders, payments, subscriptions, codes — Phase 5
- CMS, homepage builder, analytics, audit — Phase 6
