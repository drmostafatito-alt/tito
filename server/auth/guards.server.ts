import { redirect } from "react-router";
import { getDb, type DB } from "../db/client.server";
import { getSettings } from "../settings/service.server";
import { resolveAuth, type AuthContext } from "./session.server";
import { logSecurityEvent } from "../security/events.server";
import { getEnv } from "../cf.server";

export interface Guarded {
  auth: AuthContext;
  settings: Awaited<ReturnType<typeof getSettings>>;
  setCookie?: string;
}

/** Require any authenticated, active user; redirects to /login otherwise. */
export async function requireUser(context: unknown, request: Request): Promise<Guarded> {
  const env = getEnv(context);
  const db: DB = getDb(env);
  const { auth, refreshCookie } = await resolveAuth(db, env, request);
  const settings = await getSettings(db);
  if (!auth) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return { auth, settings, setCookie: refreshCookie };
}

/** Require a minimum role rank (3 = admin, 4 = super_admin). Denial is logged + 404-shaped. */
export async function requireRole(
  context: unknown,
  request: Request,
  minRank: number
): Promise<Guarded> {
  const env = getEnv(context);
  const db: DB = getDb(env);
  const { auth, refreshCookie } = await resolveAuth(db, env, request);
  const settings = await getSettings(db);
  if (!auth) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (auth.user.rank < minRank) {
    await logSecurityEvent(db, {
      userId: auth.user.id,
      type: "permission_denied",
      metadata: { path: new URL(request.url).pathname, rank: auth.user.rank, required: minRank },
    });
    // 404-style redirect: do not reveal that an admin area exists
    throw redirect("/dashboard?error=forbidden");
  }
  return { auth, settings, setCookie: refreshCookie };
}
