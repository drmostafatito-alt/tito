# Production deployment runbook

> **Current repository status (2026-09-15): NOT configured for production.**
> `wrangler.jsonc` intentionally contains local resource identifiers. The deploy
> command fails closed until the owner supplies real production bindings and
> non-secret variables. Do not run the local seed against production.

## 1. Free-first architecture

The application runs on Cloudflare Workers + D1 + three private bindings to R2.
A `*.workers.dev` HTTPS origin is supported and is sufficient for the application;
a custom application domain is **not required now**. Cloudflare terminates HTTPS,
and all authentication cookies are `Secure`, host-only, `HttpOnly`, and
`SameSite=Lax`.

Production, preview, test, and local data must remain isolated. Never copy the
production D1 or R2 contents into tests. Browser tests use `tests/e2e/test.env`,
an in-memory capture email transport, and synthetic values only.

Current published free-plan boundaries should be monitored in the Cloudflare
Dashboard before and after launch:

- Workers Free: 100,000 requests/day, 10 ms CPU/request, 128 MB memory, and a
  100 MB request body maximum.
- D1 Free: 5 million rows read/day, 100,000 rows written/day, and 5 GB total
  storage. Since 2026-09-01, exceeding daily read/write quotas causes requests to
  fail until the UTC reset; it is not merely a warning.
- R2 Free: verify the current storage and operation allowances in the owner
  account before launch. The app never enables a paid plan or incurs a paid
  upgrade automatically.

Authoritative references:
- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://www.cloudflare.com/products/d1/>
- <https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/>

PBKDF2 authentication is intentionally configured at 100,000 iterations. Because
Workers Free exposes a tight CPU budget, the owner must test registration, known
and unknown login, and password reset on the real production Worker before
accepting traffic. Do not silently lower password cost or buy a plan; measure and
make an explicit decision if the platform reports CPU-limit errors.

## 2. Create production resources

Create one production D1 database and three production R2 buckets. Names are
examples only; copy the real IDs/names returned by Wrangler into `wrangler.jsonc`:

```bash
npx wrangler d1 create tito-prod
npx wrangler r2 bucket create tito-public-assets-prod
npx wrangler r2 bucket create tito-private-files-prod
npx wrangler r2 bucket create tito-video-masters-prod
```

Required bindings:

| Binding | Resource | Public exposure |
|---|---|---|
| `DB` | production D1 | none |
| `PUBLIC_ASSETS` | public-content R2 bucket | only through `/files/:id` |
| `PRIVATE_FILES` | private R2 bucket | never public; signed route only |
| `VIDEO_MASTERS` | source-video R2 bucket | never public |

Replace `DB.database_id`, `DB.database_name`, and all production bucket names.
`npm run check:deploy-config` refuses `database_id: "local"`, development/test
settings, capture transport, and plaintext secrets.

## 3. Resend Free transactional email

The code uses native HTTPS `POST https://api.resend.com/emails`; no Node SDK,
SMTP service, paid email provider, or browser-exposed key is used.

The owner-confirmed Resend Free allowance for this project is **3,000 emails per
month and 100 emails per day**. The application adds a conservative shared
90-per-rolling-24-hour ceiling across welcome, email-change, and recovery mail,
plus the configurable recovery ceiling (default 80/day). Welcome and email-change
mail are each capped at 20 per rolling 24 hours, reserving at least 50 shared
slots for recovery even under lower-priority abuse. These guards do not
observe mail sent by another application, so use a dedicated Resend key/account
and monitor the provider dashboard. There are no retries that could duplicate a
reset message.

### Development and automated tests

- Automated tests use `EMAIL_PROVIDER=capture` only with `ENVIRONMENT=test`.
- `/__test/email-capture` is additionally protected by a synthetic test secret
  and returns 404 when any gate is absent.
- Do not put a real Resend key in `.dev.vars`, `tests/e2e/test.env`, fixtures,
  GitHub Actions logs, or any `VITE_`/`PUBLIC_` variable.
- Resend's `onboarding@resend.dev` behavior is suitable only for manual testing
  to the email address associated with the Resend account. It cannot deliver to
  arbitrary students.

### Production sender requirement (owner blocker)

To deliver to student addresses, Resend requires a sending domain that the owner
controls. This is separate from the application URL: the app may stay on
`workers.dev`, but arbitrary-recipient email cannot launch with
`onboarding@resend.dev`. If the owner does not currently control a suitable
sending domain/DNS zone, password recovery is **not production-operational** and
the deployment verdict must remain blocked; do not switch providers or purchase
anything automatically.

Owner steps in Resend:

1. Create/sign in to the Resend account and add a sending domain.
2. Copy the exact DNS records shown by Resend into that domain's DNS zone. Verify
   SPF and DKIM in the Resend dashboard; do not invent record values from this
   runbook. DMARC is recommended, initially with a monitoring policy.
3. Confirm the domain status is verified. Send a controlled test to the account
   owner, then a second controlled test to another authorized test mailbox.
4. Create a restricted production API key and copy it once into Wrangler secret
   storage.
5. Set `EMAIL_FROM` to a mailbox on the verified domain, for example
   `Dr Mostafa Tito <noreply@verified-domain.example>`.

Resend references:
- <https://resend.com/docs/knowledge-base/403-error-resend-dev-domain>
- <https://resend.com/docs/api-reference/errors>
- <https://resend.com/docs/dashboard/domains/dmarc>

## 4. Production variables and secrets

Commit only these **non-secret** production variables under `vars` in
`wrangler.jsonc` after their real values are known:

