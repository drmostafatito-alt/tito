import type { Route } from "./+types/learn.$courseSlug.$lessonSlug";
import { Form, Link, useLoaderData, useRouteLoaderData, useRevalidator, useActionData } from "react-router";
import { redirect } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import {
  allLessonsForCourse,
  chainForLesson,
  courseBySlug,
  filesByIds,
  itemsForLesson,
  lessonBySlug,
  unitsForCourse,
  videosByIds,
} from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { courseProgress, lessonProgressMap, setLessonCompleted, videoProgressMap } from "~server/progress/service.server";
import { getSettings } from "~server/settings/service.server";
import { signFileUrl } from "~server/files/storage.server";
import { VideoPlayer } from "~/components/player/VideoPlayer";
import { Badge } from "~/components/ui/Badge";
import { SubmitButton } from "~/components/ui/Button";
import { ProgressBar } from "~/components/ProgressBar";
import { Card, CardBody } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

/**
 * Lesson page: ordered items, access-aware rendering. The resolver verdict
 * decides everything the page shows; file URLs are minted server-side only
 * when allowed; video credentials are fetched per-view by the player.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const course = await courseBySlug(db, params.courseSlug);
  if (!course) throw new Response("Not Found", { status: 404 });
  const lesson = await lessonBySlug(db, params.lessonSlug);
  if (!lesson) throw new Response("Not Found", { status: 404 });
  const courseLessons = await allLessonsForCourse(db, course.id);
  if (!courseLessons.some((l) => l.id === lesson.id)) throw new Response("Not Found", { status: 404 });

  const { auth } = await resolveAuth(db, env, request);
  const subject = { userId: auth?.user.id ?? null, roleRank: auth?.user.rank ?? 0 };
  const chain = await chainForLesson(db, lesson.id);
  if (!chain) throw new Response("Not Found", { status: 404 });
  const verdict = await resolveContentAccess(db, subject, chain);

  if (!verdict.allowed && verdict.reason === "anon") {
    throw redirect(`/login?next=${encodeURIComponent(`/learn/${params.courseSlug}/${params.lessonSlug}`)}`);
  }

  const unitRows = await unitsForCourse(db, course.id);
  const unit = unitRows.find((u) => u.id === lesson.unitId);
  const settings = await getSettings(db);
  const items = await itemsForLesson(db, lesson.id);

  // sibling navigation (previous/next within course order)
  const idx = courseLessons.findIndex((l) => l.id === lesson.id);
  const prev = idx > 0 ? courseLessons[idx - 1] : null;
  const next = idx >= 0 && idx < courseLessons.length - 1 ? courseLessons[idx + 1] : null;

  const videoRows = await videosByIds(db, items.filter((i) => i.itemType === "video" && i.videoId).map((i) => i.videoId!));
  const fileRows = await filesByIds(db, items.filter((i) => i.itemType === "file" && i.fileId).map((i) => i.fileId!));

  const renderedItems = await Promise.all(
    items.map(async (item) => {
      if (item.itemType === "video" && item.videoId) {
        const v = videoRows.get(item.videoId);
        return {
          key: item.id,
          kind: "video" as const,
          required: item.required,
          videoId: item.videoId,
          status: v?.status ?? "pending",
          durationSeconds: v?.durationSeconds ?? null,
        };
      }
      if (item.itemType === "file" && item.fileId) {
        const f = fileRows.get(item.fileId);
        let viewUrl: string | null = null;
        let downloadUrl: string | null = null;
        if (verdict.allowed && f) {
          const ttl = settings.video.fileUrlTtlSeconds;
          viewUrl = (await signFileUrl(env, f.id, "view", ttl)).path;
          downloadUrl = f.downloadAllowed ? (await signFileUrl(env, f.id, "download", ttl)).path : null;
        }
        return {
          key: item.id,
          kind: "file" as const,
          required: item.required,
          fileId: item.fileId,
          filename: f?.originalFilename ?? "—",
          kindOf: f?.kind ?? "doc",
          byteSize: f?.byteSize ?? 0,
          visibility: f?.visibility ?? "private",
          viewUrl,
          downloadUrl,
        };
      }
      return { key: item.id, kind: "exam" as const, required: item.required, examId: item.examId };
    })
  );

  // Phase 4: progress (server is the source of truth) — only for signed-in viewers with access
  let progress: {
    lesson: { status: "in_progress" | "completed"; completedAt: number | null } | null;
    videos: Record<string, { positionSeconds: number; completed: boolean }>;
    course: { total: number; completed: number; pct: number };
  } | null = null;
  if (auth && verdict.allowed) {
    const videoIds = items.filter((i) => i.itemType === "video" && i.videoId).map((i) => i.videoId!);
    const [lpMap, vpMap, cProg] = await Promise.all([
      lessonProgressMap(db, auth.user.id, [lesson.id]),
      videoProgressMap(db, auth.user.id, videoIds),
      courseProgress(db, auth.user.id, course.id),
    ]);
    const lp = lpMap.get(lesson.id);
    progress = {
      lesson: lp ? { status: lp.status, completedAt: lp.completedAt } : null,
      videos: Object.fromEntries([...vpMap].map(([vid, r]) => [vid, { positionSeconds: r.positionSeconds, completed: r.completed }])),
      course: { total: cProg.total, completed: cProg.completed, pct: cProg.pct },
    };
  }

  return {
    progress,
    lessonId: lesson.id,
    course: { slug: course.slug, titleAr: course.titleAr, titleEn: course.titleEn },
    unit: unit ? { titleAr: unit.titleAr, titleEn: unit.titleEn } : null,
    lesson: {
      slug: lesson.slug,
      titleAr: lesson.titleAr,
      titleEn: lesson.titleEn,
      descriptionAr: lesson.descriptionAr,
      descriptionEn: lesson.descriptionEn,
      freePreview: lesson.freePreview,
    },
    verdict,
    items: renderedItems,
    prev: prev ? { slug: prev.slug, titleAr: prev.titleAr, titleEn: prev.titleEn } : null,
    next: next ? { slug: next.slug, titleAr: next.titleAr, titleEn: next.titleEn } : null,
    pres: settings.presentation.lesson,
  };
}

/** Student self-report: mark the lesson complete / not complete (entitlement re-checked). */
export async function action({ context, params, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const { auth } = await resolveAuth(db, env, request);
  if (!auth) throw new Response("Unauthorized", { status: 401 });
  const course = await courseBySlug(db, params.courseSlug);
  if (!course) throw new Response("Not Found", { status: 404 });
  const lesson = await lessonBySlug(db, params.lessonSlug);
  if (!lesson) throw new Response("Not Found", { status: 404 });
  const chain = await chainForLesson(db, lesson.id);
  if (!chain) throw new Response("Not Found", { status: 404 });
  const verdict = await resolveContentAccess(db, { userId: auth.user.id, roleRank: auth.user.rank }, chain);
  if (!verdict.allowed) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  if (String(form.get("_action") ?? "") !== "toggle-complete") throw new Response("Bad Request", { status: 400 });
  const completed = String(form.get("completed") ?? "") === "1";
  await setLessonCompleted(db, auth.user.id, lesson.id, completed);
  return { ok: true as const, completed };
}

export default function LessonPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { course, unit, lesson, verdict, items, prev, next, pres, progress, lessonId } = loaderData;
  const revalidator = useRevalidator();
  const actionData = useActionData<typeof action>();
  const title = locale === "ar" ? lesson.titleAr : lesson.titleEn;
  const lessonCompleted = actionData?.completed ?? (progress?.lesson?.status === "completed" || false);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <nav className="mb-2 flex items-center gap-1 text-sm text-slate-500">
        <Link to={`/courses/${course.slug}`} className="hover:underline">
          {locale === "ar" ? course.titleAr : course.titleEn}
        </Link>
        {unit && <span> / {locale === "ar" ? unit.titleAr : unit.titleEn}</span>}
      </nav>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        {lesson.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
        {progress && lessonCompleted && <Badge tone="success">{t(locale, "progress.completed")}</Badge>}
        {progress && !lessonCompleted && progress.lesson && <Badge tone="warning">{t(locale, "progress.inProgress")}</Badge>}
      </div>
      {progress && progress.course.total > 0 && (
        <div className="mb-4" aria-label={t(locale, "progress.courseProgress")}>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>{t(locale, "progress.courseProgress")}</span>
            <span dir="ltr">{progress.course.completed}/{progress.course.total} · {progress.course.pct}%</span>
          </div>
          <ProgressBar pct={progress.course.pct} label={t(locale, "progress.courseProgress")} />
        </div>
      )}
      {pres.showDescription && (locale === "ar" ? lesson.descriptionAr : lesson.descriptionEn) && (
        <p className="mb-6 text-slate-600">{locale === "ar" ? lesson.descriptionAr : lesson.descriptionEn}</p>
      )}

      {!verdict.allowed ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">{t(locale, "content.locked")}</p>
            <Link to={`/courses/${course.slug}`} className="mt-2 inline-block text-sm text-blue-600 hover:underline">
              {t(locale, "common.back")}
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            if (item.kind === "video") {
              return item.status === "ready" ? (
                <VideoPlayer
                  key={item.key}
                  videoId={item.videoId}
                  lessonId={lessonId}
                  title={pres.video.showTitle ? t(locale, "content.videoItem") : undefined}
                  showPoster={pres.video.showPoster}
                  allowFullscreen={pres.video.allowFullscreen}
                  allowSpeed={pres.video.allowSpeed}
                  startAt={progress?.videos[item.videoId]?.positionSeconds ?? 0}
                  onLessonCompleted={() => revalidator.revalidate()}
                />
              ) : (
                <Card key={item.key}>
                  <CardBody className="text-sm text-slate-500">
                    {t(locale, "content.videoItem")} — {t(locale, `videosAdmin.statusPending`)}…
                  </CardBody>
                </Card>
              );
            }
            if (item.kind === "file") {
              if (!pres.showAttachments) return null;
              return (
                <Card key={item.key}>
                  <CardBody className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">📄 {item.filename}</p>
                      <p className="text-xs text-slate-400">
                        {Math.max(1, Math.round(item.byteSize / 1024))} KB · {item.required ? t(locale, "content.required") : t(locale, "content.optional")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      {item.viewUrl && (
                        <a href={item.viewUrl} target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                          {t(locale, "content.view")}
                        </a>
                      )}
                      {item.downloadUrl && (
                        <a href={item.downloadUrl} className="text-blue-600 hover:underline">
                          {t(locale, "content.download")}
                        </a>
                      )}
                    </div>
                  </CardBody>
                </Card>
              );
            }
            return (
              <Card key={item.key}>
                <CardBody className="text-sm text-slate-500">
                  {t(locale, "content.examItem")} — {t(locale, "content.examNotReady")}
                </CardBody>
              </Card>
            );
          })}
          {items.length === 0 && <p className="text-sm text-slate-400">—</p>}
          <Form method="post" className="pt-2" data-lesson-id={lessonId}>
            <input type="hidden" name="_action" value="toggle-complete" />
            <input type="hidden" name="completed" value={lessonCompleted ? "0" : "1"} />
            <SubmitButton variant={lessonCompleted ? "secondary" : "primary"} className="min-h-11">
              {lessonCompleted ? t(locale, "progress.markIncomplete") : t(locale, "progress.markComplete")}
            </SubmitButton>
          </Form>
        </div>
      )}

      {pres.showPrevNext && (
      <nav className="mt-8 flex justify-between text-sm">
        {prev ? (
          <Link to={`/learn/${course.slug}/${prev.slug}`} className="text-blue-600 hover:underline">
            ← {locale === "ar" ? prev.titleAr : prev.titleEn}
          </Link>
        ) : (
          <span />
        )}
        {next && verdict.allowed && (
          <Link to={`/learn/${course.slug}/${next.slug}`} className="text-blue-600 hover:underline">
            {locale === "ar" ? next.titleAr : next.titleEn} →
          </Link>
        )}
      </nav>
      )}
    </div>
  );
}
