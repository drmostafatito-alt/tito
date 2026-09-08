import type { Route } from "./+types/public.courses.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { allLessonsForCourse, chainForCourse, courseBySlug, coursePrereqGate, unitsForCourse } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { resolvePublicImageUrls, teacherNames } from "~server/cms/render.server";
import { courseProgress, lessonProgressMap } from "~server/progress/service.server";
import { videos, lessonItems, subjects } from "~server/db/schema";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { ProgressBar } from "~/components/ProgressBar";
import { purchasableFor } from "~server/commerce/service.server";
import { formatMoney } from "~server/commerce/money";
import { Icon } from "~/cms/icons";
import { contentSeoMeta, rootMetaFrom } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";

/** Course page: units + lessons with access-aware rendering, teacher/duration meta and student progress. */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const course = await courseBySlug(db, params.slug);
  if (!course || course.status === "archived") throw new Response("Not Found", { status: 404 });

  const { auth } = await resolveAuth(db, env, request);
  const subject = { userId: auth?.user.id ?? null, roleRank: auth?.user.rank ?? 0 };
  const chain = await chainForCourse(db, course.id);
  const verdict = chain
    ? await resolveContentAccess(db, subject, chain)
    : { allowed: false as const, reason: "not_published" as const };

  // Prerequisite gate (Phase E): a signed-in student is locked out of a course's
  // content until every live transitive prerequisite course is completed. The
  // course stays visible/buyable in the storefront; opening content is gated here
  // and again on the learn route. Staff/anonymous viewers are never gated.
  const prereqLock =
    auth && auth.user.rank <= 1
      ? await coursePrereqGate(db, { userId: auth.user.id, roleRank: auth.user.rank }, course.id)
      : { locked: false, missing: [] };

  const [unitRows, lessonRows, subjectRows] = await Promise.all([
    unitsForCourse(db, course.id),
    allLessonsForCourse(db, course.id),
    db
      .select({ slug: subjects.slug, titleAr: subjects.titleAr, titleEn: subjects.titleEn })
      .from(subjects)
      .where(eq(subjects.id, course.subjectId))
      .limit(1),
  ]);

  // Phase 6: real commerce CTA when the course is locked and purchasable
  const buyOption = verdict.allowed
    ? null
    : await purchasableFor(db, { type: "course", id: course.id, subjectId: course.subjectId });

  const visibleUnits = unitRows.filter((u) => u.status === "published" || verdict.allowed);
  const visibleLessons = lessonRows.filter((l) => l.status === "published" || verdict.allowed);

  // Per-lesson verdicts: lesson chains share the course/subject context, so the
  // resolver input is synthesized from the course chain + lesson fields (no N+1
  // chain lookups; grants are still checked per lesson inside the resolver).
  const lessonVerdicts: Record<string, { allowed: boolean; reason: string }> = {};
  if (chain) {
    await Promise.all(
      visibleLessons.map(async (l) => {
        const v = await resolveContentAccess(db, subject, {
          lessonId: l.id,
          unitId: l.unitId,
          courseId: course.id,
          subjectId: chain.subjectId,
          accessLevel: l.accessLevel,
          freePreview: l.freePreview,
          status: l.status,
          publishAt: l.publishAt ?? null,
          expiresAt: l.expiresAt ?? null,
        });
        lessonVerdicts[l.id] = { allowed: v.allowed, reason: v.reason };
      })
    );
  }

  // Teacher, thumbnail, summed video duration.
  const [teacherMap, thumbnails] = await Promise.all([
    course.teacherId ? teacherNames(db, [course.teacherId]) : Promise.resolve({} as Record<string, string>),
    course.thumbnailFileId ? resolvePublicImageUrls(db, [course.thumbnailFileId]) : Promise.resolve({} as Record<string, string>),
  ]);
  let durationMinutes = 0;
  if (visibleLessons.length > 0) {
    const dRows = await db
      .select({ dur: videos.durationSeconds })
      .from(lessonItems)
      .innerJoin(videos, eq(lessonItems.videoId, videos.id))
      .where(inArray(lessonItems.lessonId, visibleLessons.map((l) => l.id)));
    durationMinutes = Math.round(dRows.reduce((sum, r) => sum + (r.dur ?? 0), 0) / 60);
  }

  // Progress (authenticated only) — DB is the source of truth.
  let progress: { lesson: Record<string, { status: string }>; course: { pct: number; completed: number; total: number } } | null = null;
  if (subject.userId) {
    const ids = visibleLessons.map((l) => l.id);
    const [lmap, cp] = await Promise.all([
      ids.length ? lessonProgressMap(db, subject.userId, ids) : Promise.resolve(new Map()),
      courseProgress(db, subject.userId, course.id),
    ]);
    progress = {
      lesson: Object.fromEntries([...lmap.entries()].map(([k, v]) => [k, { status: v.status }])),
      course: { pct: cp.pct, completed: cp.completed, total: cp.total },
    };
  }

  return {
    course: {
      slug: course.slug,
      titleAr: course.titleAr,
      titleEn: course.titleEn,
      descriptionAr: course.descriptionAr,
      descriptionEn: course.descriptionEn,
      accessLevel: course.accessLevel,
      status: course.status,
      teacherName: course.teacherId ? (teacherMap[course.teacherId] ?? null) : null,
      thumbnail: course.thumbnailFileId ? (thumbnails[course.thumbnailFileId] ?? null) : null,
      durationMinutes,
      lessonCount: visibleLessons.length,
    },
    subject: subjectRows[0] ?? null,
    verdict,
    prereqLock,
    buyOption,
    lessonVerdicts,
    progress,
    url: request.url,
    units: visibleUnits.map((u) => ({
      id: u.id,
      titleAr: u.titleAr,
      titleEn: u.titleEn,
      lessons: visibleLessons
        .filter((l) => l.unitId === u.id)
        .map((l) => ({
          id: l.id,
          slug: l.slug,
          titleAr: l.titleAr,
          titleEn: l.titleEn,
          freePreview: l.freePreview,
        })),
    })),
  };
}

