import type { Route } from "./+types/exams.$slug";
import { Form, Link, useRouteLoaderData, useSearchParams } from "react-router";
import { redirect } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  attemptEligibility,
  attemptsForStudent,
  attemptSummary,
  expireAttemptIfNeeded,
  examAccess,
  getExamBySlug,
  parseExamConfig,
  startAttempt,
} from "~server/assessment/service.server";
import { Badge } from "~/components/ui/Badge";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Exam intro: policy summary + start/resume + attempt history. Every gate is
 * server-side: unpublished/archived exams are 404 for students, entitlement is
 * re-checked here (never only on the lesson page), and any expired live attempt
 * is auto-submitted on touch before the page renders.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth, settings } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  const exam = await getExamBySlug(db, params.slug);
  const actor = { userId: auth.user.id, roleRank: auth.user.rank };
  if (!exam || (exam.status !== "published" && auth.user.rank < 3)) {
    throw new Response("Not Found", { status: 404 });
  }
  const access = await examAccess(db, actor, exam);
  if (!access.allowed) throw new Response("Forbidden", { status: 403 });

  const nowMs = Date.now();
  const config = parseExamConfig(exam.config);

  // sweep: an expired live attempt is auto-submitted (answered-so-far) on touch
  const expiredResult = await expireAttemptIfNeeded(db, {
    examId: exam.id,
    studentId: auth.user.id,
    graceSeconds: settings.assessment.graceSeconds,
    nowMs,
    videoThresholdPct: settings.video.completionThresholdPct,
  });

  const eligibility = await attemptEligibility(db, { exam, actor, nowMs });

  const attemptRows = await attemptsForStudent(db, auth.user.id, exam.id);
  const attempts = [];
  for (const row of attemptRows) {
    const summary = await attemptSummary(db, row, config, nowMs);
    if (summary) attempts.push(summary);
  }

  return {
    exam: {
      slug: exam.slug,
      titleAr: exam.titleAr,
      titleEn: exam.titleEn,
      descriptionAr: exam.descriptionAr,
      descriptionEn: exam.descriptionEn,
    },
    policy: {
      durationMinutes: config.duration_minutes,
      passPercent: config.scoring.pass_percent,
      attemptsMax: config.attempts.max,
    },
    eligibility,
    attempts,
    autoExpired: expiredResult !== null,
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const exam = await getExamBySlug(db, params.slug);
  const actor = { userId: auth.user.id, roleRank: auth.user.rank };
  if (!exam || (exam.status !== "published" && auth.user.rank < 3)) {
    throw new Response("Not Found", { status: 404 });
  }
  const access = await examAccess(db, actor, exam);
  if (!access.allowed) throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  if (form.get("_action") === "start") {
    const res = await startAttempt(db, { examId: exam.id, actor, nowMs: Date.now() });
    if (res.ok) return redirect(`/exams/${exam.slug}/attempt`);
    return { startError: res.reason, retryAt: res.retryAt ?? null };
  }
  return { startError: null };
}

const reasonKey: Record<string, string> = {
  unpublished: "exam.notFound",
  before_window: "exam.beforeWindow",
  after_window: "exam.afterWindow",
  attempts_exhausted: "exam.exhausted",
  cooldown: "exam.cooldown",
  no_access: "exam.noAccess",
  no_questions: "exam.noQuestions",
};

export default function ExamIntroPage({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const [searchParams] = useSearchParams();
  const { exam, policy, eligibility, attempts, autoExpired } = loaderData;
  const title = locale === "ar" ? exam.titleAr : exam.titleEn;
  const description = locale === "ar" ? exam.descriptionAr : exam.descriptionEn;
  const expiredParam = searchParams.get("expired") === "1";

  const startError =
    actionData && "startError" in actionData && actionData.startError
      ? reasonKey[actionData.startError as string] ?? "exam.noAccess"
      : null;

  const canStart = eligibility.ok;
  const resuming = eligibility.ok && "resume" in eligibility && Boolean(eligibility.resume);

  return (
    <div className="space-y-4">
      <nav className="text-sm">
        <Link to="/exams" className="text-blue-600 hover:underline">
          ← {t(locale, "exam.backToExams")}
        </Link>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{title}</h1>
        {attempts.some((a) => a.status === "in_progress") && (
          <Badge tone="warning">{t(locale, "exam.inProgress")}</Badge>
        )}
      </div>
      {description && <p className="text-sm text-slate-600">{description}</p>}

      {(autoExpired || expiredParam) && <Alert kind="warning">{t(locale, "exam.expiredNotice")}</Alert>}
      {!eligibility.ok && <Alert kind="info">{t(locale, reasonKey[eligibility.reason] ?? "exam.noAccess")}</Alert>}
      {startError && <Alert kind="error">{t(locale, startError)}</Alert>}

      <Card>
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
            <p className="text-slate-600">
              {policy.durationMinutes !== null && policy.durationMinutes > 0
                ? t(locale, "exam.duration").replace("{n}", String(policy.durationMinutes))
                : t(locale, "exam.unlimitedDuration")}
            </p>
            <p className="text-slate-600">{t(locale, "exam.passPercent").replace("{n}", String(policy.passPercent))}</p>
            <p className="text-slate-600">
              {policy.attemptsMax === null
                ? t(locale, "exam.attemptsUnlimited")
                : t(locale, "exam.attemptsUsed")
                    .replace("{used}", String(attempts.length))
                    .replace("{max}", String(policy.attemptsMax))}
            </p>
          </div>
          {canStart && (
            <Form method="post">
              <input type="hidden" name="_action" value="start" />
              <SubmitButton className="min-h-11 w-full sm:w-auto">
                {resuming ? t(locale, "exam.resume") : t(locale, "exam.start")}
              </SubmitButton>
            </Form>
          )}
        </CardBody>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-500">{t(locale, "exam.historyTitle")}</h2>
        {attempts.length === 0 && <p className="text-sm text-slate-400">{t(locale, "exam.noAttempts")}</p>}
        {attempts.map((a) => (
          <Card key={a.attemptId}>
            <CardBody className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {t(locale, "exam.attemptNumber").replace("{n}", String(a.attemptNumber))}
                  </span>
                  {a.status === "in_progress" ? (
                    <Badge tone="warning">{t(locale, "exam.inProgress")}</Badge>
                  ) : (
                    <Badge tone={a.status === "graded" ? (a.passed ? "success" : "danger") : "neutral"}>
                      {a.status === "graded" ? t(locale, "exam.graded") : a.status}
                    </Badge>
                  )}
                </div>
                {a.submittedAt !== null && (
                  <p className="text-xs text-slate-400">
                    {t(locale, "exam.submittedAt")}: {formatDate(locale, a.submittedAt)}
                  </p>
                )}
                {a.visible && a.score !== null && a.maxScore !== null && (
                  <p className="text-xs text-slate-600">
                    {t(locale, "exam.score")}: {a.score}/{a.maxScore}
                    {a.percentage !== null ? ` · ${a.percentage}%` : ""}
                  </p>
                )}
                {!a.visible && a.status === "graded" && (
                  <p className="text-xs text-slate-400">{t(locale, "exam.resultHidden")}</p>
                )}
              </div>
              <Link
                to={a.status === "in_progress" ? `/exams/${exam.slug}/attempt` : `/results/${a.attemptId}`}
                className="min-h-11 rounded-lg border px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 sm:min-h-0"
              >
                {a.status === "in_progress" ? t(locale, "exam.resume") : t(locale, "exam.resultsTitle")}
              </Link>
            </CardBody>
          </Card>
        ))}
      </section>
    </div>
  );
}
