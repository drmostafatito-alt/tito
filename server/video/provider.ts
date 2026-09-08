/**
 * VideoProvider abstraction (VIDEO-PROVIDERS.md §1). Server-only; vendor SDK/HTTP
 * calls live exclusively inside adapters (ARCHITECTURE golden rule 3). Business
 * logic and routes depend on this interface only — never on a vendor name.
 */

export type VideoStatus = "pending" | "preparing" | "ready" | "errored";

export interface VideoRowLike {
  id: string;
  provider: "mux" | "mock" | "bunny" | "cfstream" | "youtube";
  providerAssetId: string | null;
  playbackId: string | null;
  status: VideoStatus;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

export interface PlaybackInfo {
  /**
   * "embed" = a third-party hosted player rendered in a sandboxed iframe
   * (YouTube). No token is involved, because the URL is public and access has
   * already been enforced by the entitlement resolver before this is minted.
   */
  type: "hls" | "mp4" | "embed";
  /** Final playback URL — token (when present) appended as ?token= by the provider */
  url: string;
  token?: string;
  expiresAt: number;
  thumbnailUrl?: string;
  posterUrl?: string;
}

export interface CreateAssetInput {
  masterR2Key: string;
  /** stream of the master object from R2 video-masters (adapters that upload) */
  masterStream: ReadableStream | null;
  masterSize: number | null;
  title: string;
  corsOrigin?: string;
}

export interface CreateAssetResult {
  providerAssetId: string;
  playbackId?: string;
  status: VideoStatus;
  /** for providers needing a separate client PUT step (unused server-side flow) */
  uploadUrl?: string;
}

export interface AssetStatus {
  status: VideoStatus;
  durationSeconds?: number;
  width?: number;
  height?: number;
  playbackId?: string;
  /** when the provider rewrites its asset identity (upload id → asset id) */
  providerAssetId?: string;
}

export interface VideoProvider {
  readonly id: "mux" | "mock" | "bunny" | "cfstream" | "youtube";

  createAsset(input: CreateAssetInput): Promise<CreateAssetResult>;
  getAssetStatus(providerAssetId: string): Promise<AssetStatus>;
  deleteAsset(providerAssetId: string): Promise<void>;

  /**
   * THE security boundary: called only after entitlement + policy checks pass.
   * Mints short-TTL playback credentials server-side.
   */
  getPlayback(video: VideoRowLike, ctx: { studentId: string; lessonId?: string }): Promise<PlaybackInfo>;
  getThumbnail(video: VideoRowLike): Promise<{ url: string; expiresAt?: number }>;
  syncMetadata(providerAssetId: string): Promise<Partial<AssetStatus>>;
}

/** Typed "adapter present but credentials missing" — never a silent fallback. */
export class VideoNotConfiguredError extends Error {
  constructor(public readonly providerId: string, public readonly missing: string[]) {
    super(`video provider "${providerId}" not configured: missing ${missing.join(", ")}`);
    this.name = "VideoNotConfiguredError";
  }
}
