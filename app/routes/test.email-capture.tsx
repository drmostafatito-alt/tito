import type { Route } from "./+types/test.email-capture";
import { getEnv } from "~server/cf.server";
import { testCapturedEmails } from "~server/email/test-capture.server";

function constantTimeTextEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Browser-E2E capture inbox. It is a 404 unless all three explicit test gates
 * are present; no production credential or real email service is involved.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const expected = env.TEST_CAPTURE_SECRET ?? "";
  const supplied = request.headers.get("x-test-capture-secret") ?? "";
  if (
    env.ENVIRONMENT !== "test" ||
    env.EMAIL_PROVIDER !== "capture" ||
    expected.length < 16 ||
    !constantTimeTextEqual(supplied, expected)
  ) {
    throw new Response("Not Found", { status: 404 });
  }

  const email = (new URL(request.url).searchParams.get("to") ?? "").trim().toLowerCase();
  if (email.length > 254) return Response.json({ messages: [] }, { headers: { "Cache-Control": "no-store" } });
  return Response.json(
    { messages: testCapturedEmails(email) },
    { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }
  );
}

export function action() {
  throw new Response("Not Found", { status: 404 });
}
