import type { Route } from "./+types/logout";
import { redirect } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { logout } from "~server/auth/service.server";
import { clearCookieHeader } from "~server/auth/cookies.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { SESSION_COOKIE } from "~server/auth/session.server";

/** POST-only logout: revokes the session row (device slot persists — ADR-005). */
export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const { auth } = await resolveAuth(db, env, request);
  if (auth) {
    await logout(db, auth.session.id, auth.user.id, await sha256Hex(clientIpOf(request) ?? "unknown"));
  }
  const headers = new Headers();
  headers.append("Set-Cookie", clearCookieHeader(SESSION_COOKIE));
  return redirect("/login", { headers });
}

export async function loader(): Promise<never> {
  throw new Response("Method Not Allowed", { status: 405 });
}
