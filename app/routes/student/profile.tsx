import type { Route } from "./+types/profile";
import { Form, Link, data, useActionData, useRouteLoaderData } from "react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { users, roles } from "~server/db/schema";
import { logSecurityEvent } from "~server/security/events.server";
import { LOCALE_COOKIE } from "~server/settings/locale.server";
import { requestEmailChange } from "~server/users/emailchange.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { t, formatDate, type Locale } from "~/lib/i18n";

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || /^\+?[0-9\s-]{6,20}$/.test(v), "invalid phone"),
  localePref: z.enum(["ar", "en"]),
});

/** Student profile: account information + self-service edits (name/phone/language). */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const rows = await db
    .select({
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      localePref: users.localePref,
      createdAt: users.createdAt,
      roleLabel: roles.label,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, auth.user.id))
    .limit(1);
  const user = rows[0];
  if (!user) throw new Response("Not Found", { status: 404 });
  return { user };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();

  // Self-service email change: request an out-of-band verification.
  if (String(form.get("_action") ?? "") === "change-email") {
    const newEmail = String(form.get("newEmail") ?? "");
    const result = await requestEmailChange(env, db, { userId: auth.user.id }, newEmail, request, new URL(request.url).origin);
    if (!result.ok) {
      if (result.code === "rate_limited") return { emailError: "rate_limited" as const };
      if (result.code === "invalid") return { emailError: "invalid" as const };
      return { emailError: "same_email" as const };
    }
    // Enumeration-safe generic confirmation: we do not reveal whether the address
    // was available; if it was, a verification email has been sent to it.
    return { emailRequested: true as const };
  }

  const parsed = profileSchema.safeParse({
    fullName: String(form.get("fullName") ?? ""),
    phone: String(form.get("phone") ?? ""),
    localePref: String(form.get("localePref") ?? "ar"),
  });
  if (!parsed.success) return { error: "invalid" as const };

  const { fullName, phone, localePref } = parsed.data;
  await db
    .update(users)
    .set({ fullName, phone: phone === "" ? null : phone, localePref, updatedAt: Date.now() })
    .where(eq(users.id, auth.user.id));
  await logSecurityEvent(db, { userId: auth.user.id, type: "profile_updated" });

  const headers = new Headers();
  if (localePref !== auth.user.localePref) {
    // Keep the locale cookie in sync — the cookie wins over the stored preference.
    headers.append(
      "Set-Cookie",
      `${LOCALE_COOKIE}=${localePref}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure`
    );
  }
  return data({ ok: true as const }, { headers });
}

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { user } = loaderData;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">{t(locale, "profile.title")}</h1>

      {actionData && "error" in actionData && <Alert kind="error">{t(locale, "auth.errors.generic")}</Alert>}
      {actionData && "ok" in actionData && actionData.ok && <Alert kind="success">{t(locale, "profile.saved")}</Alert>}

      <Card>
        <CardHeader title={t(locale, "profile.accountTitle")} />
        <CardBody>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">{t(locale, "profile.email")}</dt>
              <dd className="font-medium text-slate-800" dir="ltr">{user.email}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t(locale, "dashboard.role")}</dt>
              <dd className="font-medium text-slate-800">{user.roleLabel}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t(locale, "profile.memberSince")}</dt>
              <dd className="font-medium text-slate-800">{formatDate(locale, user.createdAt)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t(locale, "profile.emailChangeTitle")}
          description={t(locale, "profile.emailChangeDesc")}
        />
        <CardBody>
          {actionData && "emailRequested" in actionData && actionData.emailRequested && (
            <Alert kind="success">{t(locale, "profile.emailChangeSent")}</Alert>
          )}
          {actionData && "emailError" in actionData && actionData.emailError && (
            <Alert kind="error">
              {actionData.emailError === "invalid"
                ? t(locale, "profile.emailChangeInvalid")
                : actionData.emailError === "same_email"
                  ? t(locale, "profile.emailChangeSame")
                  : t(locale, "profile.emailChangeRateLimited")}
            </Alert>
          )}
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="_action" value="change-email" />
            <Input
              label={t(locale, "profile.newEmail")}
              name="newEmail"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              dir="ltr"
              defaultValue={actionData && "emailRequested" in actionData ? "" : undefined}
            />
            <div className="flex justify-end">
              <SubmitButton>{t(locale, "profile.emailChangeSubmit")}</SubmitButton>
            </div>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "profile.title")} description={t(locale, "profile.accountTitle")} />
        <CardBody>
          <Form method="post" className="flex flex-col gap-4">
            <Input
              label={t(locale, "profile.fullName")}
              name="fullName"
              defaultValue={user.fullName}
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
            />
            <Input
              label={t(locale, "profile.phone")}
              name="phone"
              defaultValue={user.phone ?? ""}
              type="tel"
              maxLength={20}
              autoComplete="tel"
              dir="ltr"
            />
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              {t(locale, "profile.localePref")}
              <select
                name="localePref"
                defaultValue={user.localePref}
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="ar">{t(locale, "common.arabic")}</option>
                <option value="en">{t(locale, "common.english")}</option>
              </select>
            </label>
            <div className="flex justify-end">
              <SubmitButton>{t(locale, "common.save")}</SubmitButton>
            </div>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link to="/profile/security" className="font-medium text-blue-700 hover:underline">
            {t(locale, "dashboard.securityLink")}
          </Link>
          <Link to="/dashboard" className="font-medium text-blue-700 hover:underline">
            {t(locale, "common.dashboard")}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
