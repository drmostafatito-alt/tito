import type { Route } from "./+types/public.curriculum";
import { Link, useRouteLoaderData } from "react-router";
import { EXTERNAL_EXAMS_URL } from "~server/curriculum/constants";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, webPageJsonLd, itemListJsonLd } from "~/cms/jsonld";
import { type Locale } from "~/lib/i18n";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";

export async function loader({ request }: Route.LoaderArgs) {
  const { groupBySubject, getCurriculumStats } = await import("~server/curriculum/service.server");
  const groups = groupBySubject();
  const stats = getCurriculumStats();
  return { groups, stats, url: request.url };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  const locale = root.locale;
  const title = locale === "ar" ? "المنهج الدراسي — د/ مصطفى تيتو" : "Curriculum — Dr Mostafa Tito";
  const description =
    locale === "ar"
      ? `المنهج الدراسي الكامل: ${(loaderData as any).stats.totalLessons} درس حقيقي — ${(loaderData as any).stats.subjects.join("، ")} — ${(loaderData as any).stats.grades.join("، ")} — شرح، ملخص، مراجعة، أسئلة، امتحانات، فيديو، PDF — منصة مصطفى تيتو`
      : `Full curriculum: ${(loaderData as any).stats.totalLessons} real lessons — ${(loaderData as any).stats.subjects.join(", ")} — explanation, summary, revision, questions, exams, video, PDF`;

  const base = contentSeoMeta(
    { title: { ar: title, en: title }, description: { ar: description, en: description } },
    root.locale,
    (loaderData as any).url as string,
    { siteName: root.siteName }
  );

  let origin = "";
  let pathname = "";
  try {
    const u = new URL((loaderData as any).url as string);
    origin = u.origin;
    pathname = u.pathname;
  } catch {
    return [...siteEntitiesMeta(matches), ...base];
  }

  const crumbs = [
    { name: locale === "ar" ? "الرئيسية" : "Home", url: "/" },
    { name: locale === "ar" ? "المنهج الدراسي" : "Curriculum" },
  ];

  const allLessons = ((loaderData as any).groups as any[]).flatMap((g: any) => g.terms.flatMap((tt: any) => tt.units.flatMap((u: any) => u.chapters.flatMap((c: any) => c.lessons))));
  const itemList = itemListJsonLd({
    name: title,
    url: absUrl(origin, pathname),
    items: allLessons.slice(0, 20).map((l: any) => ({
      name: l.lesson,
      url: absUrl(origin, `/curriculum/${l.slug}`),
    })),
  });

  return [
    ...siteEntitiesMeta(matches),
    ...base,
    { "script:ld+json": webPageJsonLd({ name: title, url: absUrl(origin, pathname), description, isPartOf: absUrl(origin, "/"), additionalType: "https://schema.org/CollectionPage" }) },
    { "script:ld+json": breadcrumbJsonLd({ items: crumbs, origin }) },
    { "script:ld+json": itemList },
  ];
}

export default function CurriculumPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { groups, stats } = loaderData as any;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/" className="hover:text-brand-600">{locale === "ar" ? "الرئيسية" : "Home"}</Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-slate-700">{locale === "ar" ? "المنهج الدراسي" : "Curriculum"}</span>
      </nav>

      <h1 className="text-2xl font-bold">{locale === "ar" ? "المنهج الدراسي" : "Curriculum"}</h1>
      <p className="mt-2 text-slate-600">
        {locale === "ar"
          ? `المنهج الكامل من الملفات الحقيقية: ${stats.totalLessons} درس — ${stats.subjects.join("، ")} — ${stats.grades.join("، ")}`
          : `Full curriculum from real files: ${stats.totalLessons} lessons — ${stats.subjects.join(", ")} — ${stats.grades.join(", ")}`}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200/70 p-3 text-center">
          <div className="text-lg font-bold">{stats.totalLessons}</div>
          <div className="text-xs text-slate-500">{locale === "ar" ? "درس حقيقي" : "real lessons"}</div>
        </div>
        <div className="rounded-lg border border-slate-200/70 p-3 text-center">
          <div className="text-lg font-bold">{stats.subjects.length}</div>
          <div className="text-xs text-slate-500">{locale === "ar" ? "مواد" : "subjects"}</div>
        </div>
        <div className="rounded-lg border border-slate-200/70 p-3 text-center">
          <div className="text-lg font-bold">{stats.units}</div>
          <div className="text-xs text-slate-500">{locale === "ar" ? "وحدات" : "units"}</div>
        </div>
        <div className="rounded-lg border border-slate-200/70 p-3 text-center">
          <div className="text-lg font-bold">{stats.chapters}</div>
          <div className="text-xs text-slate-500">{locale === "ar" ? "فصول" : "chapters"}</div>
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {(groups as any[]).map((subjectGroup: any) => (
          <Card key={`${subjectGroup.subject}-${subjectGroup.grade}`}>
            <CardHeader
              title={`${subjectGroup.subject} — ${subjectGroup.grade}`}
              description={`${subjectGroup.terms.reduce((sum: number, tt: any) => sum + tt.units.reduce((s: number, u: any) => s + u.chapters.reduce((c: number, ch: any) => c + ch.lessons.length, 0), 0), 0)} درس`}
            />
            <CardBody className="space-y-6">
              {subjectGroup.terms.map((termGroup: any) => (
                <div key={termGroup.term}>
                  <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                    <Badge tone="brand">{termGroup.term}</Badge>
                    <span>{termGroup.term}</span>
                  </h3>
                  <div className="space-y-4">
                    {termGroup.units.map((unitGroup: any) => (
                      <div key={unitGroup.unit} className="rounded-lg border border-slate-200/70 p-4">
                        <h4 className="font-medium text-slate-800">{unitGroup.unit}</h4>
                        <div className="mt-3 space-y-3">
                          {unitGroup.chapters.map((chapterGroup: any) => (
                            <div key={chapterGroup.chapter}>
                              <h5 className="text-sm font-medium text-slate-600">{chapterGroup.chapter}</h5>
                              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                                {chapterGroup.lessons.map((lesson: any) => (
                                  <li key={lesson.slug}>
                                    <Link
                                      to={`/curriculum/${lesson.slug}`}
                                      className="group flex items-start gap-2 rounded-lg border border-slate-200/70 p-3 hover:border-brand-300 hover:bg-brand-50/50"
                                    >
                                      <span className="mt-0.5 text-brand-500">•</span>
                                      <span className="text-sm font-medium text-slate-800 group-hover:text-brand-700">{lesson.lesson}</span>
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-2">
                <Link to={`/subjects/${subjectGroup.terms[0]?.units[0]?.chapters[0]?.lessons[0]?.subjectSlug ?? "falsafa-manteq-1st"}`} className="text-sm text-brand-600 hover:underline">
                  {locale === "ar" ? `عرض مادة ${subjectGroup.subject}` : `View ${subjectGroup.subject}`}
                </Link>
                <span className="text-slate-300">·</span>
                <Link to={`/grades/${subjectGroup.terms[0]?.units[0]?.chapters[0]?.lessons[0]?.gradeSlug ?? "grade-1-secondary"}`} className="text-sm text-brand-600 hover:underline">
                  {locale === "ar" ? `عرض ${subjectGroup.grade}` : `View ${subjectGroup.grade}`}
                </Link>
                <span className="text-slate-300">·</span>
                <a href={EXTERNAL_EXAMS_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:underline">
                  {locale === "ar" ? "منصة الأسئلة والامتحانات" : "Questions Platform"} ↗
                </a>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
