import type { Route } from "./+types/api.exam-attempt";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { checkRateLimit } from "~server/http/rate-limit.server";
import {
  clearEssayAnswerFile,
  examAccess,
  expireAttemptIfNeeded,
  getExam,
  getOwnedAttempt,
  parseExamConfig,
  resultsVisible,
  saveAnswer,
  setEssayAnswerFile,
  submitAttempt,
} from "~server/assessment/service.server";
import {
  buildR2Key,
  deleteFile,
  detectKind,
  insertFile,
  sha256HexOf,
  signFileUrl,
  sizeCapFor,
} from "~server/files/storage.server";

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
  const env = getEnv(context);
  const db = getDb(env);

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

    // Abuse control (H1, Phase 8): autosave is client-debounced (3s) but the
    // server enforces its own cap. Keyed on the authenticated user only (placed
    // AFTER ownership + access checks — never an enumeration oracle).
    const saveRl = await checkRateLimit(db, "exam_save", auth.user.id, 60, 60_000);
    if (!saveRl.ok) {
      return Response.json({ error: "rate_limited", retryAfterMs: saveRl.retryAfterMs }, { status: 429 });
    }

    const questionId = String(form.get("questionId") ?? "");
    const raw = String(form.get("choiceIds") ?? "");
    const choiceIds = raw ? raw.split(",").filter(Boolean) : [];
    // Written (essay) answers are transported as a `text` field (form-encoded so
    // sendBeacon works); objective answers send choiceIds only.
    const textRaw = form.get("text");
    const text = typeof textRaw === "string" ? textRaw : null;
    const res = await saveAnswer(db, { attempt, questionId, choiceIds, text, nowMs: Date.now() });
    if (!res.ok) return Response.json({ error: res.error });
    return Response.json({ ok: true, version: res.version });
  }

  if (intent === "upload") {
    // Essay handwritten-work upload: multipart. Validated server-side (MIME +
    // size), stored to PRIVATE_FILES via the existing file registry, and
    // associated with the (attempt, essay-question). Authorized because this
    // route already proved ownership + entitlement; the returned URL is signed.
    if (attempt.status !== "in_progress") return Response.json({ error: "closed" });
    const uploadRl = await checkRateLimit(db, "exam_upload", `${auth.user.id}:${attempt.id}`, 20, 60_000);
    if (!uploadRl.ok) {
      return Response.json({ error: "rate_limited", retryAfterMs: uploadRl.retryAfterMs }, { status: 429 });
    }

    const questionId = String(form.get("questionId") ?? "");
    const raw = form.get("file");
    const file = raw instanceof File ? raw : null;
    if (!file || file.size === 0) return Response.json({ error: "no_file" }, { status: 400 });
    const mime = file.type || "application/octet-stream";
    const kind = detectKind(mime);
    // handwritten solutions: images or a PDF scan only
    if (!kind || (kind !== "image" && kind !== "pdf")) {
      return Response.json({ error: "invalid_type" }, { status: 400 });
    }
    if (file.size > sizeCapFor(kind)) {
      return Response.json({ error: "too_large" }, { status: 413 });
    }

    const buf = await file.arrayBuffer();
    const checksum = await sha256HexOf(buf);
    const r2Key = buildR2Key(kind, file.name, "private");
    await env.PRIVATE_FILES.put(r2Key, buf, { httpMetadata: { contentType: mime } });
    let fileId: string | undefined;
    try {
      fileId = await insertFile(db, {
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
      const attach = await setEssayAnswerFile(db, { attemptId: attempt.id, questionId, fileId, nowMs: Date.now() });
      if (attach.priorFileId && attach.priorFileId !== fileId) await deleteFile(db, env, attach.priorFileId);
    } catch (err) {
      // never leave an orphaned private object if association fails
      if (fileId) await deleteFile(db, env, fileId).catch(() => undefined);
      else await env.PRIVATE_FILES.delete(r2Key).catch(() => undefined);
      throw err;
    }
    if (!fileId) throw new Response("Internal Server Error", { status: 500 });

    const ttl = settings.video.fileUrlTtlSeconds;
    const signed = await signFileUrl(env, fileId, "view", ttl);
    return Response.json({ ok: true, fileId, url: signed.path, originalFilename: file.name.slice(0, 200), mime, byteSize: file.size });
  }

  if (intent === "clear-file") {
    if (attempt.status !== "in_progress") return Response.json({ error: "closed" });
    const questionId = String(form.get("questionId") ?? "");
    const res = await clearEssayAnswerFile(db, { attemptId: attempt.id, questionId, nowMs: Date.now() });
    if (res.ok && res.priorFileId) await deleteFile(db, env, res.priorFileId);
    return Response.json({ ok: true });
  }

  if (intent === "submit") {
    // Abuse control (H1, Phase 8): submission is idempotent but a tight cap
    // bounds burst retries. After ownership + access checks, never an oracle.
    const submitRl = await checkRateLimit(db, "exam_submit", `${auth.user.id}:${attemptId}`, 10, 60_000);
    if (!submitRl.ok) {
      return Response.json({ error: "rate_limited", retryAfterMs: submitRl.retryAfterMs }, { status: 429 });
    }

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
