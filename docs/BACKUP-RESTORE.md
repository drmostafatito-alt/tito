# Backup & Restore (W5)

> Status: **Implemented + rehearsed (Phase 8 / W5).** Rehearsal executed against
> **synthetic/test data only** on the isolated local miniflare environment — never
> production, no real customer data, no real payments.
>
> Tools: `scripts/backup.mjs` (backup), `scripts/restore.mjs` (restore),
> `scripts/w5-fixtures.mjs` (rehearsal fixtures), guards in `scripts/backup-lib.mjs`
> (unit-tested in `tests/unit/backup-safety.test.ts`).

---

## 1. Scope

The platform's durable state lives in two places, and **neither alone is a
complete backup**:

| Layer | What it holds | Covered by |
|---|---|---|
| **D1** (SQLite via Cloudflare D1) | users, settings, CMS pages/blocks/menus, catalog, progress, assessment, commerce, announcements, audit, entitlements, files metadata | `d1.sql` logical export |
| **R2** (object storage) | object *bytes*: `PUBLIC_ASSETS`, `PRIVATE_FILES`, `VIDEO_MASTERS` | object-level copy (see §3) |

A **D1 export + R2 listing is NOT a full backup** — the D1 export contains R2
*metadata* (`files.r2_key/bucket/mime/byte_size/checksum_sha256`,
`videos.master_r2_key`) but **not** the object bytes, and an R2 listing contains
bytes but no database rows or their foreign-key relationships. Both layers are
required.

### D1 scope (included)

All application tables (59) plus the `d1_migrations` tracker. Row-level: every
row is exported, including soft-deleted rows (`deleted_at IS NOT NULL`), audit
logs, security events, and rate-limit counters. Nothing is filtered.

### D1 scope (excluded)

Nothing at the D1 layer. Secrets are **not** in D1 (they are Worker secrets /
`.dev.vars`, outside the database) so the D1 export contains no secret material
beyond the hashed password/token values that are already in the database.

### R2 scope (included)

- **Metadata**: already captured in the D1 export (`files`, `videos` tables) —
  this is the authoritative record of `r2_key`, bucket, mime, size, checksum.
- **Object bytes**: captured by `scripts/backup.mjs` for all three buckets via the
  R2 bindings (`list()` + `get()`), stored content-addressed (`r2/<bucket>/<sha256>`).

### R2 scope (excluded / limitations)

- **Remote R2 bulk export** (`wrangler r2 object get --remote` per key, or an R2
  export) requires Cloudflare credentials **not available in this sandbox** — it
  is **owner-assisted** for production.
- The **local miniflare R2 sim does not round-trip `httpMetadata`
  (e.g. content-type) through `getPlatformProxy()`**, so content-type is
  reconstructed from the D1 `files.mime` / `videos.master_r2_key` mapping at
  backup time and re-applied on restore. In production R2 this metadata is
  preserved natively.
- Buckets can be large (video masters); a full object copy is therefore a
  **size- and time-bounded operation**. See §7 (RPO/RTO).

---

## 2. Backup procedure

```bash
# local (default) — writes backups/<UTC-timestamp>/
node scripts/backup.mjs
# explicit output dir
node scripts/backup.mjs --out backups/manual-2026-09-06
```

A backup directory contains:

```
backups/<ts>/
├── d1.sql            full logical export (schema + data + d1_migrations)
├── d1-schema.sql     --no-data  (schema + indexes, for restore step 1)
├── d1-data.sql       --no-schema (INSERTs only, for restore step 2)
├── manifest.json     inventory: D1 row counts per table, R2 keys+sha256+size,
│                     git commit, source env, scope/exclusions
└── r2/<bucket>/<sha256>   R2 object bytes, content-addressed
```

The `manifest.json` is what makes integrity verification possible and is the
record of *what* was backed up and *when*.

**Safety:**
- `--target remote` requires `EDUCORE_ALLOW_REMOTE=1` (Cloudflare credentials).
  Without credentials this sandbox cannot reach remote — documented, owner-assisted.
- The output lives under **gitignored `backups/`** so it never enters Git.
- The script never prints or stores secrets (no `.dev.vars` contents).

---

## 3. Restore procedure

```bash
# destructive — requires --force
node scripts/restore.mjs backups/<ts> --force
```

Steps (local):

1. Wipe local D1 state (`.wrangler/state/v3/d1`).
2. Replay `d1-schema.sql` (creates all tables + indexes + `d1_migrations`).
3. Replay `d1-data.sql` (all rows, incl. `d1_migrations` history and the
   `role_permissions` system grants).
4. Wipe and re-`put` every R2 object from `r2/<bucket>/<sha256>`, re-applying
   content-type from the manifest.
5. **Integrity verification**: re-count every D1 table vs the manifest, and
   re-hash every R2 object (sha256) vs the manifest. Non-zero failures → exit 1.

