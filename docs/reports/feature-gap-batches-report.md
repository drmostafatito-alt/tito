# Feature-Gap Batches 1–4 — Implementation & Readiness Report (branch `arena/01a07d8c-tito`)

Date: 2026-09-08 · Branch: `arena/01a07d8c-tito` only (no merge, no PR) · Dr Mostafa Tito platform.

This report records the feature-gap implementation batches delivered in place on the working
branch. It is the "Batch 5" QA / documentation / production-readiness evidence step.

---

## 1. Summary of delivered batches

| # | Area | Commit | Pushed & remote-verified |
|---|------|--------|--------------------------|
| 1 | Transactional email abstraction + **password reset** dispatch (single-use hashed expiring token, session revocation, enumeration-safe, rate-limited, audited) | `829c0b8` | ✅ |
| 2 | **Email change + verification** flow + **welcome email** (migration `0013_email_change_tokens.sql`, atomic claim, ownership re-check, single-use, enumeration-safe, profile UX + public verification route) | `6fb120c` | ✅ |
| 3 | **Teacher authoring role + admin Teachers section + teacher-permission matrix** (rank-2 authoring only when the teacher role holds an `assessment.*` row; grant restricted to authoring allowlist; reused admin question-bank editors for granted teachers) | `2de64f7` | ✅ |
| 4 | **Question-bank bulk tag/status + permission wiring** + additive search over stem/explanation | `f86074e` | ✅ |

Remote HEAD equals local HEAD (verified after each push; tree clean).

---

## 2. Implemented vs deferred

**Implemented and tested:**
- Password reset (Batch 1) and email change + verification + welcome email (Batch 2), including
  `email_change_tokens` schema, security-event types, rate-limit settings, email templates/service,
  locale keys, and a full integration suite.
- Teacher role RBAC: `canAssessment` accepts a rank-2 teacher **only** when the teacher role holds
  the relevant `role_permissions` row (students never; un-granted teachers never).
- `server/teachers/service.server.ts`: role-scoped teacher permission matrix, `setTeacherPermission`
  restricted to the `assessment.*` authoring allowlist (billing/payment/user-admin/security/system
  permissions **unreachable**), write restricted to super_admin or admin with `users.manage`, every
  grant/revoke audited.
- Admin Teachers hub `/admin/teachers`: search/filter/paginate teachers, activate/suspend
  (confirmed + audited), and the permission-matrix editor.
- Teacher authoring reach via the existing admin shell: granted teachers land in the question-bank
  hub, the sidebar is filtered to the assessment area for them, grading tab is gated behind
  `assessment.grade`, and every other admin module remains admin-only (each leaf independently
  re-checks `requireRole(3)` / its permission).
- Question-bank **bulk status** and **bulk tagging** (per-row workflow rules, per-row results never
  abort a batch, idempotent tag union, unknown tags ignored), hub `bulk-status`/`bulk-tag` action
  with permission wiring (publish → `assessment.publish`, otherwise/tag → `assessment.edit`) and
  per-change audit, plus a bulk-bar UI.

**Deferred / documented (not blocking the branch work):**
- A dedicated **FTS5 virtual-table index** over the question bank is not switched on. D1/miniflare
  FTS5 support was **verified available** (probe passed), but replacing the shipped substring
  search risks Arabic-tokenization regressions for little functional gain; question-bank search is
  instead shipped (additively widened to stem + explanation) and FTS5 remains an easy owner-side
  enhancement (create `questions_fts` + triggers; no schema-to-code change required elsewhere).
- Production **email delivery** is not live (no credentialed provider configured). Code, adapters,
  tests and templates are complete; this is an owner-only action (see §8).

---

## 3. Exact commits (local HEAD == remote for each batch)

- Batch 1 — `829c0b8db918441ca7001f3b5f244ce53514a135`
- Batch 2 — `6fb120c65217565806eae060cf367c4775e2cfc0`
- Batch 3 — `2de64f74f1572bfa29cc1a40cce623ab74c09afd`
- Batch 4 — `f86074e9534e5f7c5e7a5c7efbf0938e6419aa16` (current HEAD)

