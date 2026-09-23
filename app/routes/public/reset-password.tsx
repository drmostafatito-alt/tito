import { useEffect, useState } from "react";
import type { Route } from "./+types/reset-password";
import { Form, data, redirect, useActionData, useNavigation, useRouteLoaderData } from "react-router";
import { getEnv } from "~server/cf.server";
import {
  exchangeResetToken,
  resetPassword,
  validateResetToken,
} from "~server/auth/service.server";
import {
  clearResetCookie,
  resetTokenFromRequest,
  serializeResetCookie,
} from "~server/auth/reset-cookie.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Card } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";
import { authPageMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";

/**
 * Reset links carry the bearer in a URL fragment. Fragments never reach edge or
 * application logs. Client code immediately removes it, asks this route to
 * validate it, and receives a short-lived HttpOnly cookie.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const incoming = new URL(request.url);
  if (incoming.search) {
    // Refuse legacy/query-carried credentials and clean browser history.
    return redirect("/reset-password");
  }
  const env = getEnv(context);
  const token = resetTokenFromRequest(request);
  const verdict = token ? await validateResetToken(env, token) : { valid: false as const };
  return {
    valid: verdict.valid,
    // Never serialize a token or token-bearing request URL into loader data.
    url: `${incoming.origin}${incoming.pathname}`,
  };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [];
  const root = rootMetaFrom(matches);
  return [
    ...siteEntitiesMeta(matches),
    ...authPageMeta(
      { ar: t("ar", "seo.resetPassword"), en: t("en", "seo.resetPassword") },
      root,
      loaderData.url as string
    ),
  ];
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "reset");

  if (intent === "exchange") {
    const token = String(form.get("token") ?? "");
    const result = await exchangeResetToken(env, token, request);
    if (!result.ok) {
      return Response.json(
        { ok: false, error: result.code },
        { status: result.code === "rate_limited" ? 429 : 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": serializeResetCookie(token),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const token = resetTokenFromRequest(request);
  if (!token) return data({ error: "invalid_token" as const }, { status: 400 });

  const password = String(form.get("password") ?? "");
  const passwordConfirm = String(form.get("passwordConfirm") ?? "");
  if (password !== passwordConfirm) return { error: "mismatch" as const };

  const result = await resetPassword(env, { token, newPassword: password }, request);
  if (!result.ok) {
    const headers = new Headers();
    if (result.code === "invalid_token") headers.set("Set-Cookie", clearResetCookie());
    return data(
      { error: result.code },
      { status: result.code === "rate_limited" ? 429 : 400, headers }
    );
  }
  return redirect("/login?reset=1", { headers: { "Set-Cookie": clearResetCookie() } });
}

type ExchangeState = "checking" | "ready" | "invalid" | "rate_limited";

export default function ResetPassword({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [exchangeState, setExchangeState] = useState<ExchangeState>(
    loaderData.valid ? "ready" : "checking"
  );

  useEffect(() => {
    if (loaderData.valid) return;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("token") ?? "";
    // Remove the bearer before any further navigation, asset load, or error.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setExchangeState("invalid");
      return;
    }

    const controller = new AbortController();
    void fetch("/reset-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ _action: "exchange", token }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) {
          window.location.replace("/reset-password");
          return;
        }
        setExchangeState(response.status === 429 ? "rate_limited" : "invalid");
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== "AbortError") setExchangeState("invalid");
      });
    return () => controller.abort();
  }, [loaderData.valid]);

  const ready = exchangeState === "ready";
  const actionError = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12">
      <Card className="p-6 sm:p-8">
        <h1 className="mb-6 text-2xl font-bold text-pub-ink">{t(locale, "auth.resetTitle")}</h1>

        {exchangeState === "checking" && (
          <p role="status" className="text-sm text-pub-muted">{t(locale, "common.loading")}</p>
        )}
        {exchangeState === "invalid" && (
          <Alert kind="error">{t(locale, "auth.resetInvalid")}</Alert>
        )}
        {exchangeState === "rate_limited" && (
          <Alert kind="error">{t(locale, "auth.errors.rate_limited")}</Alert>
        )}

        {actionError && ready && (
          <div className="mb-4">
            <Alert kind="error">{t(locale, `auth.errors.${actionError}`)}</Alert>
          </div>
        )}

        {ready && (
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="_action" value="reset" />
            <Input
              label={t(locale, "auth.newPassword")}
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              dir="ltr"
              reveal
              revealShowLabel={t(locale, "common.showPassword")}
              revealHideLabel={t(locale, "common.hidePassword")}
            />
            <Input
              label={t(locale, "auth.passwordConfirm")}
              name="passwordConfirm"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              dir="ltr"
              reveal
              revealShowLabel={t(locale, "common.showPassword")}
              revealHideLabel={t(locale, "common.hidePassword")}
            />
            <SubmitButton className="w-full">
              {navigation.state === "idle" ? t(locale, "auth.resetSubmit") : t(locale, "common.loading")}
            </SubmitButton>
          </Form>
        )}
      </Card>
    </div>
  );
}
