import {
  YOUTUBE_ID_RE,
  youTubeEmbedUrl,
  youTubeThumbnailUrl,
} from "../youtube";
import type {
  AssetStatus,
  CreateAssetInput,
  CreateAssetResult,
  PlaybackInfo,
  VideoProvider,
  VideoRowLike,
} from "../provider";

/**
 * YouTube adapter.
 *
 * Deliberately NOT an upload pipeline: YouTube hosts the media, so there is no
 * master file, no R2 object, no transcode lifecycle and no short-TTL playback
 * token to mint. `createAsset` therefore refuses rather than pretending — YouTube
 * rows are created by `registerYouTubeVideo()` from a validated URL.
 *
 * Access control is unchanged and stays where it belongs: `getPlayback` is only
 * ever reached after the entitlement resolver in `/api/playback/:videoId` has
 * passed, so a paid lesson's YouTube video is still gated even though the
 * underlying asset is public.
 */
export class YouTubeVideoProvider implements VideoProvider {
  readonly id = "youtube" as const;

  async createAsset(_input: CreateAssetInput): Promise<CreateAssetResult> {
    throw new Error(
      'provider "youtube" does not accept uploads — register a YouTube URL instead'
    );
  }

  async getAssetStatus(providerAssetId: string): Promise<AssetStatus> {
    return { status: YOUTUBE_ID_RE.test(providerAssetId) ? "ready" : "errored" };
  }

  async deleteAsset(): Promise<void> {
    /* the media lives at YouTube — only the local row is removed */
  }

  async getPlayback(video: VideoRowLike): Promise<PlaybackInfo> {
    const id = video.providerAssetId;
    if (!id || !YOUTUBE_ID_RE.test(id)) {
      throw new Error(`video ${video.id} has no valid YouTube id`);
    }
    return {
      type: "embed",
      url: youTubeEmbedUrl(id),
      // The embed URL is a stable public URL, not a bearer credential, so it does
      // not expire. Callers still re-mint on every request.
      expiresAt: Date.now() + 3_600_000,
      posterUrl: youTubeThumbnailUrl(id),
    };
  }

  async getThumbnail(video: VideoRowLike): Promise<{ url: string; expiresAt?: number }> {
    const id = video.providerAssetId;
    if (!id || !YOUTUBE_ID_RE.test(id)) {
      throw new Error(`video ${video.id} has no valid YouTube id`);
    }
    return { url: youTubeThumbnailUrl(id) };
  }

  async syncMetadata(): Promise<Partial<AssetStatus>> {
    // No YouTube Data API call: fetching real duration/view metadata would need
    // an owner-supplied API key. Status is knowable from the id shape alone.
    return { status: "ready" };
  }
}
