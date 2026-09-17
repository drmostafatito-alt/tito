import type { Route } from "./+types/learn.$courseSlug.$lessonSlug";
import { Form, Link, useLoaderData, useRouteLoaderData, useRevalidator, useActionData } from "react-router";
import { redirect } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import {
  academicYearById,
  allLessonsForCourse,
  chainForLesson,
  courseBySlug,
  coursePrereqGate,
  filesByIds,
  itemsForLesson,
  lessonBySlug,
  subjectById,
  termById,
  unitsForCourse,
  videosByIds,
} from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { purchasableFor } from "~server/commerce/service.server";
import { formatMoney } from "~server/commerce/money";
import { courseProgress, lessonProgressMap, setLessonCompleted, videoProgressMap } from "~server/progress/service.server";
import { getSettings } from "~server/settings/service.server";
import { signFileUrl } from "~server/files/storage.server";
import { VideoPlayer } from "~/components/player/VideoPlayer";
import { Badge } from "~/components/ui/Badge";
import { SubmitButton } from "~/components/ui/Button";
import { ProgressBar } from "~/components/ProgressBar";
import { Card, CardBody } from "~/components/ui/Card";
import { ThinkerPortrait } from "~/components/visuals/ThinkerPortrait";
import { pubBtn } from "~/lib/publicStyles";
import { thinkerFor } from "~/lib/thinkers";
import { t, type Locale } from "~/lib/i18n";
import { contentSeoMeta, rootMetaFrom } from "~/cms/seo";

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

  // Prerequisite gate (Phase E): a signed-in student must have completed every live
  // transitive prerequisite course before content opens. Send gated students back
  // to the course page, which explains the missing prerequisites. Staff bypass.
  if (auth && auth.user.rank <= 1) {
    const lock = await coursePrereqGate(db, { userId: auth.user.id, roleRank: auth.user.rank }, course.id);
    if (lock.locked) throw redirect(`/courses/${course.slug}`);
  }

  const unitRows = await unitsForCourse(db, course.id);
  const unit = unitRows.find((u) => u.id === lesson.unitId);
  const settings = await getSettings(db);

  // Study context (المادة / الترم / السنة الدراسية) for breadcrumbs + the locked CTA.
  const [studySubject, studyTerm, studyYear] = await Promise.all([
    subjectById(db, course.subjectId),
    course.termId ? termById(db, course.termId) : Promise.resolve(null),
    course.academicYearId ? academicYearById(db, course.academicYearId) : Promise.resolve(null),
  ]);
  const offer = verdict.allowed
    ? null
    : await purchasableFor(db, { type: "course", id: course.id, subjectId: course.subjectId });

  const lessonItemsAll = await itemsForLesson(db, lesson.id);
  // Legacy internal-exam items were retired together with the question bank
  // (exams live on a standalone external platform now). Their rows are retained
  // in the DB, but they are never rendered, so a lesson cannot link to a dead
  // /exams route. Video/file/link items are unaffected.
  const items = lessonItemsAll.filter((i) => i.itemType !== "exam");

  // sibling navigation (previous/next within course order)
  const idx = courseLessons.findIndex((l) => l.id === lesson.id);
  const prev = idx > 0 ? courseLessons[idx - 1] : null;
  const next = idx >= 0 && idx < courseLessons.length - 1 ? courseLessons[idx + 1] : null;

  const videoRows = await videosByIds(db, items.filter((i) => i.itemType === "video" && i.videoId).map((i) => i.videoId!));
  const fileRows = await filesByIds(db, items.filter((i) => i.itemType === "file" && i.fileId).map((i) => i.fileId!));

  const renderedItems = (
    await Promise.all(
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
      if (item.itemType === "link" && item.linkUrl) {
        return {
          key: item.id,
          kind: "link" as const,
          required: item.required,
          // linkUrl is the canonical Google Forms embed URL, rebuilt server-side
          // from a validated form id at save time — never the owner's raw paste.
          embedUrl: item.linkUrl,
          openUrl: item.linkUrl.replace(/[?&]embedded=true$/, ""),
          titleAr: item.titleAr,
          titleEn: item.titleEn,
          descriptionAr: item.descriptionAr,
          descriptionEn: item.descriptionEn,
        };
      }
        return null;
      })
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);

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
    url: request.url,
    course: { slug: course.slug, titleAr: course.titleAr, titleEn: course.titleEn },
    // Study context: the student-facing labels (مادة / ترم / سنة) + the real
    // subscription offer for this scope, so a locked lesson can point somewhere
    // useful instead of a dead end. Nothing here is invented: `offer` is null
    // unless the admin published a product with a real price for this scope.
    study: {
      subjectSlug: studySubject?.slug ?? null,
      subjectTitleAr: studySubject?.titleAr ?? null,
      subjectTitleEn: studySubject?.titleEn ?? null,
      termTitleAr: studyTerm?.titleAr ?? course.titleAr,
      termTitleEn: studyTerm?.titleEn ?? course.titleEn,
      yearTitleAr: studyYear?.titleAr ?? null,
      yearTitleEn: studyYear?.titleEn ?? null,
      offer,
    },
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
  if (!chain || chain.courseId !== course.id) throw new Response("Not Found", { status: 404 });
  if (auth.user.rank <= 1) {
    const lock = await coursePrereqGate(db, { userId: auth.user.id, roleRank: auth.user.rank }, course.id);
    if (lock.locked) throw new Response("Forbidden", { status: 403 });
  }
  const verdict = await resolveContentAccess(db, { userId: auth.user.id, roleRank: auth.user.rank }, chain);
  if (!verdict.allowed) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  if (String(form.get("_action") ?? "") !== "toggle-complete") throw new Response("Bad Request", { status: 400 });
  const completed = String(form.get("completed") ?? "") === "1";
  await setLessonCompleted(db, auth.user.id, lesson.id, completed);
  return { ok: true as const, completed };
}

