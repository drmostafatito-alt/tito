import type { Route } from "./+types/public.study";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { studyHub } from "~server/content/service.server";
import { getSettings } from "~server/settings/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { CARD_BODY, CARD_META, CHIP, PUB_CARD, pubBtnSm } from "~/lib/publicStyles";
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

  const empty = loaderData.subjects.length === 0;

  return (
    <div className="relative isolate overflow-x-hidden">
      {/* One restrained opening band: light-blue support surface, a whisper
          portrait and the journey line. No dark hero, no stacked ornament. */}
      <section className="relative isolate overflow-hidden bg-pub-surface">
        <SectionDecor variant="page" />
        <div className="relative z-10 mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] py-8 sm:py-12">
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-pub-sm text-pub-muted" aria-label={t(locale, "common.breadcrumb")} data-allow-small>
            <Link to="/" className="hover:underline">{t(locale, "study.breadcrumbHome")}</Link>
            <span aria-hidden="true"> / </span>
            <span className="font-medium text-pub-navy-2">{t(locale, "study.title")}</span>
          </nav>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:gap-x-5">
            {!empty ? (
              /* Subject identity sits BESIDE the title — the same grammar as the
                 cards below, and never behind text, so a long description can never
                 collide with the portrait at phone widths. */
              <ThinkerPortrait
                thinker={heroThinker}
                presentation="avatar"
                eager
                className="h-14 w-14 shrink-0 sm:h-20 sm:w-20"
              />
            ) : null}
            <div className="min-w-0">
              <h1 className="text-pub-h2 font-extrabold tracking-tight text-pub-ink sm:text-pub-h1">
                {t(locale, "study.title")}
              </h1>
              <DecorHairline className="mt-3 max-w-[10rem] text-pub-accent" />
            </div>
          </div>
          {!empty && (
            <p className="mt-3 max-w-[var(--pub-measure)] text-pub-base leading-pub-normal text-pub-muted">
              {t(locale, "study.subtitle")}
            </p>
          )}

          {loaderData.ownerPhotoUrl && (
            <div className="relative mt-6 inline-flex">
              <img
                src={loaderData.ownerPhotoUrl}
                alt={ownerName || t(locale, "study.ownerPhotoSlot")}
                width={72}
                height={72}
                className="relative z-10 h-16 w-16 rounded-pub-xl object-cover shadow-pub-md ring-2 ring-pub-bg sm:h-[4.5rem] sm:w-[4.5rem]"
              />
            </div>
          )}
        </div>
      </section>

      <div className="relative z-10 mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] pb-[var(--pub-pad-y)]">
        {empty ? (
          <div
            className="relative isolate mt-1 overflow-hidden rounded-pub-2xl border border-pub-line bg-pub-bg p-6 shadow-pub-card sm:p-8"
            data-testid="study-empty"
          >
            <ThinkerPortrait thinker={heroThinker} presentation="avatar" eager className="mt-1" />
            <div className="relative z-10 max-w-[var(--pub-measure)]">
              <h2 className="text-pub-md font-extrabold text-pub-ink">{t(locale, "study.emptyTitle")}</h2>
              <p className="mt-2 text-pub-base leading-pub-normal text-pub-muted">{t(locale, "study.empty")}</p>
              <Link to="/register" className={`mt-5 ${pubBtnSm("primary", "px-5")}`}>
                {t(locale, "common.register")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-[var(--pub-gap)] sm:grid-cols-2" data-testid="study-subjects">
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
                <article key={s.slug} className={`${PUB_CARD} isolate rounded-pub-2xl`}>
                  <Link
                    to={`/study/${s.slug}`}
                    className="relative z-10 flex min-h-[11rem] flex-col gap-2 p-5 sm:p-6"
                    data-testid={`study-subject-${s.slug}`}
                  >
                    <span className="flex min-w-0 items-start gap-3">
                      {/* subject identity, cropped small — legible on a phone */}
                      <ThinkerPortrait thinker={thinker} presentation="avatar" />
                      <h2 className="min-w-0 flex-1 text-pub-lg font-bold leading-pub-snug text-pub-ink group-hover:text-pub-navy-2">
                        {ar ? s.titleAr : s.titleEn}
                      </h2>
                    </span>
                    <p className={`text-pub-sm ${CARD_BODY}`}>
                      {t(locale, "study.gradeLabel")}: {ar ? s.gradeTitleAr : s.gradeTitleEn}
                      {s.programTitleAr || s.programTitleEn
                        ? ` · ${t(locale, "study.programLabel")}: ${ar ? s.programTitleAr : s.programTitleEn}`
                        : ""}
                    </p>
                    {year && (
                      <p className={`text-pub-xs ${CARD_META}`} dir="ltr">
                        {t(locale, "study.yearLabel")}: {year}
                      </p>
                    )}
                    {(ar ? s.descriptionAr : s.descriptionEn) && (
                      <p className={`line-clamp-2 text-pub-sm ${CARD_BODY}`}>{ar ? s.descriptionAr : s.descriptionEn}</p>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                      <span className={CHIP}>{t(locale, "study.termsCount", { n: s.termCount })}</span>
                      <span className={CHIP}>{t(locale, "study.lessonsCount", { n: s.lessonCount })}</span>
                    </div>
                    <span className={pubBtnSm("primary", "mt-3 w-fit group-hover:bg-pub-navy-2")}>
                      {t(locale, "study.openSubject")}
                      <Icon name="arrow-right" size="sm" colorRole="invert" className="text-pub-bg rtl:rotate-180" />
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
