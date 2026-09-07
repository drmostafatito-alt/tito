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
 → provider.getPlayback() mints credentials ≤60s TTL
 → client <VideoPlayer> plays (hls.js MSE everywhere; Safari/iOS native HLS w/ playsinline)
 → progress beacons (debounced + pagehide/sendBeacon) → position, completion threshold → completed
```
Server-enforced policies at mint time: replay cap, completion threshold %, disable-seeking flag (client-enforced + server ignores out-of-band progress beyond tolerance), enabled flag, availability window.

## 5. Adapters

### mock (dev/local; Phase 2 — implemented)
- Serves a synthetic HLS playlist backed by a REAL decodable placeholder segment (`server/video/mock-segment.server.ts` — 3s of black, H.264 baseline 160x90): hls.js genuinely plays it through MSE, so progress beacons, resume and the server-side completion threshold are exercisable offline. The segment (and poster) are token-gated; token = HMAC-SHA256 over `videoId|scope|studentId|expiresAt` with `MOCK_VIDEO_SECRET`, ≤45s TTL, embedded in the URL query (`uid|exp|token`) — mirroring the signed-URL discipline so dev behaves like prod. Scope separation: playlists + `segment.ts` are `playback`-scoped, `poster.svg` is `thumbnail`-scoped. No network needed — works offline in the sandbox.
- **Token scopes are separated**: `/api/mock-stream/:videoId/:file` derives the scope from the file extension (`.m3u8` → `playback`, anything else → `thumbnail`) and rejects cross-scope tokens with a 404. `mintPlayback()` therefore returns a `posterUrl` carrying its OWN thumbnail-scoped token (a Phase 2 bug where it reused the playback token — poster always 404'd — is fixed and regression-tested in `video.test.ts` + smoke §6).
- Verification (2026-09-05, live `wrangler dev`): valid token → 200 playlist/SVG; forged/missing/expired/cross-scope → 404; responses `no-store`.

### mux (production; Phase 2 — adapter implemented, credentials env-gated)
- Verified model (2026-09-05): playback IDs are `public` or `signed`; signed requires a JWT (`https://stream.mux.com/{PLAYBACK_ID}.m3u8?token={JWT}`) signed with the environment's **Ed25519 signing key** (key id + private key). Tokens minted server-side only; short `exp` (≤45s in the adapter, settings-capped ≤60s); optional **playback restrictions** (domain allowlist) referenced at signing. Assets also expose signed thumbnails (`image.mux.com`). Sources: Mux docs — "Securing video playback with signed URLs", "Mux fundamentals" (see DECISIONS.md verification queue for links).
- Implementation status: Ed25519 signing via WebCrypto verified INSIDE workerd (integration test signs/verifies a playback JWT in the Workers runtime — no fallback lib needed). Direct-upload ingest + asset-status sync implemented against the documented API shape; **live Mux API calls untested (no production credentials in this environment)** — first real-credential run must re-verify upload/asset schemas per the queue below. Missing credentials fail loudly: `VideoNotConfiguredError` at provider selection — verified live (settings switched to `mux` → ingest rejected, row stays `pending`, NO silent mock fallback; ADR-006 holds: business logic never mentions Mux).
- Credentials: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` (API), `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY` (playback JWT) — secrets only.

### bunny / cfstream (future)
- Same interface; Bunny uses HMAC-SHA256 token auth (WebCrypto-compatible); Cloudflare Stream uses signed tokens as well. Verification ADRs required before either ships.

## 6. Migration runbook (Provider A → B)

1. Keep masters in R2 (already the rule). 2. Enable adapter B (env + setting). 3. Background job: for each `videos` row with provider A, `createAsset` on B from master, poll ready, then rewrite row in a transaction (`provider`, ids, `playback_id`). 4. New plays resolve through the resolver against the new row state. 5. No UI/business-logic change — the contract test suite proves parity before cutover.

## 7. iOS/Safari player requirements (built into the single player component)

`playsinline` + `webkit-playsinline` attributes (prevents auto-fullscreen), native HLS on Safari (no MSE on iPhone), PiP via standard API where present, orientation-tolerant layout (`dvh`), resume from `video_progress.position_seconds`, graceful behavior on foreground/background transitions (re-check entitlement token on `visibilitychange` if near expiry), `pagehide` beacon for final position.

## 8. What video security does NOT guarantee (stated plainly)

Signed short-TTL playback tokens + domain restrictions stop casual URL sharing and hotlinking. They cannot stop screen recording. Replay limits are a business rule enforced at token-mint time. DRM (Widevine/FairPlay) is documented as a future paid option, deliberately out of scope for v1.
