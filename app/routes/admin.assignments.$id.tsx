import type { Route } from "./+types/admin.assignments.$id";
import { Form, Link, redirect, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { adminTree } from "~server/content/service.server";
import {
  AssignmentReferenceError,
  AssignmentValidationError,
  adminAssignmentSummary,
  archiveAssignment,
  assignmentLocation,
  canAssignment,
  createAssignment,
  getAssignment,
  gradeSubmission,
  publishAssignment,
  setAssignmentStatus,
  updateAssignment,
} from "~server/assignments/service.server";
import { signFileUrl } from "~server/files/storage.server";
import { Badge } from "~/components/ui/Badge";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { EmptyState } from "~/components/ui/EmptyState";
import { t, formatDate, type Locale } from "~/lib/i18n";

const selectCls = "h-[42px] w-full rounded-lg border border-line bg-white px-3 text-sm";
const textareaCls = "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm";
const inputCls = "h-[42px] w-full rounded-lg border border-line bg-white px-3 text-sm";

interface Issue { path: string; message: string; }
const toLocalInput = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString().slice(0, 16));
const fromLocalInput = (v: string) => (v ? new Date(`${v}:00Z`).getTime() : null);

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { auth, settings } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const isNew = params.id === "new";
  const perms = {
    read: await canAssignment(db, auth, "assignment.read"),
    create: await canAssignment(db, auth, "assignment.create"),
    edit: await canAssignment(db, auth, "assignment.edit"),
    publish: await canAssignment(db, auth, "assignment.publish"),
    grade: await canAssignment(db, auth, "assignment.grade"),
  };

  const tree = await adminTree(db);
  const courses: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  const units: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  const lessons: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  for (const p of tree)
    for (const g of p.children)
      for (const s of g.children) {
        for (const c of s.children) {
          if (c.type !== "course") continue;
          courses.push({ id: c.id, labelAr: `${s.titleAr} › ${c.titleAr}`, labelEn: `${s.titleEn} › ${c.titleEn}` });
          for (const u of c.children) {
            if (u.type !== "unit") continue;
            units.push({ id: u.id, labelAr: `${c.titleAr} › ${u.titleAr}`, labelEn: `${c.titleEn} › ${u.titleEn}` });
            for (const l of u.children) {
              if (l.type === "lesson") lessons.push({ id: l.id, labelAr: `${u.titleAr} › ${l.titleAr}`, labelEn: `${u.titleEn} › ${l.titleEn}` });
            }
          }
        }
      }

  if (isNew)
    return { isNew: true as const, perms, courses, units, lessons, assignment: null, location: null, summary: null, subs: null as null, denied: false as const };

  if (!perms.read)
    return { isNew: false as const, perms, courses, units, lessons, assignment: null, location: null, summary: null, subs: null as null, denied: true as const };

  const a = await getAssignment(db, params.id);
  if (!a) throw new Response("Not Found", { status: 404 });
  const [location, summary] = await Promise.all([
    assignmentLocation(db, a),
    adminAssignmentSummary(db, a.id),
  ]);
  // mint signed view URLs for private files (owner/grader may open them)
  const ttl = settings.video.fileUrlTtlSeconds;
  const subs = summary ? await Promise.all(
    summary.submissions.map(async (s) => {
      const file = s.fileId ? { id: s.fileId, url: (await signFileUrl(getEnv(context), s.fileId, "view", ttl)).path } : null;
      return { ...s, file };
    })
  ) : [];
  const agg = summary ? { submittedCount: summary.submittedCount, gradedCount: summary.gradedCount, total: summary.submissions.length } : null;

  return { isNew: false as const, perms, courses, units, lessons, assignment: a, location, summary: agg, subs, denied: false as const };
}

