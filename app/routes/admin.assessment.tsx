import type { Route } from "./+types/admin.assessment";
import { Form, Link, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  canAssessment,
  examAttemptCounts,
  listExams,
  listQuestions,
  listTags,
  parseExamConfig,
} from "~server/assessment/service.server";
import { adminTree } from "~server/content/service.server";
import { Badge } from "~/components/ui/Badge";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

const selectCls = "h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm";

/**
 * Assessment admin hub — question bank + exam listings, inside the existing
 * admin architecture (auth/RBAC/layout). Rank 3 needs assessment.* permission
 * rows; rank 4 bypasses. Mutations live on the detail pages and are audited.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "exams" ? "exams" : "questions";

  const perms = {
    read: await canAssessment(db, auth, "assessment.read"),
    create: await canAssessment(db, auth, "assessment.create"),
  };
  const emptyBank = {
    subjects: [] as Array<{ id: string; labelAr: string; labelEn: string }>,
    tags: [] as Array<{ id: string; labelAr: string; labelEn: string }>,
  };
  if (!perms.read) return { tab, perms, questions: [], exams: [], counts: {} as Record<string, { total: number; live: number }>, ...emptyBank };

  if (tab === "questions") {
    // Filter metadata: subjects from the content tree + existing tags.
    const [tree, tagRows] = await Promise.all([adminTree(db), listTags(db)]);
    const subjects: Array<{ id: string; labelAr: string; labelEn: string }> = [];
    for (const p of tree) for (const g of p.children) for (const s of g.children) {
      if (s.type === "subject") {
        subjects.push({ id: s.id, labelAr: `${p.titleAr} › ${g.titleAr} › ${s.titleAr}`, labelEn: `${p.titleEn} › ${g.titleEn} › ${s.titleEn}` });
      }
    }
    const tags = tagRows.map((tg) => ({ id: tg.id, labelAr: tg.labelAr, labelEn: tg.labelEn }));
    const questions = await listQuestions(db, {
      status: url.searchParams.get("status") || undefined,
      type: url.searchParams.get("type") || undefined,
      difficulty: url.searchParams.get("difficulty") || undefined,
      subjectId: url.searchParams.get("subjectId") || undefined,
      tagId: url.searchParams.get("tagId") || undefined,
      q: url.searchParams.get("q") || undefined,
      limit: 200,
    });
    return { tab, perms, questions, exams: [], counts: {} as Record<string, { total: number; live: number }>, subjects, tags };
  }

  const examRows = await listExams(db);
  const counts = await examAttemptCounts(db);
  const exams = examRows.map((e) => {
    const cfg = parseExamConfig(e.config);
    return {
      id: e.id,
      slug: e.slug,
      titleAr: e.titleAr,
      titleEn: e.titleEn,
      status: e.status,
      durationMinutes: cfg.duration_minutes,
      passPercent: cfg.scoring.pass_percent,
      selectionMode: cfg.selection.mode,
      updatedAt: e.updatedAt,
    };
  });
  return { tab, perms, questions: [], exams, counts, subjects: emptyBank.subjects, tags: emptyBank.tags };
}

const qStatusTone: Record<string, "neutral" | "warning" | "success" | "brand"> = {
  draft: "neutral",
  in_review: "warning",
  published: "success",
  archived: "brand",
};

export default function AdminAssessmentPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { tab, perms, questions, exams, counts, subjects, tags } = loaderData;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t(locale, "assessment.title")}</h1>
        {perms.create && (
          <div className="flex gap-2">
            <Link
              to="/admin/assessment/questions/new"
              className="min-h-11 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 sm:min-h-0"
            >
              + {t(locale, "assessment.newQuestion")}
            </Link>
            <Link
              to="/admin/assessment/exams/new"
              className="min-h-11 rounded-lg border border-brand-600 px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 sm:min-h-0"
            >
              + {t(locale, "assessment.newExam")}
            </Link>
          </div>
        )}
      </div>

      {!perms.read && <Alert kind="error">{t(locale, "assessment.denied")}</Alert>}

      <div className="flex gap-2 border-b">
        {(["questions", "exams"] as const).map((tb) => (
          <Link
            key={tb}
            to={`/admin/assessment?tab=${tb}`}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === tb ? "border border-b-0 bg-white text-brand-700" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t(locale, tb === "questions" ? "assessment.questionsTab" : "assessment.examsTab")}
          </Link>
        ))}
      </div>

      {tab === "questions" && perms.read && (
        <>
          <Form method="get" className="flex flex-wrap items-end gap-2" data-testid="question-filters">
            <input type="hidden" name="tab" value="questions" />
            <input
              name="q"
              placeholder={t(locale, "assessment.searchPlaceholder")}
              className="h-[42px] min-w-[10rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
            <select name="status" className={selectCls} defaultValue="">
              <option value="">{t(locale, "assessment.status")}: *</option>
              <option value="draft">{t(locale, "assessment.status_draft")}</option>
              <option value="in_review">{t(locale, "assessment.status_in_review")}</option>
              <option value="published">{t(locale, "assessment.status_published")}</option>
              <option value="archived">{t(locale, "assessment.status_archived")}</option>
            </select>
            <select name="type" className={selectCls} defaultValue="">
              <option value="">{t(locale, "assessment.type")}: *</option>
              <option value="mcq">{t(locale, "assessment.type_mcq")}</option>
              <option value="true_false">{t(locale, "assessment.type_true_false")}</option>
              <option value="multi_select">{t(locale, "assessment.type_multi_select")}</option>
              <option value="essay">{t(locale, "assessment.type_essay")}</option>
            </select>
            <select name="difficulty" className={selectCls} defaultValue="" aria-label={t(locale, "assessment.difficulty")}>
              <option value="">{t(locale, "assessment.difficulty")}: *</option>
              <option value="easy">{t(locale, "assessment.diff_easy")}</option>
              <option value="medium">{t(locale, "assessment.diff_medium")}</option>
              <option value="hard">{t(locale, "assessment.diff_hard")}</option>
            </select>
            <select name="subjectId" className={selectCls} defaultValue="" aria-label={t(locale, "assessment.filterSubject")}>
              <option value="">{t(locale, "assessment.filterSubject")}: *</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{locale === "ar" ? s.labelAr : s.labelEn}</option>
              ))}
            </select>
            <select name="tagId" className={selectCls} defaultValue="" aria-label={t(locale, "assessment.filterTag")}>
              <option value="">{t(locale, "assessment.filterTag")}: *</option>
              {tags.map((tg) => (
                <option key={tg.id} value={tg.id}>{locale === "ar" ? tg.labelAr : tg.labelEn}</option>
              ))}
            </select>
            <button type="submit" className="min-h-[42px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">
              {t(locale, "common.search")}
            </button>
          </Form>

          {questions.length === 0 && (
            <Card>
              <CardBody className="text-sm text-slate-500">{t(locale, "assessment.noQuestions")}</CardBody>
            </Card>
          )}
          {questions.map((q) => (
            <Link key={q.id} to={`/admin/assessment/questions/${q.id}`} className="block">
              <Card className="transition hover:border-brand-300">
                <CardBody className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{q.stemAr || q.stemEn}</p>
                    <p className="text-xs text-slate-400">
                      {t(locale, `assessment.type_${q.type}`)} · {t(locale, `assessment.diff_${q.difficulty}`)} ·{" "}
                      {t(locale, "assessment.examPoints")}: {q.pointsDefault}
                    </p>
                  </div>
                  <Badge tone={qStatusTone[q.status] ?? "neutral"}>
                    {t(locale, `assessment.status_${q.status}`)}
                  </Badge>
                </CardBody>
              </Card>
            </Link>
          ))}
        </>
      )}

      {tab === "exams" && perms.read && (
        <>
          {exams.length === 0 && (
            <Card>
              <CardBody className="text-sm text-slate-500">{t(locale, "assessment.noExams")}</CardBody>
            </Card>
          )}
          {exams.map((e) => {
            const c = counts[e.id] ?? { total: 0, live: 0 };
            return (
              <Card key={e.id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/admin/assessment/exams/${e.id}`} className="truncate text-sm font-medium hover:text-brand-700">
                      {locale === "ar" ? e.titleAr : e.titleEn}
                    </Link>
                    <p className="text-xs text-slate-400">
                      {e.durationMinutes !== null ? t(locale, "exam.duration").replace("{n}", String(e.durationMinutes)) : t(locale, "exam.unlimitedDuration")}
                      {" · "}
                      {t(locale, "exam.passPercent").replace("{n}", String(e.passPercent))}
                      {" · "}
                      {t(locale, "assessment.attemptsCount")}: {c.total}
                      {c.live > 0 ? ` (${c.live} ${t(locale, "exam.inProgress")})` : ""}
                      {e.selectionMode === "pool" ? ` · ${t(locale, "assessment.mode_pool")}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.status === "published" && (
                      <Link to={`/exams/${e.slug}`} className="text-xs text-blue-600 hover:underline">
                        {t(locale, "assessment.previewStudent")}
                      </Link>
                    )}
                    <Badge tone={qStatusTone[e.status] ?? "neutral"}>
                      {t(locale, `assessment.status_${e.status}`)}
                    </Badge>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
