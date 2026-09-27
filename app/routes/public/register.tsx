import type { Route } from "./+types/register";
import { useState } from "react";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { redirect } from "react-router";
import { getEnv, getWaitUntil } from "~server/cf.server";
import { login, registerUser } from "~server/auth/service.server";
import { applyAuthCookies } from "~server/auth/session.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Card } from "~/components/ui/Card";
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
    { ar: t("ar", "seo.register"), en: t("en", "seo.register") },
    root,
    loaderData.url as string,
  )];
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const fullName = String(form.get("fullName") ?? "");
  const password = String(form.get("password") ?? "");
  const passwordConfirm = String(form.get("passwordConfirm") ?? "");

  if (password !== passwordConfirm) {
    return { error: "mismatch", email, fullName };
  }

  const registered = await registerUser(env, { email, fullName, password }, request, getWaitUntil(context));
  if (!registered.ok) {
    return { error: registered.code, email, fullName };
  }

  // auto-login after registration (session + device policy apply)
  const result = await login(env, { email, password }, request);
  if (!result.ok) {
    return redirect(`/login?next=/dashboard`);
  }
  const headers = new Headers();
  applyAuthCookies(headers, env, result.cookies);
  return redirect("/dashboard", { headers });
}

export default function Register() {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const strength = password.length === 0
    ? 0
    : (password.length >= 8 ? 1 : 0) + (/[0-9]/.test(password) ? 1 : 0) + (/[A-Za-z\u0600-\u06FF]/.test(password) ? 1 : 0);

  return (
    <div className="auth-page mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12">
      <Card className="p-6 sm:p-8">
        <h1 className="mb-6 text-2xl font-bold text-pub-ink">{t(locale, "common.register")}</h1>

        <SessionStorageNotice locale={locale} />

        {actionData?.error && (
          <div className="mb-4">
            <Alert kind="error">{t(locale, `auth.errors.${actionData.error}`)}</Alert>
          </div>
        )}

        <Form method="post" className="flex flex-col gap-4" onSubmit={markAuthSubmitted}>
          <Input
            label={t(locale, "auth.fullName")}
            name="fullName"
            autoComplete="name"
            required
            minLength={2}
            defaultValue={actionData?.fullName ?? ""}
          />
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
            autoComplete="new-password"
            required
            minLength={8}
            dir="ltr"
            reveal
            revealShowLabel={t(locale, "common.showPassword")}
            revealHideLabel={t(locale, "common.hidePassword")}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password.length > 0 && (
            <div className="flex flex-col gap-1" aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    className={`h-1.5 flex-1 rounded-full ${strength >= n ? (strength >= 3 ? "bg-pub-success" : strength === 2 ? "bg-pub-accent" : "bg-pub-danger") : "bg-pub-line"}`}
                  />
                ))}
              </div>
              <p className="text-xs text-pub-muted">
                {strength >= 3 ? t(locale, "auth.passwordStrengthStrong") : strength === 2 ? t(locale, "auth.passwordStrengthOk") : t(locale, "auth.passwordStrengthWeak")}
              </p>
            </div>
          )}
          <Input
            label={t(locale, "auth.passwordConfirm")}
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            dir="ltr"
            reveal
            revealShowLabel={t(locale, "common.showPassword")}
            revealHideLabel={t(locale, "common.hidePassword")}
          />
          <SubmitButton className="mt-1 w-full">
            {navigation.state === "idle" ? t(locale, "common.register") : t(locale, "common.loading")}
          </SubmitButton>
        </Form>

        <p className="mt-4 text-sm text-pub-muted">
          {t(locale, "auth.haveAccount")}{" "}
          <Link to={`/login${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="font-medium text-pub-ink-soft hover:underline">
            {t(locale, "common.login")}
          </Link>
        </p>
      </Card>
    </div>
  );
}
