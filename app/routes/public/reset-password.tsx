import type { Route } from "./+types/reset-password";
import { Form, useActionData, useNavigation, useSearchParams } from "react-router";
import { redirect } from "react-router";
import { getEnv } from "~server/cf.server";
import { resetPassword } from "~server/auth/service.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { AuthShell } from "~/components/AuthShell";
import { t, type Locale } from "~/lib/i18n";
import { useRouteLoaderData } from "react-router";

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const passwordConfirm = String(form.get("passwordConfirm") ?? "");

  if (password !== passwordConfirm) return { error: "mismatch" as const, token };
  const result = await resetPassword(env, { token, newPassword: password });
  if (!result.ok) return { error: result.code, token };
  return redirect("/login?reset=1");
}

export default function ResetPassword() {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const token = params.get("token") ?? actionData?.token ?? "";
  const invalidLink = !token;

  return (
    <AuthShell title={t(locale, "auth.resetTitle")}>

        {invalidLink && (
          <Alert kind="error">{t(locale, "auth.resetInvalid")}</Alert>
        )}

        {actionData?.error && !invalidLink && (
          <div className="mb-4">
            <Alert kind="error">{t(locale, `auth.errors.${actionData.error}`)}</Alert>
          </div>
        )}

        {!invalidLink && (
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <Input
              label={t(locale, "auth.newPassword")}
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              dir="ltr"
            />
            <Input
              label={t(locale, "auth.passwordConfirm")}
              name="passwordConfirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              dir="ltr"
            />
            <SubmitButton className="w-full">
              {navigation.state === "idle" ? t(locale, "auth.resetSubmit") : t(locale, "common.loading")}
            </SubmitButton>
          </Form>
        )}
    </AuthShell>
  );
}
