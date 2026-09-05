import { eq } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { videos } from "../db/schema";
import { getSettings } from "../settings/service.server";
import { type PlaybackInfo, type VideoProvider, type VideoRowLike, VideoNotConfiguredError } from "./provider";
import { MockVideoProvider } from "./providers/mock.server";
import { MuxVideoProvider } from "./providers/mux.server";

/**
 * Video service — the only thing routes/business logic talk to. The active
 * adapter is a SETTINGS value (video.provider) + env credentials; switching
 * providers never touches business logic (ADR-006 / VIDEO-PROVIDERS.md §1).
 */

export type VideoRow = typeof videos.$inferSelect;

function registry(env: Env): Record<string, VideoProvider> {
  return {
    mock: new MockVideoProvider(env),
    mux: new MuxVideoProvider({ env }),
  };
}

/** Active adapter per settings + env credentials. */
export async function activeProviderFor(db: DB, env: Env): Promise<VideoProvider> {
  const settings = await getSettings(db);
  const id = settings.video.provider;
  const provider = registry(env)[id];
  if (!provider) throw new VideoNotConfiguredError(id, ["settings.video.provider"]);
  return provider;
}

/** Register a mock video (dev/demo): instantly ready. */
export async function registerMockVideo(db: DB, input: { durationSeconds?: number; title?: string }): Promise<VideoRow> {
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    provider: "mock" as const,
    providerAssetId: null,
    playbackId: null,
    status: "pending" as const,
    durationSeconds: input.durationSeconds ?? null,
    thumbnailUrl: null,
    thumbnailFileId: null,
    byteSize: null,
    width: null,
    height: null,
    masterR2Key: null,
    metadata: input.title ? { title: input.title } : null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(videos).values(row);
  const provider = new MockVideoProvider({} as { MOCK_VIDEO_SECRET?: string });
  const asset = await provider.createAsset({ masterR2Key: "", masterStream: null, masterSize: null, title: input.title ?? "mock" });
  const [updated] = await db
    .update(videos)
    .set({ providerAssetId: asset.providerAssetId, playbackId: asset.playbackId, status: "ready", updatedAt: Date.now() })
    .where(eq(videos.id, row.id))
    .returning();
  return updated;
}

/** Ingest a master file through the ACTIVE provider (R2 master first — ADR-006). */
export async function ingestMaster(
  db: DB,
  env: Env,
  input: { masterStream: ReadableStream; masterSize: number; originalFilename: string; title: string }
): Promise<VideoRow> {
  const provider = await activeProviderFor(db, env);
  const masterR2Key = `masters/${crypto.randomUUID()}/${input.originalFilename.replace(/[^\w.\-]+/g, "_")}`;
  await env.VIDEO_MASTERS.put(masterR2Key, input.masterStream, {
    httpMetadata: { contentType: "video/mp4" },
  });
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    provider: provider.id,
    providerAssetId: null,
    playbackId: null,
    status: "pending" as const,
    durationSeconds: null,
    thumbnailUrl: null,
    thumbnailFileId: null,
    byteSize: input.masterSize,
    width: null,
    height: null,
    masterR2Key,
    metadata: { title: input.title },
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(videos).values(row);

  // fresh stream for the provider upload (the R2 object is the source of truth)
  const obj = await env.VIDEO_MASTERS.get(masterR2Key);
  const created = await provider.createAsset({
    masterR2Key,
    masterStream: obj?.body ?? null,
    masterSize: input.masterSize,
    title: input.title,
  });
  const [updated] = await db
    .update(videos)
    .set({
      providerAssetId: created.providerAssetId,
      playbackId: created.playbackId ?? null,
      status: created.status,
      updatedAt: Date.now(),
    })
    .where(eq(videos.id, row.id))
    .returning();
  return updated;
}

/** Poll provider → update neutral row (admin "sync" action / future cron). */
export async function syncVideo(db: DB, env: Env, videoId: string): Promise<VideoRow | null> {
  const rows = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  const row = rows[0];
  if (!row || !row.providerAssetId) return row ?? null;
  const provider = registry(env)[row.provider];
  if (!provider) return row;
  const status = await provider.getAssetStatus(row.providerAssetId);
  const [updated] = await db
    .update(videos)
    .set({
      status: status.status,
      durationSeconds: status.durationSeconds ?? row.durationSeconds,
      width: status.width ?? row.width,
      height: status.height ?? row.height,
      playbackId: status.playbackId ?? row.playbackId,
      providerAssetId: status.providerAssetId ?? row.providerAssetId,
      updatedAt: Date.now(),
    })
    .where(eq(videos.id, videoId))
    .returning();
  return updated;
}

export async function getVideo(db: DB, videoId: string): Promise<VideoRow | null> {
  const rows = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  return rows[0] ?? null;
}

export async function listVideos(db: DB, limit = 100) {
  return db.select().from(videos).orderBy(videos.createdAt).limit(limit);
}

/**
 * Mint playback credentials. THE security boundary — callers MUST have already
 * run the entitlement resolver (ARCHITECTURE §10; routes do this immediately
 * before calling). Re-verifies the asset is ready; TTL comes from settings
 * (≤60s enforced by the settings schema).
 */
export async function mintPlayback(
  db: DB,
  env: Env,
  video: VideoRow,
  viewer: { studentId: string; lessonId?: string }
): Promise<PlaybackInfo | { error: "not_ready" | "no_playback_id" }> {
  if (video.status !== "ready") return { error: "not_ready" };
  if (video.provider === "mux" && !video.playbackId) return { error: "no_playback_id" };
  const provider = registry(env)[video.provider];
  if (!provider) throw new VideoNotConfiguredError(video.provider, ["provider registry"]);
  return provider.getPlayback(video as VideoRowLike, viewer);
}

export async function deleteVideo(db: DB, env: Env, videoId: string): Promise<boolean> {
  const row = await getVideo(db, videoId);
  if (!row) return false;
  const provider = registry(env)[row.provider];
  if (provider && row.providerAssetId) {
    try {
      await provider.deleteAsset(row.providerAssetId);
    } catch {
      // asset already gone at provider — proceed with local cleanup
    }
  }
  if (row.masterR2Key) await env.VIDEO_MASTERS.delete(row.masterR2Key);
  await db.delete(videos).where(eq(videos.id, videoId));
  return true;
}
