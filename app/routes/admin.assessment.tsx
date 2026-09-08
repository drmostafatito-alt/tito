import { useState } from "react";
import type { Route } from "./+types/admin.assessment";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { logAudit } from "~server/audit/log.server";
import {
  bulkSetQuestionStatus,
  bulkTagQuestions,
  canAssessment,
  essayGradingQueue,
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

const selectCls = "h-[42px] rounded-lg border border-line bg-surface px-3 text-sm";

/**
 * Assessment admin hub — question bank + exam listings, inside the existing
 * admin architecture (auth/RBAC/layout). Rank 3 needs assessment.* permission
 * rows; rank 4 bypasses. Mutations live on the detail pages and are audited.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 2); // teacher authors (with perms); admin+
  const db = getDb(getEnv(context));
  const url = new URL(request.url);
  const tabRaw = url.searchParams.get("tab");
  // Grading is an admin-level privilege: a teacher without assessment.grade
  // is never shown the grading tab even if they request it.
  const perms = {
    read: await canAssessment(db, auth, "assessment.read"),
    create: await canAssessment(db, auth, "assessment.create"),
    edit: await canAssessment(db, auth, "assessment.edit"),
    publish: await canAssessment(db, auth, "assessment.publish"),
    delete: await canAssessment(db, auth, "assessment.delete"),
    grade: await canAssessment(db, auth, "assessment.grade"),
  };
  const tab =
    tabRaw === "exams" || (tabRaw === "grading" && perms.grade) ? tabRaw : "questions";

  const emptyBank = {
    subjects: [] as Array<{ id: string; labelAr: string; labelEn: string }>,
    tags: [] as Array<{ id: string; labelAr: string; labelEn: string }>,
  };
  if (!perms.read)
    return { tab, perms, questions: [], exams: [], counts: {} as Record<string, { total: number; live: number }>, ...emptyBank, grading: [] as Awaited<ReturnType<typeof essayGradingQueue>> };

  if (tab === "grading") {
    const grading = await essayGradingQueue(db, { status: "pending" });
    return { tab, perms, questions: [], exams: [], counts: {} as Record<string, { total: number; live: number }>, ...emptyBank, grading };
  }

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
    return { tab, perms, questions, exams: [], counts: {} as Record<string, { total: number; live: number }>, subjects, tags, grading: [] as Awaited<ReturnType<typeof essayGradingQueue>> };
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
  return { tab, perms, questions: [], exams, counts, subjects: emptyBank.subjects, tags: emptyBank.tags, grading: [] as Awaited<ReturnType<typeof essayGradingQueue>> };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 2);
  const db = getDb(getEnv(context));
  const actor = { userId: auth.user.id, role: auth.user.roleId };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const ids = form.getAll("ids").map((x) => String(x));
  if (!ids.length) return { bulk: { kind: intent, requested: 0, succeeded: 0, failed: 0, results: [] as never[] }, error: "empty" };

  if (intent === "bulk-status") {
    const status = String(form.get("status") ?? "");
    if (!["draft", "in_review", "published", "archived"].includes(status)) return { bulk: null, error: "bad_request" };
    const allowed = status === "published"
      ? await canAssessment(db, auth, "assessment.publish")
      : await canAssessment(db, auth, "assessment.edit");
    if (!allowed) return { bulk: null, error: "denied" };
    const results = await bulkSetQuestionStatus(db, ids, status, actor);
    for (const r of results) {
      if (r.ok) {
        await logAudit(db, {
          actorUserId: auth.user.id,
          actorRole: auth.user.roleId,
          action: "assessment.question.bulk_status",
          entityType: "question",
          entityId: r.id,
          after: { status },
        });
      }
    }
    return { bulk: summarize("bulk-status", results), error: null };
  }

  if (intent === "bulk-tag") {
    if (!(await canAssessment(db, auth, "assessment.edit"))) return { bulk: null, error: "denied" };
    const tagIds = form.getAll("tagIds").map((x) => String(x));
    if (!tagIds.length) return { bulk: null, error: "empty" };
    const results = await bulkTagQuestions(db, ids, tagIds);
    for (const r of results) {
      if (r.ok) {
        await logAudit(db, {
          actorUserId: auth.user.id,
          actorRole: auth.user.roleId,
          action: "assessment.question.bulk_tag",
          entityType: "question",
          entityId: r.id,
          after: { tagIds },
        });
      }
    }
    return { bulk: summarize("bulk-tag", results), error: null };
  }

  return { bulk: null, error: "bad_request" };
}

function summarize(kind: string, results: Array<{ ok: boolean; error?: string; id: string }>) {
  const succeeded = results.filter((r) => r.ok).length;
  return {
    kind,
    requested: results.length,
    succeeded,
    failed: results.length - succeeded,
    results: results.filter((r) => !r.ok).slice(0, 10),
  };
}

type AssessmentTab = "questions" | "exams" | "grading";
const ASSESSMENT_TABS_ALL: AssessmentTab[] = ["questions", "exams", "grading"];
const ASSESSMENT_TABS_AUTH: AssessmentTab[] = ["questions", "exams"];

const qStatusTone: Record<string, "neutral" | "warning" | "success" | "brand"> = {
  draft: "neutral",
  in_review: "warning",
  published: "success",
  archived: "brand",
};

interface BulkActionData {
  bulk: {
    kind: string;
    requested: number;
    succeeded: number;
    failed: number;
    results: Array<{ id: string; error?: string }>;
  } | null;
  error: "denied" | "bad_request" | "empty" | null;
}

export default function AdminAssessmentPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { tab, perms, questions, exams, counts, subjects, tags, grading } = loaderData;
  const actionData = useActionData<BulkActionData>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const onPageIds = questions.map((q) => q.id);
  const allSelected = onPageIds.length > 0 && onPageIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) for (const id of onPageIds) next.delete(id);
      else for (const id of onPageIds) next.add(id);
      return next;
    });
  const canBulkEdit = perms.edit || perms.publish;
  const bulk = actionData?.bulk ?? null;
  const bulkError = actionData?.error ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t(locale, "assessment.title")}</h1>
        {perms.create && (
          <div className="flex gap-2">
            <Link
              to="/admin/assessment/questions/new"
              className="min-h-11 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 sm:min-h-0"
            >
              + {t(locale, "assessment.newQuestion")}
            </Link>
            <Link
              to="/admin/assessment/exams/new"
              className="min-h-11 rounded-lg border border-brand-700 px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 sm:min-h-0"
            >
              + {t(locale, "assessment.newExam")}
            </Link>
          </div>
        )}
      </div>

      {!perms.read && <Alert kind="error">{t(locale, "assessment.denied")}</Alert>}

      {bulkError === "denied" && <Alert kind="error">{t(locale, "assessment.bulkDenied")}</Alert>}
      {bulkError === "bad_request" && <Alert kind="error">{t(locale, "assessment.opFailed")}</Alert>}
      {bulk && (
        <Alert kind={bulk.failed === 0 ? "success" : "warning"} data-testid="bulk-result">
          {t(locale, "assessment.bulkPerformed", { succeeded: bulk.succeeded, failed: bulk.failed })}
          {bulk.failed > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs">
              {bulk.results.map((r) => (
                <li key={r.id}>{r.error ?? "error"}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <div className="flex gap-2 border-b">
        {(perms.grade ? ASSESSMENT_TABS_ALL : ASSESSMENT_TABS_AUTH).map((tb) => (
          <Link
            key={tb}
            to={`/admin/assessment?tab=${tb}`}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === tb ? "border border-b-0 bg-surface text-brand-700" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t(locale, tb === "questions" ? "assessment.questionsTab" : tb === "exams" ? "assessment.examsTab" : "assessment.gradingTab")}
          </Link>
        ))}
      </div>

      {tab === "grading" && perms.read && (
        <>
          {grading.length === 0 && (
            <Card>
              <CardBody className="text-sm text-ink-muted">{t(locale, "assessment.noPendingGrading")}</CardBody>
            </Card>
          )}
          <ol className="flex flex-col gap-2">
            {grading.map((item) => (
              <li key={`${item.attemptId}:${item.questionId}`}>
                <Link to={`/admin/assessment/attempts/${item.attemptId}`} className="block">
                  <Card className="transition hover:border-brand-300">
                    <CardBody className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.studentName} — {locale === "ar" ? item.stemAr : item.stemEn}</p>
                        <p className="text-xs text-ink-muted">
                          {locale === "ar" ? item.examTitleAr : item.examTitleEn} · #{item.attemptNumber} · {item.points} {t(locale, "assessment.examPoints")}
                        </p>
                      </div>
                      <Badge tone="warning">{t(locale, "assessment.pendingGrading")}</Badge>
                    </CardBody>
                  </Card>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}

      {tab === "questions" && perms.read && (
        <>
          <Form method="get" className="flex flex-wrap items-end gap-2" data-testid="question-filters">
            <input type="hidden" name="tab" value="questions" />
            <input
              name="q"
              placeholder={t(locale, "assessment.searchPlaceholder")}
              className="h-[42px] min-w-[10rem] flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
            />
            <select name="status" aria-label={t(locale, "assessment.status")} className={selectCls} defaultValue="">
              <option value="">{t(locale, "assessment.status")}: *</option>
              <option value="draft">{t(locale, "assessment.status_draft")}</option>
              <option value="in_review">{t(locale, "assessment.status_in_review")}</option>
              <option value="published">{t(locale, "assessment.status_published")}</option>
              <option value="archived">{t(locale, "assessment.status_archived")}</option>
            </select>
            <select name="type" aria-label={t(locale, "assessment.type")} className={selectCls} defaultValue="">
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
            <button type="submit" className="min-h-[42px] rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-sand-100">
              {t(locale, "common.search")}
            </button>
          </Form>

          {questions.length === 0 && (
            <Card>
              <CardBody className="text-sm text-ink-muted">{t(locale, "assessment.noQuestions")}</CardBody>
            </Card>
          )}

          {canBulkEdit && questions.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-sand-100 px-3 py-2" data-testid="bulk-bar">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4" data-testid="bulk-select-all" />
                {t(locale, "assessment.selectAll")}
              </label>
              <span className="text-xs text-ink-muted" data-testid="bulk-selected">
                {t(locale, "assessment.selectedCount", { n: selected.size })}
              </span>
              {selected.size > 0 && (
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Form method="post">
                    <input type="hidden" name="_action" value="bulk-status" />
                    {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
                    <select name="status" className={selectCls} defaultValue="in_review" aria-label={t(locale, "assessment.status")} data-testid="bulk-status-select">
                      <option value="in_review">{t(locale, "assessment.status_in_review")}</option>
                      <option value="draft">{t(locale, "assessment.status_draft")}</option>
                      {perms.publish && <option value="published">{t(locale, "assessment.status_published")}</option>}
                      <option value="archived">{t(locale, "assessment.status_archived")}</option>
                    </select>
                    <button type="submit" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:bg-sand-100">
                      {t(locale, "assessment.bulkSetStatus")}
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="_action" value="bulk-tag" />
                    {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
                    <select name="tagIds" className={selectCls} defaultValue="" aria-label={t(locale, "assessment.filterTag")} data-testid="bulk-tag-select">
                      <option value="" disabled>{t(locale, "assessment.chooseTag")}</option>
                      {tags.map((tg) => (
                        <option key={tg.id} value={tg.id}>{locale === "ar" ? tg.labelAr : tg.labelEn}</option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:bg-sand-100">
                      {t(locale, "assessment.bulkAddTag")}
                    </button>
                  </Form>
                </div>
              )}
            </div>
          )}

          {questions.map((q) => (
            <div key={q.id} className="flex items-center gap-3">
              {canBulkEdit && (
                <input
                  type="checkbox"
                  checked={selected.has(q.id)}
                  onChange={() => toggle(q.id)}
                  aria-label={t(locale, "assessment.selectRow")}
                  className="h-4 w-4 shrink-0"
                  data-testid={`select-question-${q.id}`}
                />
              )}
              <Link to={`/admin/assessment/questions/${q.id}`} className="block min-w-0 flex-1">
                <Card className="transition hover:border-brand-300">
                  <CardBody className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{q.stemAr || q.stemEn}</p>
                      <p className="text-xs text-ink-muted">
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
            </div>
          ))}
        </>
      )}

      {tab === "exams" && perms.read && (
        <>
          {exams.length === 0 && (
            <Card>
              <CardBody className="text-sm text-ink-muted">{t(locale, "assessment.noExams")}</CardBody>
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
                    <p className="text-xs text-ink-muted">
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
