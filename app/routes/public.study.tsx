import type { Route } from "./+types/public.study";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { studyHub } from "~server/content/service.server";
import { getSettings } from "~server/settings/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { Badge } from "~/components/ui/Badge";
import { Icon } from "~/cms/icons";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { DecorHairline, SectionDecor } from "~/components/visuals/PhilosophyDecor";
import { ThinkerPortrait } from "~/components/visuals/ThinkerPortrait";
import { thinkerAlternate, thinkerFor } from "~/lib/thinkers";
import { t, type Locale } from "~/lib/i18n";

/**
 * المحتوى التعليمي — the student-facing entry point to real published content.
 *
 * Information architecture (owner model, no "courses" vocabulary):
 *   السنة الدراسية → الصف → المادة → الترم → الدرس
 *
 * Everything rendered here comes from PUBLISHED rows the admin created; the page
 * is empty-first, so nothing is ever invented or shown as a placeholder.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const [subjects, settings] = await Promise.all([studyHub(db), getSettings(db)]);
  const photoId = settings.identity.ownerPhotoFileId;
  const images = photoId ? await resolvePublicImageUrls(db, [photoId]) : {};
  return {
    subjects,
    url: request.url,
    ownerPhotoUrl: photoId ? (images[photoId] ?? null) : null,
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
  const heroThinker = thinkerFor({ slot: "landing-hero", slug: "study-hub" });
  const ownerName = ar
    ? loaderData.ownerNameAr || loaderData.ownerNameEn
    : loaderData.ownerNameEn || loaderData.ownerNameAr;

  return (
    <div className="relative isolate overflow-x-hidden">
      <section className="relative isolate overflow-hidden bg-gradient-to-b from-navy-100/70 via-navy-50/30 to-transparent">
        <SectionDecor variant="hero" />
        <ThinkerPortrait thinker={heroThinker} intensity="whisper" eager />
        <div className="relative z-10 mx-auto max-w-5xl px-4 py-10 sm:py-14">
          <nav className="mb-3 flex items-center gap-1 text-sm text-navy-500" aria-label={t(locale, "common.breadcrumb")}>
            <Link to="/" className="hover:underline">{t(locale, "study.breadcrumbHome")}</Link>
            <span aria-hidden="true"> / </span>
            <span className="font-medium text-navy-800">{t(locale, "study.title")}</span>
          </nav>
          <p className="text-sm font-semibold text-gold-700">{t(locale, "study.discoverEyebrow")}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">{t(locale, "study.title")}</h1>
          <DecorHairline className="mt-3 max-w-[10rem] text-gold-500" />
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">{t(locale, "study.subtitle")}</p>

          {loaderData.ownerPhotoUrl && (
            <div className="relative mt-6 inline-flex">
              <img
                src={loaderData.ownerPhotoUrl}
                alt={ownerName || t(locale, "study.ownerPhotoSlot")}
                width={72}
                height={72}
                className="relative z-10 h-16 w-16 rounded-2xl object-cover ring-2 ring-white shadow-md sm:h-[4.5rem] sm:w-[4.5rem]"
              />
            </div>
          )}
        </div>
      </section>

      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-16">
        {loaderData.subjects.length === 0 ? (
          <p className="mt-2 text-slate-500" data-testid="study-empty">{t(locale, "study.empty")}</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2" data-testid="study-subjects">
            {loaderData.subjects.map((s, i) => {
              const primary = thinkerFor({
                slot: "subject-card",
                slug: s.slug,
                titleAr: s.titleAr,
                titleEn: s.titleEn,
                skip: i % 2 === 1,
              });
              const thinker = i === 1 ? thinkerAlternate(thinkerFor({ slot: "subject-card", slug: s.slug, titleAr: s.titleAr, titleEn: s.titleEn }), s.slug) : primary;
              const year = ar ? s.yearTitleAr : s.yearTitleEn;
              return (
                <article
                  key={s.slug}
                  className="group relative isolate overflow-hidden rounded-[1.5rem] border border-navy-100 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-lg"
                >
                  <ThinkerPortrait thinker={thinker} intensity="subtle" />
                  <Link
                    to={`/study/${s.slug}`}
                    className="relative z-10 flex min-h-[11rem] flex-col gap-2 p-5 pe-16 sm:p-6 sm:pe-24"
                    data-testid={`study-subject-${s.slug}`}
                  >
                    <h2 className="text-xl font-extrabold text-navy-900 group-hover:text-navy-800">
                      {ar ? s.titleAr : s.titleEn}
                    </h2>
                    <p className="text-sm text-slate-600">
                      {t(locale, "study.gradeLabel")}: {ar ? s.gradeTitleAr : s.gradeTitleEn}
                      {s.programTitleAr || s.programTitleEn
                        ? ` · ${t(locale, "study.programLabel")}: ${ar ? s.programTitleAr : s.programTitleEn}`
                        : ""}
                    </p>
                    {year && (
                      <p className="text-xs font-medium text-navy-500" dir="ltr">
                        {t(locale, "study.yearLabel")}: {year}
                      </p>
                    )}
                    {(ar ? s.descriptionAr : s.descriptionEn) && (
                      <p className="line-clamp-2 text-sm text-slate-500">{ar ? s.descriptionAr : s.descriptionEn}</p>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-xs text-slate-500">
                      <Badge tone="neutral">{t(locale, "study.termsCount", { n: s.termCount })}</Badge>
                      <Badge tone="neutral">{t(locale, "study.lessonsCount", { n: s.lessonCount })}</Badge>
                    </div>
                    <span className="mt-3 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors group-hover:bg-navy-800">
                      {t(locale, "study.openSubject")}
                      <Icon name="arrow-right" size="sm" colorRole="invert" className="text-white rtl:rotate-180" />
                    </span>
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
