import type { Route } from "./+types/verify-email-change";
import { useEffect, useRef, useState } from "react";
import { Link, redirect, useFetcher, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { completeEmailChange } from "~server/users/emailchange.server";
import { Alert } from "~/components/ui/Alert";
import { Card } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";
import { authPageMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";

/**
 * Public landing for email-change verification. The bearer token is delivered
 * in the URL fragment (which is never sent in an HTTP request), removed from
 * browser history immediately, and redeemed by a same-origin POST. The GET is
 * deliberately read-only: crawlers, link scanners, logs, and prefetchers can
 * never consume a verification token.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Refuse legacy/query-token URLs without ever serializing the query into
  // loader data or canonical metadata. Newly generated mail uses a fragment.
  if (url.search) {
    throw redirect(url.pathname, {
      headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  return { url: `${url.origin}${url.pathname}` };
}

export async function action({ context, request }: Route.ActionArgs) {
  if (request.method !== "POST") return { ok: false as const };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false as const };
  }
  const token = String(form.get("token") ?? "");
  // A 32-byte base64url token is exactly 43 characters. Reject malformed input
  // before hashing or querying so arbitrary bodies cannot create a cheap DoS.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false as const };

  const env = getEnv(context);
  const result = await completeEmailChange(env, getDb(env), token);
  return result.ok
    ? { ok: true as const, email: result.email }
    : { ok: false as const };
}

/** Token pages are never indexed and never pass link equity. */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [];
  const root = rootMetaFrom(matches);
  return [
    ...siteEntitiesMeta(matches),
    ...authPageMeta(
      { ar: t("ar", "seo.verifyEmail"), en: t("en", "seo.verifyEmail") },
      root,
      loaderData.url as string,
      "noindex,nofollow",
    ),
  ];
}

export default function VerifyEmailChange() {
  const root = useRouteLoaderData("root") as { locale: Locale } | undefined;
  const locale = root?.locale ?? "ar";
  const fetcher = useFetcher<typeof action>();
  const started = useRef(false);
  const [missingToken, setMissingToken] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const fragment = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const token = new URLSearchParams(fragment).get("token") ?? "";
    // Remove the bearer credential before any subsequent navigation/history use.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setMissingToken(true);
      return;
    }
    fetcher.submit({ token }, { method: "post", action: "/verify-email-change" });
  }, [fetcher]);

  const completed = fetcher.data;
  const pending = !missingToken && !completed;
  const verifiedEmail = completed?.ok === true ? completed.email : null;
  const invalid = missingToken || completed?.ok === false;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-16">
      <Card className="p-6 sm:p-8">
        <h1 className="mb-3 text-2xl font-bold text-slate-900">{t(locale, "verifyEmail.title")}</h1>
        <div aria-live="polite">
          {pending && (
            <Alert kind="info">
              <p className="font-medium">{t(locale, "verifyEmail.title")}</p>
            </Alert>
          )}
          {verifiedEmail && (
            <Alert kind="success">
              <p className="font-medium">{t(locale, "verifyEmail.okTitle")}</p>
              <p className="mt-1">{t(locale, "verifyEmail.okBody")}</p>
              <p className="mt-1" dir="ltr">{verifiedEmail}</p>
            </Alert>
          )}
          {invalid && (
            <Alert kind="error">
              <p className="font-medium">{t(locale, "verifyEmail.invalidTitle")}</p>
              <p className="mt-1">{t(locale, "verifyEmail.invalidBody")}</p>
            </Alert>
          )}
          <noscript>
            <Alert kind="error">
              <p className="font-medium">{t(locale, "verifyEmail.invalidTitle")}</p>
              <p className="mt-1">{t(locale, "verifyEmail.invalidBody")}</p>
            </Alert>
          </noscript>
        </div>
        <div className="mt-5">
          <Link to="/" className="font-medium text-brand-700 hover:underline">
            {t(locale, "verifyEmail.goHome")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
