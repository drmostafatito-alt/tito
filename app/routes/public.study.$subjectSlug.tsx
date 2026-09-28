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
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { breadcrumbJsonLd } from "~/cms/jsonld";
import { PageBody, PageHead } from "~/components/tito/page";
import { Action, ArrowGlyph, EmptyNote, Meter, Ordinal, Tag } from "~/components/tito/ui";
import { subjectKindOf } from "~/components/tito/subject";
import { ContentTypeChips } from "~/components/study/ContentTypeChips";
import { Icon } from "~/cms/icons";
import type { StudyItemKind } from "~/lib/thinkers";
import { t, type Locale } from "~/lib/i18n";

/**
 * Subject study page — السنة الدراسية → الصف → المادة → الترم → الوحدة → الدرس.
 *
 * The previous version stopped at the term and dumped every lesson into one
 * flat list, which is exactly the "raw DB mirror" the brief rules out. Here the
 * UNIT is restored as a real level: a term is read as its units, each unit is a
 * numbered ruled group, and lessons are rows inside it.
 *
 * The lesson list shows BOTH free and paid lessons: a paid lesson the viewer has
 * no entitlement for is rendered locked with a clear subscription CTA instead of
 * being hidden, so the student knows what exists.
 *
 * Access is decided SERVER-SIDE by the same pure resolver the lesson page uses —
 * the tag is only a rendering of that verdict, never the gate itself.
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

type Lesson = Route.ComponentProps["loaderData"]["years"][number]["terms"][number]["lessons"][number];

/** Regroup a term's flat lesson list back into the units it was authored in. */
function unitsOf(lessons: Lesson[], ar: boolean): Array<{ title: string; lessons: Lesson[] }> {
  const out: Array<{ title: string; lessons: Lesson[] }> = [];
  for (const l of lessons) {
    const title = (ar ? l.unitTitleAr || l.unitTitleEn : l.unitTitleEn || l.unitTitleAr) || "";
    const last = out[out.length - 1];
    if (last && last.title === title) last.lessons.push(l);
    else out.push({ title, lessons: [l] });
  }
  return out;
}

