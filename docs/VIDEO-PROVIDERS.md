# Video Providers

> Status: **Phase 0 design.** Adapter implementation lands in Phase 2. Per `DECISIONS.md`,
> each adapter gets a doc-verification pass before code; the Mux playback model was verified
> 2026-09-05 against Mux's official docs (signed JWT playback tokens + playback restrictions).

## 1. Abstraction (server-only module)

```ts
// server/video/provider.ts
interface VideoProvider {
  readonly id: 'mux' | 'mock' | 'bunny' | 'cfstream';

  createAsset(input: { masterR2Key: string; title: string; corsOrigin?: string })
    : Promise<{ providerAssetId: string; uploadUrl?: string; status: VideoStatus }>;

  getAssetStatus(providerAssetId: string)
    : Promise<{ status: VideoStatus; durationSeconds?: number; width?: number; height?: number }>;

  deleteAsset(providerAssetId: string): Promise<void>;

  // THE security boundary: called only after entitlement + replay policy pass.
  getPlayback(video: VideoRow, ctx: { studentId: string; lessonId?: string })
    : Promise<PlaybackInfo>;   // { type:'hls', url, token?, expiresAt, thumbnailUrl, posterUrl }

  getThumbnail(video: VideoRow): Promise<{ url: string; expiresAt?: number }>;
  syncMetadata(providerAssetId: string): Promise<Partial<VideoRow>>;
}
```

- The active provider is a **setting** (`video.provider`) + env credentials per provider — no code changes to switch.
- The app renders a single player component; it consumes `PlaybackInfo` only and knows no vendor names.

## 2. Provider-neutral storage

`videos` table keeps `provider`, `provider_asset_id`, `playback_id`, `duration_seconds`, `status`, thumbnail refs (see DATABASE-SCHEMA). **Masters live in R2 `video-masters/`** (never public) — provider migration is a re-ingest job from masters, not data loss (ADR-006).

## 3. Ingestion flow (admin upload)

```
Admin selects master file (mp4/mov)
 → validate (size cap, MIME sniff, checksum) → PUT R2 video-masters/{uuid}.{ext}
 → provider.createAsset()  (Mux: create direct-upload, keyed to master)
 → status poll/sync (asset.ready → duration, dims, playback id)   [video.status: pending→preparing→ready]
 → attach to lesson_item; thumbnail synced to provider or R2
```
Re-encode/cap: initial quality profile 720p ladder (provider default renditions); future profiles are a settings field, not code.

## 4. Playback flow (student)

```
Player route loads (server) → entitlement resolver: lesson/course/subject covered?
 → replay policy check (video_progress.watch_count vs setting/exam-level cap; unlimited default off/on per settings)
 → increment watch session (video_watch_sessions) 
 → provider.getPlayback() mints credentials for asset duration + 30m (24h hard cap)
 → client <VideoPlayer> plays (hls.js MSE everywhere; Safari/iOS native HLS w/ playsinline)
 → progress beacons (debounced + pagehide/sendBeacon) → position, completion threshold → completed
```
Server-enforced policies at mint time: replay cap, completion threshold %, disable-seeking flag (client-enforced + server ignores out-of-band progress beyond tolerance), enabled flag, availability window.

## 5. Adapters

### mock (dev/local; Phase 2 — implemented)
- Serves a synthetic HLS stream (placeholder segments — A/V decoding intentionally not simulated); token = HMAC-SHA256 over `videoId|scope|studentId|expiresAt` with `MOCK_VIDEO_SECRET`, using the same bounded viewing window as production and embedded in the URL query (`uid|exp|token`). No network needed — works offline in the sandbox.
- **Token scopes are separated**: `/api/mock-stream/:videoId/:file` treats HLS playlists/segments as `playback` and only `poster.svg` as `thumbnail`, rejecting cross-scope tokens with a 404. `mintPlayback()` therefore returns a `posterUrl` carrying its OWN thumbnail-scoped token (a Phase 2 bug where it reused the playback token — poster always 404'd — is fixed and regression-tested in `video.test.ts` + smoke §6).
- Verification (2026-09-05, live `wrangler dev`): valid token → 200 playlist/SVG; forged/missing/expired/cross-scope → 404; responses `no-store`.

### mux (production; Phase 2 — adapter implemented, credentials env-gated)
- Re-verified 2026-09-15 against Mux's official secure-playback guide: signed playback requires an **RS256** JWT using Mux's 2048-bit RSA signing key. Mux rejects requests after `exp`, including an already-playing HLS stream, so `exp` must exceed the asset duration. This implementation uses known duration + 30 minutes, four hours when duration is unknown, and a 24-hour hard cap. A playback restriction (production host allowlist) is required owner/provider setup and its ID is embedded in every token. Assets also expose separately signed thumbnails (`image.mux.com`).
- Implementation status: RS256 signing and Mux's base64-encoded PEM/PKCS#1/PKCS#8 formats are verified in Node and inside workerd; hls.js supplies MSE playback on Chromium/Firefox/Android while Safari/iOS uses native HLS. Direct-upload ingest + asset-status sync implemented against the documented API shape; **live Mux API calls untested (no production credentials in this environment)** — first real-credential run must re-verify upload/asset schemas per the queue below. Missing credentials fail loudly: `VideoNotConfiguredError` at provider selection — verified locally (settings switched to `mux` → ingest rejected, row stays `pending`, NO silent mock fallback; ADR-006 holds: business logic never mentions Mux).
- Credentials: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` (API), `MUX_SIGNING_KEY_ID`, and `MUX_SIGNING_PRIVATE_KEY` (playback JWT) are secrets. `MUX_PLAYBACK_RESTRICTION_ID` is a non-secret production variable.

### bunny / cfstream (future)
- Same interface; Bunny uses HMAC-SHA256 token auth (WebCrypto-compatible); Cloudflare Stream uses signed tokens as well. Verification ADRs required before either ships.

## 6. Migration runbook (Provider A → B)

1. Keep masters in R2 (already the rule). 2. Enable adapter B (env + setting). 3. Background job: for each `videos` row with provider A, `createAsset` on B from master, poll ready, then rewrite row in a transaction (`provider`, ids, `playback_id`). 4. New plays resolve through the resolver against the new row state. 5. No UI/business-logic change — the contract test suite proves parity before cutover.

## 7. iOS/Safari player requirements (built into the single player component)

`playsinline` + `webkit-playsinline` attributes (prevents auto-fullscreen), native HLS on Safari (no MSE on iPhone), hls.js/MSE elsewhere, orientation-tolerant layout (`dvh`), resume from `video_progress.position_seconds`, and a `pagehide` beacon for final position.

## 8. What video security does NOT guarantee (stated plainly)

Signed, duration-bounded playback tokens plus owner-configured domain restrictions reduce casual URL sharing and hotlinking. They cannot stop screen recording. Replay limits are a business rule enforced at token-mint time. DRM (Widevine/FairPlay) is documented as a future paid option, deliberately out of scope for v1.
