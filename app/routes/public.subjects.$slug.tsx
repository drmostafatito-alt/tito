import type { Route } from "./+types/public.subjects.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { eq } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { catalogCourses } from "~server/content/service.server";
import { lessonCounts, resolvePublicImageUrls, teacherNames } from "~server/cms/render.server";
import { subjects } from "~server/db/schema";
import { purchasableFor } from "~server/commerce/service.server";
import { formatMoney } from "~server/commerce/money";
import { Card, CardBody } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { contentSeoMeta, rootMetaFrom } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";

/** Subject page: visible courses of one published subject (catalog hierarchy). */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const rows = await db.select().from(subjects).where(eq(subjects.slug, params.slug)).limit(1);
  const subject = rows[0];
  if (!subject || subject.status !== "published" || subject.deletedAt) {
    throw new Response("Not Found", { status: 404 });
  }

  // Phase 6: subject-level access product CTA (server-read price)
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

  return {
    subject: {
      slug: subject.slug,
      titleAr: subject.titleAr,
      titleEn: subject.titleEn,
      descriptionAr: subject.descriptionAr,
      descriptionEn: subject.descriptionEn,
    },
    program: { slug: catalog[0]?.programSlug ?? null, titleAr: catalog[0]?.programAr ?? null, titleEn: catalog[0]?.programEn ?? null },
    buyOption,
    pres,
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

/** SEO/social preview from the admin-edited subject row (Admin → Content). */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  return contentSeoMeta(
    {
      title: { ar: loaderData.subject.titleAr, en: loaderData.subject.titleEn },
      description: { ar: loaderData.subject.descriptionAr, en: loaderData.subject.descriptionEn },
    },
    root.locale,
    loaderData.url,
    { siteName: root.siteName }
  );
}

export default function SubjectPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { subject, program, pres, courses, buyOption } = loaderData;
  const c = (row: { titleAr: string | null; titleEn: string | null }) => (locale === "ar" ? row.titleAr : row.titleEn);
  const desc = locale === "ar" ? subject.descriptionAr : subject.descriptionEn;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/courses" className="hover:text-brand-600">{t(locale, "content.catalogTitle")}</Link>
        {program.slug && program.titleAr && (
          <>
            <span className="mx-1.5" aria-hidden>›</span>
            <Link to={`/programs/${program.slug}`} className="hover:text-brand-600">{c(program)}</Link>
          </>
        )}
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-slate-700">{c(subject)}</span>
      </nav>
      <h1 className="text-2xl font-bold">{c(subject)}</h1>
      {desc && <p className="mt-2 text-slate-600">{desc}</p>}
      {buyOption && (
        <Link
          to={`/products/${buyOption.productSlug}`}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          data-testid="subject-buy-cta"
        >
          {t(locale, "commerce.buyCta")}
          <span dir="ltr">
            {t(locale, "commerce.fromPrice").replace("{price}", formatMoney(buyOption.minPriceMinor, buyOption.currency))}
          </span>
        </Link>
      )}

      {courses.length === 0 ? (
        <p className="mt-6 text-slate-500">{t(locale, "content.catalogEmpty")}</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {courses.map((course) => {
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
                        <h2 className="font-semibold text-slate-800 group-hover:text-brand-600">{c(course)}</h2>
                        <Badge tone={course.accessLevel === "public" ? "success" : course.accessLevel === "authenticated" ? "brand" : "neutral"}>
                          {t(locale, course.accessLevel === "public" ? "content.accessPublic" : course.accessLevel === "authenticated" ? "content.accessAuthenticated" : "content.accessEntitled")}
                        </Badge>
                      </div>
                      {meta.length > 0 && <p className="text-sm text-slate-500">{meta.join(" · ")}</p>}
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
