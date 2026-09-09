import type { Route } from "./+types/exams";
import { Link, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { listPublishedExamsForActor } from "~server/assessment/service.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

/**
 * Student exam index: published exams the actor can access (the service skips
 * anything the entitlement resolver denies). Availability state, attempt usage
 * and live-attempt resume hints are all computed server-side.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const actor = { userId: auth.user.id, roleRank: auth.user.rank };
  const exams = await listPublishedExamsForActor(db, actor, Date.now());
  return { exams };
}

export default function ExamsPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { exams } = loaderData;
  return (
    <div className="space-y-4">
      <div className="border-b-2 border-brand-800 pb-4">
        <h1 className="sig-display text-3xl text-ink">{t(locale, "exam.listTitle")}</h1>
      </div>
      {exams.length === 0 && (
        <Card>
          <CardBody className="text-sm text-ink-muted">{t(locale, "exam.empty")}</CardBody>
        </Card>
      )}
      {exams.map((exam) => {
        const title = locale === "ar" ? exam.titleAr : exam.titleEn;
        return (
          <Link key={exam.slug} to={`/exams/${exam.slug}`} className="block">
            <Card className="transition-colors hover:border-brand-800">
              <CardBody className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-bold text-ink">{title}</h2>
                  {exam.hasLiveAttempt ? (
                    <Badge tone="warning">{t(locale, "exam.resume")}</Badge>
                  ) : exam.state === "before_window" ? (
                    <Badge tone="neutral">{t(locale, "exam.beforeWindow")}</Badge>
                  ) : exam.state === "after_window" ? (
                    <Badge tone="neutral">{t(locale, "exam.afterWindow")}</Badge>
                  ) : exam.attemptsMax !== null && exam.attemptsUsed >= exam.attemptsMax ? (
                    <Badge tone="danger">{t(locale, "exam.exhausted")}</Badge>
                  ) : (
                    <Badge tone="success">{t(locale, "exam.start")}</Badge>
                  )}
                </div>
                <p className="text-xs tabular-nums text-ink-muted">
                  {exam.durationMinutes !== null && exam.durationMinutes > 0
                    ? t(locale, "exam.duration").replace("{n}", String(exam.durationMinutes))
                    : t(locale, "exam.unlimitedDuration")}
                  {" · "}
                  {exam.attemptsMax === null
                    ? t(locale, "exam.attemptsUnlimited")
                    : t(locale, "exam.attemptsUsed")
                        .replace("{used}", String(exam.attemptsUsed))
                        .replace("{max}", String(exam.attemptsMax))}
                  {" · "}
                  {t(locale, "exam.passPercent").replace("{n}", String(exam.passPercent))}
                </p>
              </CardBody>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
