import type { Route } from "./+types/public.study.$subjectSlug";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { chainsForStudyView, subjectStudyView } from "~server/content/service.server";
import { entitlementsFor, chainRefsOf, chainScopeOf } from "~server/entitlements/access.server";
import { resolveAccess } from "~server/entitlements/resolver.server";
import { purchasableFor } from "~server/commerce/service.server";
import { formatMoney } from "~server/commerce/money";
import { lessonProgressMap } from "~server/progress/service.server";
import { EmptyState } from "~/components/ui/EmptyState";
import { ProgressBar } from "~/components/ProgressBar";
import { Icon } from "~/cms/icons";
import { DecorRings } from "~/components/visuals/PhilosophyDecor";
import { StudyRule } from "~/components/study/StudyRule";
import { LessonCard } from "~/components/study/LessonCard";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { breadcrumbJsonLd } from "~/cms/jsonld";
import { t, type Locale } from "~/lib/i18n";
import {
  countLabel,
  groupTermLessons,
  shouldShowUnitHeadings,
  studyLessonState,
  summarizeTermStates,
  termCompletion,
  type LessonViewProgress,
  type StudyLessonState,
} from "~/lib/study-view";

/**
 * Subject study page — السنة الدراسية → الصف → المادة → الترم → الدروس.
 *
 * The lesson list shows BOTH free and paid lessons: a paid lesson the viewer has
 * no entitlement for is rendered locked with a clear subscription CTA instead of
 * being hidden, so the student knows what exists (PART 4–6).
 *
 * Access is decided SERVER-SIDE by the same pure resolver the lesson page uses —
 * the badge/CTA is only a rendering of that verdict, never the gate itself, and
 * the student's own progress is read from the progress service, not from the
 * browser (PART 7). Every count, year, unit and material chip comes from real
 * rows: nothing on this page is generated.
 */

/** One lesson + the server verdict for it, ready for the view model. */
interface LessonEntry {
  id: string;
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  unitId: string;
  unitTitleAr: string;
  unitTitleEn: string;
  containerSlug: string;
  contentKinds: string[];
  itemCount: number;
  accessLevel: "public" | "authenticated" | "entitled";
  state: StudyLessonState;
  progress: LessonViewProgress | null;
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const view = await subjectStudyView(db, String(params.subjectSlug ?? ""));
  if (!view) throw new Response("Not Found", { status: 404 });

  const { auth } = await resolveAuth(db, env, request);
  const userId = auth?.user.id ?? null;
  const signedIn = Boolean(userId);
  const subject = { userId, roleRank: auth?.user.rank ?? 0 };

  const chains = chainsForStudyView(view);
  const allRefs = [...new Set([...chains.values()].flatMap((c) => chainRefsOf(c).map((r) => r.id)))];
  const grants = userId
    ? await entitlementsFor(db, userId, allRefs, { scopeSubjectId: view.subject.id })
    : [];

  const now = Date.now();
  const verdicts: Record<string, { allowed: boolean; reason: string }> = {};
  for (const [lessonId, chain] of chains) {
    const v = resolveAccess({
      subject,
      resource: {
        accessLevel: chain.accessLevel,
        status: chain.status,
        publishAt: chain.publishAt,
        expiresAt: chain.expiresAt,
        freePreview: chain.freePreview,
      },
      chain: chainRefsOf(chain),
      entitlements: grants,
      chainScope: chainScopeOf(chain),
      now,
    });
    verdicts[lessonId] = { allowed: v.allowed, reason: v.reason };
  }

  // The student's own lesson states (server-side source of truth).
  const progressRows = userId ? await lessonProgressMap(db, userId, [...chains.keys()]) : new Map();

  // Real subscription offer per term container (only when the admin published a
  // product with a real price for it — never invented here).
  const offers: Record<string, { href: string; priceLabel: string } | null> = {};
  for (const year of view.years) {
    for (const { term } of year.terms) {
      if (offers[term.id] !== undefined) continue;
      const offer = await purchasableFor(db, { type: "course", id: term.id, subjectId: view.subject.id });
      offers[term.id] = offer
        ? { href: `/checkout/${offer.productSlug}`, priceLabel: formatMoney(offer.minPriceMinor, offer.currency) }
        : null;
    }
  }

