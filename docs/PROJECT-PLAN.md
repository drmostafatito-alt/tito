# EduCore (working title) — Project Plan & Phase Guide

> Single source of truth for **scope, phases, and process**.
> Architecture details live in `ARCHITECTURE.md`. Decision rationale lives in `DECISIONS.md`.

**Status: Phases 0–8 delivered (2026-09-05 onward). Phase 3 = CMS / Page Builder (owner-inserted; see ADR-018 for the renumbering of the original plan); Phase 4 = student experience (progress, resume, catalog hierarchy, profile); Phase 5 = assessment engine (question bank incl. pools/randomization + essay/written-response grading, exam builder, attempt engine, auto-grading, results/review — ADR-022); Phase 6 = commerce engine (products & server-side pricing, orders, manual payment rail + proof submission, activation codes, discounts, subscriptions, refunds/revocation, signature-verified webhook pipeline — ADR-023/ADR-024); Phase 7 = admin platform (real-metrics dashboard, user management + escalation-safe role/status actions, announcements = in-app notifications per ADR-025, read-only analytics aggregation, security center, audit viewer — built ON the existing domains, zero parallel tracking); Phase 8 = hardening & release (W0–W10, see `docs/reports/phase-8-*`). Homework/assignments engine delivered (engine + schema + admin builder + student list/detail + text/file submission). Post-8 operational hardening batches delivered on the working branch `arena/01a07d8c-tito`: **A** bulk activate/suspend, **B** admin "needs attention" counters, **C** admin announcement preview, **D** manual-payment proof submission + review (secure private-file evidence), **E** course prerequisites (completion-gated DAG) + clone/archive/scheduling review with learner gating. Remaining steps are **owner-only** (see `docs/DEPLOYMENT.md` and the phase-table notes below): production deploy runbook execution, `bootstrap-admin --remote`, real video/payment provider credentials, and the real-device/iOS matrix — all engineering work is complete.**

---

## 1. Product summary

A commercial educational platform (Egypt-first, Cloudflare-hosted) with:

- Free + paid content at every granularity (lesson / course / subject / bundle / subscription)
- Monthly, term, annual, and custom-duration subscriptions; activation codes; admin-granted access
- Hierarchical content: Program → Grade → Subject → Course → Unit → Lesson → Lesson items (video / file / quiz)
- Secure video streaming behind a swappable provider layer (Mux initially)
- Question bank + full exam engine (server-authoritative timing, autosave, manual essay grading)
- Admin-first configurability: CMS, pricing, access policy, device policy, security policy — no code deploys for routine changes
- Device management and layered account-sharing deterrence
- Payment abstraction with verified-only gateway integrations (Egypt-compatible candidates: Paymob, Fawry; Stripe only if merchant entity permits)

## 2. Non-negotiable rules (from the project brief)

1. Correctness, security, and data integrity over delivery speed.
2. All authorization enforced **server-side**. The frontend never decides access.
3. **No fabricated integrations.** Every external provider adapter requires a verification pass against current official documentation, recorded in `DECISIONS.md`, *before* implementation.
4. Business rules an administrator should control live in the settings/configuration layer, never hard-coded.
5. Phased delivery, with regression checks between phases (see §6).
6. No destructive schema changes without export/backup + verification (see `DEPLOYMENT.md` when written).
7. Video and payment providers are abstracted behind interfaces; business logic never imports vendor SDKs.
8. Exam integrity never depends on browser timers.
9. Protected files/videos are never exposed via public URLs; access credentials are minted server-side after entitlement checks.

## 3. Phase plan

