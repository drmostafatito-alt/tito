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
import { absUrl, breadcrumbJsonLd, definedTermSetJsonLd, webPageJsonLd } from "~/cms/jsonld";
import { t, type Locale } from "~/lib/i18n";
import { extractSemanticKeywords } from "~server/seo/keywordClusters.server";
import { getRealLessonsForGrade, getLessonNamesForMeta, getSemanticForLessons } from "~server/seo/realLessonsMapping.server";

/**
 * Grade landing page (SEO Master Phase, batch 4 + Lesson Phase + SEO Discovery).
 *
 * The canonical destination for the "grade" keyword cluster.
 * Real content only: published grade row + its published subjects.
 *
 * SEO Discovery enhancement (48 real lessons, no homepage visibility):
 * - If grade title matches real lessons grade (e.g., "الصف الأول الثانوي" ↔ 24 lessons, "بكالوريا" ↔ 24 lessons),
 *   we enrich meta description with up to 2 example lesson names (natural, no stuffing) and add their semantic
 *   keywords to DefinedTermSet structured data. This helps Google discover existing grade page when user searches
 *   for lesson name like "معنى التفكير الإنساني وتطبيقاته" or "الذكاءات المتعددة".
 * - No UI change: students still see only published subjects from DB, no 48 lessons list.
 * - No new pages, no doorway, no thin.
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

  const catalog = await catalogCourses(db);
  const counts: Record<string, number> = {};
  for (const r of catalog) counts[r.subjectSlug] = (counts[r.subjectSlug] ?? 0) + 1;

  const settings = await getSettings(db);
  const siteName = { ar: settings.platform.nameAr, en: settings.platform.nameEn };

  const allSubjectTitles = subjectRows.map((s) => s.titleAr).join(" ");
  const semanticKeywords = extractSemanticKeywords(allSubjectTitles, grade.titleAr, "");

  // SEO Discovery: matching real lessons for this grade (from CSV, no guessing)
  const realLessonsForGrade = getRealLessonsForGrade(grade.titleAr);
  const realLessonNames = getLessonNamesForMeta(realLessonsForGrade, 3);
  const realLessonsSemantic = getSemanticForLessons(realLessonsForGrade, 12);

  return {
    grade: { slug: grade.slug, titleAr: grade.titleAr, titleEn: grade.titleEn },
    program: program ? { slug: program.slug, titleAr: program.titleAr, titleEn: program.titleEn } : null,
    subjects: subjectRows.map((s) => ({
      slug: s.slug,
      titleAr: s.titleAr,
      titleEn: s.titleEn,
      courseCount: counts[s.slug] ?? 0,
    })),
    semanticKeywords,
    realLessonsForGradeCount: realLessonsForGrade.length,
    realLessonNames,
    realLessonsSemantic,
    siteName,
    url: request.url,
  };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  const locale = root.locale;
  const grade = loaderData.grade as { titleAr: string; titleEn: string };
  const siteName = loaderData.siteName as { ar: string; en: string };
  const subjectTitles = (loaderData.subjects as Array<{ titleAr: string; titleEn: string }>).map((s) =>
    locale === "ar" ? s.titleAr : s.titleEn
  );
  const realLessonNames = (loaderData.realLessonNames as string[]) ?? [];
  const realLessonsSemantic = (loaderData.realLessonsSemantic as string[]) ?? [];
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
        // Base: materials list
        let baseDesc: string;
        if (subjectTitles.length === 0) {
          baseDesc = l === "ar" ? `${g} على منصة ${site}.` : `${g} on the ${site} platform.`;
        } else {
          const list = subjectTitles.join(l === "ar" ? "، " : ", ");
          baseDesc = l === "ar" ? `مواد ${g} على منصة ${site}: ${list}.` : `${g} on the ${site} platform: ${list}.`;
        }
        // SEO Discovery enrichment: add up to 2 example lesson names if matching grade has real lessons
        // Natural, not stuffing, only when grade matches real lessons grade
        if (realLessonNames.length > 0 && l === "ar") {
          const examples = realLessonNames.slice(0, 2).join("، ");
          // Only enrich if grade is one of the 2 real grades (الأول, بكالوريا) to avoid false positives for "صف فارغ"
          const isRealGrade = g.includes("الأول") || g.includes("بكالوريا") || g.includes("الثانوي");
          if (isRealGrade) {
            baseDesc += ` تشمل دروس: ${examples}.`;
          }
        }
        return baseDesc;
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

  const teaches = (loaderData.semanticKeywords as string[]) ?? [];
  // Merge with real lessons semantic for richer topical authority (honest, from CSV)
  const allTeaches = [...teaches, ...realLessonsSemantic].slice(0, 20);
  const extra: Array<Record<string, unknown>> = [];
  if (allTeaches.length > 0) {
    extra.push(
      definedTermSetJsonLd({
        name: locale === "ar" ? `مفاهيم ${g}` : `Concepts of ${g}`,
        url: absUrl(origin, pathname),
        terms: allTeaches,
      })
    );
  }

  const description = (base as Array<Record<string, unknown>>).find((b) => (b as any).name === "description")?.content as string | undefined;
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
        educationalLevel: g,
      }),
    },
    ...extra.map((e) => ({ "script:ld+json": e })),
    { "script:ld+json": breadcrumbJsonLd({ items: crumbs, origin }) },
  ];
}

export default function GradePage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { grade, program, subjects: subjectRows } = loaderData as any;
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
          {subjectRows.map((s: any) => (
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