/**
 * Lesson pages are gated + per-user (progress badges, resume points, signed
 * media URLs) ⇒ NOINDEX. A unique branded title + canonical still render so a
 * shared lesson URL previews well and never accumulates a duplicate brand title.
 * The public "lesson discovery" surface is the course page (which lists lessons
 * and IS indexable).
 */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [];
  const root = rootMetaFrom(matches);
  return contentSeoMeta(
    {
      title: { ar: loaderData.lesson.titleAr, en: loaderData.lesson.titleEn },
      description: { ar: loaderData.lesson.descriptionAr, en: loaderData.lesson.descriptionEn },
    },
    root.locale,
    loaderData.url as string,
    {
      intermediate: { ar: loaderData.course.titleAr, en: loaderData.course.titleEn },
      siteName: root.siteName,
      robots: "noindex,follow",
    },
  );
}

export default function LessonPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { course, unit, lesson, verdict, items, prev, next, pres, progress, lessonId, study } = loaderData;
  const revalidator = useRevalidator();
  const actionData = useActionData<typeof action>();
  const title = locale === "ar" ? lesson.titleAr : lesson.titleEn;
  const lessonCompleted = actionData?.completed ?? (progress?.lesson?.status === "completed" || false);
  const thinker = thinkerFor({
    slot: verdict.allowed ? "lesson-page" : "lesson-locked",
    slug: study.subjectSlug ?? course.slug,
    titleAr: study.subjectTitleAr,
    titleEn: study.subjectTitleEn,
  });
  const backHref = study.subjectSlug ? `/study/${study.subjectSlug}` : "/study";

  return (
    <main className="pub-root relative isolate mx-auto w-full max-w-[56rem] overflow-x-hidden px-[var(--pub-pad-x)] py-[var(--pub-pad-y)]">
      <ThinkerPortrait thinker={thinker} intensity="whisper" />
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-pub-sm text-pub-muted" aria-label={t(locale, "common.breadcrumb")} data-allow-small>
        <Link to="/study" className="hover:underline">{t(locale, "study.title")}</Link>
        {study.subjectSlug && (
          <>
            <span aria-hidden="true"> / </span>
            <Link to={`/study/${study.subjectSlug}`} className="hover:underline">
              {locale === "ar" ? study.subjectTitleAr || study.subjectTitleEn : study.subjectTitleEn || study.subjectTitleAr}
            </Link>
          </>
        )}
        <span aria-hidden="true"> / </span>
        {/* the term container, labelled with the TERM name — never "كورس" */}
        <span>{locale === "ar" ? study.termTitleAr : study.termTitleEn}</span>
        {unit && <span> / {locale === "ar" ? unit.titleAr : unit.titleEn}</span>}
      </nav>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-pub-h3 font-extrabold tracking-tight text-pub-ink">{title}</h1>
        {lesson.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
        {progress && lessonCompleted && <Badge tone="success">{t(locale, "progress.completed")}</Badge>}
        {progress && !lessonCompleted && progress.lesson && <Badge tone="warning">{t(locale, "progress.inProgress")}</Badge>}
      </div>
      {progress && progress.course.total > 0 && (
        <div className="mb-4" aria-label={t(locale, "progress.courseProgress")}>
          <div className="mb-1 flex items-center justify-between text-pub-xs text-pub-muted">
            <span>{t(locale, "progress.courseProgress")}</span>
            <span dir="ltr">{progress.course.completed}/{progress.course.total} · {progress.course.pct}%</span>
          </div>
          <ProgressBar pct={progress.course.pct} label={t(locale, "progress.courseProgress")} />
        </div>
      )}
      {pres.showDescription && (locale === "ar" ? lesson.descriptionAr : lesson.descriptionEn) && (
        <p className="mb-6 text-pub-muted">{locale === "ar" ? lesson.descriptionAr : lesson.descriptionEn}</p>
      )}

      {!verdict.allowed ? (
        <Card data-testid="lesson-locked" className="relative isolate overflow-hidden border-pub-line">
          <ThinkerPortrait
            thinker={thinkerFor({ slot: "lesson-locked", slug: study.subjectSlug ?? "locked" })}
            presentation="avatar"
            className="absolute end-4 top-4 h-10 w-10"
          />
          <CardBody className="relative z-10 space-y-3">
            <div className="flex items-center gap-2">
              <span aria-hidden="true">🔒</span>
              <h2 className="text-pub-base font-semibold text-pub-ink">{t(locale, "content.lockedTitle")}</h2>
            </div>
            <p className="text-pub-sm text-pub-muted">{t(locale, "content.lockedBody")}</p>
            {/* The scope this lesson belongs to, so the student knows exactly what
                they would be subscribing to (year · subject · term). */}
            <p className="text-pub-xs text-pub-muted" data-testid="lesson-locked-scope">
              {[
                study.yearTitleAr || study.yearTitleEn
                  ? `${t(locale, "commerce.scopeYear")}: ${locale === "ar" ? study.yearTitleAr || study.yearTitleEn : study.yearTitleEn || study.yearTitleAr}`
                  : null,
                study.subjectTitleAr || study.subjectTitleEn
                  ? `${t(locale, "commerce.scopeSubject")}: ${locale === "ar" ? study.subjectTitleAr || study.subjectTitleEn : study.subjectTitleEn || study.subjectTitleAr}`
                  : null,
                `${t(locale, "commerce.scopeTerm")}: ${locale === "ar" ? study.termTitleAr : study.termTitleEn}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {study.offer ? (
                <Link
                  to={`/checkout/${study.offer.productSlug}`}
                  className={pubBtn("gold", "pill", "px-5 py-2")}
                  data-testid="lesson-subscribe-cta"
                >
                  {t(locale, "content.lockedSubscribe")}
                  <span dir="ltr" className="ms-2 text-pub-xs">
                    {formatMoney(study.offer.minPriceMinor, study.offer.currency)}
                  </span>
                </Link>
              ) : (
                <span className="text-pub-sm text-pub-muted" data-testid="lesson-no-offer">
                  {t(locale, "content.lockedNoOffer")}
                </span>
              )}
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-pub-sm text-pub-muted">{t(locale, "content.lockedActivateHint")}</p>
              <Link
                to="/activate"
                className="mt-2 inline-flex min-h-11 items-center rounded-pub-pill border border-slate-300 px-4 py-2 text-pub-sm font-semibold text-pub-muted hover:bg-pub-surface"
                data-testid="lesson-activate-cta"
              >
                {t(locale, "content.lockedActivate")}
              </Link>
            </div>
            <Link to={`/courses/${course.slug}`} className="mt-2 inline-block text-pub-sm text-blue-600 hover:underline">
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
                  <CardBody className="text-pub-sm text-pub-muted">
                    {t(locale, "content.videoItem")} — {t(locale, `videosAdmin.statusPending`)}…
                  </CardBody>
                </Card>
              );
            }
            if (item.kind === "link") {
              const title = (locale === "ar" ? item.titleAr : item.titleEn)
                ?? (locale === "ar" ? item.titleEn : item.titleAr)
                ?? t(locale, "content.linkItem");
              const desc = (locale === "ar" ? item.descriptionAr : item.descriptionEn)
                ?? (locale === "ar" ? item.descriptionEn : item.descriptionAr);
              return (
                <Card key={item.key}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-pub-sm font-semibold text-pub-ink">{title}</h3>
                      {item.required && (
                        <span className="text-pub-xs text-pub-muted">{t(locale, "content.required")}</span>
                      )}
                    </div>
                    {desc && <p className="text-pub-sm text-pub-muted">{desc}</p>}
                    {/* Google Forms sets its own X-Frame-Options for /viewform with
                        ?embedded=true, so the iframe is the supported path. The
                        external link is always offered as well, so the quiz is
                        reachable even where embedding is blocked. */}
                    <div className="overflow-hidden rounded-pub-md border border-pub-line" data-testid="external-quiz">
                      <iframe
                        src={item.embedUrl}
                        title={title}
                        className="h-[600px] w-full border-0"
                        loading="lazy"
                        referrerPolicy="strict-origin-when-cross-origin"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      />
                    </div>
                    <a
                      href={item.openUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex min-h-11 items-center gap-1 text-pub-sm font-medium text-pub-ink-soft underline decoration-pub-accent underline-offset-4 hover:text-pub-accent-strong"
                      data-testid="external-quiz-open"
                    >
                      {t(locale, "content.linkOpen")} ↗
                    </a>
                  </CardBody>
                </Card>
              );
            }
            if (item.kind === "file") {
              if (!pres.showAttachments) return null;
              const isPdf = item.kindOf === "pdf";
              return (
                <Card key={item.key} className="overflow-hidden border-pub-line">
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-pub-ink">{isPdf ? t(locale, "content.pdfItem") : t(locale, "content.fileItem")} · {item.filename}</p>
                        <p className="text-pub-xs text-pub-muted">
                          {Math.max(1, Math.round(item.byteSize / 1024))} KB · {item.required ? t(locale, "content.required") : t(locale, "content.optional")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-pub-sm">
                        {item.viewUrl && (
                          <a href={item.viewUrl} target="_blank" rel="noopener" className="font-medium text-navy-700 hover:underline">
                            {t(locale, "content.view")}
                          </a>
                        )}
                        {item.downloadUrl && (
                          <a href={item.downloadUrl} className="font-medium text-navy-700 hover:underline">
                            {t(locale, "content.download")}
                          </a>
                        )}
                      </div>
                    </div>
                    {isPdf && item.viewUrl && (
                      <div className="overflow-hidden rounded-pub-md border border-pub-line bg-navy-50">
                        <iframe
                          src={item.viewUrl}
                          title={item.filename}
                          className="h-[min(70vh,32rem)] w-full border-0"
                          loading="lazy"
                        />
                      </div>
                    )}
                  </CardBody>
                </Card>
              );
            }
            // Legacy internal-exam items are filtered out server-side (the
            // questions/exams platform is now an external standalone product).
            return null;
          })}
          {items.length === 0 && <p className="text-pub-sm text-pub-muted">—</p>}
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
      <nav className="mt-8 flex justify-between text-pub-sm" aria-label={t(locale, "common.prevNext")}>
        {prev ? (
          <Link to={`/learn/${course.slug}/${prev.slug}`} className="inline-flex min-h-6 items-center text-blue-600 hover:underline">
            <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span>
            {locale === "ar" ? prev.titleAr : prev.titleEn}
          </Link>
        ) : (
          <span />
        )}
        {next && verdict.allowed && (
          <Link to={`/learn/${course.slug}/${next.slug}`} className="inline-flex min-h-6 items-center text-blue-600 hover:underline">
            {locale === "ar" ? next.titleAr : next.titleEn}
            <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>
          </Link>
        )}
      </nav>
      )}
    </main>
  );
}