export default function SubjectStudyPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const subject = loaderData.subject;
  const kind = subjectKindOf(subject.slug, subject.titleEn, subject.titleAr);
  const pick = (row: { titleAr: string | null; titleEn: string | null }) =>
    ar ? row.titleAr || row.titleEn || "" : row.titleEn || row.titleAr || "";

  const allTerms = loaderData.years.flatMap((y) => y.terms.map((x) => ({ year: y, ...x })));
  const selected = allTerms.find((x) => x.term.slug === loaderData.selectedTerm) ?? allTerms[0] ?? null;

  const lessons = selected?.lessons ?? [];
  const units = unitsOf(lessons, ar);
  const openCount = lessons.filter((l) => l.allowed).length;
  const fullyOpen = lessons.length > 0 && openCount === lessons.length;
  const offer = selected?.offer ?? null;

  return (
    <div className="flex flex-col" data-subject={kind}>
      <PageHead
        locale={locale}
        kind={kind}
        plate
        crumbs={[
          { label: t(locale, "study.breadcrumbHome"), to: "/" },
          { label: t(locale, "study.title"), to: "/study" },
          { label: pick(subject) },
        ]}
        eyebrow={[loaderData.program ? pick(loaderData.program) : null, loaderData.grade ? pick(loaderData.grade) : null]
          .filter(Boolean)
          .join(" · ")}
        title={pick(subject)}
        lede={(ar ? subject.descriptionAr : subject.descriptionEn) || undefined}
        aside={
          allTerms.length === 0 ? undefined : (
            <dl className="flex shrink-0 gap-10" data-testid="study-subject-context">
              <div>
                <dd data-numeral className="text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink">
                  {allTerms.length}
                </dd>
                <dt className="tito-label mt-2">{t(locale, "study.termsTitle")}</dt>
              </div>
              <div>
                <dd data-numeral className="text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink">
                  {allTerms.reduce((n, x) => n + x.lessons.length, 0)}
                </dd>
                <dt className="tito-label mt-2">{t(locale, "study.lessonsInTerm")}</dt>
              </div>
            </dl>
          )
        }
      />

      {/* THE TERM RAIL — the one navigational control on this page. Ruled tabs,
          not pills: the selected term is the one the page is currently set to. */}
      {allTerms.length > 1 && (
        <nav aria-label={t(locale, "study.chooseTerm")} className="border-b border-pub-line bg-pub-sheet">
          <div className="mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)]">
            <ul className="-mb-px flex flex-wrap items-stretch gap-x-7">
              {allTerms.map((x, i) => {
                const active = selected?.term.id === x.term.id;
                return (
                  <li key={x.term.id}>
                    <Link
                      to={`/study/${subject.slug}?term=${encodeURIComponent(x.term.slug)}`}
                      aria-current={active ? "true" : undefined}
                      className={`flex min-h-12 items-center gap-2.5 border-b-2 pt-px text-pub-sm font-bold transition-colors ${
                        active
                          ? "border-[color:var(--subject-ink)] text-pub-ink"
                          : "border-transparent text-pub-muted hover:border-pub-line-strong hover:text-pub-ink"
                      }`}
                    >
                      <Ordinal n={i + 1} className="text-pub-xs text-ink-300" />
                      {pick(x.term)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
      )}

      <PageBody>
        {allTerms.length === 0 ? (
          <div data-testid="study-no-terms">
            <EmptyNote title={t(locale, "study.noTerms")} />
          </div>
        ) : (
          <div className="grid items-start gap-x-[var(--pub-gap)] gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="min-w-0" data-testid={`study-term-${selected?.term.slug ?? ""}`}>
              {/* The term, stated. Year + term as ruled data, then the units. */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t-2 border-pub-ink pt-3.5">
                <h2 className="font-display text-[length:var(--text-pub-h3)] font-extrabold tracking-[-0.03em] text-pub-ink">
                  {selected ? pick(selected.term) : ""}
                </h2>
                <span className="tito-label ms-auto" dir="auto">
                  {[
                    selected && pick(selected.year) ? `${t(locale, "study.yearLabel")} ${pick(selected.year)}` : null,
                    t(locale, "study.unitsCount", { n: units.length }),
                    t(locale, "study.lessonsCount", { n: lessons.length }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>

              {lessons.length === 0 ? (
                <EmptyNote className="mt-6" title={t(locale, "study.noLessons")} />
              ) : (
                <div className="mt-8 flex flex-col gap-10" data-testid={`study-lessons-${selected?.term.slug ?? ""}`}>
                  {units.map((u, ui) => (
                    <section key={`${u.title}-${ui}`} aria-labelledby={`unit-${ui}`} className="min-w-0">
                      {/* THE UNIT — the level the old page dropped. */}
                      <div className="flex items-baseline gap-3 border-t border-pub-line-strong pt-3">
                        <span className="tito-label text-[color:var(--subject-ink)]" aria-hidden="true">
                          {t(locale, "study.unitLabel")} <Ordinal n={ui + 1} />
                        </span>
                        <h3 id={`unit-${ui}`} className="min-w-0 font-display text-pub-md font-bold leading-pub-snug text-pub-ink">
                          {u.title || `${t(locale, "study.unitLabel")} ${ui + 1}`}
                        </h3>
                      </div>

                      <ol className="tito-rows mt-1">
                        {u.lessons.map((l, li) => {
                          const paid = l.accessLevel === "entitled" && !l.freePreview;
                          const open = l.allowed;
                          const href = `/learn/${l.containerSlug}/${l.slug}`;
                          return (
                            <li key={l.id} className="tito-row grid-cols-[2.25rem_minmax(0,1fr)_auto] px-1 sm:px-2">
                              <span className="pt-1 text-pub-sm font-bold text-ink-300 select-none" aria-hidden="true">
                                <Ordinal n={li + 1} />
                              </span>

                              <div className="min-w-0">
                                {open ? (
                                  <Link
                                    to={href}
                                    data-testid={`study-lesson-${l.slug}`}
                                    className="font-display text-pub-md font-bold leading-pub-snug text-pub-ink after:absolute after:inset-0 focus-visible:outline-offset-4"
                                  >
                                    {ar ? l.titleAr : l.titleEn}
                                  </Link>
                                ) : (
                                  <span data-testid={`study-lesson-${l.slug}`} className="font-display text-pub-md font-bold leading-pub-snug text-pub-muted">
                                    {ar ? l.titleAr : l.titleEn}
                                  </span>
                                )}
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                                  <ContentTypeChips kinds={l.itemKinds as StudyItemKind[]} locale={locale} />
                                  {open && !paid ? (
                                    <Tag tone="mark">{t(locale, "study.freeBadge")}</Tag>
                                  ) : open ? (
                                    <Tag tone="ok">{t(locale, "study.availableHint")}</Tag>
                                  ) : l.freePreview ? (
                                    /* Published as a free preview, but this
                                       visitor is not signed in — say that,
                                       rather than calling it locked. */
                                    <Tag tone="mark">{t(locale, "study.previewBadge")}</Tag>
                                  ) : (
                                    <Tag tone="quiet" icon="lock">{t(locale, "study.lockedHint")}</Tag>
                                  )}
                                </div>
                              </div>

                              <div className="relative z-10 flex shrink-0 items-center self-center">
                                {/* One action per row at most. The purchase
                                    decision belongs to the term panel beside
                                    the list, not repeated on every locked
                                    line — nine identical buttons is noise. */}
                                {open ? (
                                  <span className="flex min-h-11 items-center gap-2 text-pub-sm font-bold text-pub-ink">
                                    <span className="hidden sm:inline">{t(locale, "study.startLesson")}</span>
                                    <ArrowGlyph />
                                  </span>
                                ) : l.freePreview ? (
                                  <Link
                                    to={`/login?next=${encodeURIComponent(href)}`}
                                    className="flex min-h-11 items-center gap-2 text-pub-sm font-bold text-pub-ink underline decoration-pub-accent decoration-2 underline-offset-4"
                                  >
                                    <span className="hidden sm:inline">{t(locale, "study.previewSignIn")}</span>
                                    <ArrowGlyph />
                                  </Link>
                                ) : (
                                  <span className="flex min-h-11 items-center text-ink-300" aria-hidden="true">
                                    <Icon name="lock" size="sm" className="h-4 w-4 text-current" />
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  ))}
                </div>
              )}
            </div>

            {/* ACCESS — one honest panel stating what the viewer can actually
                open in this term, and the single action that changes it. */}
            <aside className="lg:sticky lg:top-24">
              <div className="border border-pub-line bg-pub-sheet p-5">
                <p className="tito-label">{t(locale, "study.accessTitle")}</p>
                <p className="mt-3 font-display text-pub-base font-bold leading-pub-snug text-pub-ink">
                  {fullyOpen
                    ? t(locale, "study.accessOpen")
                    : openCount > 0
                      ? t(locale, "study.accessPartial")
                      : t(locale, "study.accessLocked")}
                </p>
                {lessons.length > 0 && (
                  <>
                    <Meter
                      className="mt-4"
                      pct={(openCount / lessons.length) * 100}
                      label={t(locale, "study.accessTitle")}
                    />
                    <p data-numeral dir="ltr" className="mt-2 text-pub-xs font-bold text-pub-muted rtl:text-end">
                      {openCount} / {lessons.length}
                    </p>
                  </>
                )}
                {!fullyOpen && (
                  <>
                    <p className="mt-4 text-pub-sm leading-pub-normal text-pub-muted">{t(locale, "study.accessLockedBody")}</p>
                    <div className="mt-5 flex flex-col gap-2">
                      {offer ? (
                        <Action variant="gold" size="sm" to={`/checkout/${offer.productSlug}`} className="justify-between" data-testid={`study-subscribe-${selected?.term.slug}`}>
                          {t(locale, "study.subscribeCta")}
                          <span dir="ltr" data-numeral className="font-extrabold">
                            {formatMoney(offer.minPriceMinor, offer.currency)}
                          </span>
                        </Action>
                      ) : null}
                      <Action variant="secondary" size="sm" to="/activate" data-testid={`study-activate-${selected?.term.slug}`}>
                        {t(locale, "content.lockedActivate")}
                      </Action>
                    </div>
                  </>
                )}
              </div>

              {allTerms.length > 1 && (
                <nav aria-label={t(locale, "study.termsNav")} className="mt-6 hidden lg:block">
                  <p className="tito-label border-t border-pub-ink pt-3">{t(locale, "study.termsNav")}</p>
                  <ul className="mt-2">
                    {allTerms.map((x, i) => {
                      const active = selected?.term.id === x.term.id;
                      return (
                        <li key={x.term.id}>
                          <Link
                            to={`/study/${subject.slug}?term=${encodeURIComponent(x.term.slug)}`}
                            aria-current={active ? "true" : undefined}
                            className={`flex min-h-11 items-center gap-3 border-b border-pub-line text-pub-sm ${
                              active ? "font-bold text-pub-ink" : "text-pub-muted hover:text-pub-ink"
                            }`}
                          >
                            <Ordinal n={i + 1} className="text-pub-xs text-ink-300" />
                            <span className="min-w-0 flex-1 truncate">{pick(x.term)}</span>
                            <span data-numeral className="text-pub-xs text-ink-300">
                              {x.lessons.length}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              )}
            </aside>
          </div>
        )}
      </PageBody>
    </div>
  );
}
