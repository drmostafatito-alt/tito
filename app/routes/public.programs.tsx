import type { Route } from "./+types/public.programs";
import { Link, useRouteLoaderData } from "react-router";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { programs, grades, subjects } from "~server/db/schema";
import { CARD_BODY, CARD_META, PUB_CARD, PUB_INNER, PUB_SECTION } from "~/lib/publicStyles";
import { Icon } from "~/cms/icons";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";

/** Programs index: published programs with subject counts (catalog hierarchy root). */
export async function loader({ context, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const progs = await db
    .select()
    .from(programs)
    .where(and(eq(programs.status, "published"), isNull(programs.deletedAt)))
    .orderBy(programs.sortOrder);

  const subjectCounts: Record<string, number> = {};
  if (progs.length > 0) {
    const rows = await db
      .select({ programId: grades.programId, id: subjects.id })
      .from(subjects)
      .innerJoin(grades, eq(subjects.gradeId, grades.id))
      .where(
        and(
          inArray(grades.programId, progs.map((p) => p.id)),
          eq(subjects.status, "published"),
          isNull(subjects.deletedAt),
          eq(grades.status, "published"),
          isNull(grades.deletedAt)
        )
      );
    for (const r of rows) subjectCounts[r.programId] = (subjectCounts[r.programId] ?? 0) + 1;
  }

  return {
    programs: progs.map((p) => ({
      slug: p.slug,
      titleAr: p.titleAr,
      titleEn: p.titleEn,
      descriptionAr: p.descriptionAr,
      descriptionEn: p.descriptionEn,
      subjectCount: subjectCounts[p.id] ?? 0,
    })),
    url: request.url,
  };
}

/**
 * Catalog index: no content row of its own, so the title comes from the
 * localized page label and the description from the platform tagline — both
 * owner-editable (Appearance → System), nothing hardcoded here.
 */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  return [
    ...siteEntitiesMeta(matches),
    ...contentSeoMeta(
      {
        title: { ar: t("ar", "catalog.programs"), en: t("en", "catalog.programs") },
        description: root.tagline ?? {},
      },
      root.locale,
      loaderData.url,
      { siteName: root.siteName }
    ),
  ];
}

export default function ProgramsPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";

  // Legacy SEO surface: same section rhythm, card grammar and type scale as the
  // rest of the public UI — one language, no separate "old pages" stylesheet.
  return (
    <section className={`${PUB_SECTION} bg-pub-bg`}>
      <div className={PUB_INNER}>
        <h1 className="text-pub-h2 font-extrabold tracking-tight text-pub-ink">{t(locale, "catalog.programs")}</h1>
        {loaderData.programs.length === 0 ? (
          <p className={`pub-measure mt-4 ${CARD_BODY}`}>{t(locale, "catalog.noPrograms")}</p>
        ) : (
          <div className="pub-grid mt-6 sm:grid-cols-2">
            {loaderData.programs.map((p) => {
              const desc = locale === "ar" ? p.descriptionAr : p.descriptionEn;
              return (
                <Link
                  key={p.slug}
                  to={`/programs/${p.slug}`}
                  className={`${PUB_CARD} min-h-[7rem] gap-2 p-5 sm:p-6`}
                >
                  <h2 className="flex items-center gap-2 text-pub-md font-bold leading-pub-snug text-pub-ink">
                    <Icon name="graduation-cap" className="h-5 w-5 shrink-0 text-pub-navy" aria-hidden />
                    <span className="min-w-0">{locale === "ar" ? p.titleAr : p.titleEn}</span>
                  </h2>
                  {desc && <p className={CARD_BODY}>{desc}</p>}
                  <p className={`mt-auto ${CARD_META}`}>
                    {t(locale, "catalog.subjects")}: <span className="tabular-nums">{p.subjectCount}</span>
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
