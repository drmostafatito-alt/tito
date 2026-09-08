import type { Route } from "./+types/set-locale";
import { redirect } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { LOCALE_COOKIE } from "~server/settings/locale.server";
import { serializeCookie } from "~server/auth/cookies.server";
import { isLocale } from "~/lib/i18n";

/** POST /set-locale { lang, next } — writes the locale cookie, redirects back. */
export async function action({ context, request }: Route.ActionArgs) {
  const form = await request.formData();
  const lang = String(form.get("lang") ?? "");
  const nextRaw = String(form.get("next") ?? "/");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  if (!isLocale(lang)) return redirect(next);
  // Enforce the owner's offered-language setting server-side (Appearance →
  // System). Hiding the switcher alone would still let a crafted POST pin a
  // language the platform does not serve.
  const settings = await getSettings(getDb(getEnv(context)));
  if (!settings.locale.enabled.includes(lang)) return redirect(next);

  const headers = new Headers();
  const url = new URL(request.url);
  // Omit Secure on http://localhost so the cookie is stored in local/dev browsers
  // that do not treat 127.0.0.1 as a secure origin. HTTPS still gets Secure.
  headers.append(
    "Set-Cookie",
    serializeCookie(LOCALE_COOKIE, lang, {
      maxAgeSeconds: 31536000,
      httpOnly: true,
      sameSite: "Lax",
      secure: url.protocol === "https:",
    }),
  );
  headers.set("Cache-Control", "no-store");
  return redirect(next, { headers });
}

export async function loader(): Promise<never> {
  throw new Response("Method Not Allowed", { status: 405 });
}