/**
 * SEO/social preview for the course page. The owner controls every value here
 * from Admin → Content (title, description, thumbnail) — there is no separate
 * SEO form because the content row already IS the source of truth.
 */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  return contentSeoMeta(
    {
      title: { ar: loaderData.course.titleAr, en: loaderData.course.titleEn },
      description: { ar: loaderData.course.descriptionAr, en: loaderData.course.descriptionEn },
    },
    root.locale,
    loaderData.url,
    { ogImageUrl: loaderData.course.thumbnail, siteName: root.siteName }
  );
}

export default function CoursePage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { course, subject, verdict, prereqLock, lessonVerdicts, progress, units, buyOption } = loaderData;
  const title = locale === "ar" ? course.titleAr : course.titleEn;
  const desc = locale === "ar" ? course.descriptionAr : course.descriptionEn;
  const gated = prereqLock.locked;
  const lessonLockedFor = (lessonId: string) => {
    if (gated) return true;
    const lv = lessonVerdicts[lessonId];
    return lv ? !lv.allowed : !verdict.allowed;
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      {/* Breadcrumbs */}
      <nav aria-label="breadcrumb" className="mb-5 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-muted">
        <Link to="/courses" className="font-semibold transition-colors hover:text-brand-800">{t(locale, "content.catalogTitle")}</Link>
        {subject && (
          <>
            <span className="inline-block rtl:rotate-180" aria-hidden>›</span>
            <Link to={`/subjects/${subject.slug}`} className="font-semibold transition-colors hover:text-brand-800">
              {locale === "ar" ? subject.titleAr : subject.titleEn}
            </Link>
          </>
        )}
        <span className="inline-block rtl:rotate-180" aria-hidden>›</span>
        <span className="font-bold text-ink">{title}</span>
      </nav>

      {course.thumbnail && (
        <figure className="tito-plate mb-6">
        <img src={course.thumbnail} alt="" loading="lazy" decoding="async" className="h-44 w-full object-cover sm:h-60" />
      </figure>
      )}

      <div className="mb-2 flex items-center gap-2">
        <Badge tone={course.accessLevel === "public" ? "success" : course.accessLevel === "authenticated" ? "brand" : "neutral"}>
          {t(locale, course.accessLevel === "public" ? "content.accessPublic" : course.accessLevel === "authenticated" ? "content.accessAuthenticated" : "content.accessEntitled")}
        </Badge>
        {!verdict.allowed && course.status !== "published" && (
          <span className="text-sm text-ink-muted">{t(locale, "content.notAvailable")}</span>
        )}
      </div>
      <h1 className="font-display max-w-3xl text-3xl font-semibold leading-snug text-ink sm:text-4xl sm:leading-snug">{title}</h1>
      {desc && <p className="mt-3 max-w-3xl text-lg leading-loose text-ink-soft">{desc}</p>}

      {/* Meta row: teacher · lessons · duration */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
        {course.teacherName && (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="user" className="h-4 w-4" aria-hidden />
            <span className="sr-only">{t(locale, "content.teacher")}: </span>
            {course.teacherName}
          </span>
        )}
        {verdict.allowed && course.lessonCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="list" className="h-4 w-4" aria-hidden />
            {t(locale, "content.lessonsCount", { n: course.lessonCount })}
          </span>
        )}
        {verdict.allowed && course.durationMinutes > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="clock" className="h-4 w-4" aria-hidden />
            {t(locale, "content.durationMinutes", { n: course.durationMinutes })}
          </span>
        )}
      </div>

      {/* Student progress */}
      {progress && progress.course.total > 0 && (
        <Card className="mt-4">
          <CardBody>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-ink-soft">{t(locale, "progress.courseProgress")}</span>
              <span className="tabular-nums text-ink-muted">
                {progress.course.completed}/{progress.course.total} · {progress.course.pct}%
              </span>
            </div>
            <ProgressBar pct={progress.course.pct} label={t(locale, "progress.courseProgress")} />
          </CardBody>
        </Card>
      )}

      {gated && prereqLock.missing.length > 0 && (
        <Card className="mt-4">
          <CardBody>
            <p className="text-sm font-medium text-ink-soft">{t(locale, "content.prereqRequired")}</p>
            <ul className="mt-2 space-y-1">
              {prereqLock.missing.map((m) => (
                <li key={m.courseId}>
                  <Link to={`/courses/${m.slug}`} className="text-sm text-brand-700 hover:underline">
                    {locale === "ar" ? m.titleAr : m.titleEn}
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {!gated && !verdict.allowed && (
        <Card className="mt-4">
          <CardBody>
            <p className="text-sm text-ink-muted">
              {verdict.reason === "anon" ? (
                <Link to="/login" className="font-medium text-brand-700 hover:underline">
                  {t(locale, "content.loginToContinue")}
                </Link>
              ) : (
                t(locale, "content.locked")
              )}
            </p>
            {buyOption && (
              <Link
                to={`/products/${buyOption.productSlug}`}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-btn)] bg-brand-700 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800"
                data-testid="course-buy-cta"
              >
                {t(locale, "commerce.buyCta")}
                <span dir="ltr">
                  {t(locale, "commerce.fromPrice").replace("{price}", formatMoney(buyOption.minPriceMinor, buyOption.currency))}
                </span>
              </Link>
            )}
          </CardBody>
        </Card>
      )}

      <div className="mt-8 space-y-5">
        {units.map((unit, ui) => (
          <Card key={unit.id}>
            <CardBody>
              <div className="mb-2 flex items-start justify-between gap-3">
                <h2 className="font-display flex items-baseline gap-2.5 text-xl font-semibold text-ink">
                  <span aria-hidden="true" className="text-base font-semibold text-accent-600">{(ui + 1).toLocaleString(locale === "ar" ? "ar-EG" : "en-US", { minimumIntegerDigits: 2 })}</span>
                  {locale === "ar" ? unit.titleAr : unit.titleEn}
                </h2>
                {!gated && verdict.allowed && (
                  <Link to={`/courses/${course.slug}/units/${unit.id}`} className="tito-link shrink-0 text-sm">
                    {t(locale, "content.openUnit")}
                  </Link>
                )}
              </div>
              <ol className="divide-y divide-line">
                {unit.lessons.map((lesson) => {
                  const lessonLocked = lessonLockedFor(lesson.id);
                  const lp = progress?.lesson[lesson.id];
                  return (
                    <li key={lesson.slug} className="flex min-h-11 items-center gap-2.5 py-1.5 text-[15px]">
                      {lp?.status === "completed" && (
                        <Icon name="check-circle" className="h-4 w-4 shrink-0 text-success" aria-label={t(locale, "progress.completed")} />
                      )}
                      {lp && lp.status !== "completed" && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
                      )}
                      {!lp && !lessonLocked && <span className="h-2 w-2 shrink-0 rounded-full bg-sand-300" aria-hidden />}
                      {lessonLocked ? (
                        <span className="inline-flex items-center gap-1.5 text-ink-muted">
                          <Icon name="lock" className="h-4 w-4 shrink-0" aria-hidden />
                          {locale === "ar" ? lesson.titleAr : lesson.titleEn}
                        </span>
                      ) : (
                        <Link to={`/learn/${course.slug}/${lesson.slug}`} className="inline-flex min-h-6 items-center font-medium text-ink underline-offset-4 transition-colors hover:text-brand-800 hover:underline">
                          {locale === "ar" ? lesson.titleAr : lesson.titleEn}
                        </Link>
                      )}
                      {lesson.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
                    </li>
                  );
                })}
                {unit.lessons.length === 0 && <li className="text-sm text-ink-muted">—</li>}
              </ol>
            </CardBody>
          </Card>
        ))}
        {units.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "content.catalogEmpty")}</p>}
      </div>
    </div>
  );
}
