import type { Route } from "./+types/public.study";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { listAcademicYears, studyHub, studyMaterialKinds } from "~server/content/service.server";
import { getSettings } from "~server/settings/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { EmptyState } from "~/components/ui/EmptyState";
import { SubjectCard } from "~/components/study/SubjectCard";
import { StudyHero } from "~/components/study/StudyHero";
import { MaterialKindsSection, StartSteps, KnowledgeBanner } from "~/components/study/StudySections";
import { Icon } from "~/cms/icons";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";
import { countLabel, groupSubjectsByGrade, subjectPhilosopher, type StudyContentKind } from "~/lib/study-view";
import type { PhilosopherSlotId } from "~/components/study/PhilosopherSlot";

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
 *
 * Visual phase additions — all data-driven, none of them decorative fiction:
 *   · the hero's counts and the current academic year (owner rows, never a
 *     hardcoded year; the section is omitted when no year is published);
 *   · the teacher panel, bound to the SAME identity settings and photo file the
 *     rest of the platform uses (/about, teacher_profile) — never a stand-in
 *     portrait;
 *   · "أنواع المحتوى المتاحة" measured from the published lessons' own items.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);

  const [subjects, years, materialKinds] = await Promise.all([
    studyHub(db),
    listAcademicYears(db, { publishedOnly: true }),
    studyMaterialKinds(db),
  ]);

  // The teacher photo keeps its single source of truth: identity settings →
  // the same public-image resolver /about and the CMS teacher block call.
  const idn = settings.identity;
  const photoUrl = idn.ownerPhotoFileId
    ? ((await resolvePublicImageUrls(db, [idn.ownerPhotoFileId]))[idn.ownerPhotoFileId] ?? null)
    : null;
  return {
    subjects,
    materialKinds: materialKinds as Array<{ kind: StudyContentKind; lessonCount: number }>,
    // Only REAL academic years the owner created. `isCurrent` is the owner's own
    // flag; a platform with years but no current flag still shows its single
    // year, and a platform with none shows nothing at all.
    years: years.map((y) => ({ id: y.id, titleAr: y.titleAr, titleEn: y.titleEn, isCurrent: y.isCurrent })),
    identity: {
      nameAr: idn.ownerNameAr,
      nameEn: idn.ownerNameEn,
      titleAr: idn.ownerTitleAr,
      titleEn: idn.ownerTitleEn,
      photoUrl,
      taglineAr: settings.platform.taglineAr,
      taglineEn: settings.platform.taglineEn,
    },
    url: request.url,
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
  const groups = groupSubjectsByGrade(loaderData.subjects);
  const totalSubjects = loaderData.subjects.length;
  const totalLessons = loaderData.subjects.reduce((sum, s) => sum + s.lessonCount, 0);
  const totalFree = loaderData.subjects.reduce((sum, s) => sum + s.freeLessonCount, 0);

  const pick = (a: string | null, b: string | null) => (ar ? a || b || "" : b || a || "");
  const identity = loaderData.identity;
  const teacher =
    identity.nameAr || identity.nameEn || identity.titleAr || identity.titleEn || identity.photoUrl
      ? {
          name: pick(identity.nameAr, identity.nameEn),
          title: pick(identity.titleAr, identity.titleEn),
          photoUrl: identity.photoUrl,
        }
      : null;

  // The academic years that actually carry the published content on this page.
  const contentYearIds = new Set(loaderData.subjects.flatMap((s) => s.years.map((y) => y.id)));
  const contentYears = loaderData.years.filter((y) => contentYearIds.has(y.id));
  const currentYearRow = loaderData.years.find((y) => y.isCurrent) ?? (contentYears.length === 1 ? contentYears[0] : null);
  const currentYear = currentYearRow ? pick(currentYearRow.titleAr, currentYearRow.titleEn) : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
      <nav className="mb-3 flex items-center gap-1 text-sm text-slate-500" aria-label={t(locale, "common.breadcrumb")}>
        <Link to="/" className="rounded-sm px-1 py-1.5 hover:underline">{t(locale, "study.breadcrumbHome")}</Link>
        <span aria-hidden="true"> / </span>
        <span className="font-medium text-navy-800">{t(locale, "study.title")}</span>
      </nav>

      <StudyHero
        subjectCount={totalSubjects}
        lessonCount={totalLessons}
        freeLessonCount={totalFree}
        currentYear={currentYear}
        teacher={teacher}
        tagline={pick(identity.taglineAr, identity.taglineEn)}
      />

      {groups.length === 0 ? (
        <div className="mt-6" data-testid="study-empty">
          <EmptyState
            title={t(locale, "study.empty")}
            body={t(locale, "study.subtitle")}
            icon={<Icon name="book-open" size="md" colorRole="muted" />}
          />
        </div>
      ) : (
        <>
          <div className="mt-12 space-y-10" id="study-subjects">
            {groups.map((group) => {
              const gradeTitle = ar ? group.gradeTitleAr || group.gradeTitleEn : group.gradeTitleEn || group.gradeTitleAr;
              const programTitle = ar ? group.programTitleAr || group.programTitleEn : group.programTitleEn || group.programTitleAr;
              return (
                <section key={group.key} aria-labelledby={`grade-${group.key}`} data-testid={`study-grade-${group.key}`} className="scroll-mt-24">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div className="min-w-0">
                      {programTitle && <p className="text-xs font-medium text-navy-500">{programTitle}</p>}
                      <h2 id={`grade-${group.key}`} className="mt-1 text-xl font-bold text-navy-900 sm:text-2xl">
                        {gradeTitle}
                      </h2>
                    </div>
                    <p className="rounded-full bg-navy-50 px-3 py-1 text-xs font-medium text-navy-700">
                      {countLabel(locale, group.subjects.length, "subjects")}
                    </p>
                  </div>

                  {/* Two subjects in one grade sit side by side; a lone subject
                      keeps the full column so the card never looks half-empty. */}
                  <ul
                    className={`mt-5 grid gap-4 ${group.subjects.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`}
                    data-testid="study-subjects"
                  >
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
                        slotId={subjectPhilosopher(ar ? s.titleAr || s.titleEn : s.titleEn || s.titleAr, s.slug) as PhilosopherSlotId}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <MaterialKindsSection locale={locale} facts={loaderData.materialKinds} />
          <StartSteps locale={locale} />
          <KnowledgeBanner locale={locale} />
        </>
      )}
    </div>
  );
}
