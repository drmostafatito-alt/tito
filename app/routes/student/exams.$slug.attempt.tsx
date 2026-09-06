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

  return {
    examSlug: exam.slug,
    examTitleAr: exam.titleAr,
    examTitleEn: exam.titleEn,
    attemptId: live.id,
    attemptNumber: live.attemptNumber,
    questions: ctx.questions,
    answers: ctx.answers,
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

type SaveState = "idle" | "saving" | "saved" | "error";

export default function AttemptPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { examSlug, examTitleAr, examTitleEn, attemptId, questions, answers, remainingSeconds } = loaderData;
  const title = locale === "ar" ? examTitleAr : examTitleEn;

  const [idx, setIdx] = useState(0);
  const [selections, setSelections] = useState<Record<string, string[]>>(answers);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [remaining, setRemaining] = useState<number | null>(remainingSeconds);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [closed, setClosed] = useState(false);

  const dirty = useRef<Map<string, string[]>>(new Map());
  const saveSeq = useRef<Map<string, number>>(new Map());
  const submittingRef = useRef(false);

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
      for (const [qid, choiceIds] of dirty.current.entries()) {
        const body = new URLSearchParams({ _action: "save", attemptId, questionId: qid, choiceIds: choiceIds.join(",") });
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

  async function persist(questionId: string, choiceIds: string[]) {
    const seq = (saveSeq.current.get(questionId) ?? 0) + 1;
    saveSeq.current.set(questionId, seq);
    dirty.current.set(questionId, choiceIds);
    setSaveState("saving");
    const json = await post(new URLSearchParams({ _action: "save", attemptId, questionId, choiceIds: choiceIds.join(",") }));
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
    if (!current || closed || submittingRef.current) return;
    const prev = selections[current.id] ?? [];
    let next: string[];
    if (current.type === "multi_select") {
      next = prev.includes(choiceId) ? prev.filter((c) => c !== choiceId) : [...prev, choiceId];
    } else {
      next = prev.length === 1 && prev[0] === choiceId ? [] : [choiceId]; // click again to unselect
    }
    setSelections((s) => ({ ...s, [current.id]: next }));
    void persist(current.id, next);
  }

  async function doSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(false);
    // flush anything unsaved BEFORE submitting so the graded set is complete
    for (const [qid, choiceIds] of [...dirty.current.entries()]) {
      await persist(qid, choiceIds);
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

  const answeredCount = questions.filter((q) => (selections[q.id] ?? []).length > 0).length;
  const unanswered = questions.length - answeredCount;
  const lowTime = remaining !== null && remaining <= 60;

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert kind="warning">{t(locale, "exam.noQuestions")}</Alert>
        <Link to={`/exams/${examSlug}`} className="mt-4 inline-flex min-h-6 items-center text-sm text-blue-600 hover:underline">
          <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
          {t(locale, "exam.backToExams")}
        </Link>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <Alert kind="warning">{t(locale, "exam.attemptLocked")}</Alert>
        <Link to={`/exams/${examSlug}`} className="inline-flex min-h-6 items-center text-sm text-blue-600 hover:underline">
          <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
          {t(locale, "exam.backToExams")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50" data-attempt-id={attemptId}>
      {/* sticky header: exit · title · countdown · save state */}
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <Link to={`/exams/${examSlug}`} className="shrink-0 text-sm text-slate-500 hover:text-slate-800" aria-label={t(locale, "exam.backToExams")}>
            ✕
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
          {saveState === "saving" && <span className="shrink-0 text-xs text-slate-400">{t(locale, "exam.saving")}</span>}
          {saveState === "saved" && <span className="shrink-0 text-xs text-emerald-600">{t(locale, "exam.saved")}</span>}
          {saveState === "error" && <span className="shrink-0 text-xs text-red-600">{t(locale, "exam.saveError")}</span>}
          {remaining !== null && (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-xs font-bold ${
                lowTime ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"
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
          <section className="rounded-xl border bg-white p-4 shadow-sm" data-question-id={current.id}>
            <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
              <span>{t(locale, "exam.questionPos").replace("{i}", String(idx + 1)).replace("{n}", String(questions.length))}</span>
              <span>{t(locale, "exam.points").replace("{n}", String(current.points))}</span>
            </div>
            <h2 className="mb-4 text-base font-medium leading-relaxed">
              {locale === "ar" ? current.stemAr || current.stemEn : current.stemEn || current.stemAr}
            </h2>
            {current.type === "multi_select" && <p className="mb-2 text-xs text-amber-600">{t(locale, "exam.multiHint")}</p>}
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
                      selected ? "border-brand-500 bg-brand-50 text-brand-900" : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                        current.type === "multi_select" ? "rounded" : "rounded-full"
                      } ${selected ? "border-brand-600 bg-brand-600" : "border-slate-300 bg-white"}`}
                    >
                      {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="flex-1">{content}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* navigator */}
        <details className="mt-3 rounded-xl border bg-white p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-500">
            {t(locale, "exam.navigatorTitle")} — {answeredCount}/{questions.length} {t(locale, "exam.answered")}
          </summary>
          <div className="mt-3 grid grid-cols-8 gap-1.5 sm:grid-cols-10">
            {questions.map((q, i) => {
              const answered = (selections[q.id] ?? []).length > 0;
              return (
                <button
                  key={q.id}
                  type="button"
                  data-nav-question-id={q.id}
                  onClick={() => setIdx(i)}
                  aria-current={i === idx}
                  className={`min-h-9 rounded-md border text-xs font-medium ${
                    i === idx
                      ? "border-brand-600 bg-brand-600 text-white"
                      : answered
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500"
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
      <footer className="sticky bottom-0 border-t bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0 || submitting}
            aria-label={t(locale, "exam.prevQuestion")}
            className="min-h-11 rounded-lg border px-4 text-sm font-medium disabled:opacity-40"
          >
            <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
          </button>
          <button
            type="button"
            onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
            disabled={idx >= questions.length - 1 || submitting}
            aria-label={t(locale, "exam.nextQuestion")}
            className="min-h-11 flex-1 rounded-lg border px-4 text-sm font-medium disabled:opacity-40 sm:flex-none"
          >
            <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={submitting}
            className="min-h-11 flex-1 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 sm:flex-none"
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
        <p className="text-sm text-slate-600">{t(locale, "exam.submitConfirmBody")}</p>
        {unanswered > 0 && (
          <p className="mt-1 text-sm font-medium text-amber-600">
            {t(locale, "exam.submitUnanswered").replace("{n}", String(unanswered))}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium"
          >
            {t(locale, "exam.submitConfirmNo")}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmOpen(false);
              void doSubmit();
            }}
            className="min-h-11 flex-1 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            {t(locale, "exam.submitConfirmYes")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