function toSelect(value: string | null | undefined, list: { id: string }[], keepValue = false) {
  return list.some((x) => x.id === value) || keepValue ? (value ?? "") : "";
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const back = `/admin/assignments/${params.id}`;
  const denied = { issues: [{ path: "perm", message: "denied" }] satisfies Issue[] };
  const audit = async (action: string, entityId: string) => {
    const { logAudit } = await import("~server/audit/log.server");
    await logAudit(db, { actorUserId: auth.user.id, actorRole: auth.user.roleId, action, entityType: "assignment", entityId, ipHash: null });
  };

  try {
    const isNew = params.id === "new";
    if (intent === "create") {
      if (isNew) {
        if (!(await canAssignment(db, auth, "assignment.create"))) return denied;
        const res = await createAssignment(
          db,
          {
            titleAr: str("titleAr"), titleEn: str("titleEn"),
            descriptionAr: str("descriptionAr") || null, descriptionEn: str("descriptionEn") || null,
            instructionsAr: str("instructionsAr") || null, instructionsEn: str("instructionsEn") || null,
            courseId: str("courseId") || null, unitId: str("unitId") || null, lessonId: str("lessonId") || null,
            maxScore: Number(str("maxScore")) || 0,
            dueAt: fromLocalInput(str("dueAt")),
            allowedSubmissionTypes: form.getAll("channels").map(String),
          },
          { userId: auth.user.id, role: auth.user.roleId }
        );
        await audit("assignment.created", res.id);
        return redirect(`/admin/assignments/${res.id}?saved=1`);
      }
    }

    const a = await getAssignment(db, params.id);
    if (!a) throw new Response("Not Found", { status: 404 });

    if (intent === "save") {
      if (!(await canAssignment(db, auth, "assignment.edit"))) return denied;
      await updateAssignment(db, a.id, {
        titleAr: str("titleAr"), titleEn: str("titleEn"),
        descriptionAr: str("descriptionAr") || null, descriptionEn: str("descriptionEn") || null,
        instructionsAr: str("instructionsAr") || null, instructionsEn: str("instructionsEn") || null,
        courseId: str("courseId") || null, unitId: str("unitId") || null, lessonId: str("lessonId") || null,
        maxScore: Number(str("maxScore")),
        dueAt: fromLocalInput(str("dueAt")),
        allowedSubmissionTypes: form.getAll("channels").map(String),
      });
      await audit("assignment.updated", a.id);
      return redirect(`${back}?saved=1`);
    }
    if (intent === "publish") {
      if (!(await canAssignment(db, auth, "assignment.publish"))) return denied;
      await publishAssignment(db, a.id);
      await audit("assignment.published", a.id);
      return redirect(`${back}?published=1`);
    }
    if (intent === "archive") {
      if (!(await canAssignment(db, auth, "assignment.publish"))) return denied;
      await archiveAssignment(db, a.id);
      await audit("assignment.archived", a.id);
      return redirect(`${back}?saved=1`);
    }
    if (intent === "draft") {
      if (!(await canAssignment(db, auth, "assignment.publish"))) return denied;
      await setAssignmentStatus(db, a.id, "draft", { userId: auth.user.id, role: auth.user.roleId });
      await audit("assignment.draft", a.id);
      return redirect(`${back}?saved=1`);
    }
    if (intent === "grade") {
      if (!(await canAssignment(db, auth, "assignment.grade"))) return denied;
      const submissionId = str("submissionId");
      const score = Number(str("score"));
      const feedback = str("feedback") || null;
      await gradeSubmission(db, { submissionId, score, feedback, grader: { userId: auth.user.id, role: auth.user.roleId, rank: auth.user.rank, roleId: auth.user.roleId } });
      return redirect(`${back}#sub-${submissionId}`);
    }
  } catch (err) {
    if (err instanceof AssignmentValidationError) return { issues: err.issues };
    if (err instanceof AssignmentReferenceError) return { issues: [{ path: err.field, message: err.message }] };
    throw err;
  }
  return { issues: [{ path: "_action", message: "unknown intent" }] satisfies Issue[] };
}

