import type { Route } from "./+types/public.curriculum.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { catalogCourses } from "~server/content/service.server";
import { grades, subjects } from "~server/db/schema";
import { PUB_CARD, pubBtn, pubBtnSm } from "~/lib/publicStyles";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, itemListJsonLd, webPageJsonLd } from "~/cms/jsonld";
import { SectionDecor } from "~/components/visuals/PhilosophyDecor";
import { t, type Locale } from "~/lib/i18n";
import { curriculumPageBySlug } from "~server/seo/curriculum-pages.server";
import { curriculumSummaryText } from "~/lib/curriculum-format";
import { getRealLessonsForSubject } from "~server/seo/realLessonsMapping.server";

/**
 * Public curriculum-overview page — "نبذة عن محتوى المنهج / Curriculum overview".
 *
 * HOW THIS PAGE IS REACHED (owner brief §7): by direct link or Google — never
 * from the homepage, the navigation or any homepage section, and it never
 * redirects. Arriving students get the full page (no interstitial, no gate).
 *
 * WHY IT IS NOT IN THE CATALOG ROUTES: the curriculum structure comes from the
 * owner-provided curriculum source, not from database rows, so the page exists
 * and is useful on day one (the catalog tables start empty). Everything it
 * states is derived from that source: term/unit/chapter names and real lesson
 * counts. The platform-availability part is resolved live from PUBLISHED rows
 * only — when nothing is published yet the section is omitted instead of
 * printing placeholder courses.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: no invented science text, no lesson-name
 * blocks, no prices, no statistics, no ratings/reviews, no promises, no
 * keyword lists.
 */

