import type { Route } from "./+types/beacons.progress";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { getSettings } from "~server/settings/service.server";
import { chainForLesson, coursePrereqGate } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { beaconSchema, recordBeacon, ProgressReferenceError } from "~server/progress/service.server";
import { checkRateLimit } from "~server/http/rate-limit.server";

/**
 * POST /beacons/progress — session-validated progress beacons (ARCHITECTURE §90,
 * Phase 4). The player sends debounced heartbeats (position/duration) and an
 * "ended" beacon on pagehide. The server — never the client — decides completion
 * (threshold from settings.video.completionThresholdPct) and re-checks lesson
 * entitlements on every beacon when a lesson context is present.
 *
 * Non-blocking by design: the client fires these with fetch keepalive /
 * sendBeacon; failures are silently ignored player-side.
 */
export async function action({ context, request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const env = getEnv(context);
  const db = getDb(env);

  const { auth } = await resolveAuth(db, env, request);
  if (!auth) return Response.json({ error: "login_required" }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = beaconSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "invalid_payload" }, { status: 400 });
  const beacon = parsed.data;

  const rate = await checkRateLimit(db, "progress-beacon", auth.user.id, 120, 60_000);
  if (!rate.ok) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) } }
    );
  }

  // A lesson context is mandatory and its entitlement is always re-checked.
  // recordBeacon additionally verifies that the video belongs to this lesson.
  const chain = await chainForLesson(db, beacon.lessonId);
  if (!chain?.courseId) return Response.json({ error: "not_found" }, { status: 404 });
  if (auth.user.rank <= 1) {
    const lock = await coursePrereqGate(
      db,
      { userId: auth.user.id, roleRank: auth.user.rank },
      chain.courseId
    );
    if (lock.locked) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const verdict = await resolveContentAccess(db, { userId: auth.user.id, roleRank: auth.user.rank }, chain);
  if (!verdict.allowed) return Response.json({ error: "forbidden" }, { status: 403 });

  const settings = await getSettings(db);
  try {
    const result = await recordBeacon(db, auth.user.id, beacon, {
      completionThresholdPct: settings.video.completionThresholdPct,
      deviceId: auth.device.id,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ProgressReferenceError) return Response.json({ error: "not_found" }, { status: 404 });
    throw err;
  }
}

export async function loader() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