| # | Phase | Scope summary | Exit criteria (tests must pass) |
|---|-------|---------------|--------------------------------|
| 0 | Architecture & planning ✅ | This document, `DECISIONS.md`, then the full doc set (§7) | Docs approved by owner ✅ |
| 1 | Foundation ✅ | Repo scaffold, env strategy, D1 + typed schema & migrations (identity/platform domains), authentication, RBAC, sessions + devices core, settings service, audit log, security middleware, base design system + layout | ✅ verified 2026-09-05 (report + TEST-PLAN §6) |
| 2 | Content domain ✅ | Content hierarchy + admin CRUD, slugs/status/visibility/ordering, thumbnails, files + R2 signed access, VideoProvider abstraction (mock + Mux adapters), catalog & lesson pages gated by entitlement engine, menus from settings | ✅ verified 2026-09-05: signed-URL discipline (tamper/expiry/perm-swap → 404), mock playback green, Mux adapter env-gated (loud `VideoNotConfiguredError`, no silent fallback), 104-check HTTP smoke (report + TEST-PLAN §6) |
| 3 | CMS / page builder ✅ | Owner-inserted phase (ADR-018): data-driven UI — pages CRUD + draft/preview/publish + versions/rollback, block registry (typed zod schemas, ~40 block types), branding/theme tokens, icon registry, navigation & footer builders, configurable forms, SEO, fine-grained CMS permissions, audit on every mutation, production-readiness gate (`check:production-readiness`), empty-first production content policy (ADR-020) | Routine visual/content changes need zero deploys; drafts never public; no script/HTML/CSS injection; forms cannot execute code; readiness script fails on any demo/placeholder content; Phases 1–2 regression green |
| 4 | Student experience ✅ | Progress & resume tracking (DB-backed: lesson/video progress, watch sessions, events), server-decided completion threshold, replay limit enforced at credential minting, catalog hierarchy pages (programs/subjects), course/unit pages with per-lesson verdicts + progress, student dashboard from real data (continue learning, stats, course %), student profile page, student mobile nav + CMS student menu. (Device management UI shipped in P1 security page; notifications/announcements deferred to P7 per FEATURE-SPEC §9) | ✅ verified 2026-09-05: playback denied without entitlement (401/403 at every gate); replay limits enforced server-side at mint (admin bypass); resume works across sessions (smoke: heartbeat → re-mint → resumeAt); 162-check cold smoke + 12 integration progress tests (report + TEST-PLAN §6) |
| 5 ✅ | Assessment engine | Question bank (MCQ / true-false / multi-select / essay; explanations, difficulty, tags, review workflow), exam builder (pools, randomization, distributions, windows, attempt & visibility policies), attempt engine (server timing, autosave, reconnect recovery, idempotent submission), auto-grading + manual essay queue, results & review modes | Client cannot bypass timing; refresh/network-loss recovery verified; duplicate submissions impossible; randomization stable per attempt |
| 6 ✅ | Commerce | Products & pricing (incl. promos), discount codes, orders/order items, PaymentProvider abstraction + **Manual rail first** (transfer + admin approval), gateway adapter(s) only after verification ADR, webhook ingestion + signature verification + reconciliation, payment events, subscription lifecycle, activation codes (hashed, batched, product-bound), transactional entitlement grants | No access without verified webhook or admin approval; webhook signature tests pass; code redemption concurrency-safe; refunds adjust entitlements per policy |
| 7 | Admin platform ✅ | Complete admin dashboard (all sections from brief §27) with search/filter/sort/pagination; homepage builder & CMS blocks; menus/footer/contact/social/WhatsApp settings; announcements broadcast; analytics events & charts; usage visibility for cost-sensitive services. DELIVERED as read/aggregate layer over existing domains: `/admin` real-metrics dashboard (users/learning/video/exams/commerce, range switch, ~20 batched queries), `/admin/users` + `/admin/users/:id` (search/filters/pagination, aggregates, escalation-safe status/role/session/device actions + entitlement revoke via existing resolver), `/admin/analytics` (windows today/7d/30d/all), `/admin/security` (events + active sessions), `/admin/audit` (read-only viewer), `/admin/announcements` + student `/notifications` (draft→publish lifecycle, audiences, lazy reads, nav badge — ADR-025) | ✅ verified 2026-09-05: `npm run verify` green (unit 108/108, integration 187/187 incl. 35 `admin-platform.test.ts`, build, boundaries); cold smoke **273/273** with §17 (dashboard real metrics → users search/detail/no-secret-leak → promote → rank-3 escalation denied ×3 → suspend → session dies → reactivate → badge states → IDOR denied → announcements draft-invisible → publish → student inbox → unread badge → mark-read → audit trail → analytics/security/assessment/commerce/audit surfaces → student denied all 6 admin paths); migration `0007_little_aqueduct` additive (fresh-DB 8/8, permission floor 28/28 gate-enforced); report: `docs/reports/phase-7-report.md` |
| 8 ✅ | Hardening & release | Security review & pen checklist, performance pass, accessibility audit, i18n/RTL final pass, Playwright e2e regression suite, real-device mobile/iOS matrix, backup/restore rehearsal, production deploy runbook, docs finalization | `TEST-PLAN.md` fully executed incl. device matrix; runbook matches reality; `CHANGELOG.md` current |

