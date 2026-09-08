import type { Route } from "./+types/public.programs.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { catalogCourses } from "~server/content/service.server";
import { programs, grades, subjects } from "~server/db/schema";
import { Card, CardBody } from "~/components/ui/Card";
import { Icon } from "~/cms/icons";
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
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/programs" className="hover:text-brand-600">{t(locale, "catalog.programs")}</Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-slate-700">{locale === "ar" ? program.titleAr : program.titleEn}</span>
      </nav>
      <h1 className="text-2xl font-bold">{locale === "ar" ? program.titleAr : program.titleEn}</h1>
      {desc && <p className="mt-2 text-slate-600">{desc}</p>}

      {!hasSubjects ? (
        <p className="mt-6 text-slate-500">{t(locale, "catalog.noSubjects")}</p>
      ) : (
        <div className="mt-6 space-y-6">
          {grades.map((g) =>
            g.subjects.length === 0 ? null : (
              <section key={g.id}>
                <h2 className="mb-3 text-lg font-semibold text-slate-700">{locale === "ar" ? g.titleAr : g.titleEn}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {g.subjects.map((s) => (
                    <Card key={s.slug}>
                      <CardBody>
                        <Link to={`/subjects/${s.slug}`} className="group block">
                          <h3 className="flex items-center gap-2 font-medium text-slate-800 group-hover:text-brand-600">
                            <Icon name="book-open" className="h-4.5 w-4.5 shrink-0 text-brand-500" aria-hidden />
                            {locale === "ar" ? s.titleAr : s.titleEn}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {t(locale, "content.coursesCount", { n: s.courseCount })}
                          </p>
                        </Link>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              </section>
            )
          )}
        </div>
      )}
    </div>
  );
}
