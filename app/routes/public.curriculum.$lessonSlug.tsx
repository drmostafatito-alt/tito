import type { Route } from "./+types/public.curriculum.$lessonSlug";
import { Link, useRouteLoaderData } from "react-router";
import { EXTERNAL_EXAMS_URL } from "~server/curriculum/constants";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, definedTermSetJsonLd, learningResourceJsonLd, webPageJsonLd } from "~/cms/jsonld";
import { type Locale } from "~/lib/i18n";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";

export async function loader({ params, request }: Route.LoaderArgs) {
  const { getLessonBySlug, getRelatedLessons } = await import("~server/curriculum/service.server");
  const lesson = getLessonBySlug(params.lessonSlug);
  if (!lesson) throw new Response("Not Found", { status: 404 });
  const related = getRelatedLessons(lesson);
  return { lesson, related, url: request.url };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  const locale = root.locale;
  const lesson = (loaderData as any).lesson;

  const title = locale === "ar" ? `${lesson.lesson} — ${lesson.subject} — ${lesson.grade} — د/ مصطفى تيتو` : `${lesson.lesson} — ${lesson.subject} — ${lesson.grade} — Dr Mostafa Tito`;
  const description =
    locale === "ar"
      ? `${lesson.lesson} ضمن ${lesson.chapter}، ${lesson.unit}، ${lesson.subject} ${lesson.grade} ${lesson.term}. مفاهيم: ${lesson.semantic.slice(0, 5).join("، ")}. شرح، ملخص، مراجعة، أسئلة، امتحان، فيديو، PDF على منصة مصطفى تيتو.`
      : `${lesson.lesson} in ${lesson.chapter}, ${lesson.unit}, ${lesson.subject} ${lesson.grade} ${lesson.term}. Concepts: ${lesson.semantic.slice(0, 5).join(", ")}.`;

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
    { name: locale === "ar" ? "المنهج الدراسي" : "Curriculum", url: "/curriculum" },
    { name: lesson.subject, url: `/subjects/${lesson.subjectSlug}` },
    { name: lesson.grade, url: `/grades/${lesson.gradeSlug}` },
    { name: lesson.unit },
    { name: lesson.lesson },
  ];

  const educationalLevel = lesson.grade;
  const teaches = lesson.semantic.slice(0, 8);

  return [
    ...siteEntitiesMeta(matches),
    ...base,
    {
      "script:ld+json": webPageJsonLd({
        name: lesson.lesson,
        url: absUrl(origin, pathname),
        description,
        isPartOf: absUrl(origin, "/"),
        additionalType: "https://schema.org/LearningResource",
        educationalLevel,
      }),
    },
    {
      "script:ld+json": learningResourceJsonLd({
        name: lesson.lesson,
        url: absUrl(origin, pathname),
        description,
        educationalLevel,
        teaches,
        isPartOf: absUrl(origin, `/subjects/${lesson.subjectSlug}`),
        learningResourceType: "Lesson",
      }),
    },
    {
      "script:ld+json": definedTermSetJsonLd({
        name: locale === "ar" ? `مفاهيم ${lesson.lesson}` : `Concepts of ${lesson.lesson}`,
        url: absUrl(origin, pathname),
        terms: lesson.semantic.slice(0, 12),
      }),
    },
    { "script:ld+json": breadcrumbJsonLd({ items: crumbs, origin }) },
  ];
}

