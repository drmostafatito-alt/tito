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
import { SubmitButton } from "~/components/ui/Button";
import { Action, ArrowGlyph, Meter, Ordinal, Tag } from "~/components/tito/ui";
import { SubjectPlate, subjectKindOf } from "~/components/tito/subject";
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

/** One numbered part of the lesson: a rule, a label, then the material. */
function Part({
  index,
  label,
  title,
  meta,
  children,
  testId,
}: {
  index: number;
  label: string;
  title?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-pub-ink pt-3">
        <span className="tito-label text-pub-ink" aria-hidden="true">
          <Ordinal n={index} />
        </span>
        <span className="tito-label">{label}</span>
        {title && <span className="min-w-0 font-display text-pub-base font-bold text-pub-ink">{title}</span>}
        {meta && <span className="ms-auto text-pub-xs text-pub-muted">{meta}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * THE LESSON — a reading room, not a page of cards.
 *
 * The chrome is deliberately thin: one sticky bar carrying where you are, how
 * far you have got, and the way back. Everything below it is the material
 * itself, numbered in the order the teacher ordered it. Access is the server's
 * verdict; the locked state states the exact scope you would be buying.
 */
export default function LessonPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const { course, unit, lesson, verdict, items, prev, next, pres, progress, lessonId, study } = loaderData;
  const revalidator = useRevalidator();
  const actionData = useActionData<typeof action>();
  const title = ar ? lesson.titleAr : lesson.titleEn;
  const lessonCompleted = actionData?.completed ?? (progress?.lesson?.status === "completed" || false);
  const kind = subjectKindOf(study.subjectSlug ?? course.slug, study.subjectTitleEn ?? "", study.subjectTitleAr ?? "");
  const backHref = study.subjectSlug ? `/study/${study.subjectSlug}` : "/study";
  const subjectTitle = (ar ? study.subjectTitleAr || study.subjectTitleEn : study.subjectTitleEn || study.subjectTitleAr) || "";
  const termTitle = (ar ? study.termTitleAr : study.termTitleEn) || "";
  const unitTitle = unit ? (ar ? unit.titleAr : unit.titleEn) : "";
  const description = ar ? lesson.descriptionAr : lesson.descriptionEn;

  /* Parts are numbered by what actually renders, so a hidden attachment or a
     pending video never leaves a gap in the sequence. */
  let part = 0;

  return (
    <div className="pub-root flex min-h-dvh flex-col bg-pub-bg" data-subject={kind}>
      {/* ── THE LESSON BAR ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-pub-line bg-pub-bg/97 pt-safe backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[64rem] items-center gap-4 px-[var(--pub-pad-x)] py-2.5">
          <Link
            to={backHref}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 text-pub-sm font-bold text-pub-ink-soft transition-colors hover:text-pub-ink"
          >
            <span className="rotate-180 rtl:rotate-0">
              <ArrowGlyph />
            </span>
            <span className="hidden sm:inline">{t(locale, "common.back")}</span>
          </Link>

          <nav aria-label={t(locale, "common.breadcrumb")} data-allow-small className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-2 text-pub-xs text-pub-muted">
              <li className="shrink-0">
                <Link to="/study" className="font-semibold hover:text-pub-ink">
                  {t(locale, "study.title")}
                </Link>
              </li>
              {study.subjectSlug && (
                <li className="hidden min-w-0 shrink items-center gap-2 sm:flex">
                  <span aria-hidden="true" className="text-ink-300">/</span>
                  <Link to={`/study/${study.subjectSlug}`} className="min-w-0 truncate font-semibold hover:text-pub-ink">
                    {subjectTitle}
                  </Link>
                </li>
              )}
              <li className="hidden min-w-0 shrink items-center gap-2 lg:flex">
                <span aria-hidden="true" className="text-ink-300">/</span>
                <span className="min-w-0 truncate">{termTitle}</span>
              </li>
              {unitTitle && (
                <li className="hidden min-w-0 shrink items-center gap-2 lg:flex">
                  <span aria-hidden="true" className="text-ink-300">/</span>
                  <span className="min-w-0 truncate">{unitTitle}</span>
                </li>
              )}
            </ol>
          </nav>

          {progress && progress.course.total > 0 && (
            <div className="hidden w-48 shrink-0 sm:block">
              <div className="flex items-baseline justify-between gap-2">
                <span className="tito-label">{t(locale, "progress.courseProgress")}</span>
                <span data-numeral dir="ltr" className="text-pub-xs font-bold text-pub-ink">
                  {progress.course.completed}/{progress.course.total}
                </span>
              </div>
              <Meter className="mt-1.5" pct={progress.course.pct} label={t(locale, "progress.courseProgress")} />
            </div>
          )}
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-[64rem] flex-1 px-[var(--pub-pad-x)] py-8 sm:py-12">
        {/* ── THE LESSON HEAD ───────────────────────────────────────────── */}
        <div className="border-b border-pub-line pb-8">
          <p className="tito-label text-[color:var(--subject-ink)]">
            {[subjectTitle, termTitle, unitTitle].filter(Boolean).join(" · ")}
          </p>
          <h1 className="mt-3 max-w-[22ch] font-display text-[length:var(--text-pub-h1)] font-extrabold leading-pub-tight tracking-[-0.04em] text-pub-ink [overflow-wrap:anywhere]">
            {title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {lesson.freePreview && <Tag tone="mark">{t(locale, "content.freePreview")}</Tag>}
            {progress && lessonCompleted && <Tag tone="ok">{t(locale, "progress.completed")}</Tag>}
            {progress && !lessonCompleted && progress.lesson && <Tag tone="neutral">{t(locale, "progress.inProgress")}</Tag>}
          </div>
          {pres.showDescription && description && (
            <p className="mt-5 max-w-[60ch] text-pub-md leading-pub-normal text-pub-ink-soft">{description}</p>
          )}
        </div>

        {!verdict.allowed ? (
          /* ── LOCKED ──────────────────────────────────────────────────
             The gate is the server's. This panel only explains it, and it
             names the exact scope the student would be paying for. */
          <section
            data-testid="lesson-locked"
            className="relative isolate mt-10 overflow-hidden rounded-pub-lg bg-pub-navy p-6 text-pub-on-navy sm:p-9"
          >
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-14 -z-10 opacity-20 ltr:-right-12 rtl:-left-12">
              <SubjectPlate kind={kind === "none" ? "logic" : kind} className="h-72 w-[26rem] text-pub-accent" />
            </span>

            <p className="tito-label text-pub-accent">{t(locale, "content.locked")}</p>
            <h2 className="mt-3 max-w-[20ch] font-display text-[length:var(--text-pub-h3)] font-extrabold leading-pub-tight tracking-[-0.03em] text-pub-on-navy">
              {t(locale, "content.lockedTitle")}
            </h2>
            <p className="mt-3 max-w-[52ch] text-pub-sm leading-pub-normal text-pub-on-navy-soft">{t(locale, "content.lockedBody")}</p>

            <dl className="mt-7 max-w-md" data-testid="lesson-locked-scope">
              {[
                study.yearTitleAr || study.yearTitleEn
                  ? { k: t(locale, "commerce.scopeYear"), v: (ar ? study.yearTitleAr || study.yearTitleEn : study.yearTitleEn || study.yearTitleAr) || "" }
                  : null,
                subjectTitle ? { k: t(locale, "commerce.scopeSubject"), v: subjectTitle } : null,
                { k: t(locale, "commerce.scopeTerm"), v: termTitle },
              ]
                .filter((x): x is { k: string; v: string } => Boolean(x))
                .map((row) => (
                  <div key={row.k} className="flex items-baseline justify-between gap-4 border-t border-white/15 py-2.5">
                    <dt className="tito-label text-pub-on-navy-muted">{row.k}</dt>
                    <dd className="min-w-0 text-end text-pub-sm font-bold text-pub-on-navy">{row.v}</dd>
                  </div>
                ))}
            </dl>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              {study.offer ? (
                <Link
                  to={`/checkout/${study.offer.productSlug}`}
                  className="inline-flex min-h-12 items-center gap-3 rounded-pub-md bg-pub-accent px-6 text-pub-base font-bold text-pub-ink transition-colors hover:bg-pub-accent-soft"
                  data-testid="lesson-subscribe-cta"
                >
                  {t(locale, "content.lockedSubscribe")}
                  <span dir="ltr" data-numeral className="font-extrabold">
                    {formatMoney(study.offer.minPriceMinor, study.offer.currency)}
                  </span>
                </Link>
              ) : (
                <p className="text-pub-sm text-pub-on-navy-soft" data-testid="lesson-no-offer">
                  {t(locale, "content.lockedNoOffer")}
                </p>
              )}
              <Link
                to="/activate"
                className="inline-flex min-h-12 items-center rounded-pub-md border border-white/25 px-5 text-pub-sm font-bold text-pub-on-navy transition-colors hover:border-pub-accent hover:text-pub-accent"
                data-testid="lesson-activate-cta"
              >
                {t(locale, "content.lockedActivate")}
              </Link>
            </div>
            <p className="mt-3 text-pub-xs text-pub-on-navy-muted">{t(locale, "content.lockedActivateHint")}</p>
          </section>
        ) : (
          <div className="mt-10 flex flex-col gap-12">
            {items.map((item) => {
              if (item.kind === "video") {
                if (item.status !== "ready") {
                  return (
                    <Part key={item.key} index={++part} label={t(locale, "content.videoItem")}>
                      <p className="border border-dashed border-pub-line-strong bg-pub-surface px-4 py-6 text-center text-pub-sm text-pub-muted">
                        {t(locale, "videosAdmin.statusPending")}…
                      </p>
                    </Part>
                  );
                }
                return (
                  <Part key={item.key} index={++part} label={t(locale, "content.videoItem")}>
                    <div className="overflow-hidden rounded-pub-md border border-pub-ink bg-black">
                      <VideoPlayer
                        videoId={item.videoId}
                        lessonId={lessonId}
                        title={pres.video.showTitle ? t(locale, "content.videoItem") : undefined}
                        showPoster={pres.video.showPoster}
                        allowFullscreen={pres.video.allowFullscreen}
                        allowSpeed={pres.video.allowSpeed}
                        startAt={progress?.videos[item.videoId]?.positionSeconds ?? 0}
                        onLessonCompleted={() => revalidator.revalidate()}
                      />
                    </div>
                  </Part>
                );
              }

              if (item.kind === "link") {
                const linkTitle =
                  (ar ? item.titleAr : item.titleEn) ?? (ar ? item.titleEn : item.titleAr) ?? t(locale, "content.linkItem");
                const desc = (ar ? item.descriptionAr : item.descriptionEn) ?? (ar ? item.descriptionEn : item.descriptionAr);
                return (
                  <Part
                    key={item.key}
                    index={++part}
                    label={t(locale, "content.linkItem")}
                    title={linkTitle}
                    meta={item.required ? t(locale, "content.required") : undefined}
                  >
                    {desc && <p className="mb-4 max-w-[60ch] text-pub-sm leading-pub-normal text-pub-muted">{desc}</p>}
                    {/* Google Forms sets its own X-Frame-Options for /viewform
                        with ?embedded=true, so the iframe is the supported
                        path. The external link is always offered too, so the
                        quiz stays reachable where embedding is blocked. */}
                    <div className="overflow-hidden rounded-pub-sm border border-pub-line" data-testid="external-quiz">
                      <iframe
                        src={item.embedUrl}
                        title={linkTitle}
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
                      className="mt-3 inline-flex min-h-11 items-center gap-2 text-pub-sm font-bold text-pub-ink underline decoration-pub-accent decoration-2 underline-offset-4"
                      data-testid="external-quiz-open"
                    >
                      {t(locale, "content.linkOpen")}
                      <ArrowGlyph />
                    </a>
                  </Part>
                );
              }

              if (item.kind === "file") {
                if (!pres.showAttachments) return null;
                const isPdf = item.kindOf === "pdf";
                return (
                  <Part
                    key={item.key}
                    index={++part}
                    label={isPdf ? t(locale, "content.pdfItem") : t(locale, "content.fileItem")}
                    title={item.filename}
                    meta={
                      <span data-numeral>
                        {Math.max(1, Math.round(item.byteSize / 1024))} KB ·{" "}
                        {item.required ? t(locale, "content.required") : t(locale, "content.optional")}
                      </span>
                    }
                  >
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      {item.viewUrl && (
                        <a href={item.viewUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 text-pub-sm font-bold text-pub-ink underline decoration-pub-accent decoration-2 underline-offset-4">
                          {t(locale, "content.view")}
                        </a>
                      )}
                      {item.downloadUrl && (
                        <a href={item.downloadUrl} className="inline-flex min-h-11 items-center gap-2 text-pub-sm font-bold text-pub-ink underline decoration-pub-accent decoration-2 underline-offset-4">
                          {t(locale, "content.download")}
                        </a>
                      )}
                    </div>
                    {isPdf && item.viewUrl && (
                      <div className="mt-4 overflow-hidden rounded-pub-sm border border-pub-line bg-pub-surface">
                        <iframe src={item.viewUrl} title={item.filename} className="h-[min(70vh,32rem)] w-full border-0" loading="lazy" />
                      </div>
                    )}
                  </Part>
                );
              }

              // Legacy internal-exam items are filtered out server-side (the
              // questions/exams platform is now an external standalone product).
              return null;
            })}

            {items.length === 0 && (
              <p className="border border-dashed border-pub-line-strong bg-pub-surface px-4 py-8 text-center text-pub-sm text-pub-muted">—</p>
            )}

            {/* ── COMPLETION ─────────────────────────────────────────────
                The student's own mark on the lesson. The server re-checks the
                entitlement on every toggle; this is only the control. */}
            <Form method="post" data-lesson-id={lessonId} className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-pub-ink pt-5">
              <div className="min-w-0">
                <p className="tito-label">{t(locale, "progress.courseProgress")}</p>
                <p className="mt-1 font-display text-pub-base font-bold text-pub-ink">
                  {lessonCompleted ? t(locale, "progress.completed") : t(locale, "progress.inProgress")}
                </p>
              </div>
              <input type="hidden" name="_action" value="toggle-complete" />
              <input type="hidden" name="completed" value={lessonCompleted ? "0" : "1"} />
              <SubmitButton variant={lessonCompleted ? "secondary" : "primary"} size="lg">
                {lessonCompleted ? t(locale, "progress.markIncomplete") : t(locale, "progress.markComplete")}
              </SubmitButton>
            </Form>
          </div>
        )}

        {/* ── PREV / NEXT ─────────────────────────────────────────────── */}
        {pres.showPrevNext && (prev || (next && verdict.allowed)) && (
          <nav className="mt-14 grid gap-px border-t border-pub-line bg-pub-line sm:grid-cols-2" aria-label={t(locale, "common.prevNext")}>
            {prev ? (
              <Link to={`/learn/${course.slug}/${prev.slug}`} className="group flex min-h-24 flex-col justify-center gap-1.5 bg-pub-bg py-5 pe-4 transition-colors hover:bg-pub-surface">
                <span className="tito-label flex items-center gap-2">
                  <span className="rotate-180 rtl:rotate-0">
                    <ArrowGlyph className="h-3.5 w-3.5" />
                  </span>
                  {t(locale, "common.previous")}
                </span>
                <span className="font-display text-pub-base font-bold leading-pub-snug text-pub-ink">{ar ? prev.titleAr : prev.titleEn}</span>
              </Link>
            ) : (
              <span className="hidden bg-pub-bg sm:block" />
            )}
            {next && verdict.allowed ? (
              <Link to={`/learn/${course.slug}/${next.slug}`} className="group flex min-h-24 flex-col justify-center gap-1.5 bg-pub-bg py-5 ps-4 text-end transition-colors hover:bg-pub-surface">
                <span className="tito-label flex items-center justify-end gap-2">
                  {t(locale, "common.next")}
                  <ArrowGlyph className="h-3.5 w-3.5" />
                </span>
                <span className="font-display text-pub-base font-bold leading-pub-snug text-pub-ink">{ar ? next.titleAr : next.titleEn}</span>
              </Link>
            ) : (
              <span className="hidden bg-pub-bg sm:block" />
            )}
          </nav>
        )}
      </main>
    </div>
  );
}