function AssignmentForm({ locale, assignment, courses, units, lessons, disabled, actionValue }: {
  locale: Locale; assignment: { titleAr: string; titleEn: string; descriptionAr?: string | null; descriptionEn?: string | null; instructionsAr?: string | null; instructionsEn?: string | null; courseId?: string | null; unitId?: string | null; lessonId?: string | null; maxScore: number; dueAt?: number | null; allowedSubmissionTypes: string[]; };
  courses: { id: string; labelAr: string; labelEn: string }[]; units: { id: string; labelAr: string; labelEn: string }[]; lessons: { id: string; labelAr: string; labelEn: string }[];
  disabled: boolean; actionValue: string;
}) {
  const langAr = ` (${t(locale, "assignment.langAr")})`;
  const langEn = ` (${t(locale, "assignment.langEn")})`;
  const channels = assignment.allowedSubmissionTypes?.length ? assignment.allowedSubmissionTypes : ["text", "file"];
  return (
    <div className="space-y-3">
      <input type="hidden" name="_action" value={actionValue} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t(locale, "assignment.titleAr")} name="titleAr" defaultValue={assignment.titleAr} disabled={disabled} required />
        <Input label={t(locale, "assignment.titleEn")} name="titleEn" defaultValue={assignment.titleEn} disabled={disabled} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink">{t(locale, "assignment.descriptionLabel")}{langAr}</span>
          <textarea name="descriptionAr" defaultValue={assignment.descriptionAr ?? ""} disabled={disabled} className={textareaCls} rows={2} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink">{t(locale, "assignment.descriptionLabel")}{langEn}</span>
          <textarea name="descriptionEn" defaultValue={assignment.descriptionEn ?? ""} disabled={disabled} className={textareaCls} rows={2} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink">{t(locale, "assignment.instructionsLabel")} ({t(locale, "assignment.langAr")})</span>
          <textarea name="instructionsAr" defaultValue={assignment.instructionsAr ?? ""} disabled={disabled} className={textareaCls} rows={3} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink">{t(locale, "assignment.instructionsLabel")} ({t(locale, "assignment.langEn")})</span>
          <textarea name="instructionsEn" defaultValue={assignment.instructionsEn ?? ""} disabled={disabled} className={textareaCls} rows={3} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-sm font-medium text-ink">{t(locale, "assignment.courseLabel")}</label>
          <select name="courseId" defaultValue={assignment.courseId ?? ""} disabled={disabled} className={selectCls}>
            <option value="">—</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.labelAr : c.labelEn}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-ink">{t(locale, "assignment.unitLabel")}</label>
          <select name="unitId" defaultValue={assignment.unitId ?? ""} disabled={disabled} className={selectCls}>
            <option value="">—</option>
            {units.map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.labelAr : c.labelEn}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-ink">{t(locale, "assignment.lessonLabel")}</label>
          <select name="lessonId" defaultValue={assignment.lessonId ?? ""} disabled={disabled} className={selectCls}>
            <option value="">—</option>
            {lessons.map((c) => <option key={c.id} value={c.id}>{locale === "ar" ? c.labelAr : c.labelEn}</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label={t(locale, "assignment.maxScore")} name="maxScore" type="number" min={1} step="0.5" defaultValue={String(assignment.maxScore)} disabled={disabled} required />
        <div>
          <label className="text-sm font-medium text-ink">{t(locale, "assignment.dueAt")} (UTC)</label>
          <input name="dueAt" type="datetime-local" defaultValue={assignment.dueAt ? toLocalInput(assignment.dueAt) : ""} disabled={disabled} className={inputCls} />
        </div>
        <div className="sm:col-span-1">
          <span className="text-sm font-medium text-ink">{t(locale, "assignment.submitChannels")}</span>
          <div className="mt-1.5 flex gap-4 text-sm">
            {(["text", "file"] as const).map((ch) => (
              <label key={ch} className="flex items-center gap-1.5">
                <input type="checkbox" name="channels" value={ch} defaultChecked={channels.includes(ch)} disabled={disabled} className="h-4 w-4" />
                {t(locale, `assignment.channel_${ch}`)}
              </label>
            ))}
          </div>
        </div>
      </div>
      {!disabled && (
        <SubmitButton variant="secondary">{t(locale, "assignment.save")}</SubmitButton>
      )}
    </div>
  );
}

