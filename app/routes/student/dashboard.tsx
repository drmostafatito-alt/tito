import type { Route } from "./+types/dashboard";
import { Link, useRouteLoaderData } from "react-router";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { courses, devices, securityEvents, sessions, subscriptions } from "~server/db/schema";
import { unreadAnnouncementsCount, visibleAnnouncements } from "~server/announcements/service.server";
import { entitlementsForStudent } from "~server/entitlements/grant.server";
import { continueLearning, courseProgressBatch, progressStats } from "~server/progress/service.server";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { ProgressBar } from "~/components/ProgressBar";
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
  let myCourses: Array<{ slug: string; titleAr: string; titleEn: string; pct: number; completed: number; total: number }> = [];
  if (enabled.get("my_courses")) {
    const nowMs = Date.now();
    const ents = (await entitlementsForStudent(db, auth.user.id)).filter(
      (e) => e.status === "active" && e.startsAt <= nowMs && (e.expiresAt === null || e.expiresAt > nowMs)
    );
    const courseIds = ents.filter((e) => e.resourceType === "course" && e.resourceId).map((e) => e.resourceId!);
    const subjectIds = ents.filter((e) => e.resourceType === "subject" && e.resourceId).map((e) => e.resourceId!);
    if (courseIds.length || subjectIds.length) {
      const selectCols = { id: courses.id, slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn };
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
      const rows = [...byCourse, ...bySubject].filter((c) => (seen.has(c.slug) ? false : (seen.add(c.slug), true)));
      const pcts = await courseProgressBatch(db, auth.user.id, rows.map((r) => r.id));
      myCourses = rows.map((c) => {
        const pr = pcts.get(c.id);
        return { slug: c.slug, titleAr: c.titleAr, titleEn: c.titleEn, pct: pr?.pct ?? 0, completed: pr?.completed ?? 0, total: pr?.total ?? 0 };
      });
    }
  }

  // continue learning (Phase 4): recent lessons with resume positions — server-resolved, entitled-only
  const continueItems = enabled.get("continue") ? await continueLearning(db, auth.user.id, 4) : [];
  const stats = enabled.get("stats") ? await progressStats(db, auth.user.id) : null;

  // Phase 7 modules: unread announcements + subscriptions expiring within 14 days (FEATURE-SPEC §2)
  const notifUser = { id: auth.user.id, roleId: auth.user.roleId };
  const [notifItems, notifUnread] = enabled.get("announcements")
    ? await Promise.all([visibleAnnouncements(db, notifUser, Date.now(), 3), unreadAnnouncementsCount(db, notifUser)])
    : [[], 0];
  const announcementsModule = enabled.get("announcements")
    ? { unread: notifUnread, items: notifItems.map((i) => ({ id: i.id, titleAr: i.titleAr, titleEn: i.titleEn, readAt: i.readAt })) }
    : null;

  let expiringModule: Array<{ id: string; titleAr: string | null; titleEn: string | null; endAt: number }> | null = null;
  if (enabled.get("expiry")) {
    const nowMs = Date.now();
    const horizon = nowMs + 14 * 86_400_000;
    const subRows = await db
      .select({ id: subscriptions.id, planSnapshot: subscriptions.planSnapshot, currentPeriodEnd: subscriptions.currentPeriodEnd, expiresAt: subscriptions.expiresAt })
      .from(subscriptions)
      .where(and(eq(subscriptions.studentId, auth.user.id), inArray(subscriptions.status, ["active", "paused", "cancelled"])))
      .limit(20);
    expiringModule = subRows
      .map((s) => ({
        id: s.id,
        titleAr: typeof s.planSnapshot?.titleAr === "string" ? s.planSnapshot.titleAr : null,
        titleEn: typeof s.planSnapshot?.titleEn === "string" ? s.planSnapshot.titleEn : null,
        endAt: s.expiresAt ?? s.currentPeriodEnd ?? 0,
      }))
      .filter((s) => s.endAt > nowMs && s.endAt <= horizon)
      .sort((a, b) => a.endAt - b.endAt);
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
        continue: Boolean(enabled.get("continue")),
        stats: Boolean(enabled.get("stats")),
        quickActions: Boolean(enabled.get("quick_actions")),
        support: Boolean(enabled.get("support")),
        announcements: Boolean(enabled.get("announcements")),
        expiry: Boolean(enabled.get("expiry")),
      },
    },
    myCourses,
    continueItems,
    stats,
    announcementsModule,
    expiringModule,
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
      {loaderData.dash.modules.continue && (
        <Card>
          <CardHeader title={t(locale, "progress.continueTitle")} />
          <CardBody>
            {loaderData.continueItems.length === 0 ? (
              <p className="text-sm text-slate-500">{t(locale, "progress.continueEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {loaderData.continueItems.map((item) => (
                  <li key={`${item.courseSlug}/${item.lessonSlug}`}>
                    <Link
                      to={`/learn/${item.courseSlug}/${item.lessonSlug}`}
                      className="flex min-h-11 flex-col gap-1 rounded-lg border border-slate-200 px-4 py-2.5 hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-800">
                        {locale === "ar" ? item.lessonTitleAr || item.lessonTitleEn : item.lessonTitleEn || item.lessonTitleAr}
                        {item.status === "completed" ? (
                          <Badge tone="success">{t(locale, "progress.completed")}</Badge>
                        ) : (
                          <span className="text-xs font-normal text-brand-700">{t(locale, "progress.resume")}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        {locale === "ar" ? item.courseTitleAr || item.courseTitleEn : item.courseTitleEn || item.courseTitleAr}
                        <span dir="ltr">· {item.pct}%</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {loaderData.dash.modules.stats && loaderData.stats && (
        <Card>
          <CardHeader title={t(locale, "progress.statsTitle")} />
          <CardBody>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3 text-center">
                <p className="text-2xl font-bold text-brand-700" dir="ltr">{loaderData.stats.completedLessons}</p>
                <p className="text-xs text-slate-500">{t(locale, "progress.completedLessons")}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-center">
                <p className="text-2xl font-bold text-slate-700" dir="ltr">{loaderData.stats.inProgressLessons}</p>
                <p className="text-xs text-slate-500">{t(locale, "progress.lessonsInProgress")}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-center">
                <p className="text-2xl font-bold text-slate-700" dir="ltr">{loaderData.stats.completedVideos}</p>
                <p className="text-xs text-slate-500">{t(locale, "progress.completedVideos")}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

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
                      className="flex min-h-11 flex-col gap-1.5 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span className="flex items-center justify-between gap-2">
                        {locale === "ar" ? course.titleAr || course.titleEn : course.titleEn || course.titleAr}
                        <span className="text-xs font-normal text-slate-500" dir="ltr">{course.pct}%</span>
                      </span>
                      <ProgressBar pct={course.pct} label={t(locale, "progress.courseProgress")} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {loaderData.dash.modules.announcements && loaderData.announcementsModule && (
        <Card>
          <CardHeader
            title={t(locale, "dashboard.announcements")}
            action={
              <Link to="/notifications" className="text-sm text-blue-700 hover:underline">
                {loaderData.announcementsModule.unread > 0
                  ? t(locale, "dashboard.unreadCount", { n: loaderData.announcementsModule.unread })
                  : t(locale, "dashboard.viewAll")}
              </Link>
            }
          />
          <CardBody>
            {loaderData.announcementsModule.items.length === 0 ? (
              <p className="text-sm text-slate-500" data-testid="dash-announcements-empty">{t(locale, "notifications.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {loaderData.announcementsModule.items.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm" data-testid="dash-announcement-row">
                    <Link to="/notifications" className="truncate font-medium text-slate-800 hover:text-brand-700">
                      {locale === "ar" ? a.titleAr || a.titleEn : a.titleEn || a.titleAr}
                    </Link>
                    {!a.readAt && <Badge tone="brand">{t(locale, "notifications.unreadLabel")}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {loaderData.dash.modules.expiry && loaderData.expiringModule && loaderData.expiringModule.length > 0 && (
        <Card>
          <CardHeader title={t(locale, "dashboard.expiring")} />
          <CardBody>
            <ul className="flex flex-col gap-2">
              {loaderData.expiringModule.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm" data-testid="dash-expiry-row">
                  <span className="truncate font-medium text-slate-800">
                    {(locale === "ar" ? s.titleAr || s.titleEn : s.titleEn || s.titleAr) || t(locale, "dashboard.subscriptionGeneric")}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone="warning">{t(locale, "dashboard.expiresOn")}</Badge>
                    <span className="text-xs text-slate-500">{formatDate(locale, s.endAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
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
            <Link to="/profile/security" className="mt-3 inline-flex min-h-6 items-center text-sm font-medium text-brand-700 hover:underline">
              {t(locale, "dashboard.securityLink")}
              <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>
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
