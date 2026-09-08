import type { Route } from "./+types/register";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { redirect } from "react-router";
import { getEnv } from "~server/cf.server";
import { login, registerUser } from "~server/auth/service.server";
import { serializeCookie } from "~server/auth/cookies.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { AuthShell } from "~/components/AuthShell";
import { t, type Locale } from "~/lib/i18n";
import { useRouteLoaderData } from "react-router";

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

  const registered = await registerUser(env, { email, fullName, password }, request);
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
    headers.append("Set-Cookie", serializeCookie(c.name, c.value, { maxAgeSeconds: c.maxAgeSeconds }));
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
    <AuthShell title={t(locale, "common.register")}>

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

        <p className="mt-4 text-sm text-ink-muted">
          {t(locale, "auth.haveAccount")}{" "}
          <Link to={`/login${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="tito-link text-sm">
            {t(locale, "common.login")}
          </Link>
        </p>
    </AuthShell>
  );
}
