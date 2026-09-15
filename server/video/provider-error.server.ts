/**
 * Public/admin action shape for upstream video failures. Provider exceptions may
 * contain credential-adjacent request metadata or response bodies, so the
 * original value is intentionally ignored rather than serialized or logged.
 */
export function sanitizedVideoProviderFailure(_error: unknown): { error: "provider" } {
  return { error: "provider" };
}
