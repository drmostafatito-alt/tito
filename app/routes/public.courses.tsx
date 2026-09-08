import type { Route } from "./+types/public.courses";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { catalogCourses } from "~server/content/service.server";
import { lessonCounts, resolvePublicImageUrls, teacherNames } from "~server/cms/render.server";
import { Card, CardBody } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { contentSeoMeta, rootMetaFrom } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";

/**
 * Catalog: published + visible courses only; access badges from row data
 * (resolver decides at open). Presentation (image/teacher/lesson-count/subject/
 * badge toggles, CTA label, layout) is admin-controlled via settings —
 * content rows and display config stay separate (Phase 3 stage 6).
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const settings = await getSettings(db);
  const pres = settings.presentation.courseCard;
  const rows = await catalogCourses(db);
  const courseIds = rows.map((r) => r.course.id);
  const [counts, names] = await Promise.all([
    lessonCounts(db, courseIds),
    teacherNames(db, rows.map((r) => r.course.teacherId ?? "")),
  ]);
  const thumbs = rows.map((r) => r.course.thumbnailFileId).filter((x): x is string => Boolean(x));
  const images = pres.showImage ? await resolvePublicImageUrls(db, thumbs) : {};

  return {
    pres,
    courses: rows.map((r) => ({
      slug: r.course.slug,
      titleAr: r.course.titleAr,
      titleEn: r.course.titleEn,
      accessLevel: r.course.accessLevel,
      visibility: r.course.visibility,
      subjectAr: r.subjectAr,
      subjectEn: r.subjectEn,
      gradeAr: r.gradeAr,
      gradeEn: r.gradeEn,
      programAr: r.programAr,
      programEn: r.programEn,
      teacherName: (r.course.teacherId && names[r.course.teacherId]) || null,
      lessonCount: counts[r.course.id] ?? 0,
      imageUrl: (r.course.thumbnailFileId && images[r.course.thumbnailFileId]) || null,
    })),
    url: request.url,
  };
}

/**
 * Catalog index: no content row of its own, so the title comes from the
 * localized page label and the description from the platform tagline — both
 * owner-editable (Appearance → System), nothing hardcoded here.
 */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  return contentSeoMeta(
    {
      title: { ar: t("ar", "content.catalogTitle"), en: t("en", "content.catalogTitle") },
      description: root.tagline ?? {},
    },
    root.locale,
    loaderData.url,
    { siteName: root.siteName }
  );
}

const LAYOUT_GRID = {
  standard: "sm:grid-cols-2",
  compact: "sm:grid-cols-2 lg:grid-cols-3",
  wide: "grid-cols-1",
} as const;

export default function CoursesCatalog({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const c = (row: { titleAr: string; titleEn: string }) => (locale === "ar" ? row.titleAr : row.titleEn);
  const { pres } = loaderData;
  const cta = locale === "ar" ? pres.ctaLabelAr : pres.ctaLabelEn;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t(locale, "content.catalogTitle")}</h1>
      {loaderData.courses.length === 0 ? (
        <p className="text-slate-500">{t(locale, "content.catalogEmpty")}</p>
      ) : (
        <div className={`grid gap-4 ${LAYOUT_GRID[pres.layout as keyof typeof LAYOUT_GRID] ?? LAYOUT_GRID.standard}`}>
          {loaderData.courses.map((course) => {
            const meta: string[] = [];
            if (pres.showTeacher && course.teacherName) meta.push(course.teacherName);
            if (pres.showLessonCount) meta.push(t(locale, "content.lessonsCount", { n: course.lessonCount }));
            if (pres.showSubject) {
              meta.push(
                `${c({ titleAr: course.programAr, titleEn: course.programEn })} · ${c({ titleAr: course.gradeAr, titleEn: course.gradeEn })} · ${c({ titleAr: course.subjectAr, titleEn: course.subjectEn })}`
              );
            }
            return (
              <Card key={course.slug} className="overflow-hidden">
                {pres.showImage && course.imageUrl && (
                  <img src={course.imageUrl} alt={c(course)} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
                )}
                <CardBody>
                  {pres.showBadge && (
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={course.accessLevel === "public" ? "success" : course.accessLevel === "authenticated" ? "brand" : "neutral"}>
                        {t(locale, course.accessLevel === "public" ? "content.accessPublic" : course.accessLevel === "authenticated" ? "content.accessAuthenticated" : "content.accessEntitled")}
                      </Badge>
                      {course.visibility === "featured" && <Badge tone="warning">★</Badge>}
                    </div>
                  )}
                  <h2 className="text-lg font-semibold">
                    <Link to={`/courses/${course.slug}`} className="hover:underline">{c(course)}</Link>
                  </h2>
                  {meta.length > 0 && <p className="mt-1 text-sm text-slate-500">{meta.join(" · ")}</p>}
                  {cta && (
                    <Link to={`/courses/${course.slug}`} className="mt-3 inline-flex min-h-9 items-center text-sm font-semibold text-brand-700 hover:text-brand-800">
                      {cta}
                      <span aria-hidden="true" className="ms-1 rtl:rotate-180">→</span>
                    </Link>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
