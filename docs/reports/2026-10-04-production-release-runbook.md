# Production release runbook — `dr-mostafa-tito`

**Release commit:** `09b78bb` (branch `arena/01a10087-tito`, PR #16 → `main`)
**Target Worker:** `dr-mostafa-tito` · **URL:** https://dr-mostafa-tito.drmostafatito.workers.dev
**Written:** 2026-10-04

This release **could not be deployed from the audit environment** — it has no Cloudflare
credentials and no network egress to the Worker origin (see "Why this is blocked" below).
Everything that does not require those two things has already been done and is green.
This document is the remaining work, in order, for an operator who has both.

---

## 0. What is already verified (do not redo)

| Gate | Result |
|---|---|
| `npm run lint` | PASS — module boundaries clean |
| `npm run typecheck` | PASS |
| `npm run test:unit` | 474 / 474 |
| `npm run test:integration` | 323 / 323 |
| `npm run build` | PASS |
| `npm run check:deploy-config` | PASS |
| Local browser QA | 342 / 342 route × viewport combinations (anon + student + admin, 320→1440) |
| Local interaction / admin / CMS / media suites | 21/21 · 15/15 · 7/7 · 17/17 |
| Working tree | clean, pushed, no secrets, no large artifacts |

**This release is code-only.** `git diff dda0f95..09b78bb` touches **no migration, no schema
file and no seed script**. Deploying it cannot alter a single row of production data.

---

## 1. Why this is blocked (evidence)

```
$ wrangler whoami
You are not authenticated. Please run `wrangler login`.

$ wrangler secret list
ERROR  In a non-interactive environment, it's necessary to set a
       CLOUDFLARE_API_TOKEN environment variable for wrangler to work.

$ curl https://dr-mostafa-tito.drmostafatito.workers.dev/
curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL      # TCP 443 opens, TLS is reset
$ curl https://registry.npmjs.org/                      # control
200
```

A real Chromium fails the same way (`net::ERR_CONNECTION_CLOSED`), so scripted production
browser QA is impossible from the audit environment, not merely inconvenient.

`wrangler deploy --temporary` was **deliberately not used**: it publishes to a throwaway
preview account, which is not the `dr-mostafa-tito` Worker.

---

## 2. Pre-deploy — confirm production secrets exist

Secrets are **not** in `wrangler.jsonc` (correctly). Confirm each of these is present on the
`dr-mostafa-tito` Worker before deploying. **Only check presence — never print a value.**

```sh
wrangler secret list            # names only; compare against the list below
```

Required by the Worker code:

| Secret | Needed for |
|---|---|
| `SESSION_PEPPER` | session hashing — **auth breaks without it** |
| `FILE_URL_SECRET` | signed `/files/:id` URLs — **private media breaks without it** |
| `RESEND_API_KEY` | transactional email (`EMAIL_PROVIDER=resend`) |
| `MUX_TOKEN_ID` | Mux API |
| `MUX_TOKEN_SECRET` | Mux API |
| `MUX_SIGNING_KEY_ID` | signed playback |
| `MUX_SIGNING_PRIVATE_KEY` | signed playback |

`MUX_PLAYBACK_RESTRICTION_ID` is already a plain var in `wrangler.jsonc` — no action.
`MOCK_VIDEO_SECRET` / `MOCK_PAYMENTS_SECRET` / `TEST_CAPTURE_SECRET` are **test-only** and
must **not** be set in production.

**If any required secret is missing: stop.** Do not invent a value, do not use a placeholder.
Obtain the real value from the owner and set it with `wrangler secret put <NAME>`.

Non-secret production config, already committed and checked:

```
name                 dr-mostafa-tito
ENVIRONMENT          production
APP_ORIGIN           https://dr-mostafa-tito.drmostafatito.workers.dev
EMAIL_PROVIDER       resend
EMAIL_FROM           Dr Mostafa Tito <onboarding@resend.dev>
AUTH_PBKDF2_ITERATIONS  100000
DB                   tito-prod  (7000f1a0-d35f-4d03-ba8b-c24bf2e9389a)
R2                   tito-public-assets-prod / tito-private-files-prod / tito-video-masters-prod
```

> `EMAIL_FROM` still uses the Resend onboarding sender (`onboarding@resend.dev`). Deliverability
> on a real domain will be poor. Worth switching to a verified domain sender, but it is a config
> change, not a code change, and is out of scope for this release.

---

## 3. Database safety

- The binding points at **`tito-prod`** only. There is no reference to the old `educore`
  Worker, the old D1 or the old R2 anywhere in `wrangler.jsonc`.
- `migrations/` contains 13 files and **none** contain `DROP TABLE`, `DELETE FROM` or `TRUNCATE`.
- This release adds **zero** migrations, so there is nothing to apply. **Do not run
  `db:migrate`, `db:seed`, `e2e-reset` or any `--remote` write against `tito-prod`.**
- Take a backup first anyway: `node scripts/backup.mjs` (restore path: `scripts/restore.mjs`).

---

## 4. Deploy

```sh
git checkout main && git pull            # after PR #16 is merged
npm ci
npm run deploy
```

`npm run deploy` is already a gated pipeline — it runs `check:deploy-config`, then `verify`
(lint + typecheck + tests + build + dependency audit), then
`check:production-readiness:remote` against the real D1, and only then `wrangler deploy`.
**Do not bypass it with a bare `wrangler deploy`.**

`check:production-readiness:remote` is the gate that judges production itself (no demo
accounts, no seed content, video provider not `mock`, migration set matches, an active super
admin exists, reset-token hygiene). It could not run here. If it fails, **fix the finding —
do not skip the gate.**

> The *local* run of that same script reports 3 failures (demo accounts, seed content rows,
> `provider=mock`). Those are the local E2E fixtures, **not** production state. Ignore them;
> the `--remote` run is the one that matters.

Record after deploying: **deployment version id**, **timestamp (UTC)**, **worker URL**.

---

## 5. Post-deploy browser QA (the step that decides PASS/FAIL)

Open the real site in a real browser. Nothing below is satisfied by reading code.

**Anonymous** — `/`, `/study`, `/about`, `/login`, `/register`.
**Student** — register or log in → dashboard → refresh (session must survive) → study →
subject → lesson → logout → log in again.
**Admin** — log in → `/admin` → refresh → navigate CMS / appearance / media / identity →
logout → log in again.

**Click, don't look:** logo · Home · Study · About · Login · Register · Admin · hero CTA ·
subject cards · lesson cards · video cards · social icons · WhatsApp · footer links ·
mobile menu · drawers · close buttons · back buttons.

**Responsive:** 320 · 360 · 375 · 390 · 414 · 768 · 1024 · 1280 · 1440.
Focus on buttons, cards, hero, navigation, mobile drawers, footer, WhatsApp, forms, admin.

**Authorization:** anonymous cannot reach `/admin`; a student cannot reach `/admin` or call
admin endpoints; an admin can; logout invalidates the session; refresh preserves a valid one.
If a Device Trust error appears, **diagnose it — do not bypass it.**

### Three specific things to confirm, because they are what this release changed

1. **Homepage counts agree with `/study`.** Production currently shows "2 محتوى تعليمي" on the
   grade chips against "24 درس" on `/study`. After the deploy the chips must count lessons
   correctly with proper Arabic plurals (`مادة واحدة / مادتان / 24 مادة`).
2. **No dead social or contact element.** In the contact block, واتساب / فيسبوك / تيك توك /
   يوتيوب currently render as non-links. After the deploy, anything with no configured URL
   must be **absent**, and anything present must navigate. There must be no `<a>` without a
   destination anywhere on the page.
3. **No decorative philosopher imagery.** `kant-sm.webp`, `descartes.webp`, `aristotle.webp`,
   `jung.webp`, `nietzsche-sm.webp` currently appear as ornament on `/study` and the subject
   pages. After the deploy the only portrait that may remain is the owner-selected figure
   inside a `quote_cards` block, i.e. attribution of a quotation.

### Running the audit harness against production

The committed harness can drive production directly from a machine with network access:

```sh
node scripts/e2e-browser-setup.mjs                   # provisions Chromium at /tmp/chromium
export QA_BASE=https://dr-mostafa-tito.drmostafatito.workers.dev
E2E_CHROMIUM_PATH=/tmp/chromium node qa/product-audit.mjs \
  --who=anon --tag=prod-anon \
  --viewports=320,360,375,390,414,768,1024,1280,1440 \
  --routes=/,/study,/about,/login,/register
E2E_CHROMIUM_PATH=/tmp/chromium node qa/interactions.mjs
```

It reports overflow, collisions, destination-less anchors, unnamed controls, broken/alt-less
images, console and network errors, heading-order skips and sub-24px pointer targets, and
writes `qa-out/audit-prod-anon/summary.md`.

**Do not run `qa/admin-roundtrip.mjs`, `qa/cms-publish-chain.mjs` or `qa/media-chain.mjs`
against production unattended.** They write real settings, publish real CMS content and
upload real files. They do restore and clean up, but an interrupted run would leave production
modified. Perform the CMS and media round-trips by hand instead (next section).

---

## 6. Manual production CMS and media round-trip

**CMS:** in `/admin/cms`, edit one safe value on the home page → Save → confirm the public page
is *unchanged* while the draft is unpublished → confirm the admin preview *does* show it →
Publish → confirm the public page updates → **restore the original value and re-publish.**
Also check identity, owner photo, social links and navigation.

**Media:** upload one small test image in `/admin/files` → confirm `/files/:id` serves it →
confirm a *private* upload is **not** readable when signed out → **delete the test asset.**
**Never delete the owner photo or any real production asset.**

Leave no test content in production.

---

## 7. Social links — do not invent

Production settings currently contain only `contactPhone 01153719506` and a Facebook URL.
There is **no** TikTok, YouTube, Telegram or WhatsApp value, locally or in production.

After this release those icons are correctly **hidden** rather than rendered dead. That is the
intended end state until the owner supplies real URLs. When they do, enter them in
`/admin/appearance?tab=identity` — no deploy is needed, they appear immediately — then click
each one and confirm the destination.

**Do not fabricate a handle or a number to make an icon appear.**

---

## 8. Sign-off

Production is PASS only when the site has actually been opened and exercised in a browser
after the deploy. Record: deployment version, UTC timestamp, the per-viewport result, and any
button or link that failed.
