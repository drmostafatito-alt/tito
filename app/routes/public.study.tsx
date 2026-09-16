import type { Route } from "./+types/public.study";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { studyHub } from "~server/content/service.server";
import { EmptyState } from "~/components/ui/EmptyState";
import { SubjectCard } from "~/components/study/SubjectCard";
import { Icon } from "~/cms/icons";
import { DecorRings } from "~/components/visuals/PhilosophyDecor";
import { StudyRule } from "~/components/study/StudyRule";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";
import { countLabel, groupSubjectsByGrade } from "~/lib/study-view";

/**
 * المحتوى التعليمي — the student-facing entry point to real published content.
 *
 * Information architecture (owner model, no "courses" vocabulary):
 *   السنة الدراسية → الصف → المادة → الترم → الدرس
 *
 * Everything rendered here comes from PUBLISHED rows the admin created; the page
 * is empty-first, so nothing is ever invented or shown as a placeholder. The hub
 * lists one GROUP per grade (the learner's actual first choice), each holding the
 * subjects published for that grade together with the real academic year(s) and
 * counts of what is live.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const subjects = await studyHub(db);
  return { subjects, url: request.url };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  return [
    ...siteEntitiesMeta(matches),
    ...contentSeoMeta(
      {
        title: { ar: t("ar", "study.title"), en: t("en", "study.title") },
        description: root.tagline ?? {},
      },
      root.locale,
      loaderData.url,
      { siteName: root.siteName }
    ),
  ];
}

export default function StudyHubPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const groups = groupSubjectsByGrade(loaderData.subjects);
  const totalSubjects = loaderData.subjects.length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <nav className="mb-3 flex items-center gap-1 text-sm text-slate-500" aria-label={t(locale, "common.breadcrumb")}>
        <Link to="/" className="rounded-sm hover:underline">{t(locale, "study.breadcrumbHome")}</Link>
        <span aria-hidden="true"> / </span>
        <span className="font-medium text-navy-800">{t(locale, "study.title")}</span>
      </nav>

      {/* Academic header — navy typography on white with a gold hairline rule */}
      <header className="relative overflow-hidden rounded-[var(--radius-card)] border border-navy-100 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">{t(locale, "study.contentEyebrow")}</p>
        <h1 className="mt-1 text-2xl font-bold text-navy-900 sm:text-3xl">{t(locale, "study.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{t(locale, "study.subtitle")}</p>
        {totalSubjects > 0 && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-navy-50 px-3 py-1 text-xs font-medium text-navy-700">
            <Icon name="graduation-cap" size="sm" colorRole="default" className="h-3.5 w-3.5 text-gold-600" />
            {countLabel(locale, totalSubjects, "subjects")}
          </p>
        )}
        <StudyRule className="mt-5" />
        {/* Watermark rings (decorative): the same academic motif as the subject pages.
         * A meander band was tried here first, but at 8px its repeating gradient resolves
         * to broken dashes — it read as rendering debris, not as a classical key band. */}
        <DecorRings className="absolute -bottom-20 -end-24 h-44 w-44 text-gold-500 opacity-[0.10]" />
      </header>

      {groups.length === 0 ? (
        <div className="mt-6" data-testid="study-empty">
          <EmptyState
            title={t(locale, "study.empty")}
            body={t(locale, "study.subtitle")}
            icon={<Icon name="book-open" size="md" colorRole="muted" />}
          />
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {groups.map((group) => {
            const gradeTitle = ar ? group.gradeTitleAr || group.gradeTitleEn : group.gradeTitleEn || group.gradeTitleAr;
            const programTitle = ar ? group.programTitleAr || group.programTitleEn : group.programTitleEn || group.programTitleAr;
            return (
              <section key={group.key} aria-labelledby={`grade-${group.key}`} data-testid={`study-grade-${group.key}`}>
                <div className="flex flex-wrap items-end justify-between gap-2 border-b border-navy-100 pb-3">
                  <div className="min-w-0">
                    {programTitle && (
                      <p className="text-xs font-medium uppercase tracking-wide text-gold-700">{programTitle}</p>
                    )}
                    <h2 id={`grade-${group.key}`} className="text-xl font-bold text-navy-900">
                      {gradeTitle}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500">{countLabel(locale, group.subjects.length, "subjects")}</p>
                </div>

                <ul className="mt-5 grid gap-4 sm:grid-cols-2" data-testid="study-subjects">
                  {group.subjects.map((s) => (
                    <SubjectCard
                      key={s.slug}
                      locale={locale}
                      slug={s.slug}
                      titleAr={s.titleAr}
                      titleEn={s.titleEn}
                      descriptionAr={s.descriptionAr}
                      descriptionEn={s.descriptionEn}
                      gradeTitleAr={s.gradeTitleAr}
                      gradeTitleEn={s.gradeTitleEn}
                      programTitleAr={s.programTitleAr}
                      programTitleEn={s.programTitleEn}
                      termCount={s.termCount}
                      lessonCount={s.lessonCount}
                      freeLessonCount={s.freeLessonCount}
                      years={s.years}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
