import type { Route } from "./+types/home";
import type { ReactNode } from "react";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { desc } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings, updateSettingsGroup } from "~server/settings/service.server";
import { canPlatform } from "~server/auth/permissions.server";
import { adminOps, adminOverview, coursePerformance } from "~server/analytics/service.server";
import { parseRange, RANGE_KEYS } from "~server/analytics/ranges";
import { auditLogs } from "~server/db/schema";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { formatMoney } from "~server/commerce/money";
import { RangeSwitcher } from "~/components/RangeSwitcher";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { fmtDuration } from "~/lib/format";
import { t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Admin dashboard (Phase 2) — real aggregates over the tables the product
 * already writes; zero hardcoded metrics. Adds a personalised welcome, honest
 * quick actions (every target is a real route), and a real "course
 * performance" panel alongside the existing domain KPI groups. All existing
 * `home-metric-*` test ids and their semantics are preserved.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { settings, auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const range = parseRange(new URL(request.url).searchParams.get("range"));

  const [canAnalytics, recentAudit, courses] = await Promise.all([
    canPlatform(db, auth, "analytics.read"),
    db
      .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, createdAt: auditLogs.createdAt, actorRole: auditLogs.actorRole })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(6),
    coursePerformance(db, 6),
  ]);
  const overview = canAnalytics ? await adminOverview(db, range) : null;
  const ops = canAnalytics ? await adminOps(db) : null;

  return {
    maintenance: settings.platform.maintenance,
    canAnalytics,
    range,
    overview,
    ops,
    recentAudit,
    courses,
    adminName: auth.user.fullName,
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

function StatCard({ label, value, testid, mono }: { label: string; value: string | number; testid: string; mono?: boolean }) {
  return (
    <Card>
      <CardBody>
        <p className={`text-2xl font-bold text-ink ${mono ? "font-mono text-lg" : ""}`} dir="ltr" data-testid={testid}>
          {typeof value === "number" ? value.toLocaleString("en-US") : value}
        </p>
        <p className="mt-1 text-xs text-ink-muted">{label}</p>
      </CardBody>
    </Card>
  );
}

function Section({ title, cols, children }: { title: string; cols?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      <div className={`grid gap-4 grid-cols-2 ${cols ?? "sm:grid-cols-3 lg:grid-cols-4"}`}>{children}</div>
    </section>
  );
}

const QUICK = [
  { to: "/admin/assessment/questions/new", key: "dash.qQuestion", tone: "bg-brand-700 text-white" },
  { to: "/admin/assessment/exams/new", key: "dash.qExam", tone: "bg-brand-800 text-white" },
  { to: "/admin/files", key: "dash.qMedia", tone: "bg-ink text-parchment" },
  { to: "/admin/content", key: "dash.qContent", tone: "bg-brand-700 text-white" },
  { to: "/admin/announcements?new=1", key: "dash.qAnnounce", tone: "bg-accent-600 text-white" },
] as const;

function courseLabel(c: { titleAr: string; titleEn: string }, locale: Locale) {
  return locale === "ar" ? c.titleAr || c.titleEn : c.titleEn || c.titleAr;
}

export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const o = loaderData.overview;

  return (
    <div className="flex flex-col gap-6">
      {/* Welcome */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            {t(locale, "dash.welcome", { name: loaderData.adminName || "Admin" })}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{t(locale, "dash.subtitle")}</p>
        </div>
        <RangeSwitcher range={loaderData.range} locale={locale} base="/admin" ranges={RANGE_KEYS} />
      </div>

      {/* Quick actions */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t(locale, "dash.quickTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="quick-actions">
          {QUICK.map((qa) => (
            <Link
              key={qa.to}
              to={qa.to}
              className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 ${qa.tone}`}
            >
              {t(locale, qa.key)}
            </Link>
          ))}
        </div>
      </div>

      {actionData?.toggled && <Alert kind="success">{t(locale, "admin.maintenanceDone")}</Alert>}

      {!loaderData.canAnalytics && (
        <Alert kind="warning"><span data-testid="metrics-denied">{t(locale, "admin.metricsDenied")}</span></Alert>
      )}

      {o ? (
        <>
          <Section title={t(locale, "admin.secUsers")}>
            <StatCard testid="home-metric-users-total" label={t(locale, "admin.mTotalUsers")} value={o.users.total} />
            <StatCard testid="home-metric-students" label={t(locale, "admin.mStudents")} value={o.users.students} />
            <StatCard testid="home-metric-admins" label={t(locale, "admin.mAdmins")} value={o.users.admins} />
            <StatCard testid="home-metric-new-users" label={t(locale, "admin.mNewUsers")} value={o.users.newInWindow} />
          </Section>

          <Section title={t(locale, "admin.secLearning")}>
            <StatCard testid="home-metric-enrolled" label={t(locale, "admin.mEnrolled")} value={o.learning.enrolledStudents} />
            <StatCard testid="home-metric-active-learners" label={t(locale, "admin.mActiveLearners")} value={o.learning.activeLearners} />
            <StatCard testid="home-metric-completed-lessons" label={t(locale, "admin.mCompletedLessons")} value={o.learning.completedLessons} />
            <StatCard testid="home-metric-watched-videos" label={t(locale, "admin.mWatchedVideos")} value={o.learning.watchedVideos} />
          </Section>

          <Section title={t(locale, "admin.secVideo")}>
            <StatCard testid="home-metric-watch-time" label={t(locale, "admin.mWatchedTime")} value={fmtDuration(o.video.watchedSeconds)} mono />
            <StatCard testid="home-metric-video-starts" label={t(locale, "admin.mVideoStarts")} value={o.video.starts} />
            <StatCard testid="home-metric-video-completions" label={t(locale, "admin.mVideoCompletions")} value={o.video.completions} />
            <StatCard testid="home-metric-lesson-completions" label={t(locale, "admin.mLessonCompletions")} value={o.video.lessonCompletions} />
          </Section>

          <Section title={t(locale, "admin.secExams")}>
            <StatCard testid="home-metric-attempts" label={t(locale, "admin.mAttempts")} value={o.exams.attempts} />
            <StatCard testid="home-metric-submissions" label={t(locale, "admin.mSubmissions")} value={o.exams.submissions} />
            <StatCard testid="home-metric-pass-rate" label={t(locale, "admin.mPassRate")} value={o.exams.passRatePct == null ? "—" : `${o.exams.passRatePct}%`} mono />
            <StatCard testid="home-metric-avg-score" label={t(locale, "admin.mAvgScore")} value={o.exams.avgScorePct == null ? "—" : `${o.exams.avgScorePct}%`} mono />
          </Section>

          <Section title={t(locale, "admin.secCommerce")} cols="sm:grid-cols-3 lg:grid-cols-4">
            <StatCard testid="home-metric-orders" label={t(locale, "admin.mOrders")} value={o.commerce.orders} />
            <StatCard testid="home-metric-paid-orders" label={t(locale, "admin.mPaidOrders")} value={o.commerce.paidOrders} />
            <StatCard testid="home-metric-pending-orders" label={t(locale, "admin.mPendingOrders")} value={o.commerce.pendingOrders} />
            <StatCard testid="home-metric-gross" label={t(locale, "admin.mGross")} value={formatMoney(o.commerce.grossRevenueMinor, "EGP")} mono />
            <StatCard testid="home-metric-refunded" label={t(locale, "admin.mRefunds")} value={formatMoney(o.commerce.refundedMinor, "EGP")} mono />
            <StatCard testid="home-metric-net" label={t(locale, "admin.mNet")} value={formatMoney(o.commerce.netRevenueMinor, "EGP")} mono />
            <StatCard testid="home-metric-pending-payments" label={t(locale, "admin.mPendingPayments")} value={o.commerce.pendingPaymentReview} />
            <StatCard testid="home-metric-redemptions" label={t(locale, "admin.mRedemptions")} value={o.commerce.redemptions} />
          </Section>

          <Section title={t(locale, "admin.secOps")}>
            <Link to="/admin/content" className="flex flex-col items-start justify-between gap-1 rounded-xl border border-line p-3 text-right hover:border-brand-300 hover:bg-sand-100">
              <span className="text-sm text-ink-muted">{t(locale, "admin.mPublishedCourses")}</span>
              <span className="text-2xl font-bold text-ink" dir="ltr" data-testid="home-metric-published-courses">{loaderData.ops!.publishedCourses}</span>
            </Link>
            <Link to="/admin/assignments" className="flex flex-col items-start justify-between gap-1 rounded-xl border border-line p-3 text-right hover:border-brand-300 hover:bg-sand-100">
              <span className="text-sm text-ink-muted">{t(locale, "admin.mPendingAssignGrading")}</span>
              <span className="text-2xl font-bold text-ink" dir="ltr" data-testid="home-metric-pending-assignments">{loaderData.ops!.pendingAssignmentGrading}</span>
            </Link>
            <Link to="/admin/assessment" className="flex flex-col items-start justify-between gap-1 rounded-xl border border-line p-3 text-right hover:border-brand-300 hover:bg-sand-100">
              <span className="text-sm text-ink-muted">{t(locale, "admin.mPendingEssayGrading")}</span>
              <span className="text-2xl font-bold text-ink" dir="ltr" data-testid="home-metric-pending-essays">{loaderData.ops!.pendingEssayGrading}</span>
            </Link>
          </Section>
        </>
      ) : (
        <EmptyState icon="📊" title={t(locale, "dash.noMetrics")} />
      )}

      {/* Course performance — real published courses + lesson/engaged counts */}
      <Card data-testid="course-performance">
        <CardHeader
          title={t(locale, "dash.coursesTitle")}
          action={<Link to="/admin/content" className="text-sm text-brand-700 hover:underline">{t(locale, "dash.viewAllCourses")}</Link>}
        />
        <CardBody>
          {loaderData.courses.length === 0 ? (
            <EmptyState
              icon="🎓"
              title={t(locale, "dash.coursesEmpty")}
              body={t(locale, "dash.coursesEmptyHint")}
              action={<Link to="/admin/content" className="inline-flex min-h-9 items-center rounded-lg bg-brand-700 px-3 text-sm font-medium text-white">{t(locale, "dash.courseEmptyAction")}</Link>}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {loaderData.courses.map((c) => (
                <li key={c.id}>
                  <Link to={`/admin/content/course/${c.id}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/40">
                    {c.thumbnailFileId ? (
                      <img src={`/files/${c.thumbnailFileId}`} alt="" className="h-12 w-16 rounded-md border border-line bg-sand-100 object-cover" />
                    ) : (
                      <span className="flex h-12 w-16 items-center justify-center rounded-md bg-sand-100 text-xl text-ink-muted" aria-hidden="true">🎓</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{courseLabel(c, locale)}</p>
                      <p className="truncate text-xs text-ink-muted">{c.subjectAr || c.subjectEn ? courseLabel({ titleAr: c.subjectAr ?? "", titleEn: c.subjectEn ?? "" }, locale) : ""}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-ink-muted">
                      <Badge tone="success">{t(locale, "dash.published")}</Badge>
                      <span className="tabular-nums">{t(locale, "dash.labelLessons")}: {c.lessons}</span>
                      <span className="tabular-nums">{t(locale, "dash.labelStudents")}: {c.engagedStudents}</span>
                      <span className="hidden text-ink-muted md:inline">{formatDate(locale, c.updatedAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t(locale, "admin.recentActivity")} action={<Link to="/admin/analytics" className="text-sm text-blue-700 hover:underline">{t(locale, "admin.navAnalytics")}</Link>} />
          <CardBody>
            {o?.recentActivity.length === 0 ? (
              <p className="text-sm text-ink-muted" data-testid="activity-empty">{t(locale, "admin.activityEmpty")}</p>
            ) : o?.recentActivity ? (
              <ul className="flex flex-col gap-2.5">
                {o.recentActivity.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-sm" data-testid="activity-row">
                    <span className="font-mono text-xs text-ink-muted" dir="ltr">
                      {e.type}{e.resourceType ? ` · ${e.resourceType}` : ""}
                    </span>
                    <span className="text-xs text-ink-muted">{formatDate(locale, e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="📋" title={t(locale, "dash.noMetrics")} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "admin.mRecentRegs")} action={<Link to="/admin/users" className="text-sm text-blue-700 hover:underline">{t(locale, "admin.navUsers")}</Link>} />
          <CardBody>
            {o?.users.recent.length === 0 ? (
              <EmptyState icon="👤" title={t(locale, "adminUsers.empty")} />
            ) : o?.users.recent ? (
              <ul className="flex flex-col gap-2.5">
                {o.users.recent.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 text-sm" data-testid="recent-reg-row">
                    <Link to={`/admin/users/${u.id}`} className="truncate text-blue-700 hover:underline">{u.fullName}</Link>
                    <span className="flex items-center gap-2">
                      <Badge tone="neutral">{t(locale, `adminUsers.role_${u.roleId}`)}</Badge>
                      <span className="text-xs text-ink-muted">{formatDate(locale, u.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="👤" title={t(locale, "dash.noMetrics")} />
            )}
          </CardBody>
        </Card>
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
          <CardHeader title={t(locale, "admin.recentAudit")} action={<Link to="/admin/audit" className="text-sm text-blue-700 hover:underline">{t(locale, "admin.navAudit")}</Link>} />
          <CardBody>
            {loaderData.recentAudit.length === 0 ? (
              <p className="text-sm text-ink-muted">{t(locale, "admin.auditEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {loaderData.recentAudit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm" data-testid="recent-audit-row">
                    <span className="font-mono text-xs text-ink-muted" dir="ltr">
                      {a.action}
                    </span>
                    <span className="text-xs text-ink-muted">{formatDate(locale, a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
