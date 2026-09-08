import type { Route } from "./+types/public.courses.$slug.units.$unitId";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { chainForCourse, courseBySlug, lessonsForUnit, unitsForCourse } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { lessonProgressMap } from "~server/progress/service.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";

/** Unit page: lessons of one unit with real per-lesson access verdicts + progress. */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const course = await courseBySlug(db, params.slug);
  if (!course) throw new Response("Not Found", { status: 404 });
  const unit = (await unitsForCourse(db, course.id)).find((u) => u.id === params.unitId);
  if (!unit) throw new Response("Not Found", { status: 404 });

  const { auth } = await resolveAuth(db, env, request);
  const subject = { userId: auth?.user.id ?? null, roleRank: auth?.user.rank ?? 0 };
  const courseChain = await chainForCourse(db, course.id);
  const courseVerdict = courseChain
    ? await resolveContentAccess(db, subject, courseChain)
    : { allowed: false as const, reason: "not_published" as const };

  const allLessons = await lessonsForUnit(db, unit.id);
  const visible = allLessons.filter((l) => l.status === "published" || courseVerdict.allowed);

  // Per-lesson verdicts via the resolver WITH grants (entitled lessons inside an
  // allowed course stay locked without a grant — the old page leaked them as open).
  const verdicts: Record<string, boolean> = {};
  if (courseChain) {
    await Promise.all(
      visible.map(async (l) => {
        const v = await resolveContentAccess(db, subject, {
          lessonId: l.id,
          unitId: unit.id,
          courseId: course.id,
          subjectId: courseChain.subjectId,
          accessLevel: l.accessLevel,
          freePreview: l.freePreview,
          status: l.status,
          publishAt: l.publishAt ?? null,
          expiresAt: l.expiresAt ?? null,
        });
        verdicts[l.id] = v.allowed;
      })
    );
  }

  let progress: Record<string, { status: string }> = {};
  if (subject.userId && visible.length > 0) {
    const lmap = await lessonProgressMap(db, subject.userId, visible.map((l) => l.id));
    progress = Object.fromEntries([...lmap.entries()].map(([k, v]) => [k, { status: v.status }]));
  }

  return {
    course: { slug: course.slug, titleAr: course.titleAr, titleEn: course.titleEn },
    unit: { id: unit.id, titleAr: unit.titleAr, titleEn: unit.titleEn },
    courseAllowed: courseVerdict.allowed,
    lessons: visible.map((l) => ({
      id: l.id,
      slug: l.slug,
      titleAr: l.titleAr,
      titleEn: l.titleEn,
      freePreview: l.freePreview,
      allowed: verdicts[l.id] ?? false,
      progress: progress[l.id] ?? null,
    })),
  };
}

export default function UnitPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { course, unit, lessons, courseAllowed } = loaderData;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <nav aria-label="breadcrumb" className="mb-5 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-muted">
        <Link to="/courses" className="font-semibold transition-colors hover:text-brand-800">{t(locale, "content.catalogTitle")}</Link>
        <span className="inline-block rtl:rotate-180" aria-hidden>›</span>
        <Link to={`/courses/${course.slug}`} className="font-semibold transition-colors hover:text-brand-800">
          {locale === "ar" ? course.titleAr : course.titleEn}
        </Link>
        <span className="inline-block rtl:rotate-180" aria-hidden>›</span>
        <span className="font-bold text-ink">{locale === "ar" ? unit.titleAr : unit.titleEn}</span>
      </nav>
      <div className="mb-8 flex flex-col items-start gap-3">
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-accent-500" />
        <h1 className="font-display text-3xl font-semibold leading-snug text-ink sm:text-4xl">{locale === "ar" ? unit.titleAr : unit.titleEn}</h1>
      </div>
      <Card>
        <CardBody className="px-0 py-2 sm:px-2">
          <ol className="divide-y divide-line">
            {lessons.map((l, i) => (
              <li key={l.slug} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="font-display w-8 shrink-0 text-lg font-semibold text-accent-600">{(i + 1).toLocaleString(locale === "ar" ? "ar-EG" : "en-US", { minimumIntegerDigits: 2 })}</span>
                  {l.progress?.status === "completed" && (
                    <Icon name="check-circle" className="h-4 w-4 shrink-0 text-success" aria-label={t(locale, "progress.completed")} />
                  )}
                  {l.progress && l.progress.status !== "completed" && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
                  )}
                  {l.allowed ? (
                    <Link to={`/learn/${course.slug}/${l.slug}`} className="truncate font-bold text-ink underline-offset-4 transition-colors hover:text-brand-800 hover:underline">
                      {locale === "ar" ? l.titleAr : l.titleEn}
                    </Link>
                  ) : (
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-muted">
                      <Icon name="lock" className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{locale === "ar" ? l.titleAr : l.titleEn}</span>
                    </span>
                  )}
                  {l.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
                </span>
                {l.allowed && l.progress?.status !== "completed" && (
                  <Link
                    to={`/learn/${course.slug}/${l.slug}`}
                    className="tito-link shrink-0 text-sm"
                  >
                    {l.progress ? t(locale, "progress.resume") : t(locale, "content.openLesson")}
                  </Link>
                )}
              </li>
            ))}
            {lessons.length === 0 && <li className="px-4 py-6 text-sm text-ink-muted">—</li>}
          </ol>
        </CardBody>
      </Card>
      {!courseAllowed && (
        <p className="mt-4 text-sm text-ink-muted">{t(locale, "content.locked")}</p>
      )}
    </div>
  );
}