  const years = view.years.map((y) => ({
    id: y.id,
    titleAr: y.titleAr,
    titleEn: y.titleEn,
    terms: y.terms.map(({ term, lessons }) => {
      const entries: LessonEntry[] = lessons.map((l) => {
        const verdict = verdicts[l.id] ?? { allowed: false, reason: "no_entitlement" };
        const state = studyLessonState({
          allowed: verdict.allowed,
          reason: verdict.reason,
          accessLevel: l.accessLevel,
          freePreview: l.freePreview,
          signedIn,
        });
        const row = progressRows.get(l.id);
        const progress: LessonViewProgress | null =
          state === "open" && row ? { status: row.status } : null;
        return {
          id: l.id,
          slug: l.slug,
          titleAr: l.titleAr,
          titleEn: l.titleEn,
          descriptionAr: l.descriptionAr,
          descriptionEn: l.descriptionEn,
          unitId: l.unitId,
          unitTitleAr: l.unitTitleAr,
          unitTitleEn: l.unitTitleEn,
          containerSlug: l.containerSlug,
          contentKinds: l.contentKinds,
          itemCount: l.itemCount,
          accessLevel: l.accessLevel,
          state,
          progress,
        };
      });
      const summary = summarizeTermStates(entries.map((e) => e.state));
      const completion = termCompletion(entries.map((e) => ({ state: e.state, progress: e.progress })));
      return {
        term: {
          id: term.id,
          slug: term.slug,
          titleAr: term.titleAr,
          titleEn: term.titleEn,
          academicYearTitleAr: term.academicYearTitleAr,
          academicYearTitleEn: term.academicYearTitleEn,
        },
        offer: offers[term.id] ?? null,
        lessons: entries,
        summary,
        completion,
      };
    }),
  }));

  return {
    subject: view.subject,
    grade: view.grade,
    program: view.program,
    years,
    signedIn,
    url: request.url,
  };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  const locale = root.locale;
  const grade = loaderData.grade ? { ar: loaderData.grade.titleAr, en: loaderData.grade.titleEn } : null;
  const base = contentSeoMeta(
    {
      title: { ar: loaderData.subject.titleAr, en: loaderData.subject.titleEn },
      description: { ar: loaderData.subject.descriptionAr, en: loaderData.subject.descriptionEn },
    },
    locale,
    loaderData.url,
    { siteName: root.siteName, intermediate: grade }
  );
  let origin = "";
  try {
    origin = new URL(loaderData.url).origin;
  } catch {
    return [...siteEntitiesMeta(matches), ...base];
  }
  return [
    ...siteEntitiesMeta(matches),
    ...base,
    {
      "script:ld+json": breadcrumbJsonLd({
        origin,
        items: [
          { name: locale === "ar" ? t("ar", "study.breadcrumbHome") : t("en", "study.breadcrumbHome"), url: "/" },
          { name: locale === "ar" ? t("ar", "study.title") : t("en", "study.title"), url: "/study" },
          { name: locale === "ar" ? loaderData.subject.titleAr : loaderData.subject.titleEn, url: `/study/${loaderData.subject.slug}` },
        ],
      }),
    },
  ];
}

/** Unit titles created by the admin flow's automatic "الدروس" grouping. */
const DEFAULT_UNIT_TITLES = ["الدروس", "Lessons"];

