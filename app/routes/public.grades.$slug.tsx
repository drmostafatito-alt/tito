import type { Route } from "./+types/public.grades.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { catalogCourses } from "~server/content/service.server";
import { grades, programs, subjects } from "~server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { Card, CardBody } from "~/components/ui/Card";
import { Icon } from "~/cms/icons";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, webPageJsonLd } from "~/cms/jsonld";
import { t, type Locale } from "~/lib/i18n";

/**
 * Grade landing page (SEO Master Phase, batch 4).
 *
 * The canonical destination for the "grade" keyword cluster (الصف الثالث
 * الثانوي، تالتة ثانوي، …). Real content only: the grade is a published CMS row
 * and the listed subjects/courses are its published rows — nothing synthesized
 * beyond joining the titles that already exist. Draft/deleted grades 404.
 *
 * Hierarchy: program → grade → subject → course. This page links down to the
 * grade's subjects (which link to their courses) and up to its program —
 * grade ↔ subject cross-linking per the topical architecture.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const rows = await db.select().from(grades).where(eq(grades.slug, params.slug)).limit(1);
  const grade = rows[0];
  if (!grade || grade.status !== "published" || grade.deletedAt) {
    throw new Response("Not Found", { status: 404 });
  }

  const programRows = await db
    .select({ slug: programs.slug, titleAr: programs.titleAr, titleEn: programs.titleEn })
    .from(programs)
    .where(eq(programs.id, grade.programId))
    .limit(1);
  const program = programRows[0] ?? null;

  const subjectRows = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.gradeId, grade.id), eq(subjects.status, "published"), isNull(subjects.deletedAt)))
    .orderBy(subjects.sortOrder);

  // Published-course count per subject from the same catalog query the
  // catalog pages use (visibility/window/ancestor rules included).
  const catalog = await catalogCourses(db);
  const counts: Record<string, number> = {};
  for (const r of catalog) counts[r.subjectSlug] = (counts[r.subjectSlug] ?? 0) + 1;

  const settings = await getSettings(db);
  const siteName = { ar: settings.platform.nameAr, en: settings.platform.nameEn };

  return {
    grade: { slug: grade.slug, titleAr: grade.titleAr, titleEn: grade.titleEn },
    program: program ? { slug: program.slug, titleAr: program.titleAr, titleEn: program.titleEn } : null,
    subjects: subjectRows.map((s) => ({
      slug: s.slug,
      titleAr: s.titleAr,
      titleEn: s.titleEn,
      courseCount: counts[s.slug] ?? 0,
    })),
    siteName,
    url: request.url,
  };
}

/**
 * Deterministic meta for the grade cluster:
 * title `grade — brand`, description synthesized from the REAL subject titles
 * the page lists (no keyword stuffing). WebPage + BreadcrumbList structured
 * data mirror the visible trail.
 */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  const locale = root.locale;
  const grade = loaderData.grade as { titleAr: string; titleEn: string };
  const siteName = loaderData.siteName as { ar: string; en: string };
  const subjectTitles = (loaderData.subjects as Array<{ titleAr: string; titleEn: string }>).map((s) =>
    locale === "ar" ? s.titleAr : s.titleEn
  );
  const base = contentSeoMeta(
    {
      title: { ar: grade.titleAr, en: grade.titleEn },
      description: null,
    },
    root.locale,
    loaderData.url as string,
    {
      siteName: root.siteName ?? siteName,
      fallbackDescription: (l) => {
        const g = l === "ar" ? grade.titleAr : grade.titleEn;
        const site = l === "ar" ? (root.siteName?.ar ?? siteName.ar) : (root.siteName?.en ?? siteName.en);
        if (subjectTitles.length === 0) return l === "ar" ? `${g} على منصة ${site}.` : `${g} on the ${site} platform.`;
        const list = subjectTitles.join(l === "ar" ? "، " : ", ");
        return l === "ar" ? `مواد ${g} على منصة ${site}: ${list}.` : `${g} on the ${site} platform: ${list}.`;
      },
    }
  );
  let origin = "";
  let pathname = "";
  try {
    const u = new URL(loaderData.url as string);
    origin = u.origin;
    pathname = u.pathname;
  } catch {
    return [...siteEntitiesMeta(matches), ...base];
  }
  const g = locale === "ar" ? grade.titleAr : grade.titleEn;
  const crumbs: Array<{ name: string; url?: string | null }> = [
    { name: locale === "ar" ? "الرئيسية" : "Home", url: "/" },
    { name: t(locale, "catalog.programs"), url: "/programs" },
  ];
  const program = loaderData.program as { slug: string; titleAr: string; titleEn: string } | null;
  if (program?.slug) {
    crumbs.push({ name: locale === "ar" ? program.titleAr : program.titleEn, url: `/programs/${program.slug}` });
  }
  crumbs.push({ name: g });
  const description = (base as Array<Record<string, unknown>>).find((b) => b.name === "description")?.content as string | undefined;
  return [
    ...siteEntitiesMeta(matches),
    ...base,
    {
      "script:ld+json": webPageJsonLd({
        name: g,
        url: absUrl(origin, pathname),
        description,
        isPartOf: absUrl(origin, "/"),
        additionalType: "https://schema.org/CollectionPage",
      }),
    },
    { "script:ld+json": breadcrumbJsonLd({ items: crumbs, origin }) },
  ];
}

export default function GradePage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { grade, program, subjects: subjectRows } = loaderData;
  const c = (row: { titleAr: string; titleEn: string }) => (locale === "ar" ? row.titleAr : row.titleEn);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/programs" className="hover:text-brand-600">{t(locale, "catalog.programs")}</Link>
        {program && (
          <>
            <span className="mx-1.5" aria-hidden>›</span>
            <Link to={`/programs/${program.slug}`} className="hover:text-brand-600">{c(program)}</Link>
          </>
        )}
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-slate-700">{c(grade)}</span>
      </nav>
      <h1 className="text-2xl font-bold">{c(grade)}</h1>

      {subjectRows.length === 0 ? (
        <p className="mt-6 text-slate-500">{t(locale, "catalog.noSubjects")}</p>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subjectRows.map((s) => (
            <Card key={s.slug}>
              <CardBody>
                <Link to={`/subjects/${s.slug}`} className="group block">
                  <h2 className="flex items-center gap-2 font-medium text-slate-800 group-hover:text-brand-600">
                    <Icon name="book-open" className="h-4.5 w-4.5 shrink-0 text-brand-500" aria-hidden />
                    {c(s)}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {t(locale, "content.coursesCount", { n: s.courseCount })}
                  </p>
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
