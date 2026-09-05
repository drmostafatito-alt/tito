import type { Route } from "./+types/webhooks.payments.$provider";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { processPaymentWebhook } from "~server/commerce/service.server";

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
  const env = getEnv(context);
  const db = getDb(env);
  const rawBody = await request.text();
  if (rawBody.length > 64_000) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const outcome = await processPaymentWebhook(db, env, {
    providerId: String(params.provider ?? ""),
    request,
    rawBody,
  });
  return Response.json({ result: outcome.result }, { status: outcome.status });
}

export function loader() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
