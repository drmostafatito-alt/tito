import type { Route } from "./+types/admin.assessment.exams.$id";
import { Form, Link, redirect, useRouteLoaderData, useSearchParams } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { logAudit } from "~server/audit/log.server";
import {
  AssessmentReferenceError,
  AssessmentValidationError,
  addExamQuestion,
  archiveExam,
  canAssessment,
  createExam,
  examAttemptCounts,
  examQuestionsFull,
  getExam,
  listQuestions,
  moveExamQuestion,
  parseExamConfig,
  publishExam,
  removeExamQuestion,
  setExamQuestionPoints,
  unpublishExam,
  updateExam,
} from "~server/assessment/service.server";
import { adminTree } from "~server/content/service.server";
import { Badge } from "~/components/ui/Badge";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { t, type Locale } from "~/lib/i18n";

const selectCls = "h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";
const areaCls = "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono text-xs";

interface Issue {
  path: string;
  message: string;
}

/** datetime-local (wall clock, treated as UTC) ↔ epoch ms */
const toLocalInput = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString().slice(0, 16));
const fromLocalInput = (v: string) => (v ? new Date(`${v}:00Z`).getTime() : null);

/**
 * Exam builder — lives in the Assessment domain (the CMS only links exam
 * items). Config edits go through parseExamConfig (FEATURE-SPEC §6 contract);
 * question set mutations are only allowed while the exam is draft; publish has
 * a fail-closed gate; archive/unpublish are non-destructive.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const isNew = params.id === "new";
  const perms = {
    create: await canAssessment(db, auth, "assessment.create"),
    edit: await canAssessment(db, auth, "assessment.edit"),
    publish: await canAssessment(db, auth, "assessment.publish"),
  };

  const tree = await adminTree(db);
  const courses: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  const lessons: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  for (const s of tree.filter((n) => n.type === "subject")) {
    for (const c of s.children.filter((n) => n.type === "course")) {
      courses.push({ id: c.id, labelAr: `${s.titleAr} › ${c.titleAr}`, labelEn: `${s.titleEn} › ${c.titleEn}` });
      for (const u of c.children.filter((n) => n.type === "unit")) {
        for (const l of u.children.filter((n) => n.type === "lesson")) {
          lessons.push({ id: l.id, labelAr: `${c.titleAr} › ${u.titleAr} › ${l.titleAr}`, labelEn: `${c.titleEn} › ${u.titleEn} › ${l.titleEn}` });
        }
      }
    }
  }

  if (isNew) return { isNew: true as const, perms, courses, lessons, exam: null, attached: [], bank: [], counts: { total: 0, live: 0 } };

  const exam = await getExam(db, params.id);
  if (!exam) throw new Response("Not Found", { status: 404 });
  const config = parseExamConfig(exam.config);
  const attachedRows = await examQuestionsFull(db, exam.id);
  const attachedIds = new Set(attachedRows.map((r) => r.questionId));
  const bankRows = await listQuestions(db, { status: "published", limit: 200 });
  const allCounts = await examAttemptCounts(db);

  return {
    isNew: false as const,
    perms,
    courses,
    lessons,
    exam: {
      id: exam.id,
      slug: exam.slug,
      titleAr: exam.titleAr,
      titleEn: exam.titleEn,
      descriptionAr: exam.descriptionAr,
      descriptionEn: exam.descriptionEn,
      courseId: exam.courseId,
      lessonId: exam.lessonId,
      status: exam.status,
      config: {
        durationMinutes: config.duration_minutes,
        passPercent: config.scoring.pass_percent,
        partialCredit: config.scoring.partial_credit_multiselect,
        attemptsMax: config.attempts.max,
        cooldownMinutes: config.attempts.cooldown_minutes,
        mode: config.selection.mode,
        poolsJson: JSON.stringify(config.selection.pools, null, 2),
        randomizeQuestions: config.selection.randomize_questions,
        randomizeChoices: config.selection.randomize_choices,
        show: config.results.show,
        showAnswers: config.results.show_answers,
        showExplanations: config.results.show_explanations,
        reviewMode: config.results.review_mode,
        startsAt: toLocalInput(config.availability.starts_at),
        endsAt: toLocalInput(config.availability.ends_at),
      },
    },
    attached: attachedRows.map((r) => ({
      questionId: r.questionId,
      points: r.points,
      sortOrder: r.sortOrder,
      type: r.question.type,
      status: r.question.status,
      stemAr: r.question.stemAr,
      stemEn: r.question.stemEn,
    })),
    bank: bankRows
      .filter((q) => !attachedIds.has(q.id))
      .map((q) => ({ id: q.id, stemAr: q.stemAr, stemEn: q.stemEn, type: q.type })),
    counts: allCounts[exam.id] ?? { total: 0, live: 0 },
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const back = `/admin/assessment/exams/${params.id}`;

  const audit = async (action: string, entityId: string, after: Record<string, unknown>) => {
    await logAudit(db, {
      actorUserId: auth.user.id,
      actorRole: auth.user.roleId,
      action,
      entityType: "exam",
      entityId,
      after,
      ipHash,
    });
  };

  try {
    if (intent === "create") {
      if (!(await canAssessment(db, auth, "assessment.create"))) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      const attachKind = str("attachKind");
      const attachId = str("attachId") || null;
      const res = await createExam(db, {
        titleAr: str("titleAr"),
        titleEn: str("titleEn"),
        descriptionAr: str("descriptionAr") || null,
        descriptionEn: str("descriptionEn") || null,
        courseId: attachKind === "course" ? attachId : null,
        lessonId: attachKind === "lesson" ? attachId : null,
      }, { userId: auth.user.id, role: auth.user.roleId, ipHash });
      await audit("assessment.exam.created", res.id, { slug: res.slug });
      return redirect(`/admin/assessment/exams/${res.id}?saved=1`);
    }

    const exam = await getExam(db, params.id);
    if (!exam) throw new Response("Not Found", { status: 404 });

    if (intent === "save-basic") {
      if (!(await canAssessment(db, auth, "assessment.edit"))) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      const attachKind = str("attachKind");
      const attachId = str("attachId") || null;
      await updateExam(db, exam.id, {
        titleAr: str("titleAr"),
        titleEn: str("titleEn"),
        descriptionAr: str("descriptionAr") || null,
        descriptionEn: str("descriptionEn") || null,
        courseId: attachKind === "course" ? attachId : null,
        lessonId: attachKind === "lesson" ? attachId : null,
      });
      await audit("assessment.exam.updated", exam.id, { section: "basic" });
      return redirect(`${back}?saved=1`);
    }

    if (intent === "save-config") {
      if (!(await canAssessment(db, auth, "assessment.edit"))) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      const cur = parseExamConfig(exam.config);
      const mode = str("mode") === "pool" ? "pool" : "manual";
      let pools = cur.selection.pools;
      if (mode === "pool") {
        try {
          pools = JSON.parse(str("poolsJson") || "[]");
        } catch {
          return { issues: [{ path: "poolsJson", message: "invalid JSON" }] satisfies Issue[] };
        }
      }
      const intOrNull = (k: string) => {
        const v = str(k);
        if (!v) return null;
        const n = Number(v);
        return Number.isFinite(n) ? Math.round(n) : null;
      };
      const intOr = (k: string, d: number) => {
        const v = Number(str(k));
        return Number.isFinite(v) ? Math.round(v) : d;
      };
      const cfg = {
        duration_minutes: intOrNull("durationMinutes"),
        availability: {
          starts_at: fromLocalInput(str("startsAt")),
          ends_at: fromLocalInput(str("endsAt")),
        },
        selection: {
          mode,
          pools,
          max_questions: cur.selection.max_questions,
          randomize_questions: form.get("randomizeQuestions") === "1",
          randomize_choices: form.get("randomizeChoices") === "1",
        },
        attempts: {
          max: intOrNull("attemptsMax"),
          cooldown_minutes: intOr("cooldownMinutes", 0),
          manual_extra_allowed: cur.attempts.manual_extra_allowed,
        },
        scoring: {
          pass_percent: intOr("passPercent", 50),
          partial_credit_multiselect: form.get("partialCredit") === "1",
          essay_points: cur.scoring.essay_points,
        },
        results: {
          show: ["immediate", "after_end", "manual"].includes(str("show")) ? str("show") : "immediate",
          show_answers: form.get("showAnswers") === "1",
          show_explanations: form.get("showExplanations") === "1",
          review_mode: form.get("reviewMode") === "1",
        },
      };
      await updateExam(db, exam.id, { config: cfg });
      await audit("assessment.exam.updated", exam.id, { section: "config" });
      return redirect(`${back}?saved=1`);
    }

    const editGate = async (): Promise<Issue[] | null> =>
      (await canAssessment(db, auth, "assessment.edit")) ? null : [{ path: "perm", message: "denied" }];

    if (intent === "attach") {
      const denied = await editGate();
      if (denied) return { issues: denied };
      await addExamQuestion(db, exam.id, str("questionId"));
      await audit("assessment.exam.question.attached", exam.id, { questionId: str("questionId") });
      return redirect(`${back}?saved=1`);
    }
    if (intent === "detach") {
      const denied = await editGate();
      if (denied) return { issues: denied };
      await removeExamQuestion(db, exam.id, str("questionId"));
      await audit("assessment.exam.question.detached", exam.id, { questionId: str("questionId") });
      return redirect(`${back}?saved=1`);
    }
    if (intent === "move") {
      const denied = await editGate();
      if (denied) return { issues: denied };
      await moveExamQuestion(db, exam.id, str("questionId"), str("dir") === "up" ? "up" : "down");
      return redirect(`${back}?saved=1`);
    }
    if (intent === "points") {
      const denied = await editGate();
      if (denied) return { issues: denied };
      await setExamQuestionPoints(db, exam.id, str("questionId"), Number(str("points")) || 1);
      await audit("assessment.exam.question.points", exam.id, { questionId: str("questionId"), points: Number(str("points")) });
      return redirect(`${back}?saved=1`);
    }
    if (intent === "publish") {
      if (!(await canAssessment(db, auth, "assessment.publish"))) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      await publishExam(db, exam.id);
      await audit("assessment.exam.published", exam.id, {});
      return redirect(`${back}?published=1`);
    }
    if (intent === "unpublish") {
      if (!(await canAssessment(db, auth, "assessment.publish"))) return { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
      await unpublishExam(db, exam.id);
      await audit("assessment.exam.unpublished", exam.id, {});
      return redirect(`${back}?saved=1`);
    }
    if (intent === "archive") {
      const denied = await editGate();
      if (denied) return { issues: denied };
      await archiveExam(db, exam.id);
      await audit("assessment.exam.archived", exam.id, {});
      return redirect(`${back}?saved=1`);
    }
    if (intent === "unarchive") {
      const denied = await editGate();
      if (denied) return { issues: denied };
      await unpublishExam(db, exam.id); // archived → draft (non-destructive)
      await audit("assessment.exam.unarchived", exam.id, {});
      return redirect(`${back}?saved=1`);
    }
  } catch (err) {
    if (err instanceof AssessmentValidationError) return { issues: err.issues };
    if (err instanceof AssessmentReferenceError) return { issues: [{ path: err.field, message: err.message }] };
    throw err;
  }
  return { issues: [{ path: "_action", message: "unknown intent" }] satisfies Issue[] };
}

function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  const tone = status === "published" ? "success" : status === "archived" ? "brand" : "neutral";
  return <Badge tone={tone as "success"}>{t(locale, `assessment.status_${status}`)}</Badge>;
}

export default function ExamBuilderPage({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const [searchParams] = useSearchParams();
  const { perms, courses, lessons } = loaderData;
  const issues = actionData && "issues" in actionData ? (actionData.issues as Issue[]) : null;

  if (loaderData.isNew) {
    return (
      <div className="space-y-4">
        <nav className="text-sm">
          <Link to="/admin/assessment?tab=exams" className="text-blue-600 hover:underline">
            ← {t(locale, "assessment.examsTab")}
          </Link>
        </nav>
        <h1 className="text-xl font-bold">{t(locale, "assessment.newExam")}</h1>
        {issues && <Alert kind="error">{issues.map((i) => `${i.path}: ${i.message}`).join(" — ")}</Alert>}
        {!perms.create && <Alert kind="error">{t(locale, "assessment.denied")}</Alert>}
        <Form method="post" className="max-w-xl space-y-3">
          <input type="hidden" name="_action" value="create" />
          <Input label={t(locale, "assessment.titleAr")} name="titleAr" required />
          <Input label={t(locale, "assessment.titleEn")} name="titleEn" required />
          <Input label={t(locale, "assessment.descAr")} name="descriptionAr" />
          <Input label={t(locale, "assessment.descEn")} name="descriptionEn" />
          <div>
            <label className="text-sm font-medium text-slate-700">{t(locale, "assessment.lessonLink")}</label>
            <select name="attachKind" className={selectCls} defaultValue="">
              <option value="">—</option>
              <option value="course">Course</option>
              <option value="lesson">Lesson</option>
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="attachId" className={selectCls} defaultValue="">
              <option value="">—</option>
              <optgroup label="Courses">
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {locale === "ar" ? c.labelAr : c.labelEn}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Lessons">
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locale === "ar" ? l.labelAr : l.labelEn}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <SubmitButton className="min-h-11" disabled={!perms.create}>
            {t(locale, "assessment.save")}
          </SubmitButton>
        </Form>
      </div>
    );
  }

  const { exam, attached, bank, counts } = loaderData;
  const draft = exam.status === "draft";
  const cfg = exam.config;
  const totalPoints = attached.reduce((s, a) => s + a.points, 0);

  return (
    <div className="space-y-4">
      <nav className="text-sm">
        <Link to="/admin/assessment?tab=exams" className="text-blue-600 hover:underline">
          ← {t(locale, "assessment.examsTab")}
        </Link>
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{locale === "ar" ? exam.titleAr : exam.titleEn}</h1>
        <StatusBadge status={exam.status} locale={locale} />
        {exam.status === "published" && (
          <Link to={`/exams/${exam.slug}`} className="text-xs text-blue-600 hover:underline">
            {t(locale, "assessment.previewStudent")} ↗
          </Link>
        )}
      </div>
      <p className="text-xs text-slate-400">
        {t(locale, "assessment.attemptsCount")}: {counts.total}
        {counts.live > 0 ? ` (${counts.live} ${t(locale, "exam.inProgress")})` : ""} · {t(locale, "assessment.totalPoints")}: {totalPoints}
      </p>

      {searchParams.get("saved") === "1" && <Alert kind="success">{t(locale, "assessment.saved")}</Alert>}
      {searchParams.get("published") === "1" && <Alert kind="success">{t(locale, "assessment.publishedOk")}</Alert>}
      {issues && <Alert kind="error">{issues.map((i) => `${i.path}: ${i.message}`).join(" — ")}</Alert>}
      {exam.status === "archived" && <Alert kind="info">{t(locale, "assessment.archivedNote")}</Alert>}
      {!draft && <Alert kind="info">{t(locale, "assessment.unpublish")} → {t(locale, "assessment.save")}</Alert>}

      {/* status actions */}
      <div className="flex flex-wrap gap-2">
        {exam.status === "draft" && (
          <Form method="post">
            <input type="hidden" name="_action" value="publish" />
            <SubmitButton className="min-h-11" disabled={!perms.publish}>
              {t(locale, "assessment.publish")}
            </SubmitButton>
          </Form>
        )}
        {exam.status === "published" && (
          <Form method="post">
            <input type="hidden" name="_action" value="unpublish" />
            <SubmitButton variant="secondary" className="min-h-11" disabled={!perms.publish}>
              {t(locale, "assessment.unpublish")}
            </SubmitButton>
          </Form>
        )}
        {exam.status !== "archived" && (
          <Form method="post">
            <input type="hidden" name="_action" value="archive" />
            <SubmitButton variant="secondary" className="min-h-11" disabled={!perms.edit}>
              {t(locale, "assessment.archive")}
            </SubmitButton>
          </Form>
        )}
        {exam.status === "archived" && (
          <Form method="post">
            <input type="hidden" name="_action" value="unarchive" />
            <SubmitButton variant="secondary" className="min-h-11" disabled={!perms.edit}>
              {t(locale, "assessment.backToDraft")}
            </SubmitButton>
          </Form>
        )}
      </div>

      {/* basics */}
      <Form method="post">
        <input type="hidden" name="_action" value="save-basic" />
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-sm font-semibold">{t(locale, "assessment.examSettings")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t(locale, "assessment.titleAr")} name="titleAr" defaultValue={exam.titleAr} required disabled={!draft || !perms.edit} />
              <Input label={t(locale, "assessment.titleEn")} name="titleEn" defaultValue={exam.titleEn} required disabled={!draft || !perms.edit} />
              <Input label={t(locale, "assessment.descAr")} name="descriptionAr" defaultValue={exam.descriptionAr ?? ""} disabled={!draft || !perms.edit} />
              <Input label={t(locale, "assessment.descEn")} name="descriptionEn" defaultValue={exam.descriptionEn ?? ""} disabled={!draft || !perms.edit} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-slate-700">{t(locale, "assessment.lessonLink")}</label>
                <select name="attachKind" className={selectCls} defaultValue={exam.lessonId ? "lesson" : exam.courseId ? "course" : ""} disabled={!draft || !perms.edit}>
                  <option value="">—</option>
                  <option value="course">Course</option>
                  <option value="lesson">Lesson</option>
                </select>
              </div>
              <select name="attachId" className={selectCls} defaultValue={exam.lessonId ?? exam.courseId ?? ""} disabled={!draft || !perms.edit}>
                <option value="">—</option>
                <optgroup label="Courses">
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {locale === "ar" ? c.labelAr : c.labelEn}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Lessons">
                  {lessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {locale === "ar" ? l.labelAr : l.labelEn}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            {draft && perms.edit && (
              <SubmitButton variant="secondary" className="min-h-11">
                {t(locale, "assessment.save")}
              </SubmitButton>
            )}
          </CardBody>
        </Card>
      </Form>

      {/* config */}
      <Form method="post">
        <input type="hidden" name="_action" value="save-config" />
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-sm font-semibold">{t(locale, "assessment.examSettings")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input label={t(locale, "assessment.durationMinutes")} name="durationMinutes" type="number" min={1} max={600} defaultValue={cfg.durationMinutes ?? ""} disabled={!draft || !perms.edit} />
              <Input label={t(locale, "assessment.passPercent")} name="passPercent" type="number" min={0} max={100} defaultValue={cfg.passPercent} disabled={!draft || !perms.edit} />
              <Input label={t(locale, "assessment.attemptsMax")} name="attemptsMax" type="number" min={1} max={100} defaultValue={cfg.attemptsMax ?? ""} disabled={!draft || !perms.edit} />
              <Input label={t(locale, "assessment.cooldownMinutes")} name="cooldownMinutes" type="number" min={0} max={10080} defaultValue={cfg.cooldownMinutes} disabled={!draft || !perms.edit} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-slate-700">{t(locale, "assessment.showResults")}</label>
                <select name="show" className={selectCls} defaultValue={cfg.show} disabled={!draft || !perms.edit}>
                  <option value="immediate">{t(locale, "assessment.show_immediate")}</option>
                  <option value="after_end">{t(locale, "assessment.show_after_end")}</option>
                  <option value="manual">{t(locale, "assessment.show_manual")}</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">{t(locale, "assessment.selectionMode")}</label>
                <select name="mode" className={selectCls} defaultValue={cfg.mode} disabled={!draft || !perms.edit}>
                  <option value="manual">{t(locale, "assessment.mode_manual")}</option>
                  <option value="pool">{t(locale, "assessment.mode_pool")}</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {([
                ["randomizeQuestions", cfg.randomizeQuestions, t(locale, "assessment.randomizeQuestions")],
                ["randomizeChoices", cfg.randomizeChoices, t(locale, "assessment.randomizeChoices")],
                ["partialCredit", cfg.partialCredit, t(locale, "assessment.partialCredit")],
                ["reviewMode", cfg.reviewMode, t(locale, "assessment.reviewMode")],
                ["showAnswers", cfg.showAnswers, t(locale, "assessment.showAnswers")],
                ["showExplanations", cfg.showExplanations, t(locale, "assessment.showExplanations")],
              ] as Array<[string, boolean, string]>).map(([name, checked, label]) => (
                <label key={name} className="flex items-center gap-2">
                  <input type="checkbox" name={name} value="1" defaultChecked={checked} disabled={!draft || !perms.edit} className="h-4 w-4" />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-slate-700">{t(locale, "assessment.startsAt")} (UTC)</label>
                <input type="datetime-local" name="startsAt" defaultValue={cfg.startsAt} className={selectCls} disabled={!draft || !perms.edit} />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">{t(locale, "assessment.endsAt")} (UTC)</label>
                <input type="datetime-local" name="endsAt" defaultValue={cfg.endsAt} className={selectCls} disabled={!draft || !perms.edit} />
              </div>
            </div>
            <details open={cfg.mode === "pool"} className="rounded-lg border p-2">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">{t(locale, "assessment.poolsJson")}</summary>
              <textarea name="poolsJson" rows={8} defaultValue={cfg.poolsJson} className={`${areaCls} mt-2`} disabled={!draft || !perms.edit} />
            </details>
            {draft && perms.edit && (
              <SubmitButton variant="secondary" className="min-h-11">
                {t(locale, "assessment.save")}
              </SubmitButton>
            )}
          </CardBody>
        </Card>
      </Form>

      {/* attached questions */}
      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold">
            {t(locale, "assessment.attachedQuestions")} ({attached.length})
          </h2>
          {cfg.mode === "pool" && <p className="text-xs text-amber-600">{t(locale, "assessment.mode_pool")}</p>}
          {attached.length === 0 && <p className="text-sm text-slate-400">{t(locale, "assessment.noQuestions")}</p>}
          <ol className="space-y-2">
            {attached.map((a, i) => (
              <li key={a.questionId} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm">
                <span className="w-6 text-center text-xs text-slate-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/assessment/questions/${a.questionId}`} className="block truncate font-medium hover:text-brand-700">
                    {a.stemAr || a.stemEn}
                  </Link>
                  <span className="text-xs text-slate-400">
                    {t(locale, `assessment.type_${a.type}`)} · {t(locale, `assessment.status_${a.status}`)}
                  </span>
                </div>
                {draft && perms.edit ? (
                  <div className="flex items-center gap-1">
                    <Form method="post" className="flex items-center gap-1">
                      <input type="hidden" name="_action" value="points" />
                      <input type="hidden" name="questionId" value={a.questionId} />
                      <input name="points" type="number" step="0.5" min="0.5" max="1000" defaultValue={a.points} className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-xs" aria-label={t(locale, "assessment.examPoints")} />
                      <SubmitButton size="sm" variant="secondary">
                        {t(locale, "assessment.examPoints")}
                      </SubmitButton>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="_action" value="move" />
                      <input type="hidden" name="questionId" value={a.questionId} />
                      <input type="hidden" name="dir" value="up" />
                      <SubmitButton size="sm" variant="ghost" disabled={i === 0}>
                        ↑
                      </SubmitButton>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="_action" value="move" />
                      <input type="hidden" name="questionId" value={a.questionId} />
                      <input type="hidden" name="dir" value="down" />
                      <SubmitButton size="sm" variant="ghost" disabled={i === attached.length - 1}>
                        ↓
                      </SubmitButton>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="_action" value="detach" />
                      <input type="hidden" name="questionId" value={a.questionId} />
                      <SubmitButton size="sm" variant="danger">
                        {t(locale, "assessment.remove")}
                      </SubmitButton>
                    </Form>
                  </div>
                ) : (
                  <span className="text-xs text-slate-500">
                    {t(locale, "assessment.examPoints")}: {a.points}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {draft && perms.edit && cfg.mode === "manual" && (
            <Form method="post" className="flex flex-wrap items-end gap-2 border-t pt-3">
              <input type="hidden" name="_action" value="attach" />
              <div className="min-w-0 flex-1">
                <label className="text-sm font-medium text-slate-700">{t(locale, "assessment.pickQuestion")}</label>
                <select name="questionId" className={selectCls} required>
                  <option value="">—</option>
                  {bank.map((q) => (
                    <option key={q.id} value={q.id}>
                      [{t(locale, `assessment.type_${q.type}`)}] {q.stemAr || q.stemEn}
                    </option>
                  ))}
                </select>
              </div>
              <SubmitButton variant="secondary" className="min-h-11" disabled={bank.length === 0}>
                {t(locale, "assessment.attach")}
              </SubmitButton>
            </Form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