```json
"vars": {
  "ENVIRONMENT": "production",
  "APP_ORIGIN": "https://your-worker.workers.dev",
  "EMAIL_PROVIDER": "resend",
  "EMAIL_FROM": "Dr Mostafa Tito <noreply@verified-sending-domain.example>",
  "AUTH_PBKDF2_ITERATIONS": "100000",
  "MUX_PLAYBACK_RESTRICTION_ID": "REPLACE_AFTER_MUX_SETUP"
}
```

`APP_ORIGIN` must be the exact bare HTTPS origin: no path, query, credentials, or
trailing application route. It controls recovery links and same-origin mutation
checks. A later domain change requires updating this value and redeploying.

Set secrets interactively; never place their values in shell history or files:

```bash
npx wrangler secret put SESSION_PEPPER
npx wrangler secret put FILE_URL_SECRET
npx wrangler secret put RESEND_API_KEY
```

Generate `SESSION_PEPPER` and `FILE_URL_SECRET` independently with a CSPRNG
(at least 32 random bytes each). Depending on the already-selected video
provider, also set `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`,
`MUX_SIGNING_KEY_ID`, and `MUX_SIGNING_PRIVATE_KEY`. The private-key value is the
base64-encoded PEM RSA key returned by the Mux signing-key API/dashboard; the
Worker imports it as RS256 and never sends it to the browser. Create a Mux
playback restriction allowing only the production `APP_ORIGIN` host, disable
no-referrer browser playback, and set its non-secret ID as
`MUX_PLAYBACK_RESTRICTION_ID`; every video/thumbnail JWT carries that claim.
Mux may have costs
and is not silently enabled. Before launch, the owner must ingest and play a real
asset on Safari/iOS and Chromium/Android for longer than the former 60-second
window; no live Mux credential was available in this audit. `MOCK_VIDEO_SECRET` and `MOCK_PAYMENTS_SECRET` are local
or test only and must not exist in production. No new payment gateway is added
by this work.

The Worker independently validates production configuration at runtime and
returns a generic, non-cacheable `503` before routing when required values are
missing, placeholder-shaped, reused, or unsafe. Its diagnostic log contains
field names only, never values. This backstop catches dashboard drift or a
direct Wrangler deploy; it does not replace either launch gate.

## 5. Database, bootstrap, and content safety

1. Export/verify a D1 backup before every migration:
   ```bash
   npx wrangler d1 export tito-prod --remote --output backups/pre-migration.sqlite
   ```
2. Apply migrations to production:
   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```
3. Bootstrap one real super admin. Enter a temporary password from a password
   manager without echoing it or placing it in shell history; the script validates
   it and never prints it:
   ```bash
   read -rsp "Temporary admin password: " ADMIN_BOOTSTRAP_PASSWORD; echo
   export ADMIN_BOOTSTRAP_PASSWORD ADMIN_BOOTSTRAP_EMAIL=owner@example.com
   npm run bootstrap:admin:remote
   unset ADMIN_BOOTSTRAP_PASSWORD
   ```
   The password must be 14–128 characters and use at least three character
   classes. Log in and change the temporary password immediately.
4. In admin settings, configure Dr Mostafa Tito's real platform identity and a
   non-mock video provider.
5. Never run `scripts/seed.mjs` remotely. Seed/demo/smoke accounts and content
   intentionally fail the production-readiness gate.
6. Run:
   ```bash
   npm run check:production-readiness -- --remote
   ```
   It checks migrations, admin access, branding/content hygiene, payment/video
   test artifacts, and recovery-token invariants.

Migrations use additive/expand-contract discipline. The recovery migration
invalidates all previously outstanding reset links before installing the partial
unique index that permits only one unused token per user. See
`docs/BACKUP-RESTORE.md` for D1 + R2 restore scope; D1 export alone is not a
complete media backup.

## 6. Required release gates

Run from a clean checkout with the lockfile:

```bash
npm ci
npm run check:deploy-config
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:qa
npm run build
npm run audit:dependencies
npm run check:production-readiness -- --remote
```

`npm run deploy` runs the static deploy-config gate, full verification, and the
remote production-readiness database gate before Wrangler deployment. Do not
bypass a failing gate. Browser tests use a current npm-pinned Chromium fallback
and never call Resend.

## 7. Post-deploy verification

Before accepting students:

1. Confirm `/`, catalog, login, registration, dashboard, lesson, file, and admin
   routes on desktop and mobile widths.
2. Confirm HTTP redirects to HTTPS and the canonical `APP_ORIGIN` if a custom
   route was configured; `workers.dev` alone is valid.
3. Inspect session/device/reset cookies for `Secure`, `HttpOnly`, host-only,
   `SameSite=Lax`; inspect CSP, HSTS, no-store auth headers, and no-referrer reset
   headers.
4. Run a controlled real recovery: generic forgot response, one Arabic/RTL
   Resend message, fragment removed from browser URL, successful reset, old
   password denied, new password accepted, prior sessions revoked, link replay
   denied. Inspect Worker/Resend logs and confirm no token, password, API key, or
   token-bearing URL was recorded.
5. Verify SPF/DKIM (and preferably DMARC) pass in received headers. Check Resend
   daily/monthly usage and Cloudflare Worker CPU, D1 rows, and R2 operations.
6. Re-run the remote readiness check after any smoke test that creates data.

Rollback Worker code with Wrangler version rollback. Do not reverse a D1
migration blindly; restore only from a verified backup using the documented
procedure.
