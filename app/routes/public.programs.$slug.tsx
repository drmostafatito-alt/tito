import type { Route } from "./+types/public.programs.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { catalogCourses } from "~server/content/service.server";
import { programs, grades, subjects } from "~server/db/schema";
import { EmptyState } from "~/components/ui/EmptyState";
import { contentSeoMeta, rootMetaFrom } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";

/** Program page: published grades → subjects with visible-course counts. */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const rows = await db.select().from(programs).where(eq(programs.slug, params.slug)).limit(1);
  const program = rows[0];
  if (!program || program.status !== "published" || program.deletedAt) {
    throw new Response("Not Found", { status: 404 });
  }

  const gradeRows = await db
    .select()
    .from(grades)
    .where(and(eq(grades.programId, program.id), eq(grades.status, "published"), isNull(grades.deletedAt)))
    .orderBy(grades.sortOrder);

  const subjectRows = gradeRows.length
    ? await db
        .select()
        .from(subjects)
        .where(
          and(
            inArray(subjects.gradeId, gradeRows.map((g) => g.id)),
            eq(subjects.status, "published"),
            isNull(subjects.deletedAt)
          )
        )
        .orderBy(subjects.sortOrder)
    : [];

  // Visible-course counts per subject come from the catalog query (published +
  // visible + window + published ancestors), so counts never include hidden rows.
  const catalog = await catalogCourses(db);
  const counts: Record<string, number> = {};
  for (const r of catalog) {
    if (r.programSlug === program.slug) counts[r.subjectSlug] = (counts[r.subjectSlug] ?? 0) + 1;
  }

  return {
    program: {
      slug: program.slug,
      titleAr: program.titleAr,
      titleEn: program.titleEn,
      descriptionAr: program.descriptionAr,
      descriptionEn: program.descriptionEn,
    },
    grades: gradeRows.map((g) => ({
      id: g.id,
      titleAr: g.titleAr,
      titleEn: g.titleEn,
      subjects: subjectRows
        .filter((s) => s.gradeId === g.id)
        .map((s) => ({
          slug: s.slug,
          titleAr: s.titleAr,
          titleEn: s.titleEn,
          courseCount: counts[s.slug] ?? 0,
        })),
    })),
    url: request.url,
  };
}

/** SEO/social preview from the admin-edited program row (Admin → Content). */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  return contentSeoMeta(
    {
      title: { ar: loaderData.program.titleAr, en: loaderData.program.titleEn },
      description: { ar: loaderData.program.descriptionAr, en: loaderData.program.descriptionEn },
    },
    root.locale,
    loaderData.url,
    { siteName: root.siteName }
  );
}

export default function ProgramPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { program, grades } = loaderData;
  const desc = locale === "ar" ? program.descriptionAr : program.descriptionEn;
  const hasSubjects = grades.some((g) => g.subjects.length > 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <nav aria-label="breadcrumb" className="mb-6 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-muted">
        <Link to="/programs" className="font-semibold text-ink"><span className="sig-u">{t(locale, "catalog.programs")}</span></Link>
        <span aria-hidden="true">›</span>
        <span className="font-medium">{locale === "ar" ? program.titleAr : program.titleEn}</span>
      </nav>
      <h1 className="sig-display text-3xl text-ink sm:text-4xl">{locale === "ar" ? program.titleAr : program.titleEn}</h1>
      {desc && <p className="mt-3 max-w-2xl leading-relaxed text-ink-muted">{desc}</p>}

      {!hasSubjects ? (
        <div className="mt-8">
          <EmptyState title={t(locale, "catalog.noSubjects")} icon={<span aria-hidden="true">○</span>} />
        </div>
      ) : (
        <div className="mt-10">
          {grades.map((g, gi) =>
            g.subjects.length === 0 ? null : (
              <section key={g.id} aria-label={`${gi + 1}. ${locale === "ar" ? g.titleAr : g.titleEn}`} className="border-t-2 border-brand-800 py-6 last:border-b-2">
                <h2 className="sig-display mb-4 flex items-baseline gap-3 text-xl text-ink sm:text-2xl">
                  <span aria-hidden="true" className="text-base font-bold tabular-nums text-accent-500">{String(gi + 1).padStart(2, "0")}</span>
                  {locale === "ar" ? g.titleAr : g.titleEn}
                </h2>
                <ol>
                  {g.subjects.map((sub, si) => (
                    <li key={sub.slug} className="flex min-h-12 items-center gap-3 border-b border-line py-2.5 text-[15px] last:border-b-0">
                      <span aria-hidden="true" className="w-7 shrink-0 text-sm font-bold tabular-nums text-slate-400">{gi + 1}.{si + 1}</span>
                      <Link to={`/subjects/${sub.slug}`} className="min-w-0 flex-1 truncate font-semibold text-ink">
                        <span className="sig-u">{locale === "ar" ? sub.titleAr : sub.titleEn}</span>
                      </Link>
                      <span className="shrink-0 text-sm tabular-nums text-ink-muted">{t(locale, "content.coursesCount", { n: sub.courseCount })}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )
          )}
        </div>
      )}
    </div>
  );
}
