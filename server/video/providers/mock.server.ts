import { hmacSha256Hex } from "../../crypto/hmac.server";
import type {
  AssetStatus,
  CreateAssetInput,
  CreateAssetResult,
  PlaybackInfo,
  VideoProvider,
  VideoRowLike,
} from "../provider";

/**
 * Mock adapter (VIDEO-PROVIDERS.md §5): offline, no network. Mirrors the signed
 * credential discipline of production — playback tokens are HMAC-signed with
 * MOCK_VIDEO_SECRET and verified by /api/mock-stream/* before any byte is
 * served. The stream itself is a synthetic HLS playlist (placeholder segments),
 * so the full security flow is exercisable without external services.
 */

export function mockTokenSecret(env: { MOCK_VIDEO_SECRET?: string }): string {
  const secret = env.MOCK_VIDEO_SECRET;
  if (!secret) throw new Error("MOCK_VIDEO_SECRET not set");
  return secret;
}

export async function signMockToken(
  secret: string,
  parts: { videoId: string; scope: string; studentId: string; expiresAt: number }
): Promise<string> {
  return hmacSha256Hex(secret, `${parts.videoId}|${parts.scope}|${parts.studentId}|${parts.expiresAt}`);
}

export function verifyMockTokenArgs(videoId: string, scope: string, studentId: string, expiresAt: string, token: string) {
  return { videoId, scope, studentId, expiresAt, token };
}

export class MockVideoProvider implements VideoProvider {
  readonly id = "mock" as const;

  constructor(private env: { MOCK_VIDEO_SECRET?: string }) {}

  async createAsset(input: CreateAssetInput): Promise<CreateAssetResult> {
    const assetId = `mock-asset-${crypto.randomUUID()}`;
    return { providerAssetId: assetId, playbackId: `mock-pb-${crypto.randomUUID().slice(0, 12)}`, status: "ready" };
  }

  async getAssetStatus(providerAssetId: string): Promise<AssetStatus> {
    return { status: "ready", durationSeconds: 60 };
  }

  async deleteAsset(): Promise<void> {
    /* nothing external to clean up */
  }

  async getPlayback(video: VideoRowLike, ctx: { studentId: string; lessonId?: string }): Promise<PlaybackInfo> {
    const secret = mockTokenSecret(this.env);
    const expiresAt = Date.now() + 45_000;
    const token = await signMockToken(secret, {
      videoId: video.id,
      scope: "playback",
      studentId: ctx.studentId,
      expiresAt,
    });
    const qs = `uid=${encodeURIComponent(ctx.studentId)}&exp=${expiresAt}&token=${token}`;
    // Poster is served under the "thumbnail" scope (route derives scope from the
    // file extension), so it needs its OWN token — reusing the playback-scoped
    // token would fail HMAC verification. Scope separation is intentional.
    const posterToken = await signMockToken(secret, {
      videoId: video.id,
      scope: "thumbnail",
      studentId: ctx.studentId,
      expiresAt,
    });
    const posterQs = `uid=${encodeURIComponent(ctx.studentId)}&exp=${expiresAt}&token=${posterToken}`;
    return {
      type: "hls",
      url: `/api/mock-stream/${video.id}/master.m3u8?${qs}`,
      expiresAt,
      posterUrl: `/api/mock-stream/${video.id}/poster.svg?${posterQs}`,
    };
  }

  async getThumbnail(video: VideoRowLike): Promise<{ url: string; expiresAt: number }> {
    const secret = mockTokenSecret(this.env);
    const expiresAt = Date.now() + 45_000;
    const token = await signMockToken(secret, {
      videoId: video.id,
      scope: "thumbnail",
      studentId: "anon",
      expiresAt,
    });
    const qs = `uid=anon&exp=${expiresAt}&token=${token}`;
    return { url: `/api/mock-stream/${video.id}/poster.svg?${qs}`, expiresAt };
  }

  async syncMetadata(): Promise<Partial<AssetStatus>> {
    return { status: "ready" };
  }
}
