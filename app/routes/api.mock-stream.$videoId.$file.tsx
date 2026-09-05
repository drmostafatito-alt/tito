import type { Route } from "./+types/api.mock-stream.$videoId.$file";
import { getEnv } from "~server/cf.server";
import { mockTokenSecret, signMockToken } from "~server/video/providers/mock.server";
import { timingSafeEqualHex } from "~server/crypto/hmac.server";

/**
 * Mock provider stream endpoint. Verifies the HMAC playback token (uid|exp,
 * ≤45s TTL) before serving a synthetic HLS playlist / poster — mirroring the
 * signed-credential discipline of the production provider. Placeholder media
 * segments make the security flow fully exercisable offline; actual A/V
 * decoding is intentionally NOT simulated (documented limitation).
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid") ?? "";
  const exp = Number(url.searchParams.get("exp") ?? "0");
  const token = url.searchParams.get("token") ?? "";
  const scope = params.file.endsWith(".m3u8") ? "playback" : "thumbnail";

  if (!uid || !Number.isFinite(exp) || exp <= 0 || !token) {
    return new Response("Not Found", { status: 404 });
  }
  if (exp <= Date.now()) return new Response("Not Found", { status: 404 });

  const secret = mockTokenSecret(env);
  const expected = await signMockToken(secret, {
    videoId: params.videoId,
    scope,
    studentId: uid,
    expiresAt: exp,
  });
  if (!timingSafeEqualHex(expected, token)) return new Response("Not Found", { status: 404 });

  if (scope === "thumbnail") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#0f172a"/><text x="50%" y="50%" fill="#94a3b8" font-family="sans-serif" font-size="28" text-anchor="middle">EduCore mock video</text></svg>`;
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" },
    });
  }

  const qs = `uid=${encodeURIComponent(uid)}&exp=${exp}&token=${token}`;

  if (params.file === "media.m3u8") {
    const media = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", "#EXTINF:2.0,", `segment.ts?${qs}`, "#EXT-X-ENDLIST", ""].join("\n");
    return new Response(media, {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "private, no-store" },
    });
  }

  // HLS master playlist: variant references token-carrying media playlist.
  const master = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360`,
    `media.m3u8?${qs}`,
    "",
  ].join("\n");
  return new Response(master, {
    headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "private, no-store" },
  });
}
