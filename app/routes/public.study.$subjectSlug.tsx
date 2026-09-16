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
import { Card, CardBody } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { breadcrumbJsonLd } from "~/cms/jsonld";
import { t, type Locale } from "~/lib/i18n";

/**
 * Subject study page — السنة الدراسية → الصف → المادة → الترم → الدروس.
 *
 * The lesson list shows BOTH free and paid lessons: a paid lesson the viewer has
 * no entitlement for is rendered locked with a clear subscription CTA instead of
 * being hidden, so the student knows what exists (PART 4).
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

  // Real subscription offer per term container (only when the admin published a
  // product with a real price for it — never invented here).
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

  return {
    subject: view.subject,
    grade: view.grade,
    program: view.program,
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

export default function SubjectStudyPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const pick = (row: { titleAr: string | null; titleEn: string | null }) =>
    ar ? row.titleAr || row.titleEn || "" : row.titleEn || row.titleAr || "";

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-slate-500" aria-label={t(locale, "common.breadcrumb")}>
        <Link to="/" className="hover:underline">{t(locale, "study.breadcrumbHome")}</Link>
        <span aria-hidden="true"> / </span>
        <Link to="/study" className="hover:underline">{t(locale, "study.title")}</Link>
        <span aria-hidden="true"> / </span>
        <span className="font-medium text-slate-700">{ar ? loaderData.subject.titleAr : loaderData.subject.titleEn}</span>
      </nav>

      <h1 className="text-2xl font-bold">{ar ? loaderData.subject.titleAr : loaderData.subject.titleEn}</h1>
      <p className="mt-1 text-sm text-slate-600" data-testid="study-subject-context">
        {[
          loaderData.program ? `${t(locale, "study.programLabel")}: ${pick(loaderData.program)}` : null,
          loaderData.grade ? `${t(locale, "study.gradeLabel")}: ${pick(loaderData.grade)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {(ar ? loaderData.subject.descriptionAr : loaderData.subject.descriptionEn) && (
        <p className="mt-2 text-sm text-slate-600">{ar ? loaderData.subject.descriptionAr : loaderData.subject.descriptionEn}</p>
      )}

      {loaderData.years.length === 0 ? (
        <p className="mt-6 text-slate-500" data-testid="study-no-terms">{t(locale, "study.noTerms")}</p>
      ) : (
        <div className="mt-6 space-y-8">
          {loaderData.years.map((year, yi) => (
            <section key={year.id ?? `y-${yi}`} aria-labelledby={`year-${year.id ?? yi}`}>
              {(year.titleAr || year.titleEn) && (
                <h2 id={`year-${year.id ?? yi}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {t(locale, "study.yearLabel")}: <span dir="ltr">{pick(year)}</span>
                </h2>
              )}
              <div className="space-y-4">
                {year.terms.map(({ term, lessons, offer }) => (
                  <Card key={term.id} data-testid={`study-term-${term.slug}`}>
                    <CardBody>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold text-slate-800">{pick(term)}</h3>
                        <span className="text-xs text-slate-500">
                          {t(locale, "study.lessonsCount", { n: lessons.length })}
                        </span>
                      </div>

                      {lessons.length === 0 ? (
                        <p className="text-sm text-slate-500">{t(locale, "study.noLessons")}</p>
                      ) : (
                        <ul className="divide-y divide-slate-100" data-testid={`study-lessons-${term.slug}`}>
                          {lessons.map((l) => {
                            const paid = l.accessLevel === "entitled" && !l.freePreview;
                            const open = l.allowed;
                            const href = `/learn/${l.containerSlug}/${l.slug}`;
                            return (
                              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span aria-hidden="true">{open ? "🟢" : paid ? "🔒" : "🟢"}</span>
                                    {open ? (
                                      <Link to={href} className="text-sm font-medium text-slate-800 hover:text-brand-700 hover:underline" data-testid={`study-lesson-${l.slug}`}>
                                        {ar ? l.titleAr : l.titleEn}
                                      </Link>
                                    ) : (
                                      <span className="text-sm font-medium text-slate-500" data-testid={`study-lesson-${l.slug}`}>
                                        {ar ? l.titleAr : l.titleEn}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    {open
                                      ? t(locale, "study.freeBadge")
                                      : paid
                                        ? t(locale, "content.accessPaid")
                                        : t(locale, "content.locked")}
                                    {l.itemCount > 0 && ` · ${t(locale, "study.itemsCount", { n: l.itemCount })}`}
                                  </p>
                                </div>
                                {open ? (
                                  <Link
                                    to={href}
                                    className="inline-flex min-h-9 items-center rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
                                  >
                                    {t(locale, "study.openLesson")}
                                  </Link>
                                ) : (
                                  <span className="inline-flex flex-wrap items-center gap-2">
                                    <Badge tone="warning">{t(locale, "content.accessPaid")}</Badge>
                                    {offer ? (
                                      <Link
                                        to={`/checkout/${offer.productSlug}`}
                                        className="inline-flex min-h-9 items-center rounded-full border border-brand-200 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                                        data-testid={`study-subscribe-${term.slug}`}
                                      >
                                        {t(locale, "content.lockedSubscribe")}
                                        <span dir="ltr" className="ms-1 text-xs">
                                          {formatMoney(offer.minPriceMinor, offer.currency)}
                                        </span>
                                      </Link>
                                    ) : (
                                      <Link
                                        to="/activate"
                                        className="inline-flex min-h-9 items-center rounded-full border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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
                        </ul>
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