> **Why schema-then-data (not the raw full export):** `wrangler d1 export`'s full
> file interleaves `CREATE TABLE` and `INSERT` per table, so replaying it in one
> pass fails with `no such table: main.users` (an `INSERT INTO devices` runs
> before `CREATE TABLE users`; FK schema resolution needs the referenced table to
> exist). Replaying schema first, then data, removes both that failure and the
> `UNIQUE constraint failed: role_permissions` conflict that arises if you
> instead replay data on top of a freshly `migrations apply`-ed DB.

---

## 4. Rehearsal procedure (executed — results in §5)

1. Cold baseline: wipe local state → `db:migrate:local` → `db:seed:local`.
2. Install synthetic markers across domains: `node scripts/w5-fixtures.mjs`
   (a synthetic student, announcement, exam attempt + answer, order + payment,
   lesson progress, and a tiny PNG in `PUBLIC_ASSETS`).
3. `node scripts/backup.mjs` → record pre-backup row counts.
4. **Destructive change/reset**: `rm -rf .wrangler/state/v3/d1 .wrangler/state/v3/r2`
   (D1 and R2 are now empty — verified "no such table: users", 0 R2 objects).
5. `node scripts/restore.mjs backups/<ts> --force`.
6. Integrity verification (script) + independent cross-checks (specific marker
   rows + PNG magic bytes).

---

## 5. Rehearsal results (recorded)

- **Backup**: succeeded — 59 D1 tables inventoried, 2 R2 objects backed up
  (1 `PUBLIC_ASSETS`, 1 `PRIVATE_FILES`), manifest written with git commit.
- **Destructive reset**: D1 empty (`no such table: users`), R2 `PUBLIC_ASSETS` = 0.
- **Restore**: succeeded — **64 integrity checks passed, 0 failed**
  (60 D1 tables incl. `d1_migrations` + 4 R2 object/count/sha256 checks).
- **Independent cross-checks** (not self-referential to the manifest):
  - synthetic student `w5-synthetic-student@test.local` → FOUND
  - synthetic announcement (published) → FOUND
  - synthetic order `EC-W5-SYNTH-001` (pending) → FOUND
  - synthetic file row `w5-pixel.png` (image/png) → FOUND
  - R2 PNG bytes → magic header correct, sha256 matches
  - `exam_attempts`=1, `lesson_progress`=1, `super_admin`=1

Coverage map (what the rehearsal proved restorable): users ✓, settings ✓, CMS
(files metadata; pages/blocks were empty in this dataset) ✓, learning/progress ✓,
assessment ✓, commerce test data ✓, announcements ✓, R2 objects ✓. Audit/security
events were empty in this dataset but are covered by the same table list.

---

## 6. Security precautions

- **Environment guard (enforced in code, unit-tested):** restore is destructive
  and always requires `--force`; a `--remote` restore is **refused** unless
  `EDUCORE_ALLOW_UNSAFE_RESTORE=1` **and** `--force` are both set — a restore can
  never hit production by accident. See `validateRestoreTarget` in
  `scripts/backup-lib.mjs` + `tests/unit/backup-safety.test.ts` (9 cases).
- Backup output is gitignored (`backups/`); artifacts never enter Git.
- No credentials/tokens are logged or written to the backup; scripts use the
  local miniflare state and never read `.dev.vars` secret values into output.
- Scripts contain no hardcoded production database ids / bucket names — they
  resolve bindings from `wrangler.jsonc` at runtime.
- Restore requires the backup directory to carry a `manifest.json` (provenance).

---

## 7. RPO / RTO (assumptions, not yet measured in production)

- **RPO (D1)**: point-in-time of the export command (manual; schedule it before
  destructive migrations — see DEPLOYMENT.md §5).
- **RPO (R2)**: point-in-time of the object copy; a long-running copy can span
  new writes, so R2 RPO is "bounded by copy duration", not instantaneous.
- **RTO**: dominated by replaying `d1-data.sql` (row count) and re-`put`ting R2
  objects (byte count). On the free-plan D1 (5M rows read/day) a large restore
  may span the daily read budget — an owner-assisted constraint to plan around.

---

## 8. Owner-assisted requirements (production)

1. **Cloudflare credentials** for `wrangler d1 export --remote` and
   `wrangler r2 object get --remote` (bulk R2 export) — not available in this
   sandbox.
2. **Scheduling**: a recurring backup cadence (e.g. cron / scheduled Worker) is
   not implemented — decide RPO and wire a scheduler.
3. **R2 bulk export** for large buckets (video masters): evaluate R2 export /
   Super Slurper / a Worker-based copy, since per-key `object get` is
   latency- and API-expensive at scale.
4. **Restore drill against a real preview environment** (not just local) before
   treating production restore as routine.

## 9. Cloudflare-specific limitations

- `wrangler r2 object get/put` have no `--local` mode — object-level backup/restore
  relies on the R2 *bindings* via `getPlatformProxy()` locally (same API as
  production), and on `wrangler r2 object` `--remote` in production.
- D1 has no `VACUUM`/binary snapshot API over HTTP; the portable unit of backup
  is the SQL export.
- D1 free-plan read limits (5M rows/day) bound restore throughput.
