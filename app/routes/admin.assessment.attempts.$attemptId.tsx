import type { Route } from "./+types/admin.assessment.attempts.$attemptId";
import { Link, redirect, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { logAudit } from "~server/audit/log.server";
import {
  AssessmentValidationError,
  canAssessment,
  adminAttemptReview,
  gradeEssayAnswer,
} from "~server/assessment/service.server";
import { signFileUrl } from "~server/files/storage.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, formatDateTime, type Locale } from "~/lib/i18n";

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

const areaCls = "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth, settings } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const review = await adminAttemptReview(db, params.attemptId);
  if (!review) throw new Response("Not Found", { status: 404 });
  const canGrade = await canAssessment(db, auth, "assessment.grade");
  // Authorized graders only: a view URL is minted AFTER rank/permission checks;
  // without the fresh short-TTL signature the private bytes never stream.
  const ttl = settings.video.fileUrlTtlSeconds;
  const questions = [];
  for (const q of review.questions) {
    let fileUrl: string | null = null;
    if (q.file) {
      const signed = await signFileUrl(env, q.file.id, "view", ttl);
      fileUrl = signed.path;
    }
    questions.push({ ...q, fileUrl });
  }
  return { review: { ...review, questions }, canGrade };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canAssessment(db, auth, "assessment.grade"))) {
    return Response.json({ error: "denied" }, { status: 403 });
  }
  const env = getEnv(context);
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  const form = await request.formData();
  const questionId = String(form.get("questionId") ?? "");
  const pointsRaw = Number(form.get("points"));
  const feedback = String(form.get("feedback") ?? "");
  try {
    const res = await gradeEssayAnswer(db, {
      attemptId: params.attemptId,
      questionId,
      points: Number.isFinite(pointsRaw) ? pointsRaw : 0,
      feedback,
      grader: { userId: auth.user.id, role: auth.user.roleId },
    });
    await logAudit(db, {
      actorUserId: auth.user.id,
      actorRole: auth.user.roleId,
      action: "assessment.essay.graded",
      entityType: "exam_answer",
      entityId: `${params.attemptId}:${questionId}`,
      before: {},
      after: { points: res.points, finalized: res.finalized },
      ipHash,
    });
    return redirect(`/admin/assessment/attempts/${params.attemptId}?graded=1`);
  } catch (err) {
    if (err instanceof AssessmentValidationError) {
      return Response.json({ issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}

export default function AdminAttemptReviewPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale } | null;
  const locale = root?.locale ?? "ar";
  const { review, canGrade } = loaderData;
  const examTitle = locale === "ar" ? review.examTitleAr : review.examTitleEn;
  const startedAt = new Date(review.startedAt);
  const pct = review.score !== null && review.maxScore ? Math.round((review.score / review.maxScore) * 1000) / 10 : null;

  return (
    <div className="space-y-4">
      <nav className="text-sm">
        <Link to={`/admin/assessment/exams/${review.examId}`} className="inline-flex min-h-6 items-center text-brand-700 hover:underline">
          <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
          {t(locale, "assessment.attemptsTitle")}
        </Link>
      </nav>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold">{t(locale, "assessment.reviewAttempt")} — {examTitle}</h1>
              <p className="mt-1 text-sm text-ink-muted">
                {t(locale, "assessment.colStudent")}: <span className="font-medium text-ink">{review.studentName}</span>
                <span className="text-ink-muted" dir="ltr"> ({review.studentEmail})</span>
                <span className="text-ink-muted"> · #{review.attemptNumber}</span>
              </p>
            </div>
            <Badge tone={review.status === "graded" ? "success" : review.status === "submitted" ? "warning" : review.status === "in_progress" ? "warning" : "neutral"}>
              {review.status === "graded"
                ? t(locale, "assessment.statusGraded")
                : review.status === "submitted"
                  ? t(locale, "assessment.statusNeedsManual")
                  : review.status === "in_progress"
                    ? t(locale, "assessment.statusInProgress")
                    : review.status === "grading"
                      ? t(locale, "assessment.statusGrading")
                      : review.status === "expired"
                        ? t(locale, "assessment.statusExpired")
                        : review.status === "cancelled"
                          ? t(locale, "assessment.statusCancelled")
                          : t(locale, "assessment.statusSubmitted")}
            </Badge>
          </div>
          <div className="grid gap-3 rounded-xl border border-line bg-sand-100/60 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-ink-muted">{t(locale, "assessment.colScore")}</p>
              <p className="font-semibold text-ink">{review.score ?? "—"} / {review.maxScore ?? "—"}{pct !== null && <span className="ml-1 text-xs text-ink-muted rtl:mr-1">({pct}%)</span>}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">{t(locale, "assessment.colResult")}</p>
              <p className="font-semibold text-ink">
                {review.score === null ? "—" : review.passed === null ? "—" : review.passed ? t(locale, "assessment.resultPass") : t(locale, "assessment.resultFail")}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">{t(locale, "assessment.startedOn")}</p>
              <p className="font-semibold text-ink">{formatDateTime(locale, startedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">{t(locale, "assessment.timeUsed")}</p>
              <p className="font-semibold text-ink">{fmtTime(review.timeUsedSeconds)}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold">{t(locale, "assessment.attemptQuestions", { n: review.questions.length })}</h2>

      {review.questions.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-muted">{t(locale, "assessment.noQuestions")}</p>
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
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sand-100 text-xs font-bold text-ink-muted">{i + 1}</span>
                      <div>
                        <Badge tone="neutral">{typeBadge(q.type, locale)}</Badge>
                        <p className="mt-1 font-medium text-ink">{locale === "ar" ? q.stemAr : q.stemEn}</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {q.type === "essay" ? (q.earned != null ? q.earned : t(locale, "assessment.pendingGrading")) : q.earned != null ? q.earned : "—"} / {q.points} {t(locale, "assessment.examPoints")}
                    </span>
                  </div>

                  {q.type === "essay" ? (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-line bg-sand-100/60 p-3">
                        <p className="text-xs text-ink-muted">{t(locale, "assessment.studentAnswer")}</p>
                        {q.textAnswer ? <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft" dir="auto">{q.textAnswer}</p> : <p className="text-sm text-ink-muted">{t(locale, "assessment.notAnswered")}</p>}
                      </div>
                      {q.file && q.fileUrl && (
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={q.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            data-essay-file-link
                            className="min-h-9 rounded-lg border border-brand-300 bg-surface px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
                          >
                            {t(locale, "assessment.viewSubmissionFile")}
                          </a>
                          <span dir="ltr" className="max-w-[16rem] truncate text-xs text-ink-muted">{q.file.originalFilename}</span>
                        </div>
                      )}
                      {(q.modelAnswerAr || q.modelAnswerEn) && (
                        <div className="rounded-lg border border-success/30 bg-success-soft/60 p-3">
                          <p className="text-xs font-medium text-success">{t(locale, "assessment.modelAnswer")}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft" dir="auto">{locale === "ar" ? q.modelAnswerAr || q.modelAnswerEn : q.modelAnswerEn || q.modelAnswerAr}</p>
                        </div>
                      )}
                      {q.feedback && (
                        <p className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-brand-800">
                          <span className="font-medium">{t(locale, "assessment.feedback")}: </span>
                          <span dir="auto">{q.feedback}</span>
                        </p>
                      )}
                      {canGrade && (
                        <form method="post" className="grid gap-2 rounded-lg border border-line p-3">
                          <input type="hidden" name="questionId" value={q.id} />
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1 text-xs text-ink-muted">
                              {t(locale, "assessment.colScore")} (0–{q.points})
                              <input name="points" type="number" min="0" max={q.points} step="0.5" defaultValue={q.earned != null ? q.earned : 0} required className="h-10 w-32 rounded-lg border border-line px-3 text-sm" />
                            </label>
                            <label className="flex-1 flex-col gap-1 text-xs text-ink-muted">
                              {t(locale, "assessment.feedback")}
                              <input name="feedback" defaultValue={q.feedback ?? ""} className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
                            </label>
                            <SubmitButton variant="primary" className="min-h-10">{t(locale, "assessment.saveGrade")}</SubmitButton>
                          </div>
                        </form>
                      )}
                    </div>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {q.choices.map((c) => {
                        const tone = c.correct ? "bg-success-soft border-success/30" : c.selected ? "bg-error-soft border-error/30" : "bg-surface border-line";
                        const mark = c.correct ? "✓" : c.selected ? "✗" : "";
                        return (
                          <li key={c.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}>
                            <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${c.correct ? "bg-success" : c.selected ? "bg-error" : "bg-sand-200"}`} aria-hidden="true">
                              {mark}
                            </span>
                            <span className="min-w-0 text-ink-soft">{locale === "ar" ? c.contentAr : c.contentEn}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {(q.explanationAr || q.explanationEn) && q.type !== "essay" && (
                    <p className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-brand-800">
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
