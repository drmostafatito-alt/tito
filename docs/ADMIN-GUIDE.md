# Admin Guide

> Status: **Phase 0 skeleton.** Grows with each phase; complete walkthrough ships with Phase 6.

## 1. First-run (end of Phase 1)
1. Operator runs the seed (DEPLOYMENT.md §6): creates the super_admin account with a one-time generated password.
2. First login forces password change.
3. Super admin: manage admins (role grant), review security settings defaults.

## 2. Defaults applied at Phase 1 (settings → `security`/`devices` groups)
- 1 active device per student; new logins beyond the limit are **blocked** (admin can switch to replace-oldest).
- Sessions: 30-day sliding expiry.
- Rate limits on auth endpoints (per-IP + per-account windows).

## 3. Section guides (links resolve as sections ship)
- Content management — Phase 2
- Video & file management — Phase 2
- Student & device management — Phase 3
- Question bank & exams — Phase 4
- Orders, payments, subscriptions, codes — Phase 5
- CMS, homepage builder, analytics, audit — Phase 6
