import type { Route } from "./+types/assignments.$id";
import { Form, Link, redirect, useRouteLoaderData, useSearchParams } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  attachSubmissionFile,
  getAssignmentForStudent,
  submitTextAnswer,
} from "~server/assignments/service.server";
import {
  buildR2Key,
  deleteFile,
  detectKind,
  insertFile,
  sha256HexOf,
  sizeCapFor,
  signFileUrl,
} from "~server/files/storage.server";
import { Badge } from "~/components/ui/Badge";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, formatDate, type Locale } from "~/lib/i18n";

const textareaCls = "w-full rounded-[var(--radius-btn)] border border-line bg-white px-3 py-2.5 text-sm focus:border-brand-800 focus:outline-none";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { auth, settings } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  const view = await getAssignmentForStudent(db, {
    assignmentId: params.id,
    actor: { userId: auth.user.id, roleRank: auth.user.rank, roleId: auth.user.roleId },
    nowMs: Date.now(),
  });
  if (!view || !view.access.allowed) throw new Response("Not Found", { status: 404 });

  let file: { id: string; url: string; originalFilename: string } | null = null;
  if (view.submission?.file?.id) {
    const signed = await signFileUrl(env, view.submission.file.id, "view", settings.video.fileUrlTtlSeconds);
    file = { id: view.submission.file.id, url: signed.path, originalFilename: view.submission.file.originalFilename };
  }

  return {
    assignment: {
      titleAr: view.assignment.titleAr,
      titleEn: view.assignment.titleEn,
      descriptionAr: view.assignment.descriptionAr,
      descriptionEn: view.assignment.descriptionEn,
      instructionsAr: view.assignment.instructionsAr,
      instructionsEn: view.assignment.instructionsEn,
      maxScore: view.assignment.maxScore,
      dueAt: view.assignment.dueAt,
      allowedSubmissionTypes: view.assignment.allowedSubmissionTypes ?? [],
    },
    canSubmit: view.canSubmit,
    resultVisible: view.resultVisible,
    submission: view.submission
      ? {
          status: view.submission.status,
          textAnswer: view.submission.textAnswer,
          score: view.submission.score,
          feedback: view.submission.feedback,
          submittedAt: view.submission.submittedAt,
          file,
        }
      : null,
    channels: view.assignment.allowedSubmissionTypes ?? [],
    reason: null as string | null,
  };
}

const reasonKey: Record<string, string> = {
  not_found: "assignment.err_notFound",
  denied: "assignment.err_denied",
  unpublished: "assignment.err_unpublished",
  after_due: "assignment.err_afterDue",
  channel: "assignment.err_channel",
  invalid_file: "assignment.err_invalidFile",
  graded: "assignment.err_graded",
  no_content: "assignment.err_noContent",
  too_large: "assignment.err_tooLarge",
  bad_type: "assignment.err_badType",
};

export async function action({ context, request, params }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  const actor = { userId: auth.user.id, roleRank: auth.user.rank, roleId: auth.user.roleId };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  const view = await getAssignmentForStudent(db, { assignmentId: params.id, actor, nowMs: Date.now() });
  if (!view || !view.access.allowed) throw new Response("Not Found", { status: 404 });

  if (intent === "submit_text") {
    const text = String(form.get("text") ?? "");
    const res = await submitTextAnswer(db, { assignmentId: params.id, actor, text, nowMs: Date.now() });
    if (res.ok) return redirect(`/assignments/${params.id}?sent=1`);
    return redirect(`/assignments/${params.id}?err=${res.error}`);
  }

  if (intent === "submit_file") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return redirect(`/assignments/${params.id}?err=no_content`);
    const mime = file.type || "application/octet-stream";
    const kind = detectKind(mime);
    if (kind !== "pdf" && kind !== "image") return redirect(`/assignments/${params.id}?err=bad_type`);
    if (file.size > sizeCapFor(kind)) return redirect(`/assignments/${params.id}?err=too_large`);

    const buf = await file.arrayBuffer();
    const checksum = await sha256HexOf(buf);
    const r2Key = buildR2Key(kind, file.name, "private");
    await env.PRIVATE_FILES.put(r2Key, buf, { httpMetadata: { contentType: mime } });
    const fileId = await insertFile(db, {
      r2Key,
      bucket: "PRIVATE_FILES",
      kind,
      originalFilename: file.name.slice(0, 200),
      mime,
      byteSize: file.size,
      checksumSha256: checksum,
      visibility: "private",
      createdBy: auth.user.id,
    });

    const res = await attachSubmissionFile(db, { assignmentId: params.id, actor, fileId, nowMs: Date.now() });
    if (!res.ok) {
      // roll back the just-created private file so no orphan is left
      await deleteFile(db, env, fileId);
      return redirect(`/assignments/${params.id}?err=${res.error}`);
    }
    if (res.priorFileId) await deleteFile(db, env, res.priorFileId);
    return redirect(`/assignments/${params.id}?sent=1`);
  }

  return redirect(`/assignments/${params.id}`);
}

