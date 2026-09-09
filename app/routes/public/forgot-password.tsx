import type { Route } from "./+types/forgot-password";
import { Form, useActionData } from "react-router";
import { getEnv } from "~server/cf.server";
import { requestPasswordReset } from "~server/auth/service.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Card } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";
import { useRouteLoaderData } from "react-router";

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const form = await request.formData();
  const result = await requestPasswordReset(env, String(form.get("email") ?? ""), request);
  // uniform response — never reveals whether the email exists
  return { sent: true, devToken: result.devToken ?? null };
}

export default function ForgotPassword() {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12">
      <Card className="p-6 sm:p-8">
        <div className="mb-2 flex items-center gap-3">
          <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 bg-accent-500" />
          <h1 className="sig-display text-3xl text-ink">{t(locale, "auth.forgotTitle")}</h1>
        </div>
        <p className="mb-6 border-b-2 border-brand-800 pb-5 text-sm leading-relaxed text-ink-muted">{t(locale, "auth.forgotDesc")}</p>

        {actionData?.sent && (
          <div className="mb-4 flex flex-col gap-3">
            <Alert kind="success">{t(locale, "auth.forgotSent")}</Alert>
            {actionData.devToken && (
              <Alert kind="info">
                <p className="mb-1 font-medium">{t(locale, "auth.forgotDevNote")}:</p>
                <a className="break-all font-bold text-ink underline decoration-accent-500 decoration-2 underline-offset-4" dir="ltr" href={`/reset-password?token=${actionData.devToken}`}>
                  /reset-password?token={actionData.devToken.slice(0, 12)}…
                </a>
              </Alert>
            )}
          </div>
        )}

        <Form method="post" className="flex flex-col gap-4">
          <Input label={t(locale, "auth.email")} name="email" type="email" required autoComplete="email" dir="ltr" />
          <SubmitButton className="w-full">{t(locale, "auth.forgotSubmit")}</SubmitButton>
        </Form>
      </Card>
    </div>
  );
}
