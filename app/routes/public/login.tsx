import type { Route } from "./+types/login";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { redirect } from "react-router";
import { getEnv } from "~server/cf.server";
import { safeLocalRedirect } from "~server/http/redirect.server";
import { login } from "~server/auth/service.server";
import { applyAuthCookies } from "~server/auth/session.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { AuthFrame, AuthLink } from "~/components/tito/auth";
import { SessionStorageNotice, markAuthSubmitted } from "~/components/public/SessionStorageNotice";
import { t, type Locale } from "~/lib/i18n";
import { authPageMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { useRouteLoaderData } from "react-router";

/** Auth pages never index: unique branded title + noindex (no duplicate brand titles). */
export async function loader({ request }: Route.LoaderArgs) {
  return { url: request.url };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [];
  const root = rootMetaFrom(matches);
  return [...siteEntitiesMeta(matches), ...authPageMeta(
    { ar: t("ar", "seo.login"), en: t("en", "seo.login") },
    root,
    loaderData.url as string,
  )];
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const nextInput = String(form.get("next") ?? "");
  const next = nextInput ? safeLocalRedirect(nextInput, "") || null : null;

  const result = await login(env, { email, password }, request);
  if (!result.ok) {
    const payload: { error: string; email: string; retryAfterSeconds?: number } = {
      error: result.code,
      email,
    };
    // Surface the retry window so the UI can give explicit, honest guidance.
    if (result.code === "rate_limited") {
      const rl = result as { code: string; retryAfterMs?: number };
      if (rl.retryAfterMs) payload.retryAfterSeconds = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    }
    return payload;
  }

  const headers = new Headers();
  applyAuthCookies(headers, env, result.cookies);
  const isAdmin = result.user.roleId === "admin" || result.user.roleId === "super_admin";
  const dest = isAdmin ? next ?? "/admin" : next ?? "/dashboard";
  return redirect(dest, { headers });
}

export default function Login() {
  const root = useRouteLoaderData("root") as { locale: Locale; platform: { nameAr: string; nameEn: string } };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "";
  const reset = params.get("reset");

  return (
    <AuthFrame
      locale={locale}
      step={1}
      title={t(locale, "auth.loginTitle")}
      lede={t(locale, "auth.loginSubtitle")}
      footer={
        <div className="flex flex-col gap-3">
          <p>
            {t(locale, "auth.noAccount")} <AuthLink to="/register">{t(locale, "common.register")}</AuthLink>
          </p>
          <p>
            <AuthLink to="/forgot-password">{t(locale, "auth.forgotLink")}</AuthLink>
          </p>
          {envDevNote(locale) && (
            <div className="mt-2 rounded-pub-sm border border-dashed border-pub-line-strong bg-pub-surface p-3 text-pub-xs leading-relaxed text-pub-muted" dir="ltr">
              <p className="mb-1 font-bold">{t(locale, "auth.demoAccounts")}</p>
              <p>admin@educore.local (local seed only — not a production identity)</p>
              <p>student@educore.local (local fixture)</p>
            </div>
          )}
        </div>
      }
    >
      {reset && <Alert kind="success">{t(locale, "auth.resetSuccess")}</Alert>}

      {actionData?.error === "rate_limited" && (
        <Alert kind="error">
          <span className="font-bold">{t(locale, "auth.errors.rate_limitedTitle")}</span>
          <span className="mt-1 block text-pub-sm opacity-90">{t(locale, "auth.errors.rate_limitedBody")}</span>
          {actionData.retryAfterSeconds != null && (
            <span className="mt-1 block text-pub-sm font-bold">
              {actionData.retryAfterSeconds === 1
                ? t(locale, "auth.errors.rate_limitedRetryOne")
                : t(locale, "auth.errors.rate_limitedRetry", { s: String(actionData.retryAfterSeconds) })}
            </span>
          )}
        </Alert>
      )}

      <SessionStorageNotice locale={locale} />

      {actionData?.error && actionData.error !== "rate_limited" && (
        <Alert kind="error">{t(locale, `auth.errors.${actionData.error}`)}</Alert>
      )}

      <Form method="post" className="flex flex-col gap-5" onSubmit={markAuthSubmitted}>
        <input type="hidden" name="next" value={next} />
        <Input
          label={t(locale, "auth.email")}
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={actionData?.email ?? ""}
          dir="ltr"
        />
        <Input
          label={t(locale, "auth.password")}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
          reveal
          revealShowLabel={t(locale, "common.showPassword")}
          revealHideLabel={t(locale, "common.hidePassword")}
        />
        <SubmitButton size="lg" className="mt-1 w-full">
          {navigation.state === "idle" ? t(locale, "common.login") : t(locale, "common.loading")}
        </SubmitButton>
      </Form>
    </AuthFrame>
  );
}

function envDevNote(_locale: Locale): boolean {
  // demo credentials hint only surfaces in non-production builds
  // (import.meta.env is vite-only; under wrangler bundling it is undefined)
  return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
}
