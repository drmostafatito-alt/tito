/**
 * Trusted application-origin handling.
 *
 * Production links and CSRF decisions must never trust a client-controlled Host
 * header. Production-like environments therefore require APP_ORIGIN. Local
 * development may use the request origin so Wrangler previews keep working.
 */
export type OriginEnv = {
  APP_ORIGIN?: string;
  ENVIRONMENT?: string;
};

const NON_PRODUCTION = new Set(["development", "test"]);

export function isNonProductionEnvironment(env: Pick<OriginEnv, "ENVIRONMENT">): boolean {
  return NON_PRODUCTION.has((env.ENVIRONMENT ?? "").trim().toLowerCase());
}

/** Parse a configured origin. Paths, credentials, query strings and fragments are forbidden. */
export function parseAppOrigin(value: string | null | undefined, allowHttp = false): string | null {
  const raw = (value ?? "").trim();
  if (!raw || raw.length > 300) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/") return null;
    if (!url.hostname) return null;
    if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical application origin.
 *
 * Unknown/missing ENVIRONMENT is production-safe: only an explicit, valid HTTPS
 * APP_ORIGIN is accepted. Development/test can fall back to the current request
 * origin (http is allowed there only).
 */
export function applicationOrigin(env: OriginEnv, request?: Request): string | null {
  const nonProduction = isNonProductionEnvironment(env);
  // Wrangler/E2E preview hosts are dynamic. In explicit non-production modes,
  // the runtime Request is the most accurate same-origin source.
  if (nonProduction && request) {
    try {
      const requestOrigin = parseAppOrigin(new URL(request.url).origin, true);
      if (requestOrigin) return requestOrigin;
    } catch {
      return null;
    }
  }
  return parseAppOrigin(env.APP_ORIGIN, nonProduction);
}
