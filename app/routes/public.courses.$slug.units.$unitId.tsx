import type { Route } from "./+types/public.courses.$slug.units.$unitId";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { chainForCourse, courseBySlug, lessonsForUnit, unitsForCourse } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { lessonProgressMap } from "~server/progress/service.server";
import { Badge } from "~/components/ui/Badge";
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
      <nav aria-label="breadcrumb" className="mb-6 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-muted">
        <Link to="/courses" className="font-semibold text-ink"><span className="sig-u">{t(locale, "content.catalogTitle")}</span></Link>
        <span aria-hidden="true">›</span>
        <Link to={`/courses/${course.slug}`} className="font-semibold text-ink">
          <span className="sig-u">{locale === "ar" ? course.titleAr : course.titleEn}</span>
        </Link>
        <span aria-hidden="true">›</span>
        <span className="font-medium">{locale === "ar" ? unit.titleAr : unit.titleEn}</span>
      </nav>
      <div className="mb-6 flex items-center gap-4">
        <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 bg-accent-500" />
        <h1 className="sig-display shrink-0 text-3xl text-ink">{locale === "ar" ? unit.titleAr : unit.titleEn}</h1>
        <span aria-hidden="true" className="h-px flex-1 bg-brand-800/25" />
        <span className="shrink-0 text-sm font-bold tabular-nums text-ink-muted">{lessons.length}</span>
      </div>
      <ol className="border-t-2 border-brand-800">
        {lessons.map((l, i) => (
          <li key={l.slug} className="flex min-h-14 items-center justify-between gap-3 border-b-2 border-line py-3">
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span aria-hidden="true" className="w-6 shrink-0 text-sm font-bold tabular-nums text-slate-400">{i + 1}</span>
              {l.progress?.status === "completed" ? (
                <Icon name="check-circle" className="h-5 w-5 shrink-0 text-emerald-600" aria-label={t(locale, "progress.completed")} />
              ) : l.progress ? (
                <span className="h-2.5 w-2.5 shrink-0 bg-accent-500" aria-hidden="true" />
              ) : !l.allowed ? (
                <Icon name="lock" className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              ) : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
              )}
              {l.allowed ? (
                <Link to={`/learn/${course.slug}/${l.slug}`} className="min-w-0 flex-1 truncate font-semibold text-ink">
                  <span className="sig-u">{locale === "ar" ? l.titleAr : l.titleEn}</span>
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-ink-muted">
                  {locale === "ar" ? l.titleAr : l.titleEn}
                </span>
              )}
              {l.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
            </span>
            {l.allowed && l.progress?.status !== "completed" && (
              <Link
                to={`/learn/${course.slug}/${l.slug}`}
                className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-btn)] bg-brand-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
              >
                {l.progress ? t(locale, "progress.resume") : t(locale, "content.openLesson")}
              </Link>
            )}
          </li>
        ))}
        {lessons.length === 0 && <li className="border-b-2 border-line py-4 text-sm text-ink-muted">—</li>}
      </ol>
      {!courseAllowed && (
        <p className="mt-4 text-sm text-ink-muted">{t(locale, "content.locked")}</p>
      )}
    </div>
  );
}
