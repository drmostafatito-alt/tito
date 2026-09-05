import type { Route } from "./+types/home";
import type { ReactNode } from "react";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { desc } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings, updateSettingsGroup } from "~server/settings/service.server";
import { canPlatform } from "~server/auth/permissions.server";
import { adminOverview } from "~server/analytics/service.server";
import { parseRange, RANGE_KEYS } from "~server/analytics/ranges";
import { auditLogs } from "~server/db/schema";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { formatMoney } from "~server/commerce/money";
import { RangeSwitcher } from "~/components/RangeSwitcher";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { fmtDuration } from "~/lib/format";
import { t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Admin dashboard (P7 §3) — real aggregates over the tables the product
 * already writes; zero hardcoded metrics, one batched read model, integer
 * minor units for every money figure (formatMoney at the display edge).
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { settings, auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const range = parseRange(new URL(request.url).searchParams.get("range"));

  const [canAnalytics, recentAudit] = await Promise.all([
    canPlatform(db, auth, "analytics.read"),
    db
      .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, createdAt: auditLogs.createdAt, actorRole: auditLogs.actorRole })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(6),
  ]);
  const overview = canAnalytics ? await adminOverview(db, range) : null;

  return {
    maintenance: settings.platform.maintenance,
    canAnalytics,
    range,
    overview,
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

function StatCard({ label, value, testid, mono }: { label: string; value: string | number; testid: string; mono?: boolean }) {
  return (
    <Card>
      <CardBody>
        <p className={`text-2xl font-bold text-slate-900 ${mono ? "font-mono text-lg" : ""}`} dir="ltr" data-testid={testid}>
          {typeof value === "number" ? value.toLocaleString("en-US") : value}
        </p>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
      </CardBody>
    </Card>
  );
}

function Section({ title, cols, children }: { title: string; cols?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className={`grid gap-4 grid-cols-2 ${cols ?? "sm:grid-cols-3 lg:grid-cols-4"}`}>{children}</div>
    </section>
  );
}

export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const o = loaderData.overview;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t(locale, "admin.overview")}</h1>
        <RangeSwitcher range={loaderData.range} locale={locale} base="/admin" ranges={RANGE_KEYS} />
      </div>

      {actionData?.toggled && <Alert kind="success">{t(locale, "admin.maintenanceDone")}</Alert>}

      {!loaderData.canAnalytics && (
        <Alert kind="warning"><span data-testid="metrics-denied">{t(locale, "admin.metricsDenied")}</span></Alert>
      )}

      {o && (
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

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title={t(locale, "admin.recentActivity")} action={<Link to="/admin/analytics" className="text-sm text-blue-700 hover:underline">{t(locale, "admin.navAnalytics")}</Link>} />
              <CardBody>
                {o.recentActivity.length === 0 ? (
                  <p className="text-sm text-slate-500" data-testid="activity-empty">{t(locale, "admin.activityEmpty")}</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {o.recentActivity.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 text-sm" data-testid="activity-row">
                        <span className="font-mono text-xs text-slate-600" dir="ltr">
                          {e.type}{e.resourceType ? ` · ${e.resourceType}` : ""}
                        </span>
                        <span className="text-xs text-slate-400">{formatDate(locale, e.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t(locale, "admin.mRecentRegs")} action={<Link to="/admin/users" className="text-sm text-blue-700 hover:underline">{t(locale, "admin.navUsers")}</Link>} />
              <CardBody>
                {o.users.recent.length === 0 ? (
                  <p className="text-sm text-slate-500">{t(locale, "adminUsers.empty")}</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {o.users.recent.map((u) => (
                      <li key={u.id} className="flex items-center justify-between gap-2 text-sm" data-testid="recent-reg-row">
                        <Link to={`/admin/users/${u.id}`} className="truncate text-blue-700 hover:underline">{u.fullName}</Link>
                        <span className="flex items-center gap-2">
                          <Badge tone="neutral">{t(locale, `adminUsers.role_${u.roleId}`)}</Badge>
                          <span className="text-xs text-slate-400">{formatDate(locale, u.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}

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
              <p className="text-sm text-slate-500">{t(locale, "admin.auditEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {loaderData.recentAudit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm" data-testid="recent-audit-row">
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
    </div>
  );
}
