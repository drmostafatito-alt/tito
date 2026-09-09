import type { Route } from "./+types/exams.$slug.attempt";
import { useEffect, useRef, useState } from "react";
import { Link, useRouteLoaderData } from "react-router";
import { redirect } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  attemptContext,
  attemptsForStudent,
  expireAttemptIfNeeded,
  examAccess,
  getExamBySlug,
  parseExamConfig,
} from "~server/assessment/service.server";
import { signFileUrl } from "~server/files/storage.server";
import { Alert } from "~/components/ui/Alert";
import { Modal } from "~/components/ui/Modal";
import { t, type Locale } from "~/lib/i18n";

/**
 * Live attempt page (focused mode — outside the student chrome).
 *
 * Timing is server-authoritative: the loader computes remainingSeconds from the
 * stored deadline (startedAt + duration), the client only renders a countdown.
 * Answers autosave server-side per change (idempotent upsert) with a pagehide
 * beacon as the last-resort flush — refresh/reconnect resumes exact state.
 * The answer key never reaches this page (attemptContext is sanitized).
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth, settings } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const exam = await getExamBySlug(db, params.slug);
  const actor = { userId: auth.user.id, roleRank: auth.user.rank };
  if (!exam || (exam.status !== "published" && auth.user.rank < 3)) {
    throw new Response("Not Found", { status: 404 });
  }
  const access = await examAccess(db, actor, exam);
  if (!access.allowed) throw new Response("Forbidden", { status: 403 });

  const nowMs = Date.now();
  const expired = await expireAttemptIfNeeded(db, {
    examId: exam.id,
    studentId: auth.user.id,
    graceSeconds: settings.assessment.graceSeconds,
    nowMs,
    videoThresholdPct: settings.video.completionThresholdPct,
  });
  if (expired) return redirect(`/exams/${exam.slug}?expired=1`);

  const rows = await attemptsForStudent(db, auth.user.id, exam.id);
  const live = rows.find((r) => r.status === "in_progress");
  if (!live) return redirect(`/exams/${exam.slug}`);

  const config = parseExamConfig(exam.config);
  const ctx = await attemptContext(db, { attempt: live, config, nowMs });
  if (ctx.expired) {
    // deadline passed inside the grace window sweep race — re-sweep and leave
    await expireAttemptIfNeeded(db, {
      examId: exam.id,
      studentId: auth.user.id,
      graceSeconds: settings.assessment.graceSeconds,
      nowMs: Date.now(),
      videoThresholdPct: settings.video.completionThresholdPct,
    });
    return redirect(`/exams/${exam.slug}?expired=1`);
  }

  const env = getEnv(context);
  const ttl = settings.video.fileUrlTtlSeconds;
  const essayFiles: Record<string, { fileId: string; url: string; originalFilename: string; mime: string; byteSize: number }> = {};
  for (const qid of Object.keys(ctx.essayFiles)) {
    const f = ctx.essayFiles[qid];
    const signed = await signFileUrl(env, f.fileId, "view", ttl);
    essayFiles[qid] = { ...f, url: signed.path };
  }

  return {
    examSlug: exam.slug,
    examTitleAr: exam.titleAr,
    examTitleEn: exam.titleEn,
    attemptId: live.id,
    attemptNumber: live.attemptNumber,
    questions: ctx.questions,
    answers: ctx.answers,
    textAnswers: ctx.textAnswers,
    essayFiles,
    remainingSeconds: ctx.remainingSeconds,
  };
}

function fmtClock(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fileErrorLabel(locale: Locale, code: string): string {
  const map: Record<string, string> = {
    invalid_type: "exam.fileInvalidType",
    too_large: "exam.fileTooLarge",
    no_file: "exam.noFile",
    rate_limited: "exam.fileTooMany",
    closed: "exam.attemptLocked",
  };
  return t(locale, map[code] ?? "exam.fileUploadError");
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function AttemptPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { examSlug, examTitleAr, examTitleEn, attemptId, questions, answers, textAnswers, essayFiles, remainingSeconds } = loaderData;
  const title = locale === "ar" ? examTitleAr : examTitleEn;

  const [idx, setIdx] = useState(0);
  const [selections, setSelections] = useState<Record<string, string[]>>(answers);
  const [texts, setTexts] = useState<Record<string, string>>(textAnswers);
  const [files, setFiles] = useState<Record<string, { fileId: string; url: string; originalFilename: string; mime: string; byteSize: number }>>(essayFiles ?? {});
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [remaining, setRemaining] = useState<number | null>(remainingSeconds);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [closed, setClosed] = useState(false);

  /** dirty per question carries its own payload kind (choiceIds OR essay text). */
  const dirty = useRef<Map<string, { choiceIds?: string[]; text?: string }>>(new Map());
  const saveSeq = useRef<Map<string, number>>(new Map());
  const submittingRef = useRef(false);

  const isAnswered = (q: (typeof questions)[number]) =>
    q.type === "essay" ? ((texts[q.id] ?? "").trim().length > 0 || Boolean(files[q.id])) : ((selections[q.id] ?? []).length > 0);

  const current = questions[idx] ?? null;

  // ---- countdown (display only — the server owns the deadline) -------------
  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      void doSubmit();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  // ---- last-resort flush when the page goes away ---------------------------
  useEffect(() => {
    const flush = () => {
      for (const [qid, payload] of dirty.current.entries()) {
        const body = new URLSearchParams({ _action: "save", attemptId, questionId: qid });
        if (payload.text !== undefined) body.set("text", payload.text);
        else body.set("choiceIds", (payload.choiceIds ?? []).join(","));
        navigator.sendBeacon("/api/exam-attempt", new Blob([body.toString()], { type: "application/x-www-form-urlencoded" }));
      }
      dirty.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [attemptId]);

  async function post(body: URLSearchParams): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch("/api/exam-attempt", { method: "POST", body });
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null; // network failure or non-JSON response — caller shows a retry state
    }
  }

  async function persist(questionId: string, payload: { choiceIds?: string[]; text?: string }) {
    const seq = (saveSeq.current.get(questionId) ?? 0) + 1;
    saveSeq.current.set(questionId, seq);
    dirty.current.set(questionId, payload);
    setSaveState("saving");
    const params = new URLSearchParams({ _action: "save", attemptId, questionId });
    if (payload.text !== undefined) params.set("text", payload.text);
    else params.set("choiceIds", (payload.choiceIds ?? []).join(","));
    const json = await post(params);
    if (saveSeq.current.get(questionId) !== seq) return; // a newer save superseded this one
    if (json && json.ok) {
      dirty.current.delete(questionId);
      setSaveState(dirty.current.size > 0 ? "saving" : "saved");
    } else if (json && json.error === "closed") {
      setClosed(true);
    } else {
      setSaveState("error");
    }
  }

  function choose(choiceId: string) {
    if (!current || closed || submittingRef.current || current.type === "essay") return;
    const prev = selections[current.id] ?? [];
    let next: string[];
    if (current.type === "multi_select") {
      next = prev.includes(choiceId) ? prev.filter((c) => c !== choiceId) : [...prev, choiceId];
    } else {
      next = prev.length === 1 && prev[0] === choiceId ? [] : [choiceId]; // click again to unselect
    }
    setSelections((s) => ({ ...s, [current.id]: next }));
    void persist(current.id, { choiceIds: next });
  }

  function updateText(value: string) {
    if (!current || closed || submittingRef.current || current.type !== "essay") return;
    setTexts((s) => ({ ...s, [current.id]: value }));
    void persist(current.id, { text: value });
  }

  async function uploadEssayFile(qid: string, file: File) {
    if (!current || closed || submittingRef.current || current.type !== "essay") return;
    setFileBusy(true);
    setFileError(null);
    const fd = new FormData();
    fd.set("_action", "upload");
    fd.set("attemptId", attemptId);
    fd.set("questionId", qid);
    fd.append("file", file);
    try {
      const res = await fetch("/api/exam-attempt", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (json && json.ok) {
        setFiles((s) => ({
          ...s,
          [qid]: { fileId: String(json.fileId), url: String(json.url), originalFilename: String(json.originalFilename), mime: String(json.mime), byteSize: Number(json.byteSize) },
        }));
      } else {
        setFileError((json && json.error ? String(json.error) : "error"));
      }
    } catch {
      setFileError("error");
    }
    setFileBusy(false);
  }

  async function removeEssayFile(qid: string) {
    if (!current || closed || submittingRef.current || current.type !== "essay") return;
    setFileBusy(true);
    setFileError(null);
    const p = new URLSearchParams({ _action: "clear-file", attemptId, questionId: qid });
    try {
      const res = await fetch("/api/exam-attempt", { method: "POST", body: p });
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (json && json.ok) {
        setFiles((s) => {
          const next = { ...s };
          delete next[qid];
          return next;
        });
      } else {
        setFileError("error");
      }
    } catch {
      setFileError("error");
    }
    setFileBusy(false);
  }

  async function doSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(false);
    // flush anything unsaved BEFORE submitting so the graded set is complete
    for (const [qid, payload] of [...dirty.current.entries()]) {
      await persist(qid, payload);
    }
    const json = await post(new URLSearchParams({ _action: "submit", attemptId }));
    if (json && json.ok && typeof json.redirect === "string") {
      window.location.assign(json.redirect);
      return;
    }
    if (json && json.error === "closed") {
      window.location.assign(`/exams/${examSlug}`);
      return;
    }
    submittingRef.current = false;
    setSubmitting(false);
    setSubmitError(true);
  }

  const answeredCount = questions.filter(isAnswered).length;
  const unanswered = questions.length - answeredCount;
  const lowTime = remaining !== null && remaining <= 60;

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert kind="warning">{t(locale, "exam.noQuestions")}</Alert>
        <Link to={`/exams/${examSlug}`} className="mt-4 inline-flex min-h-9 items-center gap-1 text-sm font-bold text-ink">
          <span aria-hidden="true" className="text-accent-600 rtl:rotate-180">←</span>
          <span className="sig-u">{t(locale, "exam.backToExams")}</span>
        </Link>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <Alert kind="warning">{t(locale, "exam.attemptLocked")}</Alert>
        <Link to={`/exams/${examSlug}`} className="inline-flex min-h-9 items-center gap-1 text-sm font-bold text-ink">
          <span aria-hidden="true" className="text-accent-600 rtl:rotate-180">←</span>
          <span className="sig-u">{t(locale, "exam.backToExams")}</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-white" data-attempt-id={attemptId}>
      {/* sticky header: exit · title · countdown · save state */}
      <header className="sticky top-0 z-10 border-b-2 border-brand-800 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <Link to={`/exams/${examSlug}`} className="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center text-sm font-bold text-ink-muted hover:text-ink" aria-label={t(locale, "exam.backToExams")}>
            ✕
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{title}</h1>
          {saveState === "saving" && <span className="shrink-0 text-xs font-semibold text-ink-muted">{t(locale, "exam.saving")}</span>}
          {saveState === "saved" && <span className="shrink-0 text-xs text-emerald-600">{t(locale, "exam.saved")}</span>}
          {saveState === "error" && <span className="shrink-0 text-xs text-red-600">{t(locale, "exam.saveError")}</span>}
          {remaining !== null && (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-xs font-bold ${
                lowTime ? "bg-red-100 text-red-700" : "bg-brand-800 text-white"
              }`}
              aria-label={t(locale, "exam.remaining")}
            >
              {lowTime && remaining <= 0 ? t(locale, "exam.timeUp") : fmtClock(remaining)}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">
        {submitError && (
          <div className="mb-3">
            <Alert kind="error">{t(locale, "exam.saveError")}</Alert>
          </div>
        )}

        {current && (
          <section className="rounded-[var(--radius-card)] border border-line bg-white p-4 sm:p-5" data-question-id={current.id}>
            <div className="mb-3 flex items-center justify-between text-xs font-semibold tabular-nums text-ink-muted">
              <span>{t(locale, "exam.questionPos").replace("{i}", String(idx + 1)).replace("{n}", String(questions.length))}</span>
              <span>{t(locale, "exam.points").replace("{n}", String(current.points))}</span>
            </div>
            <h2 className="mb-4 text-lg font-bold leading-relaxed text-ink">
              {locale === "ar" ? current.stemAr || current.stemEn : current.stemEn || current.stemAr}
            </h2>
            {current.type === "multi_select" && <p className="mb-2 text-xs text-amber-600">{t(locale, "exam.multiHint")}</p>}
            {current.type === "essay" && (
              <p className="mb-2 text-xs leading-relaxed text-ink-muted">{t(locale, "exam.essayHint")}</p>
            )}
            {current.type === "essay" ? (
              <div className="space-y-3">
                <textarea
                  data-essay-input
                  dir="auto"
                  value={texts[current.id] ?? ""}
                  onChange={(e) => updateText(e.target.value)}
                  disabled={submitting}
                  rows={6}
                  aria-label={t(locale, "exam.essayLabel")}
                  className="w-full resize-y rounded-[var(--radius-btn)] border border-line bg-white px-3.5 py-2.5 text-sm leading-relaxed focus:border-brand-800 focus:outline-none"
                />
                <div className="rounded-[var(--radius-btn)] border border-dashed border-line bg-slate-50/50 p-3">
                  <p className="mb-2 text-xs leading-relaxed text-ink-muted">{t(locale, "exam.essayUploadHint")}</p>
                  {files[current.id] ? (
                    <div className="flex flex-wrap items-center gap-2" data-essay-file>
                      <a
                        href={files[current.id].url}
                        target="_blank"
                        rel="noreferrer"
                        data-essay-file-link
                        className="inline-flex min-h-9 items-center rounded-[var(--radius-btn)] border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:border-brand-800"
                      >
                        {t(locale, "exam.viewSubmission")}
                      </a>
                      <span dir="ltr" className="max-w-[14rem] truncate text-xs text-ink-muted">{files[current.id].originalFilename}</span>
                      <button
                        type="button"
                        onClick={() => void removeEssayFile(current.id)}
                        disabled={fileBusy || submitting}
                        className="min-h-9 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {t(locale, "exam.removeFile")}
                      </button>
                    </div>
                  ) : (
                    <label className="inline-flex min-h-9 cursor-pointer items-center rounded-[var(--radius-btn)] border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:border-brand-800">
                      {fileBusy ? t(locale, "exam.uploading") : t(locale, "exam.uploadFile")}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                        className="sr-only"
                        disabled={fileBusy || submitting}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadEssayFile(current.id, f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  )}
                  {fileError && (
                    <p className="mt-2 text-xs text-red-600" data-file-error>
                      {fileErrorLabel(locale, fileError)}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2" role={current.type === "multi_select" ? "group" : "radiogroup"}>
                {current.choices.map((c) => {
                  const selected = (selections[current.id] ?? []).includes(c.id);
                  const content = locale === "ar" ? c.contentAr || c.contentEn : c.contentEn || c.contentAr;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      data-choice-id={c.id}
                      onClick={() => choose(c.id)}
                      disabled={submitting}
                      aria-pressed={selected}
                      className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-start text-sm transition ${
                        selected ? "border-brand-800 bg-slate-100 text-ink" : "border-line bg-white hover:border-brand-800"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                          current.type === "multi_select" ? "rounded" : "rounded-full"
                        } ${selected ? "border-brand-800 bg-brand-800" : "border-line bg-white"}`}
                      >
                        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="flex-1">{content}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* navigator */}
        <details className="mt-3 rounded-[var(--radius-card)] border border-line bg-white p-3">
          <summary className="cursor-pointer text-xs font-bold text-ink">
            {t(locale, "exam.navigatorTitle")} — {answeredCount}/{questions.length} {t(locale, "exam.answered")}
          </summary>
          <div className="mt-3 grid grid-cols-8 gap-1.5 sm:grid-cols-10">
            {questions.map((q, i) => {
              const answered = isAnswered(q);
              return (
                <button
                  key={q.id}
                  type="button"
                  data-nav-question-id={q.id}
                  onClick={() => setIdx(i)}
                  aria-current={i === idx}
                  className={`min-h-9 rounded-md border text-xs font-medium ${
                    i === idx
                      ? "border-brand-800 bg-brand-800 text-white"
                      : answered
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-line bg-white text-ink-muted"
                  }`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </details>
      </main>

      {/* sticky footer: prev/next + submit */}
      <footer className="sticky bottom-0 border-t-2 border-brand-800 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0 || submitting}
            aria-label={t(locale, "exam.prevQuestion")}
            className="min-h-11 rounded-[var(--radius-btn)] border border-line px-4 text-sm font-bold text-ink transition-colors hover:border-brand-800 disabled:opacity-40"
          >
            <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
          </button>
          <button
            type="button"
            onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
            disabled={idx >= questions.length - 1 || submitting}
            aria-label={t(locale, "exam.nextQuestion")}
            className="min-h-11 flex-1 rounded-[var(--radius-btn)] border border-line px-4 text-sm font-bold text-ink transition-colors hover:border-brand-800 disabled:opacity-40 sm:flex-none"
          >
            <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={submitting}
            className="min-h-11 flex-1 rounded-[var(--radius-btn)] bg-brand-700 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-800 disabled:opacity-50 sm:flex-none"
          >
            {submitting ? t(locale, "exam.saving") : t(locale, "exam.submit")}
          </button>
        </div>
      </footer>

      {/* submit confirmation */}
      <Modal
        open={confirmOpen && !submitting}
        onClose={() => setConfirmOpen(false)}
        title={t(locale, "exam.submitConfirmTitle")}
      >
        <p className="text-sm leading-relaxed text-ink-muted">{t(locale, "exam.submitConfirmBody")}</p>
        {unanswered > 0 && (
          <p className="mt-1 text-sm font-medium text-amber-600">
            {t(locale, "exam.submitUnanswered").replace("{n}", String(unanswered))}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="min-h-11 flex-1 rounded-[var(--radius-btn)] border border-line px-3 text-sm font-bold text-ink transition-colors hover:border-brand-800"
          >
            {t(locale, "exam.submitConfirmNo")}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmOpen(false);
              void doSubmit();
            }}
            className="min-h-11 flex-1 rounded-[var(--radius-btn)] bg-brand-700 px-3 text-sm font-bold text-white transition-colors hover:bg-brand-800"
          >
            {t(locale, "exam.submitConfirmYes")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
