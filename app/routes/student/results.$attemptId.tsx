import type { Route } from "./+types/results.$attemptId";
import { Link, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  attemptReview,
  attemptSummary,
  getExam,
  getOwnedAttempt,
  parseExamConfig,
} from "~server/assessment/service.server";
import { Badge } from "~/components/ui/Badge";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody } from "~/components/ui/Card";
import { t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Attempt result + policy-gated review. IDOR-safe: attempts are fetched only
 * through getOwnedAttempt(attemptId, auth.user.id) — another student's id is a
 * plain 404. The review payload itself is assembled server-side under
 * results.review_mode / show_answers / show_explanations.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const attempt = await getOwnedAttempt(db, params.attemptId, auth.user.id);
  if (!attempt) throw new Response("Not Found", { status: 404 });
  const exam = await getExam(db, attempt.examId);
  if (!exam) throw new Response("Not Found", { status: 404 });

  const config = parseExamConfig(exam.config);
  const nowMs = Date.now();
  const summary = await attemptSummary(db, attempt, config, nowMs);
  if (!summary) throw new Response("Not Found", { status: 404 });
  // review is gated by the SAME visibility policy as the score: a hidden
  // result must not leak per-question correctness (which implies the score)
  const review = summary.visible ? await attemptReview(db, { attempt, config }) : null;

  return {
    summary,
    review,
    examSlug: exam.slug,
    attemptInProgress: attempt.status === "in_progress",
  };
}

export default function ResultDetailPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { summary: s, review, examSlug, attemptInProgress } = loaderData;
  const title = locale === "ar" ? s.examTitleAr : s.examTitleEn;

  return (
    <div className="space-y-4">
      <nav className="flex items-center justify-between text-sm">
        <Link to="/results" className="inline-flex min-h-6 items-center text-blue-600 hover:underline">
          <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
          {t(locale, "exam.resultsTitle")}
        </Link>
        <Link to={`/exams/${examSlug}`} className="inline-flex min-h-6 items-center text-blue-600 hover:underline">
          {t(locale, "exam.backToExams")}
        </Link>
      </nav>

      <h1 className="text-xl font-bold">{title}</h1>

      {attemptInProgress && (
        <Alert kind="warning">
          {t(locale, "exam.inProgress")} —{" "}
          <Link to={`/exams/${examSlug}/attempt`} className="font-semibold underline">
            {t(locale, "exam.resume")}
          </Link>
        </Alert>
      )}

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-500">
              {t(locale, "exam.attemptNumber").replace("{n}", String(s.attemptNumber))}
            </span>
            {s.status === "graded" && s.visible && (
              <Badge tone={s.passed ? "success" : "danger"}>
                {s.passed ? t(locale, "exam.passed") : t(locale, "exam.failed")}
              </Badge>
            )}
          </div>

          {s.status === "graded" && !s.visible && (
            <p className="text-sm text-slate-500">{t(locale, "exam.resultHidden")}</p>
          )}

          {s.visible && (
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">{t(locale, "exam.score")}</dt>
                <dd className="text-lg font-bold">
                  {s.score}/{s.maxScore}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t(locale, "exam.percentage")}</dt>
                <dd className="text-lg font-bold">{s.percentage !== null ? `${s.percentage}%` : "—"}</dd>
              </div>
              {s.correctCount !== null && (
                <div>
                  <dt className="text-xs text-slate-500">{t(locale, "exam.correctAnswers")}</dt>
                  <dd className="text-lg font-bold">{s.correctCount}</dd>
                </div>
              )}
              {s.submittedAt !== null && (
                <div className="col-span-2">
                  <dt className="text-xs text-slate-500">{t(locale, "exam.submittedAt")}</dt>
                  <dd>{formatDate(locale, s.submittedAt)}</dd>
                </div>
              )}
              {s.timeUsedSeconds !== null && (
                <div>
                  <dt className="text-xs text-slate-500">{t(locale, "exam.timeUsed")}</dt>
                  <dd>
                    {Math.floor(s.timeUsedSeconds / 60)}:{String(s.timeUsedSeconds % 60).padStart(2, "0")}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </CardBody>
      </Card>

      {review && review.questions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500">{t(locale, "exam.reviewTitle")}</h2>
          {review.questions.map((q, i) => {
            const stem = locale === "ar" ? q.stemAr || q.stemEn : q.stemEn || q.stemAr;
            const explanation = locale === "ar" ? q.explanationAr : q.explanationEn;
            return (
              <Card key={q.id}>
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">
                      {i + 1}. {stem}
                    </p>
                    <Badge tone={(q.earned ?? 0) >= q.points ? "success" : (q.earned ?? 0) > 0 ? "warning" : "danger"}>
                      {q.earned ?? 0}/{q.points}
                    </Badge>
                  </div>
                  <ul className="space-y-1.5">
                    {q.choices.map((c) => {
                      const content = locale === "ar" ? c.contentAr || c.contentEn : c.contentEn || c.contentAr;
                      return (
                        <li
                          key={c.id}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                            c.correct === true
                              ? "border-emerald-300 bg-emerald-50"
                              : c.selected
                                ? "border-red-200 bg-red-50"
                                : "border-slate-200"
                          }`}
                        >
                          {c.selected && <span aria-hidden>{c.correct === true ? "✓" : c.correct === false ? "✕" : "•"}</span>}
                          {!c.selected && c.correct === true && <span aria-hidden>✓</span>}
                          <span className="flex-1">{content}</span>
                          {c.selected && <span className="text-xs text-slate-500">{t(locale, "exam.yourAnswer")}</span>}
                          {c.feedback && <span className="text-xs text-slate-500">{c.feedback}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  {!q.answered && <p className="text-xs text-slate-500">{t(locale, "exam.notAnswered")}</p>}
                  {explanation && (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-semibold">{t(locale, "exam.explanation")}: </span>
                      {explanation}
                    </p>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
