import type { Route } from "./+types/security";
import { Form, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import { redirect } from "react-router";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { changePassword } from "~server/auth/service.server";
import { revokeAllUserSessions } from "~server/auth/session.server";
import { devices } from "~server/db/schema";
import { clearCookieHeader } from "~server/auth/cookies.server";
import { SESSION_COOKIE } from "~server/auth/session.server";
import { logSecurityEvent } from "~server/security/events.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { t, formatDate, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const deviceRows = await db
    .select()
    .from(devices)
    .where(eq(devices.userId, auth.user.id))
    .orderBy(desc(devices.lastSeenAt));
  return {
    currentDeviceId: auth.device.id,
    devices: deviceRows.map((d) => ({
      id: d.id,
      label: d.label,
      platform: d.platform,
      status: d.status,
      lastSeenAt: d.lastSeenAt,
    })),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const { auth } = await requireUser(context, request);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  if (intent === "sign-out-all") {
    await revokeAllUserSessions(db, auth.user.id, "user_signout_all");
    await logSecurityEvent(db, { userId: auth.user.id, type: "sessions_revoked_all" });
    const headers = new Headers();
    headers.append("Set-Cookie", clearCookieHeader(SESSION_COOKIE));
    return redirect("/login", { headers });
  }

  const current = String(form.get("current") ?? "");
  const next = String(form.get("password") ?? "");
  const confirm = String(form.get("passwordConfirm") ?? "");
  if (next !== confirm) return { error: "mismatch" as const };

  const result = await changePassword(env, auth.user.id, {
    currentPassword: current,
    newPassword: next,
  });
  if (!result.ok) return { error: result.code };

  const headers = new Headers();
  headers.append("Set-Cookie", clearCookieHeader(SESSION_COOKIE));
  return redirect("/login?reset=1", { headers });
}

export default function Security() {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">{t(locale, "security.title")}</h1>

      {actionData?.error && <Alert kind="error">{t(locale, `auth.errors.${actionData.error}`)}</Alert>}

      <Card>
        <CardHeader
          title={t(locale, "security.changePasswordTitle")}
          description={t(locale, "security.changePasswordNote")}
        />
        <CardBody>
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="_action" value="change-password" />
            <Input
              label={t(locale, "auth.currentPassword")}
              name="current"
              type="password"
              required
              autoComplete="current-password"
              dir="ltr"
            />
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
            <div className="flex justify-end">
              <SubmitButton>{t(locale, "common.save")}</SubmitButton>
            </div>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "security.devicesTitle")} />
        <CardBody className="flex flex-col gap-3">
          {loaderData.devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-3.5 py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {d.label}{" "}
                  {d.id === loaderData.currentDeviceId && (
                    <span className="text-xs font-normal text-brand-700">· {t(locale, "security.thisDevice")}</span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {t(locale, "security.lastSeen")}: {formatDate(locale, d.lastSeenAt)}
                </p>
              </div>
              <Badge tone={d.status === "active" ? "success" : "neutral"}>{d.status}</Badge>
            </div>
          ))}
          <p className="text-xs text-slate-500">
            {t(locale, "security.devicesAdminOnly")}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <Form method="post">
            <input type="hidden" name="_action" value="sign-out-all" />
            <SubmitButton variant="danger">{t(locale, "security.signOutAll")}</SubmitButton>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
}