function sameSubjectAsCurriculum(subjectTitleAr: string, curriculumSubjectAr: string): boolean {
  const a = getRealLessonsForSubject(subjectTitleAr);
  if (a.length === 0) return false;
  const b = new Set(getRealLessonsForSubject(curriculumSubjectAr).map((l) => l.lesson));
  return a.some((l) => b.has(l.lesson));
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const page = curriculumPageBySlug(String(params.slug ?? ""));
  if (!page) throw new Response("Not Found", { status: 404 });

  const db = getDb(getEnv(context));
  const settings = await getSettings(db);

  // Real published rows that match this curriculum — the ONLY place the page
  // talks about what the platform currently offers.
  const subjectRows = await db
    .select({ slug: subjects.slug, titleAr: subjects.titleAr, titleEn: subjects.titleEn })
    .from(subjects)
    .where(and(eq(subjects.status, "published"), isNull(subjects.deletedAt)));
  const matchedSubjects = subjectRows.filter((s) => sameSubjectAsCurriculum(s.titleAr, page.subjectAr));
  const matchedSubjectSlugs = new Set(matchedSubjects.map((s) => s.slug));

  const catalog = (await catalogCourses(db)).filter((r) => matchedSubjectSlugs.has(r.subjectSlug));

  const gradeRows = await db
    .select({ slug: grades.slug, titleAr: grades.titleAr, titleEn: grades.titleEn })
    .from(grades)
    .where(and(eq(grades.status, "published"), isNull(grades.deletedAt)));
  // Reuses the same grade-matching vocabulary the SEO mapping already applies to
  // the real curriculum source, so a published grade is linked only when it
  // belongs to this curriculum.
  const matchesCurriculumGrade = (gradeTitleAr: string) => {
    const t_ = gradeTitleAr.trim();
    if (!t_) return false;
    for (const level of ["الأول", "الثاني", "الثالث", "بكالوريا"]) {
      if (t_.includes(level)) return page.gradeAr.includes(level);
    }
    return page.gradeAr.includes(t_);
  };
  const matchedGrades = gradeRows.filter((g) => matchesCurriculumGrade(g.titleAr));

  return {
    page,
    url: request.url,
    site: { nameAr: settings.platform.nameAr, nameEn: settings.platform.nameEn },
    subjects: matchedSubjects.map((s) => ({ slug: s.slug, titleAr: s.titleAr, titleEn: s.titleEn })),
    gradeLinks: matchedGrades.map((g) => ({ slug: g.slug, titleAr: g.titleAr, titleEn: g.titleEn })),
    courses: catalog.slice(0, 6).map((r) => ({
      slug: r.course.slug,
      titleAr: r.course.titleAr,
      titleEn: r.course.titleEn,
      // The public journey always lands on a SUBJECT (/study/:subjectSlug) — a
      // curriculum overview never sends a student to the legacy /courses index.
      subjectSlug: r.subjectSlug,
    })),
  };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  const { page } = loaderData;
  const subjectLine = {
    ar: `${page.gradeAr} – ${page.subjectAr}`,
    en: `${page.gradeEn} – ${page.subjectEn}`,
  };
  return [
    ...siteEntitiesMeta(matches),
    ...contentSeoMeta(
      {
        title: { ar: t("ar", "curriculum.overviewTitle"), en: t("en", "curriculum.overviewTitle") },
        description: null,
      },
      root.locale,
      loaderData.url,
      {
        siteName: root.siteName,
        intermediate: subjectLine,
        fallbackDescription: (l) => curriculumSummaryText(page, l),
      }
    ),
    {
      "script:ld+json": webPageJsonLd({
        name: `${t(root.locale, "curriculum.overviewTitle")} — ${root.locale === "ar" ? subjectLine.ar : subjectLine.en}`,
        url: absUrl(originOf(loaderData.url), `/curriculum/${page.slug}`),
        description: curriculumSummaryText(page, root.locale),
        isPartOf: absUrl(originOf(loaderData.url), "/"),
        additionalType: "https://schema.org/CollectionPage",
        educationalLevel: root.locale === "ar" ? page.gradeAr : page.gradeEn,
      }),
    },
    ...(loaderData.courses.length > 0
      ? [
          {
            "script:ld+json": itemListJsonLd({
              name: loaderData.site.nameAr ? `${loaderData.site.nameAr} — ${page.subjectAr}` : page.subjectAr,
              url: absUrl(originOf(loaderData.url), `/curriculum/${page.slug}`),
              items: loaderData.courses.map((c) => ({
                name: c.titleAr,
                url: absUrl(originOf(loaderData.url), `/courses/${c.slug}`),
              })),
            }),
          },
        ]
      : []),
    {
      "script:ld+json": breadcrumbJsonLd({
        items: [
          { name: root.locale === "ar" ? "الرئيسية" : "Home", url: "/" },
          { name: root.locale === "ar" ? "المحتوى التعليمي" : "Learning content", url: "/study" },
          { name: `${root.locale === "ar" ? subjectLine.ar : subjectLine.en}` },
        ],
        origin: originOf(loaderData.url),
      }),
    },
  ];
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export default function CurriculumPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale } | undefined;
  const locale = root?.locale ?? "ar";
  const { page, subjects: matchedSubjects, gradeLinks, courses } = loaderData;
  const subjectLine = locale === "ar" ? `${page.gradeAr} – ${page.subjectAr}` : `${page.gradeEn} – ${page.subjectEn}`;

  return (
    <div className="relative isolate overflow-hidden">
      <SectionDecor variant="page" />
      <div className="mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] py-[var(--pub-pad-y)]">
        <nav aria-label="breadcrumb" data-allow-small className="mb-4 flex flex-wrap items-center gap-1.5 text-pub-sm text-pub-muted">
          <Link to="/" className="hover:text-pub-ink-soft">{t(locale, "common.home")}</Link>
          <span aria-hidden="true" className="text-pub-accent">›</span>
          <Link to="/study" className="hover:text-pub-ink-soft">{t(locale, "curriculum.coursesCrumb")}</Link>
          <span aria-hidden="true" className="text-pub-accent">›</span>
          <span className="font-medium text-pub-navy-2" dir="auto">{subjectLine}</span>
        </nav>

        {/* Same identity spirit as the homepage hero, without cloning it: small
            gold eyebrow, navy heading, gold hairline ornament. */}
        <header className="rounded-pub-2xl border border-pub-line bg-pub-surface p-5 shadow-pub-card sm:p-8">
          <p className="inline-flex items-center gap-2 rounded-full bg-pub-accent-bg px-3 py-1 text-pub-xs font-semibold text-pub-accent-strong ring-1 ring-pub-accent-line">
            {t(locale, "curriculum.overviewEyebrow")}
          </p>
          <h1 className="mt-3 max-w-[26ch] text-pub-h2 font-extrabold tracking-tight text-pub-ink sm:text-pub-h1">
            {t(locale, "curriculum.overviewTitle")}
          </h1>
          <p className="mt-2 text-pub-md font-bold text-pub-ink-soft" dir="auto">{subjectLine}</p>
          <p className="mt-3 max-w-[var(--pub-measure)] text-pub-base leading-pub-normal text-pub-muted">
            {curriculumSummaryText(page, locale)}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/study"
              className={pubBtn("primary") + " w-full sm:w-auto"}
            >
              {t(locale, "curriculum.exploreCta")}
            </Link>
            <Link
              to="/"
              className={pubBtn("secondary") + " w-full sm:w-auto"}
            >
              {t(locale, "curriculum.homeCta")}
            </Link>
          </div>
        </header>

        {/* Structure: terms → units → chapters, straight from the curriculum source. */}
        <section className="mt-10" aria-labelledby="curriculum-outline">
          <h2 id="curriculum-outline" className="text-pub-h3 font-extrabold tracking-tight text-pub-ink sm:text-pub-h2">
            {t(locale, "curriculum.outlineTitle")}
          </h2>
          <div className="mt-5 flex flex-col gap-6">
            {page.terms.map((term) => (
              <div key={term.titleAr} className="rounded-pub-xl border border-pub-line bg-pub-bg p-5 shadow-pub-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-pub-md font-bold text-pub-ink" dir="auto">{term.titleAr}</h3>
                  <span className="rounded-full bg-pub-surface px-2.5 py-0.5 text-pub-xs font-semibold text-pub-ink-soft ring-1 ring-pub-surface-2">
                    {t(locale, "curriculum.lessonsCount", { n: term.lessonCount })}
                  </span>
                </div>
                <ul className="mt-4 flex flex-col gap-4">
                  {term.units.map((unit) => (
                    <li key={unit.titleAr} className="rounded-pub-lg border border-pub-line bg-pub-surface p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-pub-md font-bold text-pub-ink" dir="auto">{unit.titleAr}</h4>
                        <span className="text-pub-xs font-semibold text-pub-muted">
                          {t(locale, "curriculum.lessonsCount", { n: unit.lessonCount })}
                        </span>
                      </div>
                      {unit.chapters.length > 0 && (
                        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                          {unit.chapters.map((chapter) => (
                            <li key={chapter.titleAr} className="flex items-start justify-between gap-2 rounded-pub-md bg-pub-bg px-3 py-2.5 text-pub-sm text-pub-ink-soft ring-1 ring-pub-line">
                              <span dir="auto">{chapter.titleAr}</span>
                              <span className="shrink-0 text-pub-xs font-semibold text-pub-accent-strong">
                                {t(locale, "curriculum.lessonsCount", { n: chapter.lessonCount })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Availability: only real published rows; hidden entirely while the
            catalog is empty. */}
        {(courses.length > 0 || matchedSubjects.length > 0 || gradeLinks.length > 0) && (
          <section className="mt-10" aria-labelledby="curriculum-available">
            <h2 id="curriculum-available" className="text-pub-h3 font-extrabold tracking-tight text-pub-ink sm:text-pub-h2">
              {t(locale, "curriculum.availableTitle")}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {gradeLinks.map((g) => (
                <Link
                  key={g.slug}
                  to={`/grades/${g.slug}`}
                  className="inline-flex min-h-11 items-center rounded-pub-pill border border-pub-line-strong bg-pub-bg px-4 text-pub-sm text-pub-ink-soft transition-colors hover:border-pub-line-strong hover:bg-pub-surface hover:text-pub-ink"
                >
                  {locale === "ar" ? g.titleAr : g.titleEn}
                </Link>
              ))}
              {matchedSubjects.map((s) => (
                <Link
                  key={s.slug}
                  to={`/subjects/${s.slug}`}
                  className="inline-flex min-h-11 items-center rounded-pub-pill border border-pub-line-strong bg-pub-bg px-4 text-pub-sm text-pub-ink-soft transition-colors hover:border-pub-line-strong hover:bg-pub-surface hover:text-pub-ink"
                >
                  {locale === "ar" ? s.titleAr : s.titleEn}
                </Link>
              ))}
            </div>
            {courses.length > 0 && (
              <div className="mt-5 grid gap-[var(--pub-gap)] sm:grid-cols-2">
                {courses.map((c) => (
                  <div key={c.slug} className={PUB_CARD}>
                    <div className="flex flex-col gap-1.5 p-5">
                      <span className="text-pub-md font-bold leading-pub-snug text-pub-ink" dir="auto">
                        {locale === "ar" ? c.titleAr : c.titleEn}
                      </span>
                      <p className="text-pub-xs text-pub-muted">{t(locale, "curriculum.courseLinkHint")}</p>
                      <Link
                        to={`/study/${c.subjectSlug}`}
                        className={pubBtnSm("primary", "mt-2 self-start")}
                        data-testid="curriculum-open-subject"
                      >
                        {t(locale, "study.openSubject")}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <p className="mt-10 rounded-pub-lg border border-pub-accent-line bg-pub-accent-bg p-4 text-pub-sm leading-pub-normal text-pub-ink-soft">
          {t(locale, "curriculum.honestyNote")}
        </p>
      </div>
    </div>
  );
}