export default function SubjectStudyPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const pick = (row: { titleAr: string | null; titleEn: string | null }) =>
    ar ? row.titleAr || row.titleEn || "" : row.titleEn || row.titleAr || "";

  const years = loaderData.years.filter((y) => y.terms.length > 0);
  const allTerms = years.flatMap((y) => y.terms);
  const yearBands = years.length > 1;
  const yearLabels = years.map((y) => pick(y)).filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-500" aria-label={t(locale, "common.breadcrumb")}>
        <Link to="/" className="rounded-sm hover:underline">{t(locale, "study.breadcrumbHome")}</Link>
        <span aria-hidden="true"> / </span>
        <Link to="/study" className="rounded-sm hover:underline">{t(locale, "study.title")}</Link>
        <span aria-hidden="true"> / </span>
        <span className="font-medium text-navy-800">{ar ? loaderData.subject.titleAr : loaderData.subject.titleEn}</span>
      </nav>

      {/* Subject header: مادة · صف · مرحلة · سنة دراسية — all real rows */}
      <header className="relative overflow-hidden rounded-[var(--radius-card)] border border-navy-100 bg-white p-5 shadow-sm sm:p-7">
        <DecorRings className="pointer-events-none absolute -top-24 -end-16 h-52 w-52 text-gold-500 opacity-[0.10]" />
        <p className="relative text-xs font-semibold uppercase tracking-wide text-gold-700">{t(locale, "study.contentEyebrow")}</p>
        <h1 className="relative mt-1 break-words text-2xl font-bold text-navy-900 sm:text-3xl">
          {ar ? loaderData.subject.titleAr : loaderData.subject.titleEn}
        </h1>
        <ul className="relative mt-3 flex flex-wrap items-center gap-2" data-testid="study-subject-context">
          {loaderData.grade && (
            <li className="inline-flex items-center rounded-full bg-navy-900 px-3 py-1 text-xs font-semibold text-white">
              {t(locale, "study.gradeLabel")}: {pick(loaderData.grade)}
            </li>
          )}
          {loaderData.program && (
            <li className="inline-flex items-center rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-xs font-medium text-gold-800">
              {pick(loaderData.program)}
            </li>
          )}
          {yearLabels.map((y) => (
            <li key={y} dir="ltr" className="inline-flex items-center gap-1.5 rounded-full border border-navy-100 bg-navy-50 px-3 py-1 text-xs font-semibold tabular-nums text-navy-700">
              <Icon name="calendar" size="sm" colorRole="default" className="h-3.5 w-3.5 text-gold-600" />
              {y}
            </li>
          ))}
        </ul>
        {(ar ? loaderData.subject.descriptionAr : loaderData.subject.descriptionEn) && (
          <p className="relative mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
            {ar ? loaderData.subject.descriptionAr : loaderData.subject.descriptionEn}
          </p>
        )}
        <StudyRule className="relative mt-5" />
      </header>

      {allTerms.length === 0 ? (
        <div className="mt-6" data-testid="study-no-terms">
          <EmptyState
            title={t(locale, "study.noTerms")}
            body={t(locale, "study.subtitle")}
            icon={<Icon name="layers" size="md" colorRole="muted" />}
          />
        </div>
      ) : (
        <>
          {/* Term switcher — plain anchors, so it works without JS and keeps the
              page a single scrollable document on mobile. */}
          {allTerms.length > 1 && (
            <nav aria-label={t(locale, "study.termNavLabel")} className="mt-6" data-testid="study-term-nav">
              <ul className="flex flex-wrap gap-2">
                {allTerms.map(({ term }) => (
                  <li key={term.id}>
                    <a
                      href={`#term-${term.slug}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-navy-100 bg-white px-4 py-2 text-sm font-medium text-navy-800 shadow-sm transition-colors hover:border-gold-300 hover:bg-navy-50"
                    >
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold-400" />
                      {ar ? term.titleAr || term.titleEn : term.titleEn || term.titleAr}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="mt-6 space-y-10">
            {years.map((year) => {
              const yearTitle = pick(year);
              const TermHeading = yearBands ? "h3" : "h2";
              return (
                <section key={year.id ?? "no-year"} aria-labelledby={yearTitle ? `year-${year.id}` : undefined} data-testid={`study-year-${year.id ?? "none"}`}>
                  {yearBands && yearTitle && (
                    <h2 id={`year-${year.id}`} className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                      <Icon name="calendar" size="sm" colorRole="default" className="h-4 w-4 text-gold-600" />
                      {t(locale, "study.yearLabel")}: <span dir="ltr" className="tabular-nums text-navy-800">{yearTitle}</span>
                    </h2>
                  )}

                  <div className="space-y-10">
                    {year.terms.map(({ term, lessons, offer, summary, completion }) => {
                      const termTitle = ar ? term.titleAr || term.titleEn : term.titleEn || term.titleAr;
                      const groups = groupTermLessons(lessons);
                      const showUnits = shouldShowUnitHeadings(groups, locale, DEFAULT_UNIT_TITLES);
                      return (
                        <section key={term.id} id={`term-${term.slug}`} className="scroll-mt-24" data-testid={`study-term-${term.slug}`} aria-labelledby={`term-title-${term.slug}`}>
                          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-navy-100 pb-3">
                            <div className="min-w-0">
                              {!yearBands && (term.academicYearTitleAr || term.academicYearTitleEn) && (
                                <p className="text-xs font-medium text-slate-500">
                                  {t(locale, "study.yearLabel")}:{" "}
                                  <span dir="ltr" className="tabular-nums text-navy-700">
                                    {ar ? term.academicYearTitleAr || term.academicYearTitleEn : term.academicYearTitleEn || term.academicYearTitleAr}
                                  </span>
                                </p>
                              )}
                              <TermHeading id={`term-title-${term.slug}`} className="flex items-center gap-2 text-lg font-bold text-navy-900">
                                <span aria-hidden="true" className="h-5 w-1.5 rounded-full bg-gold-400" />
                                {termTitle}
                              </TermHeading>
                            </div>
                            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span>{countLabel(locale, summary.total, "lessons")}</span>
                              {summary.locked > 0 && (
                                <span className="inline-flex items-center gap-1 text-amber-700">
                                  <Icon name="lock" size="sm" colorRole="default" className="h-3.5 w-3.5" />
                                  {countLabel(locale, summary.locked, "lessons")}
                                </span>
                              )}
                            </p>
                          </div>

                          {loaderData.signedIn && completion.openable > 0 && (
                            <div className="mt-4" data-testid={`study-term-progress-${term.slug}`}>
                              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                                <span>{t(locale, "study.termProgress")}</span>
                                <span dir="ltr" className="tabular-nums font-medium text-navy-700">
                                  {completion.completed}/{completion.openable} · {completion.pct}%
                                </span>
                              </div>
                              <ProgressBar pct={completion.pct} label={t(locale, "study.termProgress")} />
                            </div>
                          )}

                          {lessons.length === 0 ? (
                            <p className="mt-4 text-sm text-slate-500" data-testid={`study-no-lessons-${term.slug}`}>
                              {t(locale, "study.noLessons")}
                            </p>
                          ) : (
                            <div className="mt-4 space-y-6" data-testid={`study-lessons-${term.slug}`}>
                              {groups.map((group) => {
                                const unitTitle = ar ? group.titleAr || group.titleEn : group.titleEn || group.titleAr;
                                return (
                                  <div key={group.key}>
                                    {showUnits && unitTitle && (
                                      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-600">
                                        <Icon name="layers" size="sm" colorRole="default" className="h-4 w-4 text-navy-400" />
                                        {unitTitle}
                                      </h4>
                                    )}
                                    <ol className="flex flex-col gap-3">
                                      {group.lessons.map(({ lesson, position }) => (
                                        <LessonCard
                                          key={lesson.id}
                                          locale={locale}
                                          position={position}
                                          slug={lesson.slug}
                                          titleAr={lesson.titleAr}
                                          titleEn={lesson.titleEn}
                                          descriptionAr={lesson.descriptionAr}
                                          descriptionEn={lesson.descriptionEn}
                                          contentKinds={lesson.contentKinds}
                                          state={lesson.state}
                                          progress={lesson.progress}
                                          accessLevel={lesson.accessLevel}
                                          headingLevel={showUnits ? "h4" : "h3"}
                                          lessonHref={`/learn/${lesson.containerSlug}/${lesson.slug}`}
                                          offer={offer}
                                          activateHref="/activate"
                                          signInHref={`/login?next=${encodeURIComponent(`/learn/${lesson.containerSlug}/${lesson.slug}`)}`}
                                        />
                                      ))}
                                    </ol>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Subscription strip — only for a term that really has
                              locked lessons, and the price only when the owner
                              published a real offer for this exact scope. */}
                          {summary.locked > 0 && (
                            <div
                              className="mt-4 rounded-[var(--radius-card)] border border-gold-200 bg-gold-50/60 p-4"
                              data-testid={`study-term-unlock-${term.slug}`}
                            >
                              <p className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                                <Icon name="lock" size="sm" colorRole="default" className="h-4 w-4 text-gold-600" />
                                {t(locale, "study.termUnlockTitle")}
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                                {t(locale, "study.termUnlockBody")}
                              </p>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {offer && (
                                  <Link
                                    to={offer.href}
                                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-navy-800 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-900"
                                    data-testid={`study-subscribe-${term.slug}`}
                                  >
                                    {t(locale, "content.lockedSubscribe")}
                                    <span dir="ltr" className="text-xs font-medium text-gold-200">{offer.priceLabel}</span>
                                  </Link>
                                )}
                                <Link
                                  to="/activate"
                                  className="inline-flex min-h-11 items-center rounded-full border border-navy-200 bg-white px-5 py-2 text-sm font-semibold text-navy-800 transition-colors hover:border-gold-300 hover:bg-navy-50"
                                  data-testid={`study-activate-${term.slug}`}
                                >
                                  {t(locale, "content.lockedActivate")}
                                </Link>
                                {!offer && (
                                  <span className="text-xs text-slate-500" data-testid={`study-no-offer-${term.slug}`}>
                                    {t(locale, "content.lockedNoOffer")}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                        </section>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
