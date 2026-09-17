import type { Route } from "./+types/forgot-password";
import { Form, useActionData } from "react-router";
import { getEnv, getWaitUntil } from "~server/cf.server";
import { requestPasswordReset } from "~server/auth/service.server";
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
    { ar: t("ar", "seo.forgotPassword"), en: t("en", "seo.forgotPassword") },
    root,
    loaderData.url as string,
  )];
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const form = await request.formData();
  await requestPasswordReset(
    env,
    String(form.get("email") ?? ""),
    request,
    getWaitUntil(context)
  );
  // Exact same public shape for known, unknown, malformed and throttled input.
  return { sent: true as const };
}

export default function ForgotPassword() {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12">
      <Card className="p-6 sm:p-8">
        <h1 className="mb-1 text-2xl font-bold text-pub-ink">{t(locale, "auth.forgotTitle")}</h1>
        <p className="mb-6 text-sm text-pub-muted">{t(locale, "auth.forgotDesc")}</p>

        {actionData?.sent && (
          <div className="mb-4">
            <Alert kind="success">{t(locale, "auth.forgotSent")}</Alert>
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