Each phase is delivered with the **per-phase report** defined in §5 before the next phase begins.

## 4. Phase dependencies

```
P0  planning
 └─ P1  foundation (auth, RBAC, DB, settings, audit, layout)
     ├─ P2  content domain (hierarchy, files, video abstraction)
     │   ├─ P3  CMS / page builder ✅ (needs content + settings; ADR-018/019/020)
     │   ├─ P4  student experience ✅ (needs content + progress)
     │   └─ P5  assessment engine (needs content hierarchy)
     ├─ P6  commerce (needs P1; unlocks full paid gating for content)
     └─ P7  admin platform (consolidation; grows incrementally during P2–P6)
P8  hardening & release (always last)
```

**Documented deviation from the brief's phase list:** the brief places "Entitlements" in Phase 5 (brief numbering; commerce is Phase 6 after the ADR-018 renumbering). We build the entitlement *engine* (schema + resolver service + admin-grant and free-tier sources) in Phases 1–2, because content access gating in Phases 2–4 depends on it. Commerce then adds purchase / subscription / activation-code sources to the same engine. See `DECISIONS.md` ADR-009.

## 5. Per-phase report format (mandatory, per brief §57)

Every phase report contains exactly:

1. What was implemented
2. Files changed
3. Database changes (migrations applied)
4. Environment variables added
5. Security considerations
6. Tests performed (with results)
7. Known limitations
8. Next phase

## 6. Regression checklist (before every significant deploy)

- [ ] Auth: register / login / logout / reset / change password
- [ ] RBAC: student/teacher cannot reach admin routes **server-side**
- [ ] Free vs paid gating for content (entitlement unit tests + route checks)
- [ ] Video: token issuance requires entitlement; replay limit; resume position
- [ ] Files: signed-URL expiry; view-vs-download permission
- [ ] Exams: server timing, submit idempotency, attempt limits
- [ ] Commerce (once present): no access without verified payment; webhook idempotency
- [ ] Mobile smoke: iPhone Safari (real device), Android Chrome, desktop Chrome/Edge
- [ ] Performance smoke: key pages within budget

## 7. Documentation index (brief §50)

| File | Answers | Status |
|------|---------|--------|
| `docs/PROJECT-PLAN.md` | What/when/how we build | ✅ Phase 0 |
| `docs/DECISIONS.md` | Why each choice; verification queue | ✅ Phase 0 (owner decisions locked 2026-09-05) |
| `docs/ARCHITECTURE.md` | System design | ✅ Phase 0 |
| `docs/DATABASE-SCHEMA.md` | ERD + DDL reference | ✅ designed (implementation per phase) |
| `docs/FEATURE-SPEC.md` | Feature behavior specs | ✅ v1 (grows per phase) |
| `docs/SECURITY.md` | Security model & checklist | ✅ Phase 0 |
| `docs/DEPLOYMENT.md` | Environments, runbooks, backups | ✅ Phase 0 (validated at first deploy) |
| `docs/TEST-PLAN.md` | Strategy + device matrix | ✅ Phase 0 (execution log per phase) |
| `docs/PAYMENTS.md` | Rails, states, verification records | ✅ Phase 0 (P6: manual rail + codes live; NO real gateway verified → mock adapter only, log §6 updated) |
| `docs/VIDEO-PROVIDERS.md` | Abstraction + adapters | ✅ Phase 0 (Mux playback verified 2026-09-05) |
| `docs/ADMIN-GUIDE.md` | How the admin runs the platform | ✅ complete (Phase 7) |
| `docs/CHANGELOG.md` | History | ✅ current |

## 8. Source-of-truth maintenance rules

- Docs are updated **in the same phase** as the code they describe; a phase is not complete until docs match reality.
- Any architecture change gets an ADR in `DECISIONS.md` *before* implementation.
- Any external API integration gets a verification entry (with doc links) in `DECISIONS.md` *before* its adapter is written.
