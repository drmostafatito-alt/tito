import type { Route } from "./+types/public.programs.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { catalogCourses } from "~server/content/service.server";
import { programs, grades, subjects } from "~server/db/schema";
import { CARD_BODY, CARD_META, CARD_TITLE, PUB_CARD, PUB_INNER, PUB_SECTION } from "~/lib/publicStyles";
import { Icon } from "~/cms/icons";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, webPageJsonLd } from "~/cms/jsonld";
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
      slug: g.slug,
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
  const locale = root.locale;
  const base = contentSeoMeta(
    {
      title: { ar: loaderData.program.titleAr, en: loaderData.program.titleEn },
      description: { ar: loaderData.program.descriptionAr, en: loaderData.program.descriptionEn },
    },
    root.locale,
    loaderData.url,
    { siteName: root.siteName }
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
  const title = locale === "ar" ? loaderData.program.titleAr : loaderData.program.titleEn;
  return [
    ...siteEntitiesMeta(matches),
    ...base,
    {
      "script:ld+json": webPageJsonLd({
        name: title,
        url: absUrl(origin, pathname),
        description: locale === "ar" ? loaderData.program.descriptionAr : loaderData.program.descriptionEn,
        isPartOf: absUrl(origin, "/"),
        additionalType: "https://schema.org/CollectionPage",
      }),
    },
    {
      "script:ld+json": breadcrumbJsonLd({
        items: [
          { name: locale === "ar" ? "الرئيسية" : "Home", url: "/" },
          { name: locale === "ar" ? "البرامج" : "Programs", url: "/programs" },
          { name: title },
        ],
        origin,
      }),
    },
  ];
}

export default function ProgramPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { program, grades } = loaderData;
  const desc = locale === "ar" ? program.descriptionAr : program.descriptionEn;
  const hasSubjects = grades.some((g) => g.subjects.length > 0);

  // Legacy SEO surface, rebuilt on the shared public grammar (same rhythm, card,
  // type and focus rules as /study) so the site never shows two visual languages.
  return (
    <section className={`${PUB_SECTION} bg-pub-bg`}>
      <div className={PUB_INNER}>
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-pub-sm text-pub-muted" aria-label={t(locale, "common.breadcrumb")} data-allow-small>
          <Link to="/programs" className="hover:text-pub-navy">{t(locale, "catalog.programs")}</Link>
          <span aria-hidden="true"> / </span>
          <span className="font-medium text-pub-navy-2">{locale === "ar" ? program.titleAr : program.titleEn}</span>
        </nav>
        <h1 className="text-pub-h2 font-extrabold tracking-tight text-pub-ink sm:text-pub-h1">
          {locale === "ar" ? program.titleAr : program.titleEn}
        </h1>
        {desc && <p className={`pub-measure mt-3 ${CARD_BODY}`}>{desc}</p>}

        {!hasSubjects ? (
          <p className={`pub-measure mt-6 ${CARD_BODY}`}>{t(locale, "catalog.noSubjects")}</p>
        ) : (
          <div className="mt-8 flex flex-col gap-8">
            {grades.map((g) =>
              g.subjects.length === 0 ? null : (
                <div key={g.id}>
                  <h2 className="mb-4 text-pub-md font-bold text-pub-ink">
                    <Link to={`/grades/${g.slug}`} className="inline-flex min-h-11 items-center gap-1.5 text-pub-navy hover:underline">
                      {locale === "ar" ? g.titleAr : g.titleEn}
                    </Link>
                  </h2>
                  <div className="pub-grid sm:grid-cols-2 lg:grid-cols-3">
                    {g.subjects.map((s) => (
                      <Link key={s.slug} to={`/subjects/${s.slug}`} className={`${PUB_CARD} min-h-[6.5rem] gap-2 p-5`}>
                        <h3 className={`flex items-center gap-2 ${CARD_TITLE}`}>
                          <Icon name="book-open" className="h-5 w-5 shrink-0 text-pub-navy" aria-hidden />
                          <span className="min-w-0">{locale === "ar" ? s.titleAr : s.titleEn}</span>
                        </h3>
                        <p className={`mt-auto ${CARD_META}`}>{t(locale, "content.coursesCount", { n: s.courseCount })}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}
