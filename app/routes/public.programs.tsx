import type { Route } from "./+types/public.programs";
import { Link, useRouteLoaderData } from "react-router";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { programs, grades, subjects } from "~server/db/schema";
import { Card, CardBody } from "~/components/ui/Card";
import { EmptyState } from "~/components/ui/EmptyState";
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="mb-8 flex items-center gap-4">
        <span aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 bg-accent-500" />
        <h1 className="sig-display shrink-0 text-3xl text-ink sm:text-4xl">{t(locale, "catalog.programs")}</h1>
        <span aria-hidden="true" className="h-px flex-1 bg-brand-800/25" />
        <span className="shrink-0 text-sm font-bold tabular-nums text-ink-muted">{loaderData.programs.length}</span>
      </div>
      {loaderData.programs.length === 0 ? (
        <EmptyState title={t(locale, "catalog.noPrograms")} icon={<span aria-hidden="true">○</span>} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {loaderData.programs.map((p, pi) => {
            const desc = locale === "ar" ? p.descriptionAr : p.descriptionEn;
            return (
              <Card key={p.slug} className="group overflow-hidden transition-all hover:border-brand-800 hover:shadow-[6px_6px_0_0_var(--color-brand-800)]">
                <CardBody>
                  <Link to={`/programs/${p.slug}`} className="block">
                    <div className="flex items-start justify-between gap-3">
                      <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] bg-brand-800 text-white">
                        <Icon name="graduation-cap" size="md" colorRole="invert" />
                      </span>
                      <span aria-hidden="true" className="sig-display text-xl tabular-nums text-slate-300 transition-colors group-hover:text-accent-600">{String(pi + 1).padStart(2, "0")}</span>
                    </div>
                    <h2 className="mt-3 text-lg font-bold text-ink">
                      <span className="sig-u">{locale === "ar" ? p.titleAr : p.titleEn}</span>
                    </h2>
                    {desc && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{desc}</p>}
                    <p className="mt-3 inline-flex min-h-9 items-center gap-1 text-sm font-bold text-ink">
                      <span className="sig-u">{t(locale, "catalog.subjects")}: <span className="tabular-nums">{p.subjectCount}</span></span>
                      <span aria-hidden="true" className="text-accent-600 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5">→</span>
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
