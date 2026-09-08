import type { Route } from "./+types/public.programs";
import { Link, useRouteLoaderData } from "react-router";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { programs, grades, subjects } from "~server/db/schema";
import { Card, CardBody } from "~/components/ui/Card";
import { Icon } from "~/cms/icons";
import { contentSeoMeta, rootMetaFrom } from "~/cms/seo";
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
  return contentSeoMeta(
    {
      title: { ar: t("ar", "catalog.programs"), en: t("en", "catalog.programs") },
      description: root.tagline ?? {},
    },
    root.locale,
    loaderData.url,
    { siteName: root.siteName }
  );
}

export default function ProgramsPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t(locale, "catalog.programs")}</h1>
      {loaderData.programs.length === 0 ? (
        <p className="text-ink-muted">{t(locale, "catalog.noPrograms")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {loaderData.programs.map((p) => {
            const desc = locale === "ar" ? p.descriptionAr : p.descriptionEn;
            return (
              <Card key={p.slug}>
                <CardBody>
                  <Link to={`/programs/${p.slug}`} className="group block">
                    <h2 className="flex items-center gap-2 font-semibold text-ink group-hover:text-brand-700">
                      <Icon name="graduation-cap" className="h-5 w-5 text-brand-500" aria-hidden />
                      {locale === "ar" ? p.titleAr : p.titleEn}
                    </h2>
                    {desc && <p className="mt-1.5 text-sm text-ink-muted">{desc}</p>}
                    <p className="mt-2 text-sm text-ink-muted">
                      {t(locale, "catalog.subjects")}: <span className="tabular-nums">{p.subjectCount}</span>
                    </p>
                  </Link>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
