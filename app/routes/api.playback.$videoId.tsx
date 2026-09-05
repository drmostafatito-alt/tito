import type { Route } from "./+types/api.playback.$videoId";
import { eq } from "drizzle-orm";
import { redirect } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { lessonItems } from "~server/db/schema";
import { chainForLesson } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { getSettings } from "~server/settings/service.server";
import { getVideo, mintPlayback } from "~server/video/service.server";
import { getVideoProgress, startWatch } from "~server/progress/service.server";

/**
 * POST /api/playback/:videoId — the ONLY place playback credentials are minted
 * (ARCHITECTURE §10). Server-side entitlement check every time; short-TTL
 * credentials; nothing provider-specific is hardcoded (ADR-006).
 */
export async function action({ context, params, request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);

  const { auth } = await resolveAuth(db, env, request);
  if (!auth) {
    return Response.json({ error: "login_required" }, { status: 401 });
  }

  const video = await getVideo(db, params.videoId);
  if (!video) return Response.json({ error: "not_found" }, { status: 404 });

  // entitlement: find the lesson this video is attached to (first published item)
  const items = await db
    .select({ lessonId: lessonItems.lessonId })
    .from(lessonItems)
    .where(eq(lessonItems.videoId, video.id))
    .limit(5);
  let allowed = false;
  let lessonId: string | undefined;
  for (const item of items) {
    const chain = await chainForLesson(db, item.lessonId);
    if (!chain) continue;
    const verdict = await resolveContentAccess(db, { userId: auth.user.id, roleRank: auth.user.rank }, chain);
    if (verdict.allowed) {
      allowed = true;
      lessonId = item.lessonId;
      break;
    }
  }
  if (!allowed) {
    // also allow admins directly (mirrors resolver's admin bypass for attached content)
    if (auth.user.rank < 3) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // replay policy (Phase 4): server-enforced cap on credential mints per student+video.
  // 0 = unlimited (default). Admins bypass (mirrors the resolver's admin rule).
  const prior = await getVideoProgress(db, auth.user.id, video.id);
  const replayLimit = settings.video.replayLimit;
  if (replayLimit > 0 && auth.user.rank < 3 && prior && prior.watchCount >= replayLimit) {
    return Response.json({ error: "replay_limit" }, { status: 403 });
  }

  const playback = await mintPlayback(db, env, video, { studentId: auth.user.id, lessonId });
  if ("error" in playback) {
    return Response.json({ error: playback.error }, { status: playback.error === "not_ready" ? 409 : 503 });
  }

  // watch accounting + resume context (never blocks playback on progress-write failure)
  try {
    await startWatch(db, { studentId: auth.user.id, videoId: video.id, lessonId: lessonId ?? null, deviceId: auth.device.id });
  } catch {
    // progress is convenience data — a failed write must not deny an entitled playback
  }

  return Response.json(
    {
      type: playback.type,
      url: playback.url,
      token: playback.token ?? null,
      expiresAt: playback.expiresAt,
      posterUrl: playback.posterUrl ?? null,
      resumeAt: prior && !prior.completed && prior.positionSeconds > 5 ? prior.positionSeconds : 0,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function loader() {
  // playback credentials are minted by POST only — GET is a client bug
  return redirect("/", { status: 302 });
}
