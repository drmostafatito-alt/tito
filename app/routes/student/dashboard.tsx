import type { Route } from "./+types/dashboard";
import { Link, useRouteLoaderData } from "react-router";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { courses, devices, securityEvents, sessions } from "~server/db/schema";
import { entitlementsForStudent } from "~server/entitlements/grant.server";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Student dashboard (Phase 3 stage 5): modular, admin-configured. Which
 * modules appear (my_courses / quick_actions / support) and the welcome line
 * come from settings.dashboard. Data is always resolved server-side per the
 * signed-in user — disabled or empty modules simply do not render (empty-first,
 * never expose unauthorized data).
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth, settings } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const dash = settings.dashboard;
  const enabled = new Map(dash.modules.map((m) => [m.id, m.enabled]));

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

  // my_courses: only what THIS user is entitled to (course grants + subject grants), active window, published courses
  let myCourses: Array<{ slug: string; titleAr: string; titleEn: string }> = [];
  if (enabled.get("my_courses")) {
    const nowMs = Date.now();
    const ents = (await entitlementsForStudent(db, auth.user.id)).filter(
      (e) => e.status === "active" && e.startsAt <= nowMs && (e.expiresAt === null || e.expiresAt > nowMs)
    );
    const courseIds = ents.filter((e) => e.resourceType === "course" && e.resourceId).map((e) => e.resourceId!);
    const subjectIds = ents.filter((e) => e.resourceType === "subject" && e.resourceId).map((e) => e.resourceId!);
    if (courseIds.length || subjectIds.length) {
      const selectCols = { slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn };
      const published = and(eq(courses.status, "published"), isNull(courses.deletedAt));
      const [byCourse, bySubject] = await Promise.all([
        courseIds.length
          ? db.select(selectCols).from(courses).where(and(published, inArray(courses.id, courseIds))).limit(50)
          : Promise.resolve([]),
        subjectIds.length
          ? db.select(selectCols).from(courses).where(and(published, inArray(courses.subjectId, subjectIds))).limit(50)
          : Promise.resolve([]),
      ]);
      const seen = new Set<string>();
      myCourses = [...byCourse, ...bySubject].filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)));
    }
  }

  return {
    user: { fullName: auth.user.fullName, roleId: auth.user.roleId },
    session: { expiresAt: auth.session.expiresAt },
    device: auth.device,
    activeDevices: deviceRows.length,
    activeSessions: sessionCount,
    recentEvents: recent,
    dash: {
      welcome: { ar: dash.welcomeAr, en: dash.welcomeEn },
      modules: {
        myCourses: Boolean(enabled.get("my_courses")),
        quickActions: Boolean(enabled.get("quick_actions")),
        support: Boolean(enabled.get("support")),
      },
    },
    myCourses,
    support: {
      email: settings.platform.supportEmail ?? "",
      phone: settings.platform.supportPhone ?? "",
      whatsapp: settings.platform.whatsapp ?? "",
    },
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
  const welcomeLine =
    (locale === "ar" ? loaderData.dash.welcome.ar : loaderData.dash.welcome.en) ||
    t(locale, "dashboard.welcome");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{welcomeLine}</p>
          <h1 className="text-2xl font-bold text-slate-900">{loaderData.user.fullName}</h1>
        </div>
        <Badge tone="brand">
          {t(locale, "dashboard.role")}: {roleLabel[loaderData.user.roleId] ?? loaderData.user.roleId}
        </Badge>
      </div>

      {/* Admin-configured modules */}
      {loaderData.dash.modules.myCourses && (
        <Card>
          <CardHeader title={t(locale, "dashboard.myCourses")} />
          <CardBody>
            {loaderData.myCourses.length === 0 ? (
              <p className="text-sm text-slate-500">{t(locale, "content.catalogEmpty")}</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {loaderData.myCourses.map((course) => (
                  <li key={course.slug}>
                    <Link
                      to={`/courses/${course.slug}`}
                      className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      {locale === "ar" ? course.titleAr || course.titleEn : course.titleEn || course.titleAr}
                      <span aria-hidden="true" className="text-slate-400 rtl:rotate-180">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {loaderData.dash.modules.quickActions && (
        <Card>
          <CardHeader title={t(locale, "dashboard.quickActions")} />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              <Link to="/courses" className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                {t(locale, "content.catalogTitle")}
              </Link>
              <Link to="/profile/security" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {t(locale, "security.devicesTitle")}
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      {loaderData.dash.modules.support &&
        (loaderData.support.email || loaderData.support.phone || loaderData.support.whatsapp) && (
          <Card>
            <CardHeader title={t(locale, "dashboard.support")} />
            <CardBody>
              <div className="flex flex-wrap gap-4 text-sm">
                {loaderData.support.email && (
                  <a href={`mailto:${loaderData.support.email}`} className="text-brand-700 hover:underline">{loaderData.support.email}</a>
                )}
                {loaderData.support.phone && (
                  <a href={`tel:${loaderData.support.phone}`} className="text-brand-700 hover:underline" dir="ltr">{loaderData.support.phone}</a>
                )}
                {loaderData.support.whatsapp && (
                  <a
                    href={`https://wa.me/${loaderData.support.whatsapp.replace(/[^\d]/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 hover:underline"
                  >
                    WhatsApp
                  </a>
                )}
              </div>
            </CardBody>
          </Card>
        )}

      {/* Account/session facts (functional, always available to the signed-in user) */}
      <div className="grid gap-5 sm:grid-cols-2">
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
      </div>

      <Card>
        <CardHeader title={locale === "ar" ? "آخر النشاطات الأمنية" : "Recent security activity"} />
        <CardBody>
          {loaderData.recentEvents.length === 0 ? (
            <p className="text-sm text-slate-500">—</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {loaderData.recentEvents.map((ev, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-600">{ev.type}</span>
                  <span className="text-xs text-slate-400">{formatDate(locale, ev.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
