import type { Route } from "./+types/api.exam-attempt";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  examAccess,
  expireAttemptIfNeeded,
  getExam,
  getOwnedAttempt,
  parseExamConfig,
  resultsVisible,
  saveAnswer,
  submitAttempt,
} from "~server/assessment/service.server";

/**
 * Exam attempt mutation endpoint — a RESOURCE route (no component), same
 * discipline as beacons.progress / api.playback: plain fetch + sendBeacon get
 * the action's JSON response verbatim (a UI-route action would be swallowed by
 * document-mode revalidation).
 *
 * Body (form-encoded, so sendBeacon works):
 *   _action=save   attemptId, questionId, choiceIds (comma-separated)
 *   _action=submit attemptId
 *
 * Security: ownership is checked via getOwnedAttempt(attemptId, auth.user.id)
 * (IDOR → 404), exam access via the entitlement resolver (→ 403), and every
 * touch runs the expiry sweep first (server-authoritative timing).
 */
export async function action({ context, request }: Route.ActionArgs) {
  if (request.method !== "POST") throw new Response("Method Not Allowed", { status: 405 });
  const { auth, settings } = await requireUser(context, request);
  const db = getDb(getEnv(context));

  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const attemptId = String(form.get("attemptId") ?? "");

  let attempt = await getOwnedAttempt(db, attemptId, auth.user.id); // IDOR guard
  if (!attempt) return Response.json({ error: "not_found" }, { status: 404 });

  const exam = await getExam(db, attempt.examId);
  if (!exam || (exam.status !== "published" && auth.user.rank < 3)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const access = await examAccess(db, { userId: auth.user.id, roleRank: auth.user.rank }, exam);
  if (!access.allowed) throw new Response("Forbidden", { status: 403 });

  // touch-sweep: a past-deadline attempt is auto-submitted before any mutation
  await expireAttemptIfNeeded(db, {
    examId: exam.id,
    studentId: auth.user.id,
    graceSeconds: settings.assessment.graceSeconds,
    nowMs: Date.now(),
    videoThresholdPct: settings.video.completionThresholdPct,
  });
  attempt = (await getOwnedAttempt(db, attemptId, auth.user.id))!;

  if (intent === "save") {
    if (attempt.status !== "in_progress") return Response.json({ error: "closed" });
    const questionId = String(form.get("questionId") ?? "");
    const raw = String(form.get("choiceIds") ?? "");
    const choiceIds = raw ? raw.split(",").filter(Boolean) : [];
    const res = await saveAnswer(db, { attempt, questionId, choiceIds, nowMs: Date.now() });
    if (!res.ok) return Response.json({ error: res.error });
    return Response.json({ ok: true, version: res.version });
  }

  if (intent === "submit") {
    const result = await submitAttempt(db, {
      attempt,
      graceSeconds: settings.assessment.graceSeconds,
      nowMs: Date.now(),
      videoThresholdPct: settings.video.completionThresholdPct,
    });
    if (result.expired) {
      return Response.json({ ok: true, redirect: `/exams/${exam.slug}?expired=1`, expired: true });
    }
    const config = parseExamConfig(exam.config);
    const fresh = (await getOwnedAttempt(db, attemptId, auth.user.id))!;
    const visible = resultsVisible(config, fresh, Date.now());
    return Response.json({
      ok: true,
      redirect: visible ? `/results/${attemptId}` : `/exams/${exam.slug}`,
    });
  }

  return Response.json({ error: "bad_intent" }, { status: 400 });
}
