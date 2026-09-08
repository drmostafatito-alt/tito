import type { Route } from "./+types/admin.analytics";
import { Link, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import { analyticsDetail, topWatched } from "~server/analytics/service.server";
import { parseRange, RANGE_KEYS } from "~server/analytics/ranges";
import { RangeSwitcher } from "~/components/RangeSwitcher";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { t, formatDate, type Locale } from "~/lib/i18n";
import { fmtDuration } from "~/lib/format";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "analytics.read"))) throw new Response("Forbidden", { status: 403 });
  const range = parseRange(new URL(request.url).searchParams.get("range"));
  const [detail, top] = await Promise.all([analyticsDetail(db, range), topWatched(db, range, Date.now(), 5)]);
  return { range, detail, top };
}

/** Quantized bar widths — literal classes so Tailwind JIT can see them (prod CSP blocks style attrs). */
const BARS = ["w-[4%]", "w-[12%]", "w-[20%]", "w-[28%]", "w-[36%]", "w-[44%]", "w-[52%]", "w-[60%]", "w-[68%]", "w-[76%]", "w-[84%]", "w-[92%]", "w-full"] as const;
const barFor = (v: number, max: number) => (max <= 0 ? BARS[0] : BARS[Math.min(BARS.length - 1, Math.round((v / max) * (BARS.length - 1)))]);

export default function AdminAnalytics({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { detail, top, range } = loaderData;
  const maxWatch = Math.max(1, ...detail.watchDaily.map((d) => d.seconds));
  const maxRegs = Math.max(1, ...detail.registrationsDaily.map((d) => d.count));
  const maxEvents = Math.max(1, ...detail.eventBreakdown.map((e) => e.count));
  const dayLabel = (epochDay: number) => formatDate(locale, epochDay * 86_400_000 + 43_200_000);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">{t(locale, "analyticsAdmin.title")}</h1>
        <RangeSwitcher range={range} locale={locale} base="/admin/analytics" ranges={RANGE_KEYS} />
      </div>

      <Card>
        <CardHeader title={t(locale, "analyticsAdmin.eventBreakdown")} description={t(locale, "analyticsAdmin.eventNote")} />
        <CardBody className="space-y-2">
          {detail.eventBreakdown.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "analyticsAdmin.empty")}</p>}
          {detail.eventBreakdown.map((e) => (
            <div key={e.type} className="flex items-center gap-3 text-sm" data-testid="event-row">
              <span className="w-40 shrink-0 font-mono text-xs text-ink-muted" dir="ltr">{e.type}</span>
              <span className={`h-2.5 rounded bg-brand-500 ${barFor(e.count, maxEvents)}`} aria-hidden="true" />
              <span className="text-xs font-semibold text-ink-soft" dir="ltr">{e.count.toLocaleString("en-US")}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t(locale, "analyticsAdmin.watchDaily")} description={t(locale, "analyticsAdmin.last14")} />
          <CardBody className="space-y-2">
            {detail.watchDaily.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "analyticsAdmin.empty")}</p>}
            {detail.watchDaily.map((d) => (
              <div key={d.epochDay} className="flex items-center gap-3 text-sm" data-testid="watch-daily-row">
                <span className="w-28 shrink-0 text-xs text-ink-muted">{dayLabel(d.epochDay)}</span>
                <span className={`h-2.5 rounded bg-success-soft0 ${barFor(d.seconds, maxWatch)}`} aria-hidden="true" />
                <span className="text-xs font-semibold text-ink-soft" dir="ltr">{fmtDuration(d.seconds)}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "analyticsAdmin.regsDaily")} description={t(locale, "analyticsAdmin.last14")} />
          <CardBody className="space-y-2">
            {detail.registrationsDaily.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "analyticsAdmin.empty")}</p>}
            {detail.registrationsDaily.map((d) => (
              <div key={d.epochDay} className="flex items-center gap-3 text-sm" data-testid="regs-daily-row">
                <span className="w-28 shrink-0 text-xs text-ink-muted">{dayLabel(d.epochDay)}</span>
                <span className={`h-2.5 rounded bg-brand-500 ${barFor(d.count, maxRegs)}`} aria-hidden="true" />
                <span className="text-xs font-semibold text-ink-soft" dir="ltr">{d.count}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t(locale, "analyticsAdmin.topWatched")} />
        <CardBody className="space-y-1.5">
          {top.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "analyticsAdmin.empty")}</p>}
          {top.map((v) => (
            <div key={v.videoId} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="top-watched-row">
              <span className="truncate font-medium text-ink-soft">
                {v.lessonTitleAr || v.lessonTitleEn ? (locale === "ar" ? v.lessonTitleAr || v.lessonTitleEn : v.lessonTitleEn || v.lessonTitleAr) : `${t(locale, "analyticsAdmin.videoFallback")} ${v.videoId.slice(0, 8)}`}
              </span>
              <span className="flex items-center gap-3 text-xs text-ink-muted">
                <span dir="ltr">{t(locale, "analyticsAdmin.plays", { n: v.plays })}</span>
                <span className="font-semibold text-ink-soft" dir="ltr">{fmtDuration(v.seconds)}</span>
              </span>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "analyticsAdmin.examPerf")} />
        <CardBody className="space-y-1.5">
          {detail.examPerformance.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "analyticsAdmin.empty")}</p>}
          {detail.examPerformance.map((e) => (
            <div key={e.examId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 text-sm last:border-0" data-testid="exam-perf-row">
              <Link to={`/admin/assessment/exams/${e.examId}`} className="truncate font-medium text-blue-700 hover:underline">
                {locale === "ar" ? e.titleAr || e.titleEn : e.titleEn || e.titleAr}
              </Link>
              <span className="flex items-center gap-3 text-xs text-ink-muted" dir="ltr">
                <span>{t(locale, "analyticsAdmin.colAttempts")}: {e.attempts}</span>
                <span>{t(locale, "analyticsAdmin.colPassed")}: {e.passed}/{e.graded}</span>
                <span className="font-semibold text-ink-soft">{e.avgPct == null ? "—" : `${e.avgPct}%`}</span>
              </span>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t(locale, "analyticsAdmin.ordersStatus")} />
          <CardBody className="space-y-1.5">
            {detail.ordersByStatus.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "analyticsAdmin.empty")}</p>}
            {detail.ordersByStatus.map((o) => (
              <div key={o.status} className="flex items-center justify-between text-sm" data-testid="orders-status-row">
                <span className="font-mono text-xs text-ink-muted" dir="ltr">{o.status}</span>
                <span className="text-xs text-ink-muted" dir="ltr">{o.count} · {o.totalMinor}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t(locale, "analyticsAdmin.codeStatus")} />
          <CardBody className="space-y-1.5">
            {detail.codeStatusBreakdown.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "analyticsAdmin.empty")}</p>}
            {detail.codeStatusBreakdown.map((c) => (
              <div key={c.status} className="flex items-center justify-between text-sm" data-testid="code-status-row">
                <span className="font-mono text-xs text-ink-muted" dir="ltr">{c.status}</span>
                <span className="text-xs font-semibold text-ink-soft" dir="ltr">{c.count}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
