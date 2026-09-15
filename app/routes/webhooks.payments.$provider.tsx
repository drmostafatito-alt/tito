import type { Route } from "./+types/webhooks.payments.$provider";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { processPaymentWebhook } from "~server/commerce/service.server";

const MAX_WEBHOOK_BYTES = 64_000;

async function readWebhookBody(request: Request): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413 }> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_WEBHOOK_BYTES) {
      return { ok: false, status: 413 };
    }
  }

  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}

/**
 * POST /webhooks/payments/:provider — gateway webhook inbox (PAYMENTS.md §4,
 * SECURITY.md §9). Signature verification happens BEFORE any parse (inside the
 * provider adapter); every delivery — valid, forged, or replayed — is recorded
 * in payment_events; processing is idempotent by provider_event_id, so retries
 * never double-fulfill. Fulfillment only ever runs through the same claimed
 * transaction as admin approval. No session/CSRF applies (server-to-server):
 * the signature IS the authentication. Unknown/unconfigured providers (e.g.
 * "mock" without its test-only secret binding) are 404 — production never
 * registers adapters that have not passed their verification ADR.
 */
export async function action({ context, request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const providerId = String(params.provider ?? "");
  // The production v1 manual rail has no webhook contract. Reject it before
  // reading a body or touching D1 so this public URL cannot be abused as an
  // unauthenticated payment_events write primitive.
  if (providerId === "manual") {
    return Response.json({ result: "unknown_provider" }, { status: 404 });
  }
  const env = getEnv(context);
  const db = getDb(env);
  // Stream with a byte cap instead of request.text(): this endpoint is public and
  // CSRF-exempt by design, so an attacker must not be able to force a 100 MB body
  // into the Worker's 128 MB isolate before the old character-length check runs.
  const body = await readWebhookBody(request);
  if (!body.ok) {
    return Response.json(
      { error: body.status === 413 ? "payload_too_large" : "invalid_payload" },
      { status: body.status }
    );
  }
  const outcome = await processPaymentWebhook(db, env, {
    providerId,
    request,
    rawBody: body.text,
  });
  return Response.json({ result: outcome.result }, { status: outcome.status });
}

export function loader() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
