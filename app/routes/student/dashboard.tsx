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
import { QuestionPlatformCard } from "~/components/QuestionPlatform";
import { Action, ArrowGlyph, EmptyNote, Meter, Ordinal, Tag } from "~/components/tito/ui";
import { subjectKindOf, SubjectSignature } from "~/components/tito/subject";
import { t, formatDate, type Locale } from "~/lib/i18n";
import { resolveQuestionPlatformUrl } from "~/lib/question-platform";

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
  // External Questions & Exams Platform entry (admin-configured; null = hidden)
  const questionPlatformUrl = resolveQuestionPlatformUrl(settings.platform);

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
    questionPlatformUrl,
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

/**
 * THE WORKSPACE.
 *
 * The dashboard answers five questions, in this order, and nothing else:
 *   1. where did I stop?      → "أكمل من حيث توقفت"
 *   2. what do I have?        → "موادي"
 *   3. how far am I?          → "تقدّمي"
 *   4. what needs attention?  → expiries + unread announcements
 *   5. what is my account?    → session, device, security activity
 *
 * Which modules exist is still decided by `settings.dashboard.modules`; a
 * disabled or empty module renders nothing at all. There is no invented
 * content anywhere on this page.
 */
function Module({
  title,
  index,
  action,
  children,
  testId,
}: {
  title: string;
  index?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t-2 border-pub-ink pt-3">
        <h2 className="flex items-baseline gap-3 font-display text-pub-md font-extrabold tracking-[-0.02em] text-pub-ink">
          {index != null && (
            <span className="tito-label text-ink-300" aria-hidden="true">
              <Ordinal n={index} />
            </span>
          )}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ModuleLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center gap-1.5 text-pub-sm font-bold text-pub-ink hover:underline">
      {children}
      <ArrowGlyph />
    </Link>
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";

  const roleLabel: Record<string, string> = {
    student: t(locale, "dashboard.roleStudent"),
    teacher: t(locale, "dashboard.roleTeacher"),
    admin: t(locale, "dashboard.roleAdmin"),
    super_admin: t(locale, "dashboard.roleSuperAdmin"),
  };
  const welcomeLine = (ar ? loaderData.dash.welcome.ar : loaderData.dash.welcome.en) || t(locale, "dashboard.welcome");

  const [resume, ...rest] = loaderData.continueItems;
  const stats = loaderData.stats;
  const showStats =
    loaderData.dash.modules.stats &&
    stats &&
    (stats.completedLessons > 0 || stats.inProgressLessons > 0 || stats.completedVideos > 0);
  const expiring = loaderData.dash.modules.expiry ? (loaderData.expiringModule ?? []) : [];
  const announcements = loaderData.dash.modules.announcements ? loaderData.announcementsModule : null;
  const support = loaderData.support;
  const hasSupport = loaderData.dash.modules.support && (support.email || support.phone || support.whatsapp);

  /* Modules are numbered in the order the student reads them, and the numbers
     are computed from what actually renders — a disabled module does not leave
     a gap in the sequence. */
  let n = 0;
  const next = () => ++n;

  return (
    <div className="student-dashboard flex flex-col gap-10">
      {/* WHO — the name is the heading; the role and the session are ruled meta. */}
      <header>
        <p className="tito-label">{welcomeLine}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-pub-line pb-4">
          <h1 className="font-display text-[length:var(--text-pub-h2)] font-extrabold leading-pub-tight tracking-[-0.035em] text-pub-ink">
            {loaderData.user.fullName}
          </h1>
          <Tag tone="neutral">
            {t(locale, "dashboard.role")}: {roleLabel[loaderData.user.roleId] ?? loaderData.user.roleId}
          </Tag>
        </div>
      </header>

      {/* 1 — WHERE DID I STOP */}
      {loaderData.dash.modules.continue && (
        <Module index={next()} title={t(locale, "progress.continueTitle")}>
          {loaderData.continueItems.length === 0 ? (
            <EmptyNote
              title={t(locale, "progress.continueEmpty")}
              action={
                <span data-testid="dash-study-link-empty">
                  <Action size="sm" to="/study">
                    {t(locale, "study.navTitle")}
                  </Action>
                </span>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {/* The resume card: the ONE thing this page exists to offer. */}
              <Link
                to={`/learn/${resume.courseSlug}/${resume.lessonSlug}`}
                className="group relative flex flex-col gap-4 overflow-hidden rounded-pub-lg bg-pub-navy p-6 text-pub-on-navy transition-colors hover:bg-pub-navy-2 sm:p-7"
              >
                <span className="tito-label text-pub-accent">{t(locale, "progress.continueTitle")}</span>
                <span className="font-display text-[length:var(--text-pub-h3)] font-extrabold leading-pub-tight tracking-[-0.03em] text-pub-on-navy">
                  {(ar ? resume.lessonTitleAr || resume.lessonTitleEn : resume.lessonTitleEn || resume.lessonTitleAr) || ""}
                </span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-pub-sm text-pub-on-navy-soft">
                  <span className="min-w-0 truncate">
                    {(ar ? resume.courseTitleAr || resume.courseTitleEn : resume.courseTitleEn || resume.courseTitleAr) || ""}
                  </span>
                  {resume.status === "completed" ? (
                    <Tag tone="onDark">{t(locale, "progress.completed")}</Tag>
                  ) : (
                    <span data-numeral dir="ltr" className="font-bold text-pub-accent">
                      {resume.pct}%
                    </span>
                  )}
                </span>
                <Meter pct={resume.pct} tone="onDark" label={t(locale, "progress.courseProgress")} />
                <span className="mt-1 inline-flex items-center gap-2 text-pub-sm font-bold text-pub-accent">
                  {t(locale, "study.startLesson")}
                  <ArrowGlyph />
                </span>
              </Link>

              {rest.length > 0 && (
                <ul className="tito-rows">
                  {rest.map((item, i) => (
                    <li key={`${item.courseSlug}/${item.lessonSlug}`} className="tito-row grid-cols-[2.25rem_minmax(0,1fr)_auto] px-1">
                      <span className="pt-1 text-pub-sm font-bold text-ink-300" aria-hidden="true">
                        <Ordinal n={i + 2} />
                      </span>
                      <div className="min-w-0">
                        <Link
                          to={`/learn/${item.courseSlug}/${item.lessonSlug}`}
                          className="font-display text-pub-base font-bold leading-pub-snug text-pub-ink after:absolute after:inset-0"
                        >
                          {(ar ? item.lessonTitleAr || item.lessonTitleEn : item.lessonTitleEn || item.lessonTitleAr) || ""}
                        </Link>
                        <p className="mt-1 truncate text-pub-xs text-pub-muted">
                          {(ar ? item.courseTitleAr || item.courseTitleEn : item.courseTitleEn || item.courseTitleAr) || ""}
                        </p>
                      </div>
                      <span className="relative z-10 flex shrink-0 items-center gap-3 self-center">
                        {item.status === "completed" ? (
                          <Tag tone="ok">{t(locale, "progress.completed")}</Tag>
                        ) : (
                          <span data-numeral dir="ltr" className="text-pub-sm font-bold text-pub-muted">
                            {item.pct}%
                          </span>
                        )}
                        <ArrowGlyph className="text-pub-ink" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Module>
      )}

      {/* 2 — WHAT DO I HAVE ACCESS TO */}
      {loaderData.dash.modules.myCourses && (
        <Module
          index={next()}
          title={t(locale, "dashboard.myCourses")}
          action={<ModuleLink to="/study">{t(locale, "study.navTitle")}</ModuleLink>}
        >
          {loaderData.myCourses.length === 0 ? (
            <EmptyNote
              title={t(locale, "content.catalogEmpty")}
              action={
                <Action size="sm" to="/study">
                  {t(locale, "study.navTitle")}
                </Action>
              }
            />
          ) : (
            <ul className="tito-rows">
              {loaderData.myCourses.map((course, i) => {
                const title = (ar ? course.titleAr || course.titleEn : course.titleEn || course.titleAr) || "";
                const kind = subjectKindOf(course.slug, course.titleEn, course.titleAr);
                return (
                  <li key={course.slug} data-subject={kind} className="tito-row grid-cols-[2.25rem_minmax(0,1fr)_auto] px-1">
                    <span className="pt-1 text-[color:var(--subject-ink)]" aria-hidden="true">
                      <SubjectSignature kind={kind} size={18} />
                    </span>
                    <div className="min-w-0">
                      <Link
                        to={`/courses/${course.slug}`}
                        className="font-display text-pub-base font-bold leading-pub-snug text-pub-ink after:absolute after:inset-0"
                      >
                        {title}
                      </Link>
                      <div className="mt-2 flex items-center gap-3">
                        <Meter pct={course.pct} className="max-w-56" label={t(locale, "progress.courseProgress")} />
                        <span data-numeral dir="ltr" className="shrink-0 text-pub-xs font-bold text-pub-muted">
                          {course.completed}/{course.total}
                        </span>
                      </div>
                    </div>
                    <span data-numeral dir="ltr" className="relative z-10 self-center text-pub-md font-extrabold text-pub-ink">
                      {course.pct}%
                      <span className="sr-only"> — {t(locale, "progress.courseProgress")}</span>
                    </span>
                    <span aria-hidden="true" className="sr-only">
                      {i}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Module>
      )}

      {/* 3 — HOW FAR AM I */}
      {showStats && stats && (
        <Module index={next()} title={t(locale, "progress.statsTitle")}>
          <dl className="grid grid-cols-3 gap-px bg-pub-line">
            {[
              { v: stats.completedLessons, l: t(locale, "progress.completedLessons") },
              { v: stats.inProgressLessons, l: t(locale, "progress.lessonsInProgress") },
              { v: stats.completedVideos, l: t(locale, "progress.completedVideos") },
            ].map((s) => (
              <div key={s.l} className="bg-pub-bg px-2 py-4">
                <dd data-numeral dir="ltr" className="text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink">
                  {s.v}
                </dd>
                <dt className="tito-label mt-2">{s.l}</dt>
              </div>
            ))}
          </dl>
        </Module>
      )}

      {/* 4 — WHAT NEEDS ATTENTION */}
      {(expiring.length > 0 || announcements) && (
        <Module
          index={next()}
          title={t(locale, "dashboard.announcements")}
          action={
            announcements ? (
              <ModuleLink to="/notifications">
                {announcements.unread > 0 ? t(locale, "dashboard.unreadCount", { n: announcements.unread }) : t(locale, "dashboard.viewAll")}
              </ModuleLink>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-6">
            {expiring.length > 0 && (
              <ul className="tito-rows">
                {expiring.map((s) => (
                  <li key={s.id} data-testid="dash-expiry-row" className="tito-row grid-cols-[minmax(0,1fr)_auto] px-1">
                    <span className="min-w-0 truncate font-display text-pub-base font-bold text-pub-ink">
                      {(ar ? s.titleAr || s.titleEn : s.titleEn || s.titleAr) || t(locale, "dashboard.subscriptionGeneric")}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 self-center">
                      <Tag tone="warn">{t(locale, "dashboard.expiresOn")}</Tag>
                      <span data-numeral className="text-pub-xs text-pub-muted">
                        {formatDate(locale, s.endAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {announcements &&
              (announcements.items.length === 0 ? (
                <p className="text-pub-sm text-pub-muted" data-testid="dash-announcements-empty">
                  {t(locale, "notifications.empty")}
                </p>
              ) : (
                <ul className="tito-rows">
                  {announcements.items.map((a) => (
                    <li key={a.id} data-testid="dash-announcement-row" className="tito-row grid-cols-[minmax(0,1fr)_auto] px-1">
                      <Link to="/notifications" className="min-w-0 truncate font-display text-pub-base font-bold text-pub-ink after:absolute after:inset-0">
                        {(ar ? a.titleAr || a.titleEn : a.titleEn || a.titleAr) || ""}
                      </Link>
                      {!a.readAt && (
                        <span className="relative z-10 self-center">
                          <Tag tone="mark">{t(locale, "notifications.unreadLabel")}</Tag>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </Module>
      )}

      {/* The external exam platform — only when the owner configured a URL. */}
      <QuestionPlatformCard url={loaderData.questionPlatformUrl} locale={locale} />

      {/* 5 — MY ACCOUNT: session, device, security, support. Facts only. */}
      <Module index={next()} title={t(locale, "dashboard.sessionCard")}>
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          <dl className="text-pub-sm">
            <div className="flex items-baseline justify-between gap-4 border-b border-pub-line py-2.5">
              <dt className="tito-label">{t(locale, "dashboard.sessionExpires")}</dt>
              <dd data-numeral className="font-bold text-pub-ink">{formatDate(locale, loaderData.session.expiresAt)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-pub-line py-2.5">
              <dt className="tito-label">{t(locale, "security.devicesTitle")}</dt>
              <dd data-numeral className="font-bold text-pub-ink">{loaderData.activeDevices}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-pub-line py-2.5">
              <dt className="tito-label">{t(locale, "dashboard.sessionsLabel")}</dt>
              <dd data-numeral className="font-bold text-pub-ink">{loaderData.activeSessions}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-b border-pub-line py-2.5">
              <dt className="tito-label">{t(locale, "dashboard.deviceCard")}</dt>
              <dd className="min-w-0 truncate font-bold text-pub-ink">{loaderData.device.label}</dd>
            </div>
            <div className="pt-3">
              <ModuleLink to="/profile/security">{t(locale, "dashboard.securityLink")}</ModuleLink>
            </div>
          </dl>

          <div className="min-w-0">
            <p className="tito-label">{t(locale, "dashboard.securityActivity")}</p>
            {loaderData.recentEvents.length === 0 ? (
              <p className="mt-3 text-pub-sm text-pub-muted">—</p>
            ) : (
              <ul className="mt-2 text-pub-sm">
                {loaderData.recentEvents.map((ev, i) => {
                  const key = `securityAdmin.ev_${ev.type}`;
                  const label = t(locale, key);
                  return (
                    <li key={i} className="flex items-baseline justify-between gap-3 border-b border-pub-line py-2.5">
                      <span className="min-w-0 truncate text-pub-ink-soft">{label === key ? ev.type.replace(/_/g, " ") : label}</span>
                      <span data-numeral className="shrink-0 text-pub-xs text-pub-muted">{formatDate(locale, ev.createdAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            {(loaderData.dash.modules.quickActions || hasSupport) && (
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
                {loaderData.dash.modules.quickActions && (
                  <span data-testid="dash-study-link">
                    <Action size="sm" variant="secondary" to="/study">
                      {t(locale, "study.navTitle")}
                    </Action>
                  </span>
                )}
                {hasSupport && (
                  <>
                    <span className="tito-label">{t(locale, "dashboard.support")}</span>
                    {support.email && (
                      <a href={`mailto:${support.email}`} className="text-pub-sm font-bold text-pub-ink hover:underline">
                        {support.email}
                      </a>
                    )}
                    {support.phone && (
                      <a href={`tel:${support.phone}`} dir="ltr" className="text-pub-sm font-bold text-pub-ink hover:underline">
                        {support.phone}
                      </a>
                    )}
                    {support.whatsapp && (
                      <a
                        href={`https://wa.me/${support.whatsapp.replace(/[^\d]/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-pub-sm font-bold text-pub-ink hover:underline"
                      >
                        WhatsApp
                      </a>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </Module>
    </div>
  );
}