export default function CurriculumLessonPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { lesson, related } = loaderData as any;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/curriculum" className="hover:text-brand-600">{locale === "ar" ? "المنهج الدراسي" : "Curriculum"}</Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <Link to={`/subjects/${lesson.subjectSlug}`} className="hover:text-brand-600">{lesson.subject}</Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <Link to={`/grades/${lesson.gradeSlug}`} className="hover:text-brand-600">{lesson.grade}</Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-slate-700">{lesson.lesson}</span>
      </nav>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="brand">{lesson.subject}</Badge>
        <Badge tone="neutral">{lesson.grade}</Badge>
        <Badge tone="neutral">{lesson.term}</Badge>
      </div>

      <h1 className="text-2xl font-bold">{lesson.lesson}</h1>
      <p className="mt-2 text-slate-600">
        {locale === "ar"
          ? `هذا الدرس جزء من ${lesson.chapter} ضمن ${lesson.unit}، مادة ${lesson.subject}، ${lesson.grade}، ${lesson.term}.`
          : `This lesson is part of ${lesson.chapter} in ${lesson.unit}, ${lesson.subject} ${lesson.grade} ${lesson.term}.`}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={locale === "ar" ? "مكان الدرس في المنهج" : "Lesson Place in Curriculum"} />
            <CardBody className="space-y-2 text-sm">
              <div><span className="text-slate-500">{locale === "ar" ? "المادة:" : "Subject:"}</span> <Link to={`/subjects/${lesson.subjectSlug}`} className="font-medium text-brand-600 hover:underline">{lesson.subject}</Link></div>
              <div><span className="text-slate-500">{locale === "ar" ? "الصف:" : "Grade:"}</span> <Link to={`/grades/${lesson.gradeSlug}`} className="font-medium text-brand-600 hover:underline">{lesson.grade}</Link></div>
              <div><span className="text-slate-500">{locale === "ar" ? "الترم/الجزء:" : "Term:"}</span> {lesson.term}</div>
              <div><span className="text-slate-500">{locale === "ar" ? "الوحدة:" : "Unit:"}</span> {lesson.unit}</div>
              <div><span className="text-slate-500">{locale === "ar" ? "الفصل:" : "Chapter:"}</span> {lesson.chapter}</div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={locale === "ar" ? "مفاهيم ومصطلحات مرتبطة" : "Related Concepts"} />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {lesson.semantic.map((term: string) => (
                  <Badge key={term} tone="neutral">{term}</Badge>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {locale === "ar"
                  ? "هذه المفاهيم مستخرجة من ملفات الـ Keyword Universe الحقيقية (لا تخمين) وتُستخدم لبناء topical authority."
                  : "These concepts are from real Keyword Universe files (no guessing) for topical authority."}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={locale === "ar" ? "المحتوى التعليمي" : "Educational Content"} />
            <CardBody className="space-y-4">
              <div>
                <h3 className="font-medium text-slate-800">{locale === "ar" ? "شرح الدرس" : "Explanation"}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {locale === "ar"
                    ? `شرح ${lesson.lesson} سيتم إضافته هنا عندما يتوفر المصدر الحقيقي من المنهج أو من المعلم. حاليًا هذه الصفحة تخدم كـ hub للمنهج وتربط الطالب بالمادة والوحدة والدروس المرتبطة.`
                    : `Explanation for ${lesson.lesson} will be added when real source is available. This page serves as curriculum hub.`}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-slate-800">{locale === "ar" ? "ملخص" : "Summary"}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {locale === "ar"
                    ? `ملخص ${lesson.lesson} — يتضمن أهم النقاط والمفاهيم الأساسية. المحتوى الحقيقي يحتاج مصدر من الكتاب المدرسي أو ملازم المعلم.`
                    : `Summary — key points and concepts. Real content needs source from textbook.`}
                </p>
              </div>
              <div>
                <h3 className="font-medium text-slate-800">{locale === "ar" ? "مراجعة" : "Revision"}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {locale === "ar"
                    ? `مراجعة ${lesson.lesson} — أسئلة وأفكار رئيسية للمراجعة النهائية.`
                    : `Revision — key questions for final review.`}
                </p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {locale === "ar"
                  ? "ℹ️ المحتوى التعليمي التفصيلي (شرح، ملخص، مراجعة) غير موجود حاليًا في الـrepo. هذه الصفحة مصممة كبنية تحتية قوية قابلة للفهرسة، ويمكن ملؤها لاحقًا بدون إعادة بناء عبر import pipeline."
                  : "ℹ️ Detailed educational content not in repo yet. This page is infrastructure ready for future content via import pipeline."}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={locale === "ar" ? "أسئلة وامتحانات" : "Questions & Exams"} />
            <CardBody>
              <p className="text-sm text-slate-600">
                {locale === "ar"
                  ? `أسئلة، تدريبات، وامتحانات على ${lesson.lesson} متاحة على منصة الأسئلة الخارجية.`
                  : `Questions, practice, and exams for ${lesson.lesson} are on external platform.`}
              </p>
              <a href={EXTERNAL_EXAMS_URL} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
                {locale === "ar" ? `حل أسئلة ${lesson.lesson}` : `Practice ${lesson.lesson}`} ↗
              </a>
              <p className="mt-2 text-xs text-slate-500">
                {locale === "ar"
                  ? "Tito لا يستضيف Question Bank داخلي — الأسئلة على منصة خارجية منفصلة."
                  : "Tito does not host internal Question Bank — external platform only."}
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title={locale === "ar" ? "روابط داخلية" : "Internal Links"} />
            <CardBody className="space-y-2 text-sm">
              <Link to={`/subjects/${lesson.subjectSlug}`} className="block text-brand-600 hover:underline">📚 {lesson.subject}</Link>
              <Link to={`/grades/${lesson.gradeSlug}`} className="block text-brand-600 hover:underline">🎓 {lesson.grade}</Link>
              <Link to="/curriculum" className="block text-brand-600 hover:underline">📖 {locale === "ar" ? "كل المنهج" : "Full Curriculum"}</Link>
              <a href={EXTERNAL_EXAMS_URL} target="_blank" rel="noopener noreferrer" className="block text-brand-600 hover:underline">📝 {locale === "ar" ? "منصة الامتحانات" : "Exams Platform"} ↗</a>
            </CardBody>
          </Card>

          {related.length > 0 && (
            <Card>
              <CardHeader title={locale === "ar" ? "دروس مرتبطة في نفس الوحدة" : "Related Lessons in Same Unit"} />
              <CardBody className="space-y-2">
                {related.map((r: any) => (
                  <Link key={r.slug} to={`/curriculum/${r.slug}`} className="block rounded-lg border border-slate-200/70 p-3 text-sm hover:border-brand-300 hover:bg-brand-50/50">
                    <span className="font-medium text-slate-800">{r.lesson}</span>
                    <span className="mt-1 block text-xs text-slate-500">{r.chapter}</span>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={locale === "ar" ? "SEO" : "SEO"} />
            <CardBody className="text-xs text-slate-500">
              <div>Canonical: <code className="text-slate-700">/curriculum/{lesson.slug}</code></div>
              <div className="mt-1">Intent: شرح، ملخص، مراجعة، فيديو، PDF → نفس الصفحة (واحد قوي)</div>
              <div className="mt-1">Questions → {EXTERNAL_EXAMS_URL}</div>
              <div className="mt-1">No doorway, no thin, no stuffing</div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
