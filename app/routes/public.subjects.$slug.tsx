import type { Route } from "./+types/public.subjects.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { eq } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { catalogCourses } from "~server/content/service.server";
import { lessonCounts, resolvePublicImageUrls, teacherNames } from "~server/cms/render.server";
import { grades, subjects } from "~server/db/schema";
import { purchasableFor } from "~server/commerce/service.server";
import { formatMoney } from "~server/commerce/money";
import { Card, CardBody } from "~/components/ui/Card";
import { pubBtnSm } from "~/lib/publicStyles";
import { Badge } from "~/components/ui/Badge";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, definedTermSetJsonLd, webPageJsonLd } from "~/cms/jsonld";
import { t, type Locale } from "~/lib/i18n";
import { extractSemanticKeywords } from "~server/seo/keywordClusters.server";
import { getRealLessonsForSubject, getLessonNamesForMeta, getSemanticForLessons } from "~server/seo/realLessonsMapping.server";

/**
 * Subject page: canonical target of BOTH the subject cluster
 * (`شرح الفلسفة`, `دروس علم النفس`…) and the grade+subject cluster
 * (`أولى ثانوي فلسفة`, `تالتة ثانوي علم نفس`…).
 *
 * SEO Discovery enhancement (48 real lessons, no homepage visibility):
 * - If subject matches real lessons subject (فلسفة ↔ فلسفة ومنطق, نفس ↔ علم النفس),
 *   enrich meta description with up to 2 example lesson names and add their semantic to DefinedTermSet.
 * - No UI change: students see only real courses from DB, no 48 lessons list.
 */

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const rows = await db.select().from(subjects).where(eq(subjects.slug, params.slug)).limit(1);
  const subject = rows[0];
  if (!subject || subject.status !== "published" || subject.deletedAt) {
    throw new Response("Not Found", { status: 404 });
  }

  const buyOption = await purchasableFor(db, { type: "subject", id: subject.id });

  const settings = await getSettings(db);
  const pres = settings.presentation.courseCard;
  const catalog = (await catalogCourses(db)).filter((r) => r.subjectSlug === subject.slug);
  const courseIds = catalog.map((r) => r.course.id);
  const [counts, names] = await Promise.all([
    lessonCounts(db, courseIds),
    teacherNames(db, catalog.map((r) => r.course.teacherId ?? "")),
  ]);
  const thumbs = catalog.map((r) => r.course.thumbnailFileId).filter((x): x is string => Boolean(x));
  const images = pres.showImage ? await resolvePublicImageUrls(db, thumbs) : {};

  const gradeRows = await db
    .select({ titleAr: grades.titleAr, titleEn: grades.titleEn, slug: grades.slug })
    .from(grades)
    .where(eq(grades.id, subject.gradeId))
    .limit(1);
  const grade = gradeRows[0] ?? null;

  const allCourseTitles = catalog.map((r) => r.course.titleAr).join(" ");
  const semanticKeywords = extractSemanticKeywords(allCourseTitles, "", subject.titleAr);

  // SEO Discovery: matching real lessons for this subject (from CSV, no guessing)
  const realLessonsForSubject = getRealLessonsForSubject(subject.titleAr);
  const realLessonNames = getLessonNamesForMeta(realLessonsForSubject, 3);
  const realLessonsSemantic = getSemanticForLessons(realLessonsForSubject, 12);

  return {
    subject: {
      slug: subject.slug,
      titleAr: subject.titleAr,
      titleEn: subject.titleEn,
      descriptionAr: subject.descriptionAr,
      descriptionEn: subject.descriptionEn,
    },
    grade: grade ? { slug: grade.slug, titleAr: grade.titleAr, titleEn: grade.titleEn } : null,
    program: { slug: catalog[0]?.programSlug ?? null, titleAr: catalog[0]?.programAr ?? null, titleEn: catalog[0]?.programEn ?? null },
    buyOption,
    pres,
    semanticKeywords,
    realLessonsForSubjectCount: realLessonsForSubject.length,
    realLessonNames,
    realLessonsSemantic,
    courses: catalog.map((r) => ({
      slug: r.course.slug,
      titleAr: r.course.titleAr,
      titleEn: r.course.titleEn,
      accessLevel: r.course.accessLevel,
      teacherName: (r.course.teacherId && names[r.course.teacherId]) || null,
      lessonCount: counts[r.course.id] ?? 0,
      imageUrl: (r.course.thumbnailFileId && images[r.course.thumbnailFileId]) || null,
    })),
    url: request.url,
  };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  const locale = root.locale;
  const grade = loaderData.grade ? { ar: loaderData.grade.titleAr, en: loaderData.grade.titleEn } : null;
  const realLessonNames = (loaderData.realLessonNames as string[]) ?? [];
  const realLessonsSemantic = (loaderData.realLessonsSemantic as string[]) ?? [];
  const base = contentSeoMeta(
    {
      title: { ar: loaderData.subject.titleAr, en: loaderData.subject.titleEn },
      description: { ar: loaderData.subject.descriptionAr, en: loaderData.subject.descriptionEn },
    },
    root.locale,
    loaderData.url,
    {
      siteName: root.siteName,
      intermediate: grade,
      fallbackDescription: (l) => {
        const s = l === "ar" ? loaderData.subject.titleAr : loaderData.subject.titleEn;
        const g = grade ? (l === "ar" ? grade.ar : grade.en) : "";
        const site = root.siteName ? (l === "ar" ? root.siteName.ar : root.siteName.en) : "";
        let baseDesc: string;
        if (l === "ar") {
          baseDesc = g ? `${s} — ${g}: محتوى تعليمي ودروس ومراجعات على منصة ${site}.` : `${s}: محتوى تعليمي ودروس ومراجعات على منصة ${site}.`;
        } else {
          baseDesc = g ? `${s} — ${g}: courses, lessons and revision on the ${site} platform.` : `${s}: courses, lessons and revision on the ${site} platform.`;
        }
        // SEO Discovery: add up to 2 example lesson names if subject matches real lessons
        if (realLessonNames.length > 0 && l === "ar") {
          const isRealSubject = s.includes("فلسفة") || s.includes("منطق") || s.includes("نفس") || s.includes("علم النفس");
          if (isRealSubject) {
            const examples = realLessonNames.slice(0, 2).join("، ");
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
    const u = new URL(loaderData.url);
    origin = u.origin;
    pathname = u.pathname;
  } catch {
    return [...siteEntitiesMeta(matches), ...base];
  }
  const crumbs: Array<{ name: string; url?: string | null }> = [
    { name: locale === "ar" ? "الرئيسية" : "Home", url: "/" },
    { name: locale === "ar" ? "المحتوى التعليمي" : "Learning content", url: "/study" },
  ];
  if (loaderData.program.slug && loaderData.program.titleAr) {
    crumbs.push({ name: locale === "ar" ? loaderData.program.titleAr : loaderData.program.titleEn, url: `/programs/${loaderData.program.slug}` });
  }
  crumbs.push({ name: locale === "ar" ? loaderData.subject.titleAr : loaderData.subject.titleEn });

  const teaches = (loaderData.semanticKeywords as string[]) ?? [];
  const allTeaches = [...teaches, ...realLessonsSemantic].slice(0, 20);
  const educationalLevel = loaderData.grade ? (locale === "ar" ? loaderData.grade.titleAr : loaderData.grade.titleEn) : null;

  const extra: Array<Record<string, unknown>> = [];
  if (allTeaches.length > 0) {
    extra.push(
      definedTermSetJsonLd({
        name: locale === "ar" ? `مفاهيم ${loaderData.subject.titleAr}` : `Concepts of ${loaderData.subject.titleEn}`,
        url: absUrl(origin, pathname),
        terms: allTeaches,
      })
    );
  }

  return [
    ...siteEntitiesMeta(matches),
    ...base,
    {
      "script:ld+json": webPageJsonLd({
        name: locale === "ar" ? loaderData.subject.titleAr : loaderData.subject.titleEn,
        url: absUrl(origin, pathname),
        description: locale === "ar" ? loaderData.subject.descriptionAr : loaderData.subject.descriptionEn,
        isPartOf: absUrl(origin, "/"),
        additionalType: "https://schema.org/CollectionPage",
        educationalLevel,
      }),
    },
    ...extra.map((e) => ({ "script:ld+json": e })),
    { "script:ld+json": breadcrumbJsonLd({ items: crumbs, origin }) },
  ];
}

export default function SubjectPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { subject, program, grade, pres, courses, buyOption } = loaderData as any;
  const c = (row: { titleAr: string | null; titleEn: string | null }) => (locale === "ar" ? row.titleAr : row.titleEn);
  const desc = locale === "ar" ? subject.descriptionAr : subject.descriptionEn;

  return (
    <div className="mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] py-[var(--pub-pad-y)]">
      <nav aria-label="breadcrumb" className="mb-3 text-pub-sm text-pub-muted">
        <Link to="/study" className="hover:text-pub-navy">{t(locale, "study.title")}</Link>
        {program.slug && program.titleAr && (
          <>
            <span className="mx-1.5" aria-hidden>›</span>
            <Link to={`/programs/${program.slug}`} className="hover:text-pub-navy">{c(program)}</Link>
          </>
        )}
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-pub-ink-soft">{c(subject)}</span>
      </nav>
      <h1 className="text-pub-h2 font-extrabold tracking-tight text-pub-ink">{c(subject)}</h1>
      {desc && <p className="mt-2 text-pub-muted">{desc}</p>}
      {grade && (
        <Link
          to={`/grades/${grade.slug}`}
          className={pubBtnSm("secondary", "mt-3")}
        >
          {c(grade)}
        </Link>
      )}
      {buyOption && (
        <Link
          to={`/products/${buyOption.productSlug}`}
          className={pubBtnSm("primary", "mt-3")}
          data-testid="subject-buy-cta"
        >
          {t(locale, "commerce.buyCta")}
          <span dir="ltr">
            {t(locale, "commerce.fromPrice").replace("{price}", formatMoney(buyOption.minPriceMinor, buyOption.currency))}
          </span>
        </Link>
      )}

      {courses.length === 0 ? (
        <p className="mt-6 text-pub-muted">{t(locale, "content.catalogEmpty")}</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {courses.map((course: any) => {
            const meta: string[] = [];
            if (pres.showTeacher && course.teacherName) meta.push(course.teacherName);
            if (pres.showLessonCount) meta.push(t(locale, "content.lessonsCount", { n: course.lessonCount }));
            return (
              <Card key={course.slug}>
                <CardBody className="p-0">
                  <Link to={`/courses/${course.slug}`} className="group block">
                    {pres.showImage && course.imageUrl && (
                      <img src={course.imageUrl} alt="" className="h-32 w-full rounded-t-xl object-cover" />
                    )}
                    <div className="p-4">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <h2 className="text-pub-md font-bold text-pub-ink group-hover:text-pub-navy">{c(course)}</h2>
                        <Badge tone={course.accessLevel === "public" ? "success" : course.accessLevel === "authenticated" ? "brand" : "neutral"}>
                          {t(locale, course.accessLevel === "public" ? "content.accessPublic" : course.accessLevel === "authenticated" ? "content.accessAuthenticated" : "content.accessEntitled")}
                        </Badge>
                      </div>
                      {meta.length > 0 && <p className="text-pub-sm text-pub-muted">{meta.join(" · ")}</p>}
                    </div>
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
