import type { Route } from "./+types/public.courses.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { allLessonsForCourse, chainForCourse, courseBySlug, unitsForCourse } from "~server/content/service.server";
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
    buyOption,
    lessonVerdicts,
    progress,
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

export default function CoursePage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { course, subject, verdict, lessonVerdicts, progress, units, buyOption } = loaderData;
  const title = locale === "ar" ? course.titleAr : course.titleEn;
  const desc = locale === "ar" ? course.descriptionAr : course.descriptionEn;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Breadcrumbs */}
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/courses" className="hover:text-brand-600">{t(locale, "content.catalogTitle")}</Link>
        {subject && (
          <>
            <span className="mx-1.5" aria-hidden>›</span>
            <Link to={`/subjects/${subject.slug}`} className="hover:text-brand-600">
              {locale === "ar" ? subject.titleAr : subject.titleEn}
            </Link>
          </>
        )}
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-slate-700">{title}</span>
      </nav>

      {course.thumbnail && (
        <img src={course.thumbnail} alt="" className="mb-4 h-40 w-full rounded-lg object-cover sm:h-52" />
      )}

      <div className="mb-2 flex items-center gap-2">
        <Badge tone={course.accessLevel === "public" ? "success" : course.accessLevel === "authenticated" ? "brand" : "neutral"}>
          {t(locale, course.accessLevel === "public" ? "content.accessPublic" : course.accessLevel === "authenticated" ? "content.accessAuthenticated" : "content.accessEntitled")}
        </Badge>
        {!verdict.allowed && course.status !== "published" && (
          <span className="text-sm text-slate-400">{t(locale, "content.notAvailable")}</span>
        )}
      </div>
      <h1 className="text-2xl font-bold">{title}</h1>
      {desc && <p className="mt-2 text-slate-600">{desc}</p>}

      {/* Meta row: teacher · lessons · duration */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
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
              <span className="font-medium text-slate-700">{t(locale, "progress.courseProgress")}</span>
              <span className="tabular-nums text-slate-500">
                {progress.course.completed}/{progress.course.total} · {progress.course.pct}%
              </span>
            </div>
            <ProgressBar pct={progress.course.pct} label={t(locale, "progress.courseProgress")} />
          </CardBody>
        </Card>
      )}

      {!verdict.allowed && (
        <Card className="mt-4">
          <CardBody>
            <p className="text-sm text-slate-600">
              {verdict.reason === "anon" ? (
                <Link to="/login" className="font-medium text-blue-600 hover:underline">
                  {t(locale, "content.loginToContinue")}
                </Link>
              ) : (
                t(locale, "content.locked")
              )}
            </p>
            {buyOption && (
              <Link
                to={`/products/${buyOption.productSlug}`}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
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

      <div className="mt-6 space-y-5">
        {units.map((unit, ui) => (
          <Card key={unit.id}>
            <CardBody>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">
                  {ui + 1}. {locale === "ar" ? unit.titleAr : unit.titleEn}
                </h2>
                {verdict.allowed && (
                  <Link to={`/courses/${course.slug}/units/${unit.id}`} className="text-sm text-blue-600 hover:underline">
                    {t(locale, "content.openUnit")}
                  </Link>
                )}
              </div>
              <ol className="space-y-1.5">
                {unit.lessons.map((lesson) => {
                  const lv = lessonVerdicts[lesson.id];
                  const lessonLocked = lv ? !lv.allowed : !verdict.allowed;
                  const lp = progress?.lesson[lesson.id];
                  return (
                    <li key={lesson.slug} className="flex items-center gap-2 text-sm">
                      {lp?.status === "completed" && (
                        <Icon name="check-circle" className="h-4 w-4 shrink-0 text-emerald-600" aria-label={t(locale, "progress.completed")} />
                      )}
                      {lp && lp.status !== "completed" && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
                      )}
                      {!lp && !lessonLocked && <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden />}
                      {lessonLocked ? (
                        <span className="inline-flex items-center gap-1.5 text-slate-500">
                          <Icon name="lock" className="h-4 w-4 shrink-0" aria-hidden />
                          {locale === "ar" ? lesson.titleAr : lesson.titleEn}
                        </span>
                      ) : (
                        <Link to={`/learn/${course.slug}/${lesson.slug}`} className="text-blue-700 hover:underline">
                          {locale === "ar" ? lesson.titleAr : lesson.titleEn}
                        </Link>
                      )}
                      {lesson.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
                    </li>
                  );
                })}
                {unit.lessons.length === 0 && <li className="text-sm text-slate-400">—</li>}
              </ol>
            </CardBody>
          </Card>
        ))}
        {units.length === 0 && <p className="text-sm text-slate-400">{t(locale, "content.catalogEmpty")}</p>}
      </div>
    </div>
  );
}
