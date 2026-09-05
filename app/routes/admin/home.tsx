import type { Route } from "./+types/home";
import { Form, useActionData, useLoaderData, useRouteLoaderData } from "react-router";
import { and, desc, eq, isNull, gt } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings, updateSettingsGroup } from "~server/settings/service.server";
import { auditLogs, devices, sessions, users } from "~server/db/schema";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { t, formatDate, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { settings } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));

  const [totalUsers, students, activeSessions, deviceCount, auditCount, recentAudit] = await Promise.all([
    db.$count(users),
    db.$count(users, eq(users.roleId, "student")),
    db.$count(sessions, and(isNull(sessions.revokedAt), gt(sessions.expiresAt, Date.now()))),
    db.$count(devices),
    db.$count(auditLogs),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        createdAt: auditLogs.createdAt,
        actorRole: auditLogs.actorRole,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(6),
  ]);

  return {
    maintenance: settings.platform.maintenance,
    stats: { totalUsers, students, activeSessions, deviceCount, auditCount },
    recentAudit,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  if (intent !== "toggle-maintenance") return { error: "generic" as const };

  const platform = (await getSettings(db)).platform;
  await updateSettingsGroup(
    db,
    "platform",
    { maintenance: !platform.maintenance },
    {
      userId: auth.user.id,
      role: auth.user.roleId,
      ipHash: await sha256Hex(clientIpOf(request) ?? "unknown"),
    }
  );
  return { toggled: true };
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardBody>
        <p className="text-3xl font-bold text-slate-900" dir="ltr">{value.toLocaleString("en-US")}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
      </CardBody>
    </Card>
  );
}

export default function AdminHome() {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const stats = [
    { label: t(locale, "admin.statUsers"), value: loaderData.stats.totalUsers },
    { label: t(locale, "admin.statStudents"), value: loaderData.stats.students },
    { label: t(locale, "admin.statSessions"), value: loaderData.stats.activeSessions },
    { label: t(locale, "admin.statDevices"), value: loaderData.stats.deviceCount },
    { label: t(locale, "admin.statAudit"), value: loaderData.stats.auditCount },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t(locale, "admin.overview")}</h1>
        {actionData?.toggled && <Alert kind="success">{t(locale, "admin.maintenanceDone")}</Alert>}
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t(locale, "admin.maintenanceTitle")}
            description={t(locale, "admin.maintenanceDesc")}
            action={
              <Badge tone={loaderData.maintenance ? "warning" : "success"}>
                {loaderData.maintenance ? "ON" : "OFF"}
              </Badge>
            }
          />
          <CardBody>
            <Form method="post" onSubmit={(e) => {
              const msg = loaderData.maintenance
                ? t(locale, "admin.maintenanceConfirmOff")
                : t(locale, "admin.maintenanceConfirmOn");
              if (!confirm(msg)) e.preventDefault();
            }}>
              <input type="hidden" name="_action" value="toggle-maintenance" />
              <SubmitButton variant={loaderData.maintenance ? "secondary" : "danger"}>
                {loaderData.maintenance
                  ? t(locale, "admin.maintenanceOff")
                  : t(locale, "admin.maintenanceOn")}
              </SubmitButton>
            </Form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "admin.recentAudit")} />
          <CardBody>
            {loaderData.recentAudit.length === 0 ? (
              <p className="text-sm text-slate-500">{t(locale, "admin.auditEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {loaderData.recentAudit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-slate-600" dir="ltr">
                      {a.action}
                    </span>
                    <span className="text-xs text-slate-400">{formatDate(locale, a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="text-center text-sm text-slate-400">{t(locale, "admin.moreComing")}</p>
    </div>
  );
}
