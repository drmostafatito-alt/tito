import type { Route } from "./+types/results";
import { Link, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { attemptsForStudent, attemptSummary, getExam, parseExamConfig } from "~server/assessment/service.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { t, formatDate, type Locale } from "~/lib/i18n";

/** All of the student's attempts across exams (summaries are policy-gated server-side). */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const nowMs = Date.now();
  const rows = await attemptsForStudent(db, auth.user.id);
  const summaries = [];
  for (const row of rows) {
    const exam = await getExam(db, row.examId);
    if (!exam) continue;
    const summary = await attemptSummary(db, row, parseExamConfig(exam.config), nowMs);
    if (summary) summaries.push(summary);
  }
  return { summaries };
}

export default function ResultsPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { summaries } = loaderData;
  return (
    <div className="space-y-4">
      <div className="border-b-2 border-brand-800 pb-4">
        <h1 className="sig-display text-3xl text-ink">{t(locale, "exam.resultsTitle")}</h1>
      </div>
      {summaries.length === 0 && (
        <Card>
          <CardBody className="text-sm text-ink-muted">{t(locale, "exam.noAttempts")}</CardBody>
        </Card>
      )}
      {summaries.map((s) => {
        const title = locale === "ar" ? s.examTitleAr : s.examTitleEn;
        return (
          <Link key={s.attemptId} to={`/results/${s.attemptId}`} className="block">
            <Card className="transition-colors hover:border-brand-800">
              <CardBody className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <p className="font-bold text-ink">{title}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
                    {t(locale, "exam.attemptNumber").replace("{n}", String(s.attemptNumber))}
                    {s.submittedAt !== null ? ` · ${formatDate(locale, s.submittedAt)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {s.status === "in_progress" && <Badge tone="warning">{t(locale, "exam.inProgress")}</Badge>}
                  {s.status === "graded" && s.visible && (
                    <Badge tone={s.passed ? "success" : "danger"}>
                      {s.percentage !== null ? `${s.percentage}%` : s.passed ? t(locale, "exam.passed") : t(locale, "exam.failed")}
                    </Badge>
                  )}
                  {s.status === "graded" && !s.visible && <Badge tone="neutral">{t(locale, "exam.resultHidden")}</Badge>}
                </div>
              </CardBody>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
