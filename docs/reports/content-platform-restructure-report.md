# Final Report — Restructuring into an Educational Content Platform

**Branch:** `arena/01a0a9db-tito` · **Commit:** `fc83e3e272bd6536f7863af782f6f5194802091e` (pushed, remote SHA verified identical)
**Base:** `81ccf0bd21e723d7694a104a988587ad9355f5ca` (`main`)
**Phase 1 audit:** `docs/reports/content-access-architecture-audit.md`
**Verification:** lint ✓ · typecheck ✓ · unit 37 files / 436 tests ✓ · integration 29 files / 321 tests ✓ (baseline 36/404 + 28/306 = 710 → now 757, zero regressions)

---

## 1. Executive summary

The platform moved from a **course-centric catalogue** to an **educational content platform** whose spine is:

```
السنة الدراسية (Academic Year)
   └─ الصف / المرحلة (Grade)
        └─ المادة (Subject)
             └─ الترم (Term)
                  └─ الدرس (Lesson)
                       └─ محتوى الدرس (video / PDF / file / exercises — none mandatory)
```

Everything was built by **extending the systems already in the repo** (CMS content service, entitlement resolver, commerce engine, activation codes, settings, admin RBAC, i18n) — not by replacing them. The word "كورسات" no longer appears anywhere in the new student-facing information architecture; `courses` survives **only as the internal storage abstraction** for a *term container* (subject + academic year + term), exactly as instructed.

Two hard invariants now hold end-to-end and are covered by tests:

1. **Access is decided on the server, by id.** A grant for «فلسفة ومنطق · الترم الأول» opens that term only — never الترم الثاني, never علم النفس, never another academic year.
2. **Money never grants access by itself.** Order → student submits manual-payment proof → **admin approves** → entitlement. Codes are system-generated, hashed, single-use and scope-bound.

No payment gateway, no hardcoded payment number, no fake WhatsApp automation, no demo content, no visual redesign.

---

## 2. Phase 1 audit outcome (what was already true)

Read before writing any code (`docs/reports/content-access-architecture-audit.md`). Verified facts that shaped the design:

| Area | Finding | Consequence |
|---|---|---|
| Content tables | `programs → grades → subjects → courses → units → lessons → lesson_items` already existed | Reuse; add only `academic_years` + `terms` |
| Access | `accessLevel ∈ public / authenticated / entitled`, `freePreview`, single resolver `resolveAccess` | No new access level needed — "مجاني/مدفوع" is `authenticated`/`entitled` |
| Commerce | Manual rail complete: `createOrder → confirmManualPayment → approveManualPayment → fulfillPaid` | Reuse untouched; only add scope + method snapshot |
| Codes | `codeHash` + `prefix`, atomic conditional claim, `UNIQUE(code_id, student_id)` | Reuse; add `order_id` + scope + `TITO-` prefix |
| Entitlements | `resourceType ∈ subject/course/lesson/product/plan`, `metadata` JSON | Scope lives in `metadata.scope` — **no migration on `entitlements`** |
| Gaps | no academic year, no term, no scope rule, no full-year rule, no order↔code link, prefix `EDU-`, header link `/courses`, locked lesson had no CTA | Exactly the work in this report |

---

## 3. Data model & migration `0012_academic_terms`

**Additive only, backward compatible, no data loss, no destructive DDL.** Applied to the local D1 only; no production database was touched and no `wrangler --remote` was used.

New tables:

- `academic_years` — `id, slug (unique), title_ar, title_en, start_year, end_year, is_current, status, sort_order, created_at, updated_at, deleted_at` + indexes on `(status, sort_order)` and `start_year`. The admin types the label *and* both calendar years; `endYear` must equal `startYear` or `startYear + 1`. Years are **never auto-created**.
- `terms` — `id, slug (unique), title_ar, title_en, starts_at, ends_at, status, sort_order, …`. The number of terms is **not fixed** anywhere in code.

