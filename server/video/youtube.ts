/**
 * YouTube URL handling — pure, dependency-free, and deliberately strict.
 *
 * The owner pastes an ordinary YouTube URL in Admin; we extract ONLY the 11-char
 * video id and then rebuild a fixed embed URL ourselves. The pasted string is
 * never rendered, never interpolated into HTML, and never used as an `href`, so a
 * crafted URL cannot become a script/HTML-injection vector — the same reasoning
 * that keeps `custom_html` out of the CMS (ADR-019).
 *
 * Kept free of Workers/DB imports so it can be unit-tested and reused on either
 * side of the module boundary.
 */

/** YouTube ids are exactly 11 chars of base64url. */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** Path prefixes that carry the id as their first segment. */
const ID_PATH_PREFIXES = new Set(["embed", "shorts", "live", "v"]);

/**
 * Extract a YouTube video id from a URL an owner pasted, or null if the string is
 * not a plain YouTube watch/embed/short/live link.
 *
 * Rejects: non-URLs, non-http(s) schemes (`javascript:`, `data:`), unknown hosts,
 * playlist-only links with no `v`, ids of the wrong shape, and anything overlong.
 */
export function parseYouTubeId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null; // bare "dQw4w9WgXcQ" or malformed input — require a real URL
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;

  // youtu.be/<id>
  if (host === "youtu.be" || host === "www.youtu.be") {
    const seg = url.pathname.split("/").filter(Boolean)[0];
    return seg && YOUTUBE_ID_RE.test(seg) ? seg : null;
  }

  // /watch?v=<id>  (query wins — it is what the canonical share URL carries)
  const v = url.searchParams.get("v");
  if (v && YOUTUBE_ID_RE.test(v)) return v;

  // /embed/<id> | /shorts/<id> | /live/<id> | /v/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ID_PATH_PREFIXES.has(parts[0].toLowerCase()) && YOUTUBE_ID_RE.test(parts[1])) {
    return parts[1];
  }

  return null;
}

function assertId(id: string): void {
  if (!YOUTUBE_ID_RE.test(id)) throw new Error("invalid YouTube video id");
}

/**
 * The only embed URL this platform will ever produce for YouTube. Privacy-enhanced
 * host, no third-party cookies, and a fixed parameter set — the owner cannot
 * inject extra parameters because only the validated id reaches this function.
 */
export function youTubeEmbedUrl(id: string): string {
  assertId(id);
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
}

/** Poster image used until the owner uploads their own thumbnail. */
export function youTubeThumbnailUrl(id: string): string {
  assertId(id);
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Canonical watch link, for the "open on YouTube" affordance. */
export function youTubeWatchUrl(id: string): string {
  assertId(id);
  return `https://www.youtube.com/watch?v=${id}`;
}