export default function StudentAssignmentDetail({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { assignment, canSubmit, resultVisible, submission, channels } = loaderData;
  const [searchParams] = useSearchParams();
  const err = searchParams.get("err");
  const sent = searchParams.get("sent") === "1";

  const title = locale === "ar" ? assignment.titleAr : assignment.titleEn;
  const description = locale === "ar" ? assignment.descriptionAr : assignment.descriptionEn;
  const instructions = locale === "ar" ? assignment.instructionsAr : assignment.instructionsEn;

  const channelsArr = channels.length ? channels : [];
  const allowText = channelsArr.includes("text");
  const allowFile = channelsArr.includes("file");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/assignments" className="inline-flex min-h-9 items-center gap-1 text-sm font-bold text-ink">
        <span aria-hidden="true" className="text-accent-600 rtl:rotate-180">←</span>
        <span className="sig-u">{t(locale, "assignment.backToList")}</span>
      </Link>

      {sent && <Alert kind="success">{t(locale, "assignment.sentOk")}</Alert>}
      {err && reasonKey[err] && <Alert kind="error">{t(locale, reasonKey[err])}</Alert>}

      <div className="flex flex-wrap items-center gap-2 border-b-2 border-brand-800 pb-4">
        <h1 className="sig-display text-3xl text-ink">{title}</h1>
        {submission?.status === "graded" && <Badge tone="brand">{t(locale, "assignment.statusGraded")}</Badge>}
        {submission?.status === "submitted" && <Badge tone="warning">{t(locale, "assignment.statusPending")}</Badge>}
      </div>

      <Card>
        <CardBody className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-ink-muted">
            <span><span>{t(locale, "assignment.maxScore")}:</span> <b className="tabular-nums text-ink">{assignment.maxScore}</b></span>
            {assignment.dueAt && (
              <span><span>{t(locale, "assignment.dueAt")}:</span> <b className="tabular-nums text-ink">{formatDate(locale, assignment.dueAt)}</b></span>
            )}
            <span><span>{t(locale, "assignment.submitChannels")}:</span> <b className="text-ink">{channelsArr.map((c) => t(locale, `assignment.channel_${c}`)).join(" + ")}</b></span>
          </div>
          {description && <p className="whitespace-pre-wrap leading-relaxed text-ink">{description}</p>}
          {instructions && (
            <div className="rounded-[var(--radius-btn)] border-s-2 border-s-brand-800 bg-slate-50 p-3">
              <p className="mb-1 font-bold text-ink">{t(locale, "assignment.instructionsLabel")}</p>
              <p className="whitespace-pre-wrap leading-relaxed text-ink-muted">{instructions}</p>
            </div>
          )}
        </CardBody>
      </Card>

      {submission && (
        <Card>
          <CardHeader title={t(locale, "assignment.yourSubmission")} />
          <CardBody className="space-y-3 text-sm">
            <p className="tabular-nums text-ink-muted">{t(locale, "assignment.submittedOn")} {formatDate(locale, submission.submittedAt)}</p>
            {submission.textAnswer && <p className="whitespace-pre-wrap leading-relaxed text-ink">{submission.textAnswer}</p>}
            {submission.file && (
              <a href={submission.file.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 font-bold text-ink">
                <span className="sig-u">{submission.file.originalFilename}</span> <span aria-hidden="true" className="text-accent-600">↗</span>
              </a>
            )}
            {submission.status === "graded" && resultVisible && (
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="font-semibold text-emerald-800">{t(locale, "assignment.colScore")}: {submission.score} / {assignment.maxScore}</p>
                {submission.feedback && <p className="mt-1 whitespace-pre-wrap text-emerald-900">{submission.feedback}</p>}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {!canSubmit && !submission && (
        <Alert kind="info">{t(locale, "assignment.locked")}</Alert>
      )}

      {canSubmit && (
        <Card>
          <CardHeader title={t(locale, "assignment.submitTitle")} description={t(locale, "assignment.submitHint")} />
          <CardBody className="space-y-4">
            {allowText && (
              <Form method="post" className="grid gap-2">
                <input type="hidden" name="_action" value="submit_text" />
                <textarea name="text" rows={5} className={textareaCls} placeholder={t(locale, "assignment.answerPlaceholder")} defaultValue={submission?.textAnswer ?? ""} />
                <div><SubmitButton name="_action" value="submit_text">{t(locale, "assignment.submit")}</SubmitButton></div>
              </Form>
            )}
            {allowFile && (
              <Form method="post" encType="multipart/form-data" className="grid gap-2 border-t border-line pt-4">
                <input type="hidden" name="_action" value="submit_file" />
                <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-sm" />
                <p className="text-xs leading-relaxed text-ink-muted">{t(locale, "assignment.fileHint")}</p>
                <div><SubmitButton variant="secondary" name="_action" value="submit_file">{t(locale, "assignment.uploadSubmit")}</SubmitButton></div>
              </Form>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