Altered tables:

- `courses` + `academic_year_id`, `term_id` (both nullable) + index `courses_year_term_idx`. When both are set the row *is* a term container.
- `activation_codes` + `order_id` (nullable) + index `activation_codes_order_idx` — links an issued code to the subscription request it came from.

Pipeline: `drizzle-kit generate` → `scripts/sync-migrations.mjs` → `scripts/gen-migrations-manifest.mjs`; `drizzle/meta/_journal.json` now ends at `0012`, `migrations/0000…0012` are in sync, and the embedded copy in `tests/integration/migrations.generated.ts` was regenerated (13 migrations). Existing tables were inspected first — no duplicates, no renames, no drops. Legacy tables (incl. all `assessment_*`) untouched.

---

## 4. Content hierarchy implementation (`server/content/service.server.ts`)

New/extended exports:

- `createAcademicYear`, `createTerm` (+ `createAcademicYearSchema`, `createTermSchema`) — audited like every other node mutation; `isCurrent` is single-select (setting it clears the previous one).
- `listAcademicYears`, `listTerms`, `academicScopeOptions`, `subjectById`, `termById`, `academicYearById`, `gradeById`.
- `studyHub`, `subjectStudyView`, `chainsForStudyView`, `termContainersForSubjectYear`, `termContainerFor`, `ensureDefaultUnit`.
- `ChainRow` now carries `academicYearId / gradeId / termId`, so `chainForLesson` returns the node's academic scope to the resolver.
- `createCourse` accepts and validates `academicYearId` / `termId` against real rows (`assertOptionalContentRef`), so a container can never point at a non-existent year or term.
- `CONTENT_TYPES` / `tableFor` / `MUTABLE` allow-lists extended; `academicYear` and `term` are **excluded from `DuplicableType`** (duplicating a year makes no sense) and are self-ordered roots (`SELF_ORDERED_ROOTS`); `moveNode` added for reordering.

Lesson content stays exactly as it was: `lesson_items` (video / PDF / file / exercise / external quiz). **Nothing is mandatory** — a lesson with zero items is valid, and the item types were not modified.

---

## 5. Real content policy

- **No content was seeded, invented, or generated.** No الصف الثالث الثانوي, no Physics demo, no fake courses/prices/numbers/testimonials/videos/books, no placeholder lessons.
- The two real subjects (فلسفة ومنطق — الصف الأول الثانوي, and علم النفس — الصف الثاني الثانوي / نظام البكالوريا المصرية) are created by the owner in **Admin → المحتوى** with the new year/term cards. The code path is data-driven: adding a year, grade, subject, term or lesson requires **no code change**.
- Every new page is **empty-first**: `/study` with no published subjects renders `study.empty` (`data-testid="study-empty"`), a subject with no terms renders `study-no-terms`. Nothing is faked to fill space.
- Test fixtures create content only inside the test database (`beforeEach` + `wipe()`), never in seeded/production data.

---

## 6. Authorization model (server-side only)

Single decision point preserved: `resolveContentAccess(db, subject, chain)` → `resolveAccess(...)`.

Changes in `server/entitlements/resolver.server.ts`:

- New types `EntitlementScope { kind: "term" | "full_year", academicYearId, subjectId, gradeId?, termId? }` and `ChainScope { academicYearId?, gradeId?, termId? }`.
- `resolveAccess` accepts `chainScope` and passes it to `entitlementCovers`, which returns `true` when **either** the classic chain match hits **or** `scopeCovers(entitlement.scope, chain, chainScope)` hits. Scope can therefore only *add* coverage where the ids genuinely match — it can never widen access by title/slug.
- Lifecycle still wins over everything: `not_published` → `scheduled` → `content_expired` are checked before any role/level logic, so **draft content is invisible to students, the public and the sitemap** (admin bypasses gating but not lifecycle).
- Free = `authenticated` (any registered user) or `public`; paid = `entitled`. `freePreview` still yields `free_preview`.

