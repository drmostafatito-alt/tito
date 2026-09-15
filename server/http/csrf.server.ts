/** Browser mutation methods protected by the global same-origin gate. */
export const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function headerOrigin(value: string | null, mustBeBareOrigin = false): string | null {
  if (!value || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    // Origin's wire grammar is a serialized origin, never a URL with a path,
    // query or fragment. Referer intentionally carries those components.
    if (mustBeBareOrigin && (url.pathname !== "/" || url.search || url.hash)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Reject malformed or oversized declared bodies before a route buffers them. */
export function declaredBodyTooLarge(request: Request, maxBytes: number): boolean {
  const value = request.headers.get("content-length");
  if (value === null) return false;
  if (!/^(?:0|[1-9]\d*)$/.test(value) || value.length > 15) return true;
  const length = Number(value);
  return !Number.isSafeInteger(length) || length > maxBytes;
}

/**
 * Read a clone so route actions retain the original body. This closes the
 * Content-Length-omission/understatement path before formData()/json() buffers
 * an unauthenticated ordinary mutation. Keep this to small (1 MiB) routes;
 * multipart upload routes enforce file caps after authentication.
 */
export async function streamedBodyTooLarge(request: Request, maxBytes: number): Promise<boolean> {
  if (!request.body) return false;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return true;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.clone().body!.getReader();
  } catch {
    return true;
  }
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      total += value.byteLength;
      if (total > maxBytes) {
        // request.clone() tees the stream. Cancel both branches without awaiting
        // either branch's tee-cancel promise (which settles only after both).
        void reader.cancel();
        void request.body.cancel();
        return true;
      }
    }
  } catch {
    // A malformed/interrupted body is not safe to hand to a buffering parser.
    void reader.cancel().catch(() => undefined);
    void request.body.cancel().catch(() => undefined);
    return true;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Require exact same-origin browser evidence. `same-site` is deliberately not
 * enough: a compromised sibling subdomain must not be able to mutate this app.
 */
export function hasSameOriginMutationEvidence(request: Request, expectedOrigin: string): boolean {
  const originValue = request.headers.get("origin");
  if (originValue !== null) {
    return headerOrigin(originValue, true) === expectedOrigin;
  }

  const refererValue = request.headers.get("referer");
  if (refererValue !== null) {
    return headerOrigin(refererValue) === expectedOrigin;
  }

  // Sec-Fetch-Site is a forbidden browser-controlled header. It is a safe
  // fallback only when privacy controls omitted both stronger headers. A
  // present-but-null/malformed Origin must never fall through to this branch.
  return (request.headers.get("sec-fetch-site") ?? "").toLowerCase() === "same-origin";
}
