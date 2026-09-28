import type { Route } from "./+types/public.study";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { studyHub } from "~server/content/service.server";
import { getSettings } from "~server/settings/service.server";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { PageBody, PageHead } from "~/components/tito/page";
import { Action, EmptyNote, Ordinal } from "~/components/tito/ui";
import { SUBJECT_PANEL_CLASS, SubjectPanelBody, subjectKindOf } from "~/components/tito/subject";
import { t, type Locale } from "~/lib/i18n";

/**
 * المحتوى التعليمي — the student-facing entry point to real published content.
 *
 * Information architecture (the owner's model, never "courses"):
 *   السنة الدراسية → الصف → المادة → الترم → الوحدة → الدرس
 *
 * This page is the FIRST TWO LEVELS of that index. Subjects are not a flat card
 * wall: they are grouped under the grade they belong to, because "which grade am
 * I in" is the question a student actually arrives with. Everything rendered
 * comes from PUBLISHED rows; the page is empty-first and never invents content.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const [subjects, settings] = await Promise.all([studyHub(db), getSettings(db)]);
  return {
    subjects,
    url: request.url,
    ownerNameAr: settings.identity.ownerNameAr,
    ownerNameEn: settings.identity.ownerNameEn,
  };
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
  const subjects = loaderData.subjects;
  const empty = subjects.length === 0;

  /**
   * Group by grade, preserving the server's ordering. The grade is the heading
   * a student scans for; the year sits in its label because one grade belongs
   * to exactly one academic year in this curriculum.
   */
  const groups: Array<{ key: string; grade: string; year: string; program: string; items: typeof subjects }> = [];
  for (const s of subjects) {
    const key = s.gradeSlug || (ar ? s.gradeTitleAr : s.gradeTitleEn);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = {
        key,
        grade: (ar ? s.gradeTitleAr : s.gradeTitleEn) || (ar ? s.gradeTitleEn : s.gradeTitleAr),
        year: (ar ? s.yearTitleAr : s.yearTitleEn) || "",
        program: (ar ? s.programTitleAr : s.programTitleEn) || "",
        items: [],
      };
      groups.push(g);
    }
    g.items.push(s);
  }

  const totalLessons = subjects.reduce((n, s) => n + s.lessonCount, 0);

  return (
    <div className="flex flex-col">
      <PageHead
        locale={locale}
        crumbs={[{ label: t(locale, "study.breadcrumbHome"), to: "/" }, { label: t(locale, "study.title") }]}
        eyebrow={t(locale, "study.discoverEyebrow")}
        title={t(locale, "study.title")}
        lede={empty ? undefined : t(locale, "study.subtitle")}
        aside={
          empty ? undefined : (
            /* The scale of the index, stated as figures rather than claimed in
               prose. Both numbers are counted from published rows. */
            <dl className="flex shrink-0 gap-10">
              <div>
                <dd data-numeral className="text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink">
                  {subjects.length}
                </dd>
                <dt className="tito-label mt-2">{t(locale, "study.subjectsTitle")}</dt>
              </div>
              <div>
                <dd data-numeral className="text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink">
                  {totalLessons}
                </dd>
                <dt className="tito-label mt-2">{t(locale, "study.lessonsInTerm")}</dt>
              </div>
            </dl>
          )
        }
      />

      <PageBody>
        {empty ? (
          <div data-testid="study-empty">
            <EmptyNote
              title={t(locale, "study.emptyTitle")}
              body={t(locale, "study.empty")}
              action={<Action to="/register">{t(locale, "common.register")}</Action>}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-[calc(var(--pub-pad-y)*0.8)]" data-testid="study-subjects">
            {groups.map((g, gi) => (
              <section key={g.key} aria-labelledby={`grade-${gi}`}>
                {/* the grade rule: an ordinal, the grade, then the journey line
                    it sits in — the hierarchy stated, not diagrammed */}
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-pub-ink pt-3.5">
                  <span className="tito-label text-pub-ink" aria-hidden="true">
                    <Ordinal n={gi + 1} />
                  </span>
                  <h2 id={`grade-${gi}`} className="font-display text-[length:var(--text-pub-h3)] font-extrabold tracking-[-0.03em] text-pub-ink">
                    {g.grade}
                  </h2>
                  <span className="tito-label ms-auto">
                    {[g.program, g.year].filter(Boolean).join(" · ")}
                  </span>
                </div>

                {/* A grade usually publishes one or two subjects. Two columns
                    only when there is something to put in the second one —
                    a lone panel goes full width instead of leaving a hole. */}
                <ul className={`mt-6 grid gap-[var(--pub-gap)] ${g.items.length > 1 ? "lg:grid-cols-2" : ""}`}>
                  {g.items.map((s) => {
                    const kind = subjectKindOf(s.slug, s.titleEn, s.titleAr);
                    return (
                      <li key={s.slug} data-subject={kind} className="min-w-0">
                        <Link
                          to={`/study/${s.slug}`}
                          data-testid={`study-subject-${s.slug}`}
                          className={SUBJECT_PANEL_CLASS}
                        >
                          <SubjectPanelBody
                            kind={kind}
                            meta={[g.year, g.grade].filter(Boolean).join(" · ")}
                            title={(ar ? s.titleAr : s.titleEn) || s.titleAr || s.titleEn}
                            desc={(ar ? s.descriptionAr : s.descriptionEn) || ""}
                            facts={[
                              t(locale, "study.termsCount", { n: s.termCount }),
                              t(locale, "study.lessonsCount", { n: s.lessonCount }),
                            ]}
                            cta={t(locale, "study.openSubject")}
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </PageBody>
    </div>
  );
}
