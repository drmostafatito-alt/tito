/** Minimal, dependency-free cookie handling (no RR session storage — opaque DB sessions). */

export interface CookieSerializeOptions {
  maxAgeSeconds?: number;
  expires?: Date;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export function serializeCookie(
  name: string,
  value: string,
  opts: CookieSerializeOptions = {}
): string {
  if (
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
    !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)
  ) {
    throw new Error("invalid cookie name or value");
  }
  if (
    name.startsWith("__Host-") &&
    ((opts.path !== undefined && opts.path !== "/") || opts.secure === false)
  ) {
    throw new Error("__Host- cookies require Secure and Path=/");
  }
  const parts = [`${name}=${value}`];
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  const sameSite = opts.sameSite ?? "Lax";
  parts.push(`SameSite=${sameSite}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure !== false) parts.push("Secure");
  // CHIPS: third-party iframes (live preview) keep None cookies only when partitioned.
  if (sameSite === "None") parts.push("Partitioned");
  return parts.join("; ");
}

/**
 * SameSite for the session/device cookies. Default "Lax" (production posture).
 * Embedded preview contexts (cross-site iframes, e.g. the sandbox live preview)
 * refuse to store Lax cookies: every login then looks like a NEW device and the
 * per-user device cap (ADR-005) blocks the very next attempt. Set
 * COOKIE_SAMESITE=None in such environments so the browser keeps the session.
 */
export function cookieSameSite(env: Env | undefined): "Strict" | "Lax" | "None" {
  // COOKIE_SAMESITE is an optional deployment var (see .dev.vars.example); the
  // generated Env type does not declare it, so read it through a narrow cast.
  const v = ((env as unknown as { COOKIE_SAMESITE?: string })?.COOKIE_SAMESITE ?? "").trim().toLowerCase();
  if (v === "none") return "None";
  if (v === "strict") return "Strict";
  return "Lax";
}

/** Cross-site iframes (live preview) drop even Partitioned cookies. When
 *  COOKIE_SAMESITE=None we also carry the opaque tokens on these headers so
 *  the hydrated client can replay them from sessionStorage. Production (Lax)
 *  never emits or accepts the headers — HttpOnly cookies stay the only path. */
export const EMBED_SESSION_HEADER = "X-Edu-Session";
export const EMBED_DEVICE_HEADER = "X-Edu-Device";
export const EMBED_CLEAR_SESSION_HEADER = "X-Edu-Clear-Session";

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function embedHeadersEnabled(env: Env | undefined): boolean {
  return cookieSameSite(env) === "None";
}

export function readEmbedHeader(request: Request, name: string, env: Env | undefined): string | undefined {
  if (!embedHeadersEnabled(env)) return undefined;
  const raw = request.headers.get(name)?.trim() ?? "";
  return OPAQUE_TOKEN.test(raw) ? raw : undefined;
}

export function applyEmbedClear(headers: Headers, env: Env | undefined): void {
  if (embedHeadersEnabled(env)) headers.set(EMBED_CLEAR_SESSION_HEADER, "1");
}

export function clearCookieHeader(name: string, path = "/"): string {
  return `${name}=; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; HttpOnly; Secure`;
}

export function parseCookieHeader(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) map.set(name, value);
  }
  return map;
}
