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
import { Badge } from "~/components/ui/Badge";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { breadcrumbJsonLd } from "~/cms/jsonld";
import { DecorHairline, SectionDecor } from "~/components/visuals/PhilosophyDecor";
import { CARD_BODY, CARD_META, PUB_CARD, pubBtnSm } from "~/lib/publicStyles";
import { ThinkerPortrait } from "~/components/visuals/ThinkerPortrait";
import { ContentTypeChips } from "~/components/study/ContentTypeChips";
import { thinkerAlternate, thinkerFor, type StudyItemKind } from "~/lib/thinkers";
import { t, type Locale } from "~/lib/i18n";

/**
 * Subject study page — السنة الدراسية → الصف → المادة → الترم → الدروس.
 *
 * The lesson list shows BOTH free and paid lessons: a paid lesson the viewer has
 * no entitlement for is rendered locked with a clear subscription CTA instead of
 * being hidden, so the student knows what exists.
 *
 * Access is decided SERVER-SIDE by the same pure resolver the lesson page uses —
 * the badge is only a rendering of that verdict, never the gate itself.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const view = await subjectStudyView(db, String(params.subjectSlug ?? ""));
  if (!view) throw new Response("Not Found", { status: 404 });

  const { auth } = await resolveAuth(db, getEnv(context), request);
  const subject = { userId: auth?.user.id ?? null, roleRank: auth?.user.rank ?? 0 };

  const chains = chainsForStudyView(view);
  const allRefs = [...new Set([...chains.values()].flatMap((c) => chainRefsOf(c).map((r) => r.id)))];
  const grants = subject.userId
    ? await entitlementsFor(db, subject.userId, allRefs, { scopeSubjectId: view.subject.id })
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

  const offers: Record<string, { productSlug: string; minPriceMinor: number; currency: string } | null> = {};
  for (const year of view.years) {
    for (const { term } of year.terms) {
      if (offers[term.id] !== undefined) continue;
      const offer = await purchasableFor(db, { type: "course", id: term.id, subjectId: view.subject.id });
      offers[term.id] = offer
        ? { productSlug: offer.productSlug, minPriceMinor: offer.minPriceMinor, currency: offer.currency }
        : null;
    }
  }

  const url = new URL(request.url);
  const selectedTerm = url.searchParams.get("term");

  return {
    subject: view.subject,
    grade: view.grade,
    program: view.program,
    selectedTerm,
    years: view.years.map((y) => ({
      id: y.id,
      titleAr: y.titleAr,
      titleEn: y.titleEn,
      terms: y.terms.map(({ term, lessons }) => ({
        term: {
          id: term.id,
          slug: term.slug,
          titleAr: term.titleAr,
          titleEn: term.titleEn,
          academicYearTitleAr: term.academicYearTitleAr,
          academicYearTitleEn: term.academicYearTitleEn,
        },
        offer: offers[term.id] ?? null,
        lessons: lessons.map((l) => ({
          id: l.id,
          slug: l.slug,
          containerSlug: l.containerSlug,
          titleAr: l.titleAr,
          titleEn: l.titleEn,
          descriptionAr: l.descriptionAr,
          descriptionEn: l.descriptionEn,
          unitTitleAr: l.unitTitleAr,
          unitTitleEn: l.unitTitleEn,
          accessLevel: l.accessLevel,
          freePreview: l.freePreview,
          itemCount: l.itemCount,
          itemKinds: l.itemKinds,
          allowed: verdicts[l.id]?.allowed ?? false,
          reason: verdicts[l.id]?.reason ?? "anon",
        })),
      })),
    })),
    signedIn: Boolean(subject.userId),
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

function padIndex(n: number): string {
  return String(n).padStart(2, "0");
}

export default function SubjectStudyPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const pick = (row: { titleAr: string | null; titleEn: string | null }) =>
    ar ? row.titleAr || row.titleEn || "" : row.titleEn || row.titleAr || "";

  const allTerms = loaderData.years.flatMap((y) => y.terms.map((t) => ({ year: y, ...t })));
  const selected =
    allTerms.find((x) => x.term.slug === loaderData.selectedTerm) ??
    allTerms[0] ??
    null;

  const heroThinker = thinkerFor({
    slot: "subject-hero",
    slug: loaderData.subject.slug,
    titleAr: loaderData.subject.titleAr,
    titleEn: loaderData.subject.titleEn,
  });

  return (
    <div className="relative isolate overflow-x-hidden">
      <section className="relative isolate overflow-hidden bg-pub-surface">
        <SectionDecor variant="page" />
        <div className="relative z-10 mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] py-8 sm:py-12">
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-pub-muted" aria-label={t(locale, "common.breadcrumb")}>
            <Link to="/" className="hover:underline">{t(locale, "study.breadcrumbHome")}</Link>
            <span aria-hidden="true"> / </span>
            <Link to="/study" className="hover:underline">{t(locale, "study.title")}</Link>
            <span aria-hidden="true"> / </span>
            <span className="font-medium text-pub-navy-2">{ar ? loaderData.subject.titleAr : loaderData.subject.titleEn}</span>
          </nav>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:gap-x-5">
            {!loaderData.years.length ? null : (
              /* Beside the title, never behind it (see /study for the rule). */
              <ThinkerPortrait
                thinker={heroThinker}
                presentation="avatar"
                eager
                className="h-14 w-14 shrink-0 sm:h-20 sm:w-20"
              />
            )}
            <div className="min-w-0">
              <h1 className="max-w-[26ch] text-pub-h2 font-extrabold tracking-tight text-pub-ink sm:text-pub-h1">
                {ar ? loaderData.subject.titleAr : loaderData.subject.titleEn}
              </h1>
              <DecorHairline className="mt-3 max-w-[8rem] text-pub-accent" />
            </div>
          </div>
          <p className="mt-3 text-pub-sm text-pub-muted" data-testid="study-subject-context">
            {[
              loaderData.program ? `${t(locale, "study.programLabel")}: ${pick(loaderData.program)}` : null,
              loaderData.grade ? `${t(locale, "study.gradeLabel")}: ${pick(loaderData.grade)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {(ar ? loaderData.subject.descriptionAr : loaderData.subject.descriptionEn) && (
            <p className="mt-2 max-w-[var(--pub-measure)] text-pub-base leading-pub-normal text-pub-muted">
              {ar ? loaderData.subject.descriptionAr : loaderData.subject.descriptionEn}
            </p>
          )}
        </div>
      </section>

      <div className="relative z-10 mx-auto w-full max-w-[56rem] px-[var(--pub-pad-x)] pb-[var(--pub-pad-y)]">
        {loaderData.years.length === 0 ? (
          <p className="text-pub-muted" data-testid="study-no-terms">{t(locale, "study.noTerms")}</p>
        ) : (
          <div className="space-y-8">
            {loaderData.years.map((year, yi) => (
              <section key={year.id ?? `y-${yi}`} aria-labelledby={`year-${year.id ?? yi}`}>
                {(year.titleAr || year.titleEn) && (
                  <h2 id={`year-${year.id ?? yi}`} className="mb-3 text-pub-xs font-semibold uppercase tracking-wide text-pub-muted">
                    {t(locale, "study.yearLabel")}: <span dir="ltr">{pick(year)}</span>
                  </h2>
                )}

                {year.terms.length > 1 && (
                  <div className="mb-4" role="tablist" aria-label={t(locale, "study.chooseTerm")}>
                    <p className="mb-2 text-sm font-medium text-pub-navy-2">{t(locale, "study.chooseTerm")}</p>
                    <div className="flex flex-wrap gap-2">
                      {year.terms.map(({ term }) => {
                        const active = selected?.term.id === term.id;
                        return (
                          <Link
                            key={term.id}
                            to={`/study/${loaderData.subject.slug}?term=${encodeURIComponent(term.slug)}`}
                            role="tab"
                            aria-selected={active}
                            className={pubBtnSm(active ? "primary" : "secondary", "rounded-pub-pill px-4 py-2") + " text-pub-sm"}
                          >
                            {pick(term)}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}

                {year.terms.map(({ term, lessons, offer }, ti) => {
                  const yearHasSelection = year.terms.some((x) => x.term.id === selected?.term.id);
                  const isSelected = selected?.term.id === term.id;
                  if (yearHasSelection && year.terms.length > 1 && !isSelected) {
                    return (
                      <div key={term.id} className="sr-only" data-testid={`study-term-${term.slug}`}>
                        <h3>{pick(term)}</h3>
                      </div>
                    );
                  }
                  const panelThinker = thinkerFor({
                    slot: "term-panel",
                    slug: loaderData.subject.slug,
                    titleAr: loaderData.subject.titleAr,
                    titleEn: loaderData.subject.titleEn,
                    skip: ti > 0,
                    salt: term.slug,
                  });
                  const thinker = ti === 1
                    ? thinkerAlternate(thinkerFor({ slot: "term-panel", slug: loaderData.subject.slug }), term.slug)
                    : panelThinker;
                  return (
                    <div
                      key={term.id}
                      data-testid={`study-term-${term.slug}`}
                      className={`${PUB_CARD} isolate rounded-pub-2xl hover:shadow-pub-card`}
                    >
                      <div className="relative z-10 p-5 sm:p-6">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                          {/* A dark photograph at 25 % on white reads as a grey smudge,
                              so the term panel carries the same small cropped avatar the
                              cards use — legible identity, no wash behind the text. */}
                          <span className="flex min-w-0 items-center gap-3">
                            <ThinkerPortrait thinker={thinker} presentation="avatar" />
                            <h3 className="text-pub-lg font-bold leading-pub-snug text-pub-ink">{pick(term)}</h3>
                          </span>
                          <span className={`text-pub-xs ${CARD_META}`}>
                            {t(locale, "study.lessonsCount", { n: lessons.length })}
                          </span>
                        </div>

                        {lessons.length === 0 ? (
                          <p className={`text-pub-sm ${CARD_BODY}`}>{t(locale, "study.noLessons")}</p>
                        ) : (
                          <ol className="flex flex-col gap-3" data-testid={`study-lessons-${term.slug}`}>
                            {lessons.map((l, idx) => {
                              const paid = l.accessLevel === "entitled" && !l.freePreview;
                              const open = l.allowed;
                              const href = `/learn/${l.containerSlug}/${l.slug}`;
                              return (
                                <li
                                  key={l.id}
                                  className="flex flex-col gap-3 rounded-pub-xl border border-pub-line bg-pub-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <div className="flex min-w-0 items-start gap-3">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pub-md bg-pub-navy text-pub-sm font-bold tabular-nums text-pub-on-navy">
                                      {padIndex(idx + 1)}
                                    </span>
                                    <div className="min-w-0">
                                      {open ? (
                                        <Link
                                          to={href}
                                          className="text-pub-base font-semibold text-pub-ink decoration-pub-accent underline-offset-4 hover:text-pub-accent-strong hover:underline"
                                          data-testid={`study-lesson-${l.slug}`}
                                        >
                                          {ar ? l.titleAr : l.titleEn}
                                        </Link>
                                      ) : (
                                        <span className="text-pub-base font-semibold text-pub-ink-soft" data-testid={`study-lesson-${l.slug}`}>
                                          {ar ? l.titleAr : l.titleEn}
                                        </span>
                                      )}
                                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        <ContentTypeChips kinds={l.itemKinds as StudyItemKind[]} locale={locale} />
                                        {open && !paid ? (
                                          <Badge tone="success">{t(locale, "study.freeBadge")}</Badge>
                                        ) : open ? (
                                          <Badge tone="success">{t(locale, "study.availableHint")}</Badge>
                                        ) : paid ? (
                                          <Badge tone="warning">{t(locale, "study.lockedHint")}</Badge>
                                        ) : (
                                          <Badge tone="neutral">{t(locale, "content.locked")}</Badge>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {open ? (
                                    <Link
                                      to={href}
                                      className={pubBtnSm("primary", "shrink-0")}
                                    >
                                      {t(locale, "study.startLesson")}
                                    </Link>
                                  ) : (
                                    <span className="inline-flex flex-wrap items-center gap-2">
                                      {offer ? (
                                        <Link
                                          to={`/checkout/${offer.productSlug}`}
                                          className={pubBtnSm("gold", "")}
                                          data-testid={`study-subscribe-${term.slug}`}
                                        >
                                          {t(locale, "study.subscribeCta")}
                                          <span dir="ltr" className="ms-1 text-xs">
                                            {formatMoney(offer.minPriceMinor, offer.currency)}
                                          </span>
                                        </Link>
                                      ) : (
                                        <Link
                                          to="/activate"
                                          className={pubBtnSm("secondary", "")}
                                          data-testid={`study-activate-${term.slug}`}
                                        >
                                          {t(locale, "content.lockedActivate")}
                                        </Link>
                                      )}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
