import type { Route } from "./+types/admin.assessment.attempts.$attemptId";
import { Link, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { adminAttemptReview } from "~server/assessment/service.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

function typeBadge(type: string, locale: Locale) {
  const key = `assessment.type_${type}`;
  return t(locale, key);
}

function fmtTime(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const review = await adminAttemptReview(db, params.attemptId);
  if (!review) throw new Response("Not Found", { status: 404 });
  return { review };
}

export default function AdminAttemptReviewPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale } | null;
  const locale = root?.locale ?? "ar";
  const { review } = loaderData;
  const examTitle = locale === "ar" ? review.examTitleAr : review.examTitleEn;
  const startedAt = new Date(review.startedAt);
  const pct = review.score !== null && review.maxScore ? Math.round((review.score / review.maxScore) * 1000) / 10 : null;

  return (
    <div className="space-y-4">
      <nav className="text-sm">
        <Link to={`/admin/assessment/exams/${review.examId}`} className="inline-flex min-h-6 items-center text-blue-600 hover:underline">
          <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
          {t(locale, "assessment.attemptsTitle")}
        </Link>
      </nav>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold">{t(locale, "assessment.reviewAttempt")} — {examTitle}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {t(locale, "assessment.colStudent")}: <span className="font-medium text-slate-800">{review.studentName}</span>
                <span className="text-slate-500" dir="ltr"> ({review.studentEmail})</span>
                <span className="text-slate-500"> · #{review.attemptNumber}</span>
              </p>
            </div>
            <Badge tone={review.status === "graded" ? "success" : review.status === "in_progress" ? "warning" : "neutral"}>
              {t(locale, review.status === "graded" ? "assessment.statusGraded" : review.status === "in_progress" ? "assessment.statusInProgress" : review.status === "grading" ? "assessment.statusGrading" : review.status === "expired" ? "assessment.statusExpired" : review.status === "cancelled" ? "assessment.statusCancelled" : "assessment.statusSubmitted")}
            </Badge>
          </div>
          <div className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">{t(locale, "assessment.colScore")}</p>
              <p className="font-semibold text-slate-800">{review.score ?? "—"} / {review.maxScore ?? "—"}{pct !== null && <span className="ml-1 text-xs text-slate-500 rtl:mr-1">({pct}%)</span>}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t(locale, "assessment.colResult")}</p>
              <p className="font-semibold text-slate-800">
                {review.passed === null ? "—" : review.passed ? t(locale, "assessment.resultPass") : t(locale, "assessment.resultFail")}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t(locale, "assessment.startedOn")}</p>
              <p className="font-semibold text-slate-800">{startedAt.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t(locale, "assessment.timeUsed")}</p>
              <p className="font-semibold text-slate-800">{fmtTime(review.timeUsedSeconds)}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold">{t(locale, "assessment.attemptQuestions", { n: review.questions.length })}</h2>

      {review.questions.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">{t(locale, "assessment.noQuestions")}</p>
          </CardBody>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {review.questions.map((q, i) => (
            <li key={q.id}>
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">{i + 1}</span>
                      <div>
                        <Badge tone="neutral">{typeBadge(q.type, locale)}</Badge>
                        <p className="mt-1 font-medium text-slate-800">{locale === "ar" ? q.stemAr : q.stemEn}</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">
                      {q.earned !== null ? `${q.earned}` : "—"} / {q.points} {t(locale, "assessment.examPoints")}
                    </span>
                  </div>

                  {q.type === "essay" ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                      <p className="text-xs text-slate-500">{t(locale, "assessment.studentAnswer")}</p>
                      {q.textAnswer ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{q.textAnswer}</p> : <p className="text-sm text-slate-500">{t(locale, "assessment.notAnswered")}</p>}
                    </div>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {q.choices.map((c) => {
                        const tone = c.correct ? "bg-emerald-50 border-emerald-200" : c.selected ? "bg-red-50 border-red-200" : "bg-white border-slate-200";
                        const mark = c.correct ? "✓" : c.selected ? "✗" : "";
                        return (
                          <li key={c.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}>
                            <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${c.correct ? "bg-emerald-500" : c.selected ? "bg-red-500" : "bg-slate-200"}`} aria-hidden="true">
                              {mark}
                            </span>
                            <span className="min-w-0 text-slate-700">{locale === "ar" ? c.contentAr : c.contentEn}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {(q.explanationAr || q.explanationEn) && (
                    <p className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800">
                      <span className="font-medium">{t(locale, "assessment.explanation")}: </span>
                      {locale === "ar" ? q.explanationAr : q.explanationEn}
                    </p>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
