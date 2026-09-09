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
import { EmptyState } from "~/components/ui/EmptyState";
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <nav aria-label="breadcrumb" className="mb-6 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-muted">
        <Link to="/courses" className="font-semibold text-ink"><span className="sig-u">{t(locale, "content.catalogTitle")}</span></Link>
        {program.slug && program.titleAr && (
          <>
            <span aria-hidden="true">›</span>
            <Link to={`/programs/${program.slug}`} className="font-semibold text-ink"><span className="sig-u">{c(program)}</span></Link>
          </>
        )}
        <span aria-hidden="true">›</span>
        <span className="font-medium">{c(subject)}</span>
      </nav>
      <h1 className="sig-display text-3xl text-ink sm:text-4xl">{c(subject)}</h1>
      {desc && <p className="mt-3 max-w-2xl leading-relaxed text-ink-muted">{desc}</p>}
      {buyOption && (
        <Link
          to={`/products/${buyOption.productSlug}`}
          className="mt-5 inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-[var(--radius-btn)] bg-brand-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
          data-testid="subject-buy-cta"
        >
          {t(locale, "commerce.buyCta")}
          <span dir="ltr">
            {t(locale, "commerce.fromPrice").replace("{price}", formatMoney(buyOption.minPriceMinor, buyOption.currency))}
          </span>
        </Link>
      )}

      {courses.length === 0 ? (
        <div className="mt-8">
          <EmptyState title={t(locale, "content.catalogEmpty")} icon={<span aria-hidden="true">○</span>} />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {courses.map((course, ci) => {
            const meta: string[] = [];
            if (pres.showTeacher && course.teacherName) meta.push(course.teacherName);
            if (pres.showLessonCount) meta.push(t(locale, "content.lessonsCount", { n: course.lessonCount }));
            return (
              <Card key={course.slug} className="group overflow-hidden transition-all hover:border-brand-800 hover:shadow-[6px_6px_0_0_var(--color-brand-800)]">
                <CardBody className="p-0">
                  <Link to={`/courses/${course.slug}`} className="block">
                    {pres.showImage && course.imageUrl && (
                      <img src={course.imageUrl} alt="" className="aspect-video w-full object-cover" />
                    )}
                    <div className="flex flex-col items-start gap-2 p-4">
                      <div className="flex w-full items-start justify-between gap-3">
                        <Badge tone={course.accessLevel === "public" ? "success" : course.accessLevel === "authenticated" ? "brand" : "neutral"}>
                          {t(locale, course.accessLevel === "public" ? "content.accessPublic" : course.accessLevel === "authenticated" ? "content.accessAuthenticated" : "content.accessEntitled")}
                        </Badge>
                        <span aria-hidden="true" className="sig-display text-xl tabular-nums text-slate-300 transition-colors group-hover:text-accent-600">{String(ci + 1).padStart(2, "0")}</span>
                      </div>
                      <h2 className="text-lg font-bold text-ink"><span className="sig-u">{c(course)}</span></h2>
                      {meta.length > 0 && <p className="text-sm text-ink-muted">{meta.join(" · ")}</p>}
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
