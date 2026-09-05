import type { Route } from "./+types/set-locale";
import { redirect } from "react-router";
import { LOCALE_COOKIE } from "~server/settings/locale.server";
import { isLocale } from "~/lib/i18n";

/** POST /set-locale { lang, next } — writes the locale cookie, redirects back. */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const lang = String(form.get("lang") ?? "");
  const nextRaw = String(form.get("next") ?? "/");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  if (!isLocale(lang)) return redirect(next);

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${LOCALE_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure`
  );
  return redirect(next, { headers });
}

export async function loader(): Promise<never> {
  throw new Response("Method Not Allowed", { status: 405 });
}
