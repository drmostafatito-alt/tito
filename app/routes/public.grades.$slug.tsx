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
import { EXTERNAL_EXAMS_URL } from "~server/curriculum/constants";
import { Badge } from "~/components/ui/Badge";

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

  // Curriculum outline from 48 real lessons — dynamic import to keep client bundle clean
  const { getCurriculumLessons } = await import("~server/curriculum/service.server");
  const allCurriculum = getCurriculumLessons();
  const gradeTitleLower = grade.titleAr.toLowerCase();
  const curriculumForGrade = allCurriculum.filter((l: any) => {
    const csvGradeLower = (l.grade as string).toLowerCase();
    // Strict matching: grade must explicitly mention the same stage
    // - "الأول" ↔ "الصف الأول الثانوي"
    // - "بكالوريا" ↔ "مرحلة البكالوريا المصرية"
    // - otherwise exact or substring both ways but only if meaningful length
    if (gradeTitleLower.includes("بكالوريا") && csvGradeLower.includes("بكالوريا")) return true;
    if (gradeTitleLower.includes("الأول") && csvGradeLower.includes("الأول")) return true;
    // Avoid false positives for generic "صف فارغ" etc: require at least 4 chars overlap and not just "صف"
    if (gradeTitleLower.length >= 4 && csvGradeLower.length >= 4) {
      if (csvGradeLower.includes(gradeTitleLower) || gradeTitleLower.includes(csvGradeLower)) return true;
    }
    return false;
  });

  const bySubject = new Map<string, typeof curriculumForGrade>();
  for (const lesson of curriculumForGrade) {
    if (!bySubject.has(lesson.subject)) bySubject.set(lesson.subject, []);
    bySubject.get(lesson.subject)!.push(lesson);
  }
  const curriculumBySubject = Array.from(bySubject.entries()).map(([subject, lessons]) => ({
    subject,
    lessons,
    count: lessons.length,
  }));

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
    curriculumBySubject,
    curriculumCount: curriculumForGrade.length,
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
        const count = loaderData.curriculumCount ? (l === "ar" ? ` — ${loaderData.curriculumCount} درس حقيقي` : ` — ${loaderData.curriculumCount} real lessons`) : "";
        if (subjectTitles.length === 0) return l === "ar" ? `${g}${count} على منصة ${site}.` : `${g}${count} on the ${site} platform.`;
        const list = subjectTitles.join(l === "ar" ? "، " : ", ");
        return l === "ar" ? `مواد ${g}${count} على منصة ${site}: ${list}.` : `${g}${count} on the ${site} platform: ${list}.`;
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
  const extra: Array<Record<string, unknown>> = [];
  if (teaches.length > 0) {
    extra.push(
      definedTermSetJsonLd({
        name: locale === "ar" ? `مفاهيم ${g}` : `Concepts of ${g}`,
        url: absUrl(origin, pathname),
        terms: teaches,
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
  const { grade, program, subjects: subjectRows, curriculumBySubject, curriculumCount } = loaderData as any;

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

      {curriculumCount > 0 && (
        <div className="mt-10">
          <h2 className="mb-2 text-xl font-bold">
            {locale === "ar" ? `المنهج الحقيقي — ${curriculumCount} درس` : `Real Curriculum — ${curriculumCount} lessons`}
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            {locale === "ar" ? "دروس من ملفات الـ Keyword Universe الحقيقية، مربوطة بصفحات Tito العامة." : "Lessons from real Keyword Universe files, linked to Tito public pages."}
          </p>
          <div className="space-y-6">
            {(curriculumBySubject as any[]).map((group: any) => (
              <Card key={group.subject}>
                <CardBody>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Badge tone="brand">{group.count}</Badge>
                    <span>{group.subject}</span>
                  </h3>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {group.lessons.map((lesson: any) => (
                      <li key={lesson.slug}>
                        <Link to={`/curriculum/${lesson.slug}`} className="group flex items-start gap-2 rounded-lg border border-slate-200/70 p-3 hover:border-brand-300 hover:bg-brand-50/50">
                          <span className="mt-0.5 text-brand-500">•</span>
                          <span className="text-sm font-medium text-slate-800 group-hover:text-brand-700">{lesson.lesson}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>
          <div className="mt-4 flex gap-3 text-sm">
            <Link to="/curriculum" className="text-brand-600 hover:underline">{locale === "ar" ? "عرض كل المنهج" : "View full curriculum"}</Link>
            <span className="text-slate-300">·</span>
            <a href={EXTERNAL_EXAMS_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{locale === "ar" ? "منصة الأسئلة" : "Questions platform"} ↗</a>
          </div>
        </div>
      )}
    </div>
  );
}
