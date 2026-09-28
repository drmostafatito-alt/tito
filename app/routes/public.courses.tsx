import type { Route } from "./+types/public.courses";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { catalogCourses } from "~server/content/service.server";
import { lessonCounts, resolvePublicImageUrls, teacherNames } from "~server/cms/render.server";
import { PageBody, PageHead } from "~/components/tito/page";
import { ArrowGlyph, EmptyNote, Ordinal, Tag } from "~/components/tito/ui";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, itemListJsonLd } from "~/cms/jsonld";
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
  const locale = root.locale;
  const base = contentSeoMeta(
    {
      title: { ar: t("ar", "content.catalogTitle"), en: t("en", "content.catalogTitle") },
      description: root.tagline ?? {},
    },
    root.locale,
    loaderData.url,
    { siteName: root.siteName }
  );
  let origin = "";
  try {
    origin = new URL(loaderData.url).origin;
  } catch {
    return [...siteEntitiesMeta(matches), ...base];
  }
  // ItemList over the published courses actually shown on this page.
  const courses = loaderData.courses as Array<{
    slug: string;
    titleAr: string;
    titleEn: string;
  }>;
  return [
    ...siteEntitiesMeta(matches),
    ...base,
    {
      "script:ld+json": itemListJsonLd({
        name: locale === "ar" ? t("ar", "content.catalogTitle") : t("en", "content.catalogTitle"),
        url: absUrl(origin, "/courses"),
        items: courses.map((c) => ({
          name: locale === "ar" ? c.titleAr : c.titleEn,
          url: absUrl(origin, `/courses/${c.slug}`),
        })),
      }),
    },
  ];
}

/**
 * A term container is READ as an index entry, not as a product card: the row
 * carries its place in the curriculum (المرحلة · الصف · المادة), its size, and
 * its access state. `presentation.courseCard` stays authoritative over which of
 * those facts are shown — the owner's toggles still decide, the grammar changed.
 *
 * `wide` keeps one column; the other saved layouts become a two-column index.
 */
const LAYOUT_COLUMNS = {
  standard: "lg:grid-cols-2",
  compact: "lg:grid-cols-2",
  wide: "",
} as const;

export default function CoursesCatalog({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const c = (row: { titleAr: string; titleEn: string }) => (ar ? row.titleAr : row.titleEn);
  const { pres } = loaderData;
  const cta = ar ? pres.ctaLabelAr : pres.ctaLabelEn;
  const withImages = pres.showImage && loaderData.courses.some((x) => x.imageUrl);

  return (
    <div className="flex flex-col">
      <PageHead
        locale={locale}
        crumbs={[{ label: t(locale, "study.breadcrumbHome"), to: "/" }, { label: t(locale, "content.catalogTitle") }]}
        eyebrow={t(locale, "study.discoverEyebrow")}
        title={t(locale, "content.catalogTitle")}
        aside={
          loaderData.courses.length === 0 ? undefined : (
            <dl className="shrink-0">
              <dd data-numeral className="text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink">
                {loaderData.courses.length}
              </dd>
              <dt className="tito-label mt-2">{t(locale, "content.catalogTitle")}</dt>
            </dl>
          )
        }
      />

      <PageBody>
        {loaderData.courses.length === 0 ? (
          <EmptyNote title={t(locale, "content.catalogEmpty")} />
        ) : (
          <ul className={`grid gap-x-[var(--pub-gap)] ${LAYOUT_COLUMNS[pres.layout as keyof typeof LAYOUT_COLUMNS] ?? LAYOUT_COLUMNS.standard}`}>
            {loaderData.courses.map((course, i) => {
              const meta: string[] = [];
              if (pres.showTeacher && course.teacherName) meta.push(course.teacherName);
              if (pres.showLessonCount && course.lessonCount > 0) meta.push(t(locale, "content.lessonsCount", { n: course.lessonCount }));
              if (pres.showSubject) {
                meta.push(
                  [
                    c({ titleAr: course.programAr, titleEn: course.programEn }),
                    c({ titleAr: course.gradeAr, titleEn: course.gradeEn }),
                    c({ titleAr: course.subjectAr, titleEn: course.subjectEn }),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                );
              }
              return (
                <li key={course.slug} className="tito-row grid-cols-[2.25rem_minmax(0,1fr)_auto] px-1">
                  <span className="pt-1 text-pub-sm font-bold text-ink-300" aria-hidden="true">
                    <Ordinal n={i + 1} />
                  </span>
                  <div className="flex min-w-0 gap-4">
                    {withImages && (
                      /* The thumbnail earns its place only when the owner
                         uploaded one; there is no placeholder tile. */
                      <span className="hidden w-28 shrink-0 self-start border border-pub-line bg-pub-surface sm:block">
                        {course.imageUrl ? (
                          <img src={course.imageUrl} alt="" loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
                        ) : (
                          <span className="block aspect-video w-full" />
                        )}
                      </span>
                    )}
                    <div className="min-w-0">
                      <Link
                        to={`/courses/${course.slug}`}
                        className="font-display text-pub-md font-bold leading-pub-snug text-pub-ink after:absolute after:inset-0 focus-visible:outline-offset-4"
                      >
                        {c(course)}
                      </Link>
                      {meta.length > 0 && <p className="mt-1.5 text-pub-sm leading-pub-snug text-pub-muted">{meta.join(" · ")}</p>}
                      {pres.showBadge && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <Tag tone={course.accessLevel === "public" ? "mark" : course.accessLevel === "authenticated" ? "neutral" : "quiet"}>
                            {t(
                              locale,
                              course.accessLevel === "public"
                                ? "content.accessPublic"
                                : course.accessLevel === "authenticated"
                                  ? "content.accessAuthenticated"
                                  : "content.accessEntitled"
                            )}
                          </Tag>
                          {course.visibility === "featured" && <Tag tone="ink">★</Tag>}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="relative z-10 flex items-center gap-2 self-center text-pub-sm font-bold text-pub-ink">
                    {cta && <span className="hidden sm:inline">{cta}</span>}
                    <ArrowGlyph />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </div>
  );
}
