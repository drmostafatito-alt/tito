import type { Route } from "./+types/register";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { redirect } from "react-router";
import { getEnv, getWaitUntil } from "~server/cf.server";
import { login, registerUser } from "~server/auth/service.server";
import { cookieSameSite, serializeCookie } from "~server/auth/cookies.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Card } from "~/components/ui/Card";
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
  for (const c of result.cookies) {
    headers.append(
      "Set-Cookie",
      serializeCookie(c.name, c.value, { maxAgeSeconds: c.maxAgeSeconds, sameSite: cookieSameSite(env) }),
    );
  }
  return redirect("/dashboard", { headers });
}

export default function Register() {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [params] = useSearchParams();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12">
      <Card className="p-6 sm:p-8">
        <h1 className="mb-6 text-2xl font-bold text-pub-ink">{t(locale, "common.register")}</h1>

        {actionData?.error && (
          <div className="mb-4">
            <Alert kind="error">{t(locale, `auth.errors.${actionData.error}`)}</Alert>
          </div>
        )}

        <Form method="post" className="flex flex-col gap-4">
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
          />
          <Input
            label={t(locale, "auth.passwordConfirm")}
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            dir="ltr"
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