Changes in `server/entitlements/access.server.ts`:

- `scopeFromMetadata` reads `entitlements.metadata.scope` (validated, fail-closed on malformed data).
- `entitlementsFor(db, studentId, ids, { scopeSubjectId })` additionally pulls scope-only grants via `json_extract(metadata, '$.scope.subjectId')`, so a scope grant that carries no `resourceId` match is still considered.
- `chainScopeOf(chain)` feeds the node's own year/grade/term ids into the verdict.

**Locked ≠ hidden:** a denied lesson still resolves and still renders — as a locked card with a CTA (see §12). Nothing is removed from listings, and no client-side hiding is relied upon anywhere.

---

## 7. Strict scope matching (`scopeCovers`) — the core rule

Id comparison only, in this order:

1. No scope on the entitlement, or no resolvable `chainScope`, or no `subject` ancestor in the chain → **false** (fail-closed).
2. `scope.subjectId !== chain.subjectId` → **false**. *(Philosophy never opens Psychology.)*
3. Missing `scope.academicYearId`, or `chainScope.academicYearId !== scope.academicYearId` → **false**.
4. Both grades present and different → **false**.
5. `kind === "term"` → requires `scope.termId` **and** `chainScope.termId === scope.termId`. *(Term 1 never opens Term 2.)*
6. `kind === "full_year"` → **true** for any term of that subject/year, including a term container published *after* the grant (the rule is re-evaluated against the node's own ids each request).
7. Any other `kind` → **false**.

Proven on real D1 in `tests/integration/content-scope.test.ts`:

- term-scoped code: Philosophy T1 ✓, Philosophy T2 ✗, Psychology ✗
- full-year code: Philosophy T1 ✓, Philosophy T2 ✓, a **later-created** Summer term container ✓, Psychology ✗
- anonymous: ✗ everywhere on entitled/authenticated content
- free lesson: ✓ for any registered student with no entitlement
- draft lesson: ✗ (`not_published`)

Unit matrix in `tests/unit/content-scope.test.ts` (32 tests) covers every branch above, including malformed scope, missing subject ancestor, `termId: null` on a term grant, and unknown scope kinds.

---

## 8. Subscription request lifecycle

States are the existing, unchanged ones: **Pending → Approved / Rejected / Cancelled** (orders) with payment states `pending / under_review / paid / failed / expired / refunded`.

- `createOrder` freezes the entitlement spec into `order_items` (server-computed price; the client never sends amounts).
- `confirmManualPayment` moves the payment to `under_review` with the student's evidence **and now also the rail they used** (`payments.method` + a frozen `instructions.method` snapshot). It grants nothing.
- `approveManualPayment` requires `receivedAmountMinor === order.totalMinor`, is claim-based/idempotent (double approval never double-grants), then `fulfillPaid` writes the entitlement — now with `metadata.scope` when the spec carries one.
- `rejectManualPayment` records a reason; refunds/cancellation revoke entitlements without deleting history.
- The admin queue (**Admin → Commerce → الطلبات/المدفوعات**) now shows, per request: order number, student email **and name**, the rail + destination as frozen at submission, the resolved scope (السنة · الصف · المادة · الترم) from real rows, amount, state, evidence, and — once paid — a direct link to generate that order's code (`data-testid="request-scope"`, `"payment-method-used"`, `"payment-review-row"`).

There is **no** `isSubscribed = true` blanket logic anywhere; a full-year grant is still subject+year bound (§7).

---

## 9. Manual payment rails (no gateways, no invented numbers)

New client-safe module `server/commerce/payment-methods.ts` (no `.server` suffix on purpose — pure, DB-free, bundle-safe like `money.ts`):

- `PAYMENT_METHOD_LABELS` — names only (`instapay`, `vodafone_cash`, `etisalat_cash`, `bank_transfer`, `other`). **No destination is ever contained in code.**
- `isMethodConfigured(m)` — a rail exists only when `enabled === true` **and** `destination.trim() !== ""`.
- `visiblePaymentMethods(methods)` — filters + sorts by the admin's `sortOrder`.
- `findPaymentMethod(methods, id)` — server-side re-validation of the id the student submitted (a disabled/unconfigured rail is rejected, so a student can never pick a dead rail).
- `methodSnapshot(m, locale)` — freezes what the student saw into the payment row; history never rewrites.

Settings (`server/settings/schema.ts`, group `payments`):

```
methods: [{ id, key, enabled, labelAr/En, destination,
            accountNameAr/En, instructionsAr/En, sortOrder }]   // max 12
receiptWhatsappEnabled: boolean
receiptNoteAr / receiptNoteEn: string
```

**Defaults ship all three requested rails DISABLED and with an EMPTY destination** — asserted by test. The owner fills in the real InstaPay handle / Vodafone Cash / Etisalat Cash numbers in **Admin → Appearance → Payments** (`data-testid="payment-methods"`, per-row `payment-method-row-{i}`, plus the receipt block). Until then, students see no rail at all rather than a placeholder. No Paymob / Fawry / Stripe / gateway code exists or was added; the pre-existing mock provider used only by tests was left alone.

---

## 10. WhatsApp receipt hand-off (click-to-chat only)

`buildReceiptMessage(input)` composes a **human-readable** message from real order data: name, email, order number, the resolved scope lines, plan label, rail label, formatted amount, and the line «سأرفق صورة الإيصال في هذه المحادثة» / "I will attach the receipt image in this chat", plus the optional owner note.

`whatsAppReceiptHref(phone, message)` returns `https://wa.me/<digits>?text=<encoded>` or **`null`** when no plausible number is configured (8–15 digits after stripping punctuation) — the UI then hides the block (`data-testid="whatsapp-not-configured"`) instead of linking to a dead chat. The number comes from the existing `platform.whatsapp` setting (Admin → System) and the feature is gated by `payments.receiptWhatsappEnabled`.

No WhatsApp Business API, no webhook, no automation, and no copy anywhere claiming the receipt was received by the system — asserted by a test that scans the generated message for automation wording. Links are rendered per locale (`whatsapp-receipt-link`).

---

## 11. Activation codes

- **Prefix switched `EDU-` → `TITO-`** in `server/commerce/money.ts` (`TITO-XXXX-XXXX-XXXX`, 12 symbols from the 31-char ambiguity-free alphabet, crypto RNG, rejection-sampled). Updated consistently in `app/routes/student/activate.tsx` (placeholder), `tests/unit/commerce.test.ts`, `tests/integration/commerce.test.ts` and `scripts/smoke.mjs`. `normalizeCode` is prefix-agnostic, so **previously printed `EDU-` codes still redeem**.
- **Storage:** SHA-256 of the normalized code + a 4-char `prefix` (`"TITO"`). Plaintext is returned exactly once and is never persisted, never re-readable, and **never written to logs or audit rows** (audit stores batch id, order number, scope metadata, grant count). Asserted by test.
- **Single-use by default:** `maxUses = 1`; the conditional `use_count + 1` claim is the race gate (two students, one code → exactly one winner), and `UNIQUE(code_id, student_id)` catches a same-student double submit. Both paths are integration-tested (`already_redeemed`, `exhausted`).
- **Statuses** in the existing enum `active / disabled / revoked / exhausted`, which map to the brief's vocabulary as: *Unused* = `active` with `use_count = 0`, *Used* = `exhausted`, *Expired* = `expires_at` passed (rejected with reason `expired`), *Revoked* = `revoked`, *Active* = `active`. The enum was deliberately **not** rewritten (reuse over rebuild); the mapping is documented here and rendered in the admin lists.
- **Scope binding:** `activationBatchSchema` accepts `scope: { kind: "term" | "full_year", academicYearId, subjectId, termId? }` (validated by `academicScopeInputSchema`: a `term` scope *requires* a `termId`). `resolveAcademicScope` re-reads every id from real rows — an unknown year/subject/term throws `CommerceReferenceError` (tested) — and stores both the explicit scope and the concrete term-container grants that exist today.
- **Order binding:** `generateCodeForOrder(db, { orderId, actor, maxUses, expiresAt })` requires `order.status === "paid"`, copies the order's frozen spec, sets `activation_codes.order_id`, and audits `commerce.code.issued_for_order`. `codesForOrder` lists them for the admin (prefix + status + `use_count/max_uses`, never plaintext).

---

## 12. Student-facing surfaces

| Route | What it does |
|---|---|
| `/study` (**new**) | المحتوى التعليمي hub: published subjects grouped by grade, with year/term context. Empty-first. |
| `/study/:subjectSlug` (**new**) | Year → Term → Lessons. Each lesson shows its real state (مجاني / مدفوع / مقفول) — locked lessons are **listed, not hidden** — plus per-term CTAs `study-subscribe-{term}` and `study-activate-{term}`. |
| `/learn/:courseSlug/:lessonSlug` | Breadcrumb now reads المحتوى التعليمي › المادة › الترم › الوحدة › الدرس. The locked branch became a real card (`lesson-locked`): scope line (`lesson-locked-scope`), **«الاشتراك الآن»** pointing at the actual purchasable offer for that scope with its real price (`lesson-subscribe-cta`) or an honest "no offer yet" line (`lesson-no-offer`), and **«لديك كود تفعيل؟»** → `/activate` (`lesson-activate-cta`). |
| `/student/orders/:orderNumber` | Request-state alert, scope card (`order-scope`) resolved from real rows, manual-rail radio picker built from `visiblePaymentMethods` (`payment-method-*`, hidden when the owner configured none), and the WhatsApp receipt block. The action passes `methodId`, re-validated server-side. |
| `/student/activate` | Unchanged flow; placeholder now `TITO-XXXX-XXXX-XXXX`. |
| Nav | Header link `/courses` → `/study` in `public/layout.tsx`, plus `student/layout.tsx` and `student/dashboard.tsx`. No visual redesign. |

Free content is visible to **registered** users; anonymous visitors get the existing auth redirect, never a fabricated preview.

---

## 13. Admin surfaces

**Admin → المحتوى** (`admin.content.tsx`, `admin.content.$type.$id.tsx`):

- New **Academic Years** card (`admin-years`) and **Terms** card (`admin-terms`): list + create forms wired to `create-academic-year` / `create-term` intents.
- The node creator gained: a **term container** type (`course` + `academicYearId` + `termId` selects, `creator-year` / `creator-term`), a **درس داخل ترم** type (`termLesson`, which auto-provisions the required unit via `ensureDefaultUnit`), and a **نوع الوصول** select (مدفوع / مجاني للمسجلين / مجاني للجميع → `accessLevel`) for lessons.
- Tree labels use `content.termContainer` instead of "الدورة"; the header hint now reads `السنة الدراسية → الصف → المادة → الترم → الدرس → محتوى الدرس`.
- Free↔paid is a toggle on the existing node editor — no migration, no code change needed later.

**Admin → Commerce** (`admin.commerce.tsx`, `admin.commerce.orders.$id.tsx`):

- Payments/requests queue enriched as described in §8.
- Batch generation gained a **code scope** fieldset (`code-scope`): kind (ترم واحد / السنة كاملة / بدون), academic year, subject, term — with a hint explaining the exact semantics. When a scope is chosen it takes precedence over the product/resource dropdowns and the product binding is cleared, so a batch can never carry two conflicting definitions.
- Order detail gained a **scope card** (`admin-order-scope`, `scope-full-year`) and an **activation-code panel** (`generate-code`): existing codes for the order (`order-codes`) + a guarded generate form (only when the order is `paid` and the admin holds `commerce.codes`), showing the plaintext once (`generated-code`) with an explicit "write it down now" warning.

**Admin → Appearance** (`admin.appearance.tsx`): payment-method editors (12 slots, first = configured) and receipt settings, persisted through the existing `updateSettingsGroup(db, "payments", …)` path (zod-validated, audited, rank ≥ 4 / `ADMIN_ONLY_GROUPS` rules unchanged).

All new mutations go through existing RBAC (`requireRole`, `canCommerce`, `COMMERCE_PERMISSIONS`) and the audit log.

---

## 14. i18n & terminology

- `app/locales/ar.ts` and `app/locales/en.ts` each gained **114 lines**, in strict parity (the `i18n-copy` test enforces key equality): new `study.*` namespace, `content.locked*`, `content.academicYear/term/termContainer/accessLabel/accessFree/accessPaid/accessFreeForAll/treeHint/yearsHint/termsHint/addAcademicYear/addTerm/addTermContainer/addTermLesson`, `commerce.payment*/scope*/subscriptionScope/scopeFullYear`, `commerceAdmin.method/scope/scopeSection/scopeKind/scopeNone/scopeTermOnly/scopeWholeYear/scopeYear/scopeSubject/scopeTermPick/scopeHint/generateCode*/codesForOrder/noCodesForOrder/codeNeedsPaidOrder/expiresAt/receipt*`.
- No duplicate keys (verified programmatically per namespace) and `tsc` passes, which is the compile-time proof of ar/en parity via the shared `Dictionary` type.
- **"كورسات" was not bulk-replaced.** The pre-existing occurrences (legacy SEO hubs, CMS registry, home preset, starter templates) are untouched; the *new* student IA simply never uses the word. Internal `course` naming remains as the legacy abstraction.

---

## 15. SEO & public visibility

- `/study` and `/study/:subjectSlug` are registered in `app/routes.ts` with `contentSeoMeta` + `siteEntitiesMeta` and proper bilingual breadcrumbs/JSON-LD (`breadcrumbJsonLd({ origin, items })`).
- `server/seo/inventory.server.ts` remains DB-driven: only **published** rows are indexable, lessons stay excluded, unit pages stay included. Draft/archived years, terms, containers and lessons can never enter the sitemap because the queries filter on `status = 'published'` and `deleted_at IS NULL`.
- Legacy hubs (`/courses`, `/subjects`, `/grades`, `/curriculum`) were **kept** for existing rankings; only the header link was repointed. `server/seo/realLessons.server.ts` untouched.

---

## 16. Testing, migration safety & verification

New tests:

- `tests/unit/content-scope.test.ts` — **32 tests**: the full `scopeCovers` matrix (term/full-year/wrong subject/wrong year/wrong grade/missing termId/no chainScope/no subject ancestor/malformed kind), `entitlementCovers` + `resolveAccess` end-to-end verdicts, payment-rail visibility & ordering & server-side re-validation, settings defaults shipping disabled+empty, WhatsApp digits/validation/message content (ar+en)/no-link-when-unconfigured/no-automation-wording.
- `tests/integration/content-scope.test.ts` — **15 tests** on real D1: container↔chain scope resolution, locked-not-hidden, free open to registered, anonymous denied, draft closed, term code exactness, single-use race outcomes, revoked code, non-existent scope rejected, plaintext never stored (hash + `TITO` prefix only), full-year across terms **and across a container created after the grant**, request → confirm (no grant) → approve (grant) → order-bound code → second student gets exactly that scope, code refused before payment, and scope text resolved from real rows («2026/2027 · فلسفة ومنطق · الترم الأول · الصف الأول الثانوي»).
- Updated for the prefix change: `tests/unit/commerce.test.ts` (shape + ambiguous-glyph check now applied to the random body, since the brand prefix legitimately contains an `I`; legacy `EDU` normalization still asserted), `tests/integration/commerce.test.ts`, `scripts/smoke.mjs`.

Results:

```
npm run lint        ✓ module boundaries clean
npm run typecheck   ✓ (route typegen + tsc, zero errors)
unit                ✓ 37 files / 436 tests   (baseline 36 / 404)
integration         ✓ 29 files / 321 tests   (baseline 28 / 306)
```

Migration safety: existing tables inspected before generating; `0012` is `CREATE TABLE` + `ADD COLUMN` + `CREATE INDEX` only; applied to the **local** D1 via the repo's own scripts; `drizzle/meta/_journal.json`, `migrations/` and the embedded test manifest are all in sync; no production D1, no deploy, no secrets, no `ADMIN_EMAIL` change, no `wrangler --remote`.

Git safety: single conventional commit on `arena/01a0a9db-tito`, pushed to that branch only, remote SHA verified equal to local (`fc83e3e…`). No force push, no history rewrite, no PR opened, no auto-merge, no deploy.

---

## NOT CHANGED (deliberately)

- **No visual redesign.** Homepage, hero, colors, fonts, layout, cards, nav structure, footer: untouched. No philosopher images, no new image assets, no generated imagery. The only UI added is the minimum needed for the new admin controls, `/study`, and the locked-lesson CTA.
- **Assessment / exams.** `assessment_*` tables, the assessment service, its migrations and the internal exam engine are untouched. The external exam platform stays separate (`https://exams.mansa-eg.workers.dev/`, `questionPlatformEnabled`, `questionPlatformURL`) and its behavior is unchanged.
- **Fixes from commit `5801a776` preserved:** Physics demo stays isolated, the dead `#exams` anchor stays fixed, learning-journey destinations stay fixed, the fake InstaPay number stays removed (the new rails ship empty by design), external-exam behavior and all current tests stay intact.
- **No payment gateway** of any kind (Paymob, Fawry, Stripe, …) was added or imported; the manual rail remains the only path. The mock provider used exclusively by tests was not modified.
- **No WhatsApp API/automation.** Only a click-to-chat link with a templated message.
- **No demo/fake content**: no الصف الثالث الثانوي, no Physics demo course, no fake courses, prices, payment numbers, testimonials, videos or books; no seeded student-visible content whatsoever.
- **Legacy tables, migrations `0000…0011`, and the `courses`/`units` abstraction** were kept (no drops, no renames, no data migration). `activation_codes.status` enum values were kept as-is (mapped, not rewritten).
- **Legacy SEO hubs** `/courses`, `/subjects`, `/grades`, `/curriculum` and `server/seo/realLessons.server.ts` remain, and the existing "كورسات" copy in legacy routes/CMS registry/home preset/starter templates was **not** bulk-replaced.
- **Auth, RBAC, settings service, audit log, files/R2, email, i18n machinery, CMS registry** — reused unchanged (only additive keys/fields where noted).
- **No production action**: no prod D1, no seed, no deploy, no secrets, no API keys, no admin account or `ADMIN_EMAIL` changes. All testing was local.

### Observed but intentionally not fixed (out of scope, non-blocking)

1. `buildEntitlementSpec` does not derive `scope` from a product's term container; product purchases therefore rely on the direct container grant (which works). Deriving a term scope there would only add redundancy — left alone to keep the change minimal.
2. `scripts/backup-lib.mjs` still contains the unrelated `EDUCORE_ALLOW_UNSAFE_RESTORE` guard string (not an activation-code prefix).
3. `docs/CHANGELOG.md` and `docs/reports/phase-6-report.md` still describe the historical `EDU-` prefix; historical documents were left as-written.
4. The repo is a shallow clone locally, so the prompt's SHAs `0f523550` / `5801a776` are not in local history; their fixes were verified behaviorally (tests + code reading) rather than by diff.
