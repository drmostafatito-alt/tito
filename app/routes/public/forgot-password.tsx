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
import { Art } from "~/components/visuals/Art";

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
    <div className="relative isolate mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12">
      {/* Decorative engraved line-art — outside the card, behind it, aria-hidden,
          never over a field or a button. */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-8 start-0 hidden h-40 w-40 select-none opacity-[0.07] sm:block">
        <Art name="kant" />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 end-0 hidden h-36 w-36 select-none opacity-[0.07] sm:block">
        <Art name="scroll" />
      </div>
      <Card className="relative p-6 sm:p-8">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">{t(locale, "auth.forgotTitle")}</h1>
        <p className="mb-6 text-sm text-slate-500">{t(locale, "auth.forgotDesc")}</p>

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
