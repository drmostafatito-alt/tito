import type { Route } from "./+types/dashboard";
import { Link, useLoaderData, useRouteLoaderData } from "react-router";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { devices, securityEvents, sessions } from "~server/db/schema";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { t, formatDate, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));

  const [deviceRows, sessionCount, recent] = await Promise.all([
    db.select().from(devices).where(and(eq(devices.userId, auth.user.id), eq(devices.status, "active"))),
    db.$count(sessions, and(eq(sessions.userId, auth.user.id))),
    db
      .select({ type: securityEvents.type, createdAt: securityEvents.createdAt })
      .from(securityEvents)
      .where(eq(securityEvents.userId, auth.user.id))
      .orderBy(desc(securityEvents.createdAt))
      .limit(5),
  ]);

  return {
    user: { fullName: auth.user.fullName, roleId: auth.user.roleId },
    session: { expiresAt: auth.session.expiresAt },
    device: auth.device,
    activeDevices: deviceRows.length,
    activeSessions: sessionCount,
    recentEvents: recent,
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";

  const roleLabel: Record<string, string> = {
    student: locale === "ar" ? "طالب" : "Student",
    teacher: locale === "ar" ? "مدرّس" : "Teacher",
    admin: locale === "ar" ? "مشرف" : "Admin",
    super_admin: locale === "ar" ? "مشرف عام" : "Super admin",
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{t(locale, "dashboard.welcome")}</p>
          <h1 className="text-2xl font-bold text-slate-900">{loaderData.user.fullName}</h1>
        </div>
        <Badge tone="brand">
          {t(locale, "dashboard.role")}: {roleLabel[loaderData.user.roleId] ?? loaderData.user.roleId}
        </Badge>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader title={t(locale, "dashboard.sessionCard")} />
          <CardBody>
            <p className="text-sm text-slate-600">
              {t(locale, "dashboard.sessionExpires")}{" "}
              <span className="font-medium text-slate-900">
                {formatDate(locale, loaderData.session.expiresAt)}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t(locale, "security.devicesTitle")}: {loaderData.activeDevices} · {locale === "ar" ? "جلسات" : "sessions"}: {loaderData.activeSessions}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "dashboard.deviceCard")} />
          <CardBody>
            <p className="text-sm font-medium text-slate-900">{loaderData.device.label}</p>
            <p className="mt-1 text-xs text-slate-400">{loaderData.device.platform}</p>
            <Link to="/profile/security" className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
              {t(locale, "dashboard.securityLink")} →
            </Link>
          </CardBody>
        </Card>

        <Card className="bg-gradient-to-br from-brand-600 to-brand-800 text-white">
          <CardBody className="flex h-full flex-col justify-between">
            <h2 className="text-base font-semibold">{t(locale, "dashboard.roadmapTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-50">{t(locale, "dashboard.roadmapBody")}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={locale === "ar" ? "آخر النشاطات الأمنية" : "Recent security activity"} />
        <CardBody>
          {loaderData.recentEvents.length === 0 ? (
            <p className="text-sm text-slate-500">—</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {loaderData.recentEvents.map((e, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-slate-500" dir="ltr">{e.type}</span>
                  <span className="text-slate-400">{formatDate(locale, e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
