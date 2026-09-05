# EduCore (working title) — Project Plan & Phase Guide

> Single source of truth for **scope, phases, and process**.
> Architecture details live in `ARCHITECTURE.md`. Decision rationale lives in `DECISIONS.md`.

**Status: Phase 0 — Architecture & Planning. No application code has been written.**

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
| 0 | Architecture & planning *(current)* | This document, `DECISIONS.md`, then the full doc set (§7) | Docs approved by owner |
| 1 | Foundation | Repo scaffold, env strategy, D1 + typed schema & migrations (identity/platform domains), authentication, RBAC, sessions + devices core, settings service, audit log, security middleware, base design system + layout | Auth flows verified; role guards server-enforced; sessions device-bound; CSP/headers verified; super-admin seed |
| 2 | Content domain | Content hierarchy + admin CRUD, slugs/status/visibility/ordering, thumbnails, files + R2 signed access, VideoProvider abstraction (mock + Mux adapters), catalog & lesson pages gated by entitlement engine, menus from settings | Protected files only via short-TTL signed URLs post-check; mock playback works; Mux adapter env-gated |
| 3 | Student experience | Student dashboard, progress & resume tracking, secure playback flow (token minting, replay rules, completion threshold), watch history, device management UI (student + admin), in-app notifications & announcements | Playback denied without entitlement; replay limits enforced server-side; resume works across sessions |
| 4 | Assessment engine | Question bank (MCQ / true-false / multi-select / essay; explanations, difficulty, tags, review workflow), exam builder (pools, randomization, distributions, windows, attempt & visibility policies), attempt engine (server timing, autosave, reconnect recovery, idempotent submission), auto-grading + manual essay queue, results & review modes | Client cannot bypass timing; refresh/network-loss recovery verified; duplicate submissions impossible; randomization stable per attempt |
| 5 | Commerce | Products & pricing (incl. promos), discount codes, orders/order items, PaymentProvider abstraction + **Manual rail first** (transfer + admin approval), gateway adapter(s) only after verification ADR, webhook ingestion + signature verification + reconciliation, payment events, subscription lifecycle, activation codes (hashed, batched, product-bound), transactional entitlement grants | No access without verified webhook or admin approval; webhook signature tests pass; code redemption concurrency-safe; refunds adjust entitlements per policy |
| 6 | Admin platform | Complete admin dashboard (all sections from brief §27) with search/filter/sort/pagination; homepage builder & CMS blocks; menus/footer/contact/social/WhatsApp settings; announcements broadcast; analytics events & charts; usage visibility for cost-sensitive services | Routine content/price/CMS changes need zero deploys; all admin actions audited; lists paginate under seeded scale |
| 7 | Hardening & release | Security review & pen checklist, performance pass, accessibility audit, i18n/RTL final pass, Playwright e2e regression suite, real-device mobile/iOS matrix, backup/restore rehearsal, production deploy runbook, docs finalization | `TEST-PLAN.md` fully executed incl. device matrix; runbook matches reality; `CHANGELOG.md` current |

Each phase is delivered with the **per-phase report** defined in §5 before the next phase begins.

## 4. Phase dependencies

```
P0  planning
 └─ P1  foundation (auth, RBAC, DB, settings, audit, layout)
     ├─ P2  content domain (hierarchy, files, video abstraction)
     │   ├─ P3  student experience (needs content + progress)
     │   └─ P4  assessment engine (needs content hierarchy)
     ├─ P5  commerce (needs P1; unlocks full paid gating for P2/P3 content)
     └─ P6  admin platform (consolidation; grows incrementally during P2–P5)
P7  hardening & release (always last)
```

**Documented deviation from the brief's phase list:** the brief places "Entitlements" in Phase 5. We build the entitlement *engine* (schema + resolver service + admin-grant and free-tier sources) in Phases 1–2, because content access gating in Phases 2–3 depends on it. Phase 5 then adds purchase / subscription / activation-code sources to the same engine. See `DECISIONS.md` ADR-009.

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
| `docs/PAYMENTS.md` | Rails, states, verification records | ✅ Phase 0 (gateway log filled at Phase 5) |
| `docs/VIDEO-PROVIDERS.md` | Abstraction + adapters | ✅ Phase 0 (Mux playback verified 2026-09-05) |
| `docs/ADMIN-GUIDE.md` | How the admin runs the platform | ✅ skeleton (complete at Phase 6) |
| `docs/CHANGELOG.md` | History | ✅ current |

## 8. Source-of-truth maintenance rules

- Docs are updated **in the same phase** as the code they describe; a phase is not complete until docs match reality.
- Any architecture change gets an ADR in `DECISIONS.md` *before* implementation.
- Any external API integration gets a verification entry (with doc links) in `DECISIONS.md` *before* its adapter is written.
