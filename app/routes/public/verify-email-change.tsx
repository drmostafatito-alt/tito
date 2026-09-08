import type { Route } from "./+types/verify-email-change";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { completeEmailChange } from "~server/users/emailchange.server";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

/**
 * Public landing for the out-of-band email-change verification link. GET-only.
 * The token in the query is the sole proof of control of the NEW mailbox; the
 * account email changes server-side only if the single-use, expiring token is
 * valid. Renders a neutral success/failure — never reveals account details.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return { ok: false as const, reason: "invalid" as const };

  const result = await completeEmailChange(env, db, token);
  if (!result.ok) return { ok: false as const, reason: "invalid" as const };
  return { ok: true as const, email: result.email };
}

export default function VerifyEmailChange({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale } | undefined;
  const locale = root?.locale ?? "ar";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-16">
      <Card className="p-6 sm:p-8">
        <h1 className="mb-3 text-2xl font-bold text-ink">{t(locale, "verifyEmail.title")}</h1>
        {loaderData.ok ? (
          <Alert kind="success">
            <p className="font-medium">{t(locale, "verifyEmail.okTitle")}</p>
            <p className="mt-1">{t(locale, "verifyEmail.okBody")}</p>
            <p className="mt-1" dir="ltr">{loaderData.email}</p>
          </Alert>
        ) : (
          <Alert kind="error">
            <p className="font-medium">{t(locale, "verifyEmail.invalidTitle")}</p>
            <p className="mt-1">{t(locale, "verifyEmail.invalidBody")}</p>
          </Alert>
        )}
        <div className="mt-5">
          <Link to="/" className="font-medium text-brand-700 hover:underline">
            {t(locale, "verifyEmail.goHome")}
          </Link>
        </div>
      </Card>
    </div>
  );
}