export default function AdminAssignmentDetail({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const issues = actionData && "issues" in actionData ? (actionData.issues as Issue[]) : null;
  const { isNew, perms, courses, units, lessons, assignment, location, summary, subs } = loaderData;

  if (isNew) {
    if (!perms.create) return <Alert kind="error">{t(locale, "assignment.denied")}</Alert>;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link to="/admin/assignments" className="text-sm text-ink hover:underline">← {t(locale, "assignment.backToList")}</Link>
        <h1 className="text-xl font-bold">{t(locale, "assignment.newAssignment")}</h1>
        {issues && <Alert kind="error">{issues.map((i) => `${i.path}: ${i.message}`).join(" — ")}</Alert>}
        <Card><CardHeader title={t(locale, "assignment.editTitle")} description={t(locale, "assignment.editHint")} /><CardBody>
          <Form method="post">
            <AssignmentForm locale={locale} assignment={{ titleAr: "", titleEn: "", maxScore: 100, dueAt: null, allowedSubmissionTypes: ["text", "file"] }} courses={courses} units={units} lessons={lessons} disabled={false} actionValue="create" />
          </Form>
        </CardBody></Card>
      </div>
    );
  }

  if (loaderData.denied) return <Alert kind="error">{t(locale, "assignment.denied")}</Alert>;
  if (!assignment) return null;
  void issues;
  const draft = assignment.status === "draft";
  const a = assignment;
  const locationName = (o: { titleAr: string; titleEn: string } | null) => (o ? (locale === "ar" ? o.titleAr : o.titleEn) : "");
  const channels = a.allowedSubmissionTypes?.length ? a.allowedSubmissionTypes : [];
  const labelEn = (k: string) => t(locale, k);

  return (
    <div className="space-y-4">
      <nav className="text-sm">
        <Link to="/admin/assignments" className="inline-flex text-ink hover:underline">← {t(locale, "assignment.backToList")}</Link>
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{locale === "ar" ? a.titleAr : a.titleEn}</h1>
        <Badge tone={a.status === "published" ? "success" : a.status === "archived" ? "brand" : "neutral"}>{t(locale, `assignment.status_${a.status}`)}</Badge>
      </div>

      {issues && <Alert kind="error">{issues.map((i) => `${i.path}: ${i.message}`).join(" — ")}</Alert>}

      {/* status actions */}
      <div className="flex flex-wrap gap-2">
        {perms.publish && (
          <>
            {draft && (
              <Form method="post"><input type="hidden" name="_action" value="publish" /><SubmitButton className="min-h-11">{t(locale, "assignment.publish")}</SubmitButton></Form>
            )}
            {a.status === "published" && (
              <Form method="post"><input type="hidden" name="_action" value="draft" /><SubmitButton variant="secondary">{t(locale, "assignment.unpublish")}</SubmitButton></Form>
            )}
            {a.status !== "archived" && (
              <Form method="post"><input type="hidden" name="_action" value="archive" /><SubmitButton variant="secondary">{t(locale, "assignment.archive")}</SubmitButton></Form>
            )}
          </>
        )}
      </div>

      {/* meta + edit */}
      <Card>
        <CardBody className="space-y-3">
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><span className="text-ink-muted">{t(locale, "assignment.maxScore")}: </span><b>{a.maxScore}</b></div>
            <div><span className="text-ink-muted">{t(locale, "assignment.dueAt")}: </span><b>{a.dueAt ? formatDate(locale, a.dueAt) : t(locale, "assignment.notSet")}</b></div>
            <div><span className="text-ink-muted">{t(locale, "assignment.submitChannels")}: </span><b>{channels.map((c) => labelEn(`assignment.channel_${c}`)).join(" + ")}</b></div>
            <div className="sm:col-span-2 lg:col-span-3">
              <span className="text-ink-muted">{t(locale, "assignment.locationLabel")}: </span>
              <b>{[locationName(location?.course), locationName(location?.unit), locationName(location?.lesson)].filter(Boolean).join(" › ") || t(locale, "assignment.notAttached")}</b>
            </div>
          </div>
          {a.descriptionAr && <p className="text-sm text-ink-muted">{locale === "ar" ? a.descriptionAr : a.descriptionEn}</p>}
        </CardBody>
      </Card>

      {/* edit form (allowed for draft+published admins with edit perm) */}
      {perms.edit && (
        <Card><CardHeader title={t(locale, "assignment.editTitle")} /><CardBody>
          <Form method="post">
            <AssignmentForm
              locale={locale}
              assignment={{ titleAr: a.titleAr, titleEn: a.titleEn, descriptionAr: a.descriptionAr, descriptionEn: a.descriptionEn, instructionsAr: a.instructionsAr, instructionsEn: a.instructionsEn, courseId: a.courseId, unitId: a.unitId, lessonId: a.lessonId, maxScore: a.maxScore, dueAt: a.dueAt, allowedSubmissionTypes: a.allowedSubmissionTypes }}
              courses={courses} units={units} lessons={lessons} disabled={false} actionValue="save"
            />
          </Form>
        </CardBody></Card>
      )}

      {/* stats (real data) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardBody><p className="text-2xl font-bold text-ink">{summary?.total ?? 0}</p><p className="text-sm text-ink-muted">{t(locale, "assignment.totalSubmissions")}</p></CardBody></Card>
        <Card><CardBody><p className="text-2xl font-bold text-amber-600">{summary?.submittedCount ?? 0}</p><p className="text-sm text-ink-muted">{t(locale, "assignment.awaitingGrading")}</p></CardBody></Card>
        <Card><CardBody><p className="text-2xl font-bold text-emerald-600">{summary?.gradedCount ?? 0}</p><p className="text-sm text-ink-muted">{t(locale, "assignment.gradedTitle")}</p></CardBody></Card>
      </div>

      {/* submissions + grading */}
      <Card>
        <CardHeader title={t(locale, "assignment.submissionsTitle")} />
        <CardBody className="p-0">
          {(!subs || subs.length === 0) ? (
            <div className="p-5"><EmptyState title={t(locale, "assignment.noSubmissions")} body={t(locale, "assignment.noSubmissionsBody")} icon="○" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="px-4 py-3 font-medium">{t(locale, "assignment.colStudent")}</th>
                    <th className="px-4 py-3 font-medium">{t(locale, "assignment.colAnswer")}</th>
                    <th className="px-4 py-3 font-medium">{t(locale, "assignment.colStatus")}</th>
                    <th className="px-4 py-3 font-medium">{t(locale, "assignment.colScore")}</th>
                    <th className="px-4 py-3 font-medium">{t(locale, "assignment.colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id} id={`sub-${s.id}`} className="border-b border-line last:border-0 align-top hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{s.studentName}</p>
                        <p className="text-xs text-ink-muted" dir="ltr">{s.studentEmail}</p>
                        <p className="mt-1 text-xs text-ink-muted">{t(locale, "assignment.submittedOn")} {formatDate(locale, s.submittedAt)}</p>
                      </td>
                      <td className="max-w-sm px-4 py-3 text-ink-muted">
                        {s.textAnswer ? <p className="whitespace-pre-wrap text-sm">{s.textAnswer}</p> : <span className="text-ink-muted">{t(locale, "assignment.noText")}</span>}
                        {s.file && (
                          <a href={s.file.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex text-xs font-medium text-ink hover:underline">
                            {t(locale, "assignment.openFile")} ↗
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3"><Badge tone={s.status === "graded" ? "success" : "warning"}>{s.status === "graded" ? t(locale, "assignment.statusGraded") : t(locale, "assignment.statusPending")}</Badge></td>
                      <td className="px-4 py-3 text-ink">{s.status === "graded" ? `${s.score} / ${a.maxScore}` : "—"}</td>
                      <td className="px-4 py-3">
                        {perms.grade ? (
                          <Form method="post" className="grid gap-2">
                            <input type="hidden" name="_action" value="grade" />
                            <input type="hidden" name="submissionId" value={s.id} />
                            <input name="score" type="number" min="0" step="0.5" max={a.maxScore} defaultValue={s.score ?? ""} aria-label={t(locale, "assignment.colScore")} className={inputCls} />
                            <textarea name="feedback" defaultValue={s.feedback ?? ""} rows={2} aria-label={t(locale, "assignment.feedbackLabel")} className={textareaCls} placeholder={t(locale, "assignment.feedbackPlaceholder")} />
                            <SubmitButton size="sm" variant={s.status === "graded" ? "secondary" : "primary"}>
                              {s.status === "graded" ? t(locale, "assignment.reGrade") : t(locale, "assignment.saveGrade")}
                            </SubmitButton>
                          </Form>
                        ) : (
                          <span className="text-xs text-ink-muted">{s.feedback}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