Remote `origin/arena/01a07d8c-tito` HEAD = `f86074e9534e5f7c5e7a5c7efbf0938e6419aa16` (verified).

---

## 4. Verification per gate

`npm run verify` (lint:imports → typegen + `tsc` → unit → integration → production build) is **green**
after each batch.

- **Unit** suite: **19 files / 152 passed**.
- **Integration** suite: **21 files / 295 passed**, including the new suites:
  - `tests/integration/emailchange.test.ts` — **5/5**
  - `tests/integration/teachers.test.ts` — **9/9**
  - `tests/integration/questionbulk.test.ts` — **6/6**
- **Production build** completes; `git diff --check` clean.
- No regression observed in pre-existing suites (auth, admin-platform, assessment, commerce,
  content-*, assignments, cms, progress, access, files, video, announcements-preview, admin-bulk,
  admin-ops, rate-limit, student360).

---

## 5. Migration status

- Migration chain runs through **`0013_email_change_tokens.sql`** (added in Batch 2).
- No schema change was needed for Batches 3–4 (teacher authoring reuses the existing `role_permissions`
  table; bulk ops reuse existing tables), so no new migration was added and the manifest was not
  bumped beyond the existing embedding (**14 embedded migrations** in `tests/integration/migrations.generated.ts`).

---

## 6. Security checks performed (and enforced by tests)

- **Never-grantable to the teacher role**: `users.*`, `commerce.*`, `billing.*`, `security.read`,
  `audit.read`, `system.settings`, etc. → `setTeacherPermission` returns `bad_permission` and writes
  nothing (tested).
- Role-scoped grants: a permission is granted on the `teacher` role only; other roles are untouched.
- Write authorization: super_admin or an admin holding `users.manage`; teachers and students are denied.
- Teacher authoring is fail-closed: a teacher is refused unless an `assessment.*` row exists; students
  are refused at the layout; every non-authoring admin module stays admin-only.
- Auditing: teacher grant/revoke (`rbac.teacher.*`) and bulk question changes (`assessment.question.bulk_*`)
  write audit rows (tested).
- Email/token behavior remains fail-closed and enumeration-safe; tokens are single-use, hashed,
  expiring, never exposed in production UI/API.
- No secrets/credentials are stored in source, logs, or the client.

---

## 7. Workspace size

- Source/tests/docs (excluding `node_modules`, `.git`, `build`): **≈ 13 MB** (well under the 90 MB limit).
- Only reproducible build output (`build/`) is generated during `verify`; no source/test/migration/doc
  was deleted.

---

## 8. Remaining OWNER-ONLY production actions (not blocked on this branch)

These require operator credentials/environments and are documented in `docs/DEPLOYMENT.md`,
`.dev.vars.example` and `docs/DECISIONS.md` — the code, tests and adapters are complete on the branch:

1. **Email provider**: select/credential a provider (Resend / MailChannels / SES); set
   `EMAIL_PROVIDER=<id>` in production; verify delivery (email verification + password reset + welcome).
2. **Deployment/readiness** (from the earlier phase-8 report §17): real Mux video, payment-gateway
   verification (currently manual/mock rails), production secrets, domain/SSL/HSTS/WAF, monitoring +
   backups, `bootstrap-admin --remote`, remote readiness gate.
3. (Optional, not blocking) switch the question-bank search to a dedicated **FTS5** index.

---

## 9. PR-readiness verdict

No pull request is opened (per standing instruction). The branch `arena/01a07d8c-tito` carries the
feature-gap batches 1–4, each tested, committed, pushed, and remote-SHA verified, with a clean
working tree and a green full `verify`. The code is engineering-complete for these gaps; the only
items remaining before production go-live are the **owner-only credential/ops actions** in §8.
