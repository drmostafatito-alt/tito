import type { Route } from "./+types/admin.assessment.questions.$id";
import { useState } from "react";
import { Form, Link, redirect, useRouteLoaderData, useSearchParams } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { logAudit } from "~server/audit/log.server";
import {
  AssessmentReferenceError,
  AssessmentValidationError,
  canAssessment,
  createQuestion,
  deleteQuestion,
  duplicateQuestion,
  ensureTag,
  getQuestionFull,
  listTags,
  setQuestionStatus,
  updateQuestion,
} from "~server/assessment/service.server";
import { adminTree } from "~server/content/service.server";
import { Badge } from "~/components/ui/Badge";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { t, type Locale } from "~/lib/i18n";

const selectCls = "h-[42px] w-full rounded-lg border border-line bg-surface px-3 text-sm";
const areaCls = "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm";

interface ChoiceDraft {
  id: string | null;
  contentAr: string;
  contentEn: string;
  isCorrect: boolean;
  feedback: string;
}

interface Issue {
  path: string;
  message: string;
}

/**
 * Question editor (bank CRUD + status workflow). Correct answers live in this
 * admin form only — students never see this payload (sanitized attemptContext).
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 2);
  const db = getDb(getEnv(context));
  const isNew = params.id === "new";
  const perms = {
    create: await canAssessment(db, auth, "assessment.create"),
    edit: await canAssessment(db, auth, "assessment.edit"),
    publish: await canAssessment(db, auth, "assessment.publish"),
    delete: await canAssessment(db, auth, "assessment.delete"),
  };

  const tree = await adminTree(db);
  const subjects: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  const courses: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  const units: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  const lessons: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  for (const s of tree.filter((n) => n.type === "subject")) {
    subjects.push({ id: s.id, labelAr: s.titleAr, labelEn: s.titleEn });
    for (const c of s.children.filter((n) => n.type === "course")) {
      courses.push({ id: c.id, labelAr: `${s.titleAr} › ${c.titleAr}`, labelEn: `${s.titleEn} › ${c.titleEn}` });
      for (const u of c.children.filter((n) => n.type === "unit")) {
        units.push({ id: u.id, labelAr: `${c.titleAr} › ${u.titleAr}`, labelEn: `${c.titleEn} › ${u.titleEn}` });
        for (const l of u.children.filter((n) => n.type === "lesson")) {
          lessons.push({ id: l.id, labelAr: `${c.titleAr} › ${u.titleAr} › ${l.titleAr}`, labelEn: `${c.titleEn} › ${u.titleEn} › ${l.titleEn}` });
        }
      }
    }
  }

  const tags = await listTags(db);
  const question = isNew ? null : await getQuestionFull(db, params.id);
  if (!isNew && !question) throw new Response("Not Found", { status: 404 });

  return {
    isNew,
    perms,
    question: question
      ? {
          id: question.id,
          type: question.type,
          stemAr: question.stemAr,
          stemEn: question.stemEn,
          explanationAr: question.explanationAr,
          explanationEn: question.explanationEn,
          modelAnswerAr: question.modelAnswerAr,
          modelAnswerEn: question.modelAnswerEn,
          difficulty: question.difficulty,
          pointsDefault: question.pointsDefault,
          subjectId: question.subjectId,
          courseId: question.courseId,
          unitId: question.unitId,
          lessonId: question.lessonId,
          status: question.status,
          tagIds: question.tagIds,
          choices: question.choices.map((c) => ({
            id: c.id,
            contentAr: c.contentAr,
            contentEn: c.contentEn,
            isCorrect: c.isCorrect,
            feedback: c.feedback,
          })),
        }
      : null,
    subjects,
    courses,
    units,
    lessons,
    tags: tags.map((tg) => ({ id: tg.id, labelAr: tg.labelAr, labelEn: tg.labelEn })),
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 2);
  const env = getEnv(context);
  const db = getDb(env);
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  const actor = { userId: auth.user.id, role: auth.user.roleId, ipHash };
  const isNew = params.id === "new";
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const nul = (k: string) => str(k) || null;

  const audit = async (action: string, entityId: string, after: Record<string, unknown>) => {
    await logAudit(db, {
      actorUserId: auth.user.id,
      actorRole: auth.user.roleId,
      action,
      entityType: "question",
      entityId,
      after,
      ipHash,
    });
  };

  try {
    if (intent === "save") {
      const allowed = isNew ? await canAssessment(db, auth, "assessment.create") : await canAssessment(db, auth, "assessment.edit");
      if (!allowed) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };

      let choicesRaw: unknown[] = [];
      try {
        choicesRaw = str("choices") ? (JSON.parse(str("choices")) as unknown[]) : [];
      } catch {
        return { issues: [{ path: "choices", message: "invalid JSON" }] satisfies Issue[] };
      }
      const pointsDefault = Number(form.get("pointsDefault"));
      const input = {
        type: str("type"),
        stemAr: str("stemAr"),
        stemEn: str("stemEn"),
        explanationAr: nul("explanationAr"),
        explanationEn: nul("explanationEn"),
        modelAnswerAr: nul("modelAnswerAr"),
        modelAnswerEn: nul("modelAnswerEn"),
        difficulty: str("difficulty") || "medium",
        pointsDefault: Number.isFinite(pointsDefault) && pointsDefault > 0 ? pointsDefault : 1,
        subjectId: nul("subjectId"),
        courseId: nul("courseId"),
        unitId: nul("unitId"),
        lessonId: nul("lessonId"),
        choices: choicesRaw,
        tagIds: form.getAll("tagIds").map(String),
      };
      if (isNew) {
        const res = await createQuestion(db, input, actor);
        await audit("assessment.question.created", res.id, { type: input.type });
        return redirect(`/admin/assessment/questions/${res.id}?saved=1`);
      }
      await updateQuestion(db, params.id, input, actor);
      await audit("assessment.question.updated", params.id, {});
      return redirect(`/admin/assessment/questions/${params.id}?saved=1`);
    }

    if (intent === "status") {
      const target = str("value");
      const allowed = target === "published"
        ? await canAssessment(db, auth, "assessment.publish")
        : await canAssessment(db, auth, "assessment.edit");
      if (!allowed) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      await setQuestionStatus(db, params.id, target, actor);
      await audit("assessment.question.status", params.id, { status: target });
      return redirect(`/admin/assessment/questions/${params.id}?saved=1`);
    }

    if (intent === "duplicate") {
      if (!(await canAssessment(db, auth, "assessment.create"))) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      const res = await duplicateQuestion(db, params.id, actor);
      await audit("assessment.question.duplicated", res.id, { from: params.id });
      return redirect(`/admin/assessment/questions/${res.id}?saved=1`);
    }

    if (intent === "delete") {
      if (!(await canAssessment(db, auth, "assessment.delete"))) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      await deleteQuestion(db, params.id);
      await audit("assessment.question.deleted", params.id, {});
      return redirect("/admin/assessment?deleted=1");
    }

    if (intent === "create-tag") {
      if (!(await canAssessment(db, auth, "assessment.create"))) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      const label = str("tagLabel");
      if (label) await ensureTag(db, { labelAr: label, labelEn: label });
      return redirect(`/admin/assessment/questions/${params.id}?saved=1`);
    }
  } catch (err) {
    if (err instanceof AssessmentValidationError) return { issues: err.issues };
    if (err instanceof AssessmentReferenceError) return { issues: [{ path: err.field, message: err.message }] };
    throw err;
  }
  return { issues: [{ path: "_action", message: "unknown intent" }] satisfies Issue[] };
}

export default function QuestionEditorPage({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const [searchParams] = useSearchParams();
  const { isNew, perms, question, subjects, courses, units, lessons, tags } = loaderData;
  const issues = actionData && "issues" in actionData ? (actionData.issues as Issue[]) : null;

  const [type, setType] = useState<string>(question?.type ?? "mcq");
  const [choices, setChoices] = useState<ChoiceDraft[]>(
    question
      ? question.choices.map((c) => ({ id: c.id, contentAr: c.contentAr, contentEn: c.contentEn, isCorrect: c.isCorrect, feedback: c.feedback ?? "" }))
      : [
          { id: null, contentAr: "", contentEn: "", isCorrect: true, feedback: "" },
          { id: null, contentAr: "", contentEn: "", isCorrect: false, feedback: "" },
        ]
  );

  const canEdit = isNew ? perms.create : perms.edit;
  const objective = type !== "essay";

  function onTypeChange(next: string) {
    setType(next);
    if (next === "true_false") {
      setChoices((prev) => {
        const keep = prev.slice(0, 2);
        const tf: ChoiceDraft[] = [
          { id: keep[0]?.id ?? null, contentAr: "صواب", contentEn: "True", isCorrect: keep[0]?.isCorrect ?? true, feedback: "" },
          { id: keep[1]?.id ?? null, contentAr: "خطأ", contentEn: "False", isCorrect: keep[1]?.isCorrect ?? false, feedback: "" },
        ];
        return tf;
      });
    }
  }

  function setCorrect(i: number, on: boolean) {
    setChoices((prev) =>
      prev.map((c, idx) => {
        if (type === "multi_select") return idx === i ? { ...c, isCorrect: on } : c;
        return { ...c, isCorrect: idx === i ? true : false }; // single-correct types
      })
    );
  }

  const statusButtons: Array<{ target: string; label: string; tone: string }> = question
    ? question.status === "draft"
      ? [{ target: "in_review", label: t(locale, "assessment.toReview"), tone: "border" }]
      : question.status === "in_review"
        ? [
            { target: "published", label: t(locale, "assessment.publish"), tone: "green" },
            { target: "draft", label: t(locale, "assessment.backToDraft"), tone: "border" },
          ]
        : question.status === "published"
          ? [{ target: "archived", label: t(locale, "assessment.archive"), tone: "border" }]
          : [{ target: "draft", label: t(locale, "assessment.backToDraft"), tone: "border" }]
    : [];

  return (
    <div className="space-y-4" key={isNew ? "new" : `q-${question?.id ?? ""}`}>
      <nav className="text-sm">
        <Link to="/admin/assessment" className="inline-flex min-h-6 items-center text-brand-700 hover:underline">
          <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
          {t(locale, "assessment.questionsTab")}
        </Link>
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{isNew ? t(locale, "assessment.newQuestion") : question!.stemAr || question!.stemEn}</h1>
        {question && <Badge tone={question.status === "published" ? "success" : question.status === "in_review" ? "warning" : "neutral"}>{t(locale, `assessment.status_${question.status}`)}</Badge>}
      </div>

      {searchParams.get("saved") === "1" && <Alert kind="success">{t(locale, "assessment.saved")}</Alert>}
      {issues && issues.length > 0 && (
        <Alert kind="error">
          <ul className="list-inside list-disc">
            {issues.map((i, idx) => (
              <li key={idx}>
                {i.path}: {i.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Form method="post" className="space-y-4">
        <input type="hidden" name="_action" value="save" />
        <input type="hidden" name="type" value={question ? question.type : type} />
        <input type="hidden" name="choices" value={JSON.stringify(choices
          .filter((c) => c.contentAr.trim() || c.contentEn.trim())
          .map(({ id, ...rest }) => (id ? { id, ...rest } : rest)))} />

        <Card>
          <CardBody className="space-y-3">
            {isNew ? (
              <div>
                <label className="text-sm font-medium text-ink-soft">{t(locale, "assessment.type")}</label>
                <select value={type} onChange={(e) => onTypeChange(e.target.value)} className={selectCls}>
                  <option value="mcq">{t(locale, "assessment.type_mcq")}</option>
                  <option value="true_false">{t(locale, "assessment.type_true_false")}</option>
                  <option value="multi_select">{t(locale, "assessment.type_multi_select")}</option>
                  <option value="essay">{t(locale, "assessment.type_essay")}</option>
                </select>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                {t(locale, "assessment.type")}: {t(locale, `assessment.type_${question!.type}`)}
              </p>
            )}
            <div>
              <label htmlFor="q-stem-ar" className="text-sm font-medium text-ink-soft">{t(locale, "assessment.stemAr")}</label>
              <textarea id="q-stem-ar" name="stemAr" required defaultValue={question?.stemAr ?? ""} rows={2} className={areaCls} />
            </div>
            <div>
              <label htmlFor="q-stem-en" className="text-sm font-medium text-ink-soft">{t(locale, "assessment.stemEn")}</label>
              <textarea id="q-stem-en" name="stemEn" required defaultValue={question?.stemEn ?? ""} rows={2} className={areaCls} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="q-difficulty" className="text-sm font-medium text-ink-soft">{t(locale, "assessment.difficulty")}</label>
                <select id="q-difficulty" name="difficulty" defaultValue={question?.difficulty ?? "medium"} className={selectCls}>
                  <option value="easy">{t(locale, "assessment.diff_easy")}</option>
                  <option value="medium">{t(locale, "assessment.diff_medium")}</option>
                  <option value="hard">{t(locale, "assessment.diff_hard")}</option>
                </select>
              </div>
              <Input
                label={t(locale, "assessment.pointsDefault")}
                name="pointsDefault"
                type="number"
                step="0.5"
                min="0.5"
                max="1000"
                defaultValue={question?.pointsDefault ?? 1}
              />
            </div>
          </CardBody>
        </Card>

        {objective && (
          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-sm font-semibold">{t(locale, "assessment.choices")}</h2>
              {type === "multi_select" && <p className="text-xs text-warning">{t(locale, "exam.multiHint")}</p>}
              {choices.map((c, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <input
                      type={type === "multi_select" ? "checkbox" : "radio"}
                      checked={c.isCorrect}
                      onChange={(e) => setCorrect(i, e.target.checked)}
                      disabled={!canEdit}
                      aria-label={t(locale, "assessment.correct")}
                      className="mt-3 h-4 w-4 shrink-0"
                    />
                    <div className="grid flex-1 gap-2">
                      <input
                        value={c.contentAr}
                        onChange={(e) => setChoices((prev) => prev.map((p, idx) => (idx === i ? { ...p, contentAr: e.target.value } : p)))}
                        placeholder={t(locale, "assessment.choiceAr")}
                        aria-label={`${t(locale, "assessment.choiceAr")} ${i + 1}`}
                        className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                      />
                      <input
                        value={c.contentEn}
                        onChange={(e) => setChoices((prev) => prev.map((p, idx) => (idx === i ? { ...p, contentEn: e.target.value } : p)))}
                        placeholder={t(locale, "assessment.choiceEn")}
                        aria-label={`${t(locale, "assessment.choiceEn")} ${i + 1}`}
                        className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                      />
                      <input
                        value={c.feedback}
                        onChange={(e) => setChoices((prev) => prev.map((p, idx) => (idx === i ? { ...p, feedback: e.target.value } : p)))}
                        placeholder={t(locale, "assessment.explanationAr")}
                        aria-label={`${t(locale, "assessment.explanationAr")} ${i + 1}`}
                        className="w-full rounded-lg border border-line px-3 py-1.5 text-xs"
                      />
                    </div>
                    {choices.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setChoices((prev) => prev.filter((_, idx) => idx !== i))}
                        className="mt-2 text-xs text-error hover:underline"
                      >
                        {t(locale, "assessment.remove")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {choices.length < 6 && (
                <button
                  type="button"
                  onClick={() => setChoices((prev) => [...prev, { id: null, contentAr: "", contentEn: "", isCorrect: false, feedback: "" }])}
                  className="min-h-11 rounded-lg border border-dashed px-4 text-sm text-ink-muted hover:border-brand-400 sm:min-h-0"
                >
                  + {t(locale, "assessment.addChoice")}
                </button>
              )}
            </CardBody>
          </Card>
        )}

        {!objective && (
          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-sm font-semibold">{t(locale, "assessment.modelAnswer")}</h2>
              <p className="text-xs text-ink-muted">{t(locale, "assessment.modelAnswerHint")}</p>
              <div>
                <label htmlFor="q-model-ar" className="text-sm font-medium text-ink-soft">{t(locale, "assessment.modelAnswerAr")}</label>
                <textarea id="q-model-ar" name="modelAnswerAr" defaultValue={question?.modelAnswerAr ?? ""} rows={4} className={areaCls} dir="auto" />
              </div>
              <div>
                <label htmlFor="q-model-en" className="text-sm font-medium text-ink-soft">{t(locale, "assessment.modelAnswerEn")}</label>
                <textarea id="q-model-en" name="modelAnswerEn" defaultValue={question?.modelAnswerEn ?? ""} rows={4} className={areaCls} dir="auto" />
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="space-y-3">
            <Input label={t(locale, "assessment.explanationAr")} name="explanationAr" defaultValue={question?.explanationAr ?? ""} />
            <Input label={t(locale, "assessment.explanationEn")} name="explanationEn" defaultValue={question?.explanationEn ?? ""} />
            <h2 className="pt-2 text-sm font-semibold">{t(locale, "assessment.topicLinks")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="q-subject" className="text-sm font-medium text-ink-soft">Subject</label>
                <select id="q-subject" name="subjectId" defaultValue={question?.subjectId ?? ""} className={selectCls}>
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {locale === "ar" ? s.labelAr : s.labelEn}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="q-course" className="text-sm font-medium text-ink-soft">Course</label>
                <select id="q-course" name="courseId" defaultValue={question?.courseId ?? ""} className={selectCls}>
                  <option value="">—</option>
                  {courses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {locale === "ar" ? s.labelAr : s.labelEn}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="q-unit" className="text-sm font-medium text-ink-soft">Unit</label>
                <select id="q-unit" name="unitId" defaultValue={question?.unitId ?? ""} className={selectCls}>
                  <option value="">—</option>
                  {units.map((s) => (
                    <option key={s.id} value={s.id}>
                      {locale === "ar" ? s.labelAr : s.labelEn}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="q-lesson" className="text-sm font-medium text-ink-soft">Lesson</label>
                <select id="q-lesson" name="lessonId" defaultValue={question?.lessonId ?? ""} className={selectCls}>
                  <option value="">—</option>
                  {lessons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {locale === "ar" ? s.labelAr : s.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <h2 className="pb-1 text-sm font-semibold">{t(locale, "assessment.tags")}</h2>
              <div className="flex flex-wrap gap-2">
                {tags.map((tg) => (
                  <label key={tg.id} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs">
                    <input type="checkbox" name="tagIds" value={tg.id} defaultChecked={question?.tagIds.includes(tg.id) ?? false} />
                    {locale === "ar" ? tg.labelAr : tg.labelEn}
                  </label>
                ))}
                {tags.length === 0 && <span className="text-xs text-ink-muted">—</span>}
              </div>
            </div>
          </CardBody>
        </Card>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <SubmitButton className="min-h-11">{t(locale, "assessment.save")}</SubmitButton>
          </div>
        )}
      </Form>

      {!isNew && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {statusButtons.map((b) => (
            <Form key={b.target} method="post">
              <input type="hidden" name="_action" value="status" />
              <input type="hidden" name="value" value={b.target} />
              <SubmitButton
                variant={b.tone === "green" ? "primary" : "secondary"}
                className="min-h-11"
                disabled={(b.target === "published" && !perms.publish) || (b.target !== "published" && !perms.edit)}
              >
                {b.label}
              </SubmitButton>
            </Form>
          ))}
          {perms.create && (
            <Form method="post">
              <input type="hidden" name="_action" value="duplicate" />
              <SubmitButton variant="secondary" className="min-h-11">
                {t(locale, "assessment.duplicate")}
              </SubmitButton>
            </Form>
          )}
          {perms.delete && (
            <Form method="post" onSubmit={(e) => { if (!window.confirm(t(locale, "assessment.delete") + "?")) e.preventDefault(); }}>
              <input type="hidden" name="_action" value="delete" />
              <SubmitButton variant="danger" className="min-h-11">
                {t(locale, "assessment.delete")}
              </SubmitButton>
            </Form>
          )}
        </div>
      )}

      {!isNew && (
        <Form method="post" className="flex items-end gap-2 border-t pt-4">
          <input type="hidden" name="_action" value="create-tag" />
          <Input label={`+ ${t(locale, "assessment.tags")}`} name="tagLabel" className="max-w-xs" />
          <SubmitButton variant="secondary" className="min-h-11">
            {t(locale, "common.save")}
          </SubmitButton>
        </Form>
      )}
    </div>
  );
}
