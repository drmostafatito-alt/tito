import type { Route } from "./+types/login";
import { Form, Link, useActionData, useNavigation, useSearchParams } from "react-router";
import { redirect } from "react-router";
import { getEnv } from "~server/cf.server";
import { login } from "~server/auth/service.server";
import { serializeCookie } from "~server/auth/cookies.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Card } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";
import { useRouteLoaderData } from "react-router";

/** Only same-app paths (no open redirects). */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));

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
  for (const c of result.cookies) {
    headers.append("Set-Cookie", serializeCookie(c.name, c.value, { maxAgeSeconds: c.maxAgeSeconds }));
  }
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
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12">
      <Card className="p-6 sm:p-8">
        <div className="mb-2 flex items-center gap-3">
          <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 bg-accent-500" />
          <h1 className="sig-display text-3xl text-ink">{t(locale, "auth.loginTitle")}</h1>
        </div>
        <p className="mb-6 border-b-2 border-brand-800 pb-5 text-sm leading-relaxed text-ink-muted">{t(locale, "auth.loginSubtitle")}</p>

        {reset && (
          <div className="mb-4">
            <Alert kind="success">{t(locale, "auth.resetSuccess")}</Alert>
          </div>
        )}

        {actionData?.error === "rate_limited" && (
          <div className="mb-4 space-y-1">
            <Alert kind="error">
              <span className="font-medium">{t(locale, "auth.errors.rate_limitedTitle")}</span>
              <span className="mt-1 block text-sm opacity-90">{t(locale, "auth.errors.rate_limitedBody")}</span>
              {actionData.retryAfterSeconds != null && (
                <span className="mt-1 block text-sm font-medium">
                  {actionData.retryAfterSeconds === 1
                    ? t(locale, "auth.errors.rate_limitedRetryOne")
                    : t(locale, "auth.errors.rate_limitedRetry", { s: String(actionData.retryAfterSeconds) })}
                </span>
              )}
            </Alert>
          </div>
        )}

        {actionData?.error && actionData.error !== "rate_limited" && (
          <div className="mb-4">
            <Alert kind="error">{t(locale, `auth.errors.${actionData.error}`)}</Alert>
          </div>
        )}

        <Form method="post" className="flex flex-col gap-4">
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
          />
          <SubmitButton className="mt-1 w-full">
            {navigation.state === "idle" ? t(locale, "common.login") : t(locale, "common.loading")}
          </SubmitButton>
        </Form>

        <div className="mt-4 flex flex-col gap-2 text-sm">
          <Link to="/forgot-password" className="inline-flex min-h-9 items-center font-bold text-ink">
            <span className="sig-u">{t(locale, "auth.forgotLink")}</span>
          </Link>
          <p className="text-ink-muted">
            {t(locale, "auth.noAccount")}{" "}
            <Link to="/register" className="inline-flex min-h-9 items-center font-bold text-ink">
              <span className="sig-u">{t(locale, "common.register")}</span>
            </Link>
          </p>
        </div>

        {envDevNote(locale) && (
          <div className="mt-6 rounded-[var(--radius-btn)] border border-dashed border-line bg-slate-50 p-3 text-xs leading-relaxed text-ink-muted" dir="ltr">
            <p className="mb-1 font-semibold">{t(locale, "auth.demoAccounts")}</p>
            <p>admin@educore.local (local seed only — not a production identity)</p>
            <p>student@educore.local (local fixture)</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function envDevNote(_locale: Locale): boolean {
  // demo credentials hint only surfaces in non-production builds
  // (import.meta.env is vite-only; under wrangler bundling it is undefined)
  return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
}
