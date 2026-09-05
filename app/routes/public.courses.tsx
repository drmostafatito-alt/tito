import type { Route } from "./+types/public.courses";
import { Link, useLoaderData, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { catalogCourses } from "~server/content/service.server";
import { Card, CardBody } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { t, type Locale } from "~/lib/i18n";

/** Catalog: published + visible courses only; access badges from row data (resolver decides at open). */
export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const rows = await catalogCourses(db);
  return {
    courses: rows.map((r) => ({
      slug: r.course.slug,
      titleAr: r.course.titleAr,
      titleEn: r.course.titleEn,
      accessLevel: r.course.accessLevel,
      visibility: r.course.visibility,
      subjectAr: r.subjectAr,
      subjectEn: r.subjectEn,
      gradeAr: r.gradeAr,
      gradeEn: r.gradeEn,
      programAr: r.programAr,
      programEn: r.programEn,
    })),
  };
}

export default function CoursesCatalog({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const c = (row: { titleAr: string; titleEn: string }) => (locale === "ar" ? row.titleAr : row.titleEn);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{t(locale, "content.catalogTitle")}</h1>
      {loaderData.courses.length === 0 ? (
        <p className="text-slate-500">{t(locale, "content.catalogEmpty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {loaderData.courses.map((course) => (
            <Card key={course.slug}>
              <CardBody>
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={course.accessLevel === "public" ? "success" : course.accessLevel === "authenticated" ? "brand" : "neutral"}>
                    {t(locale, course.accessLevel === "public" ? "content.accessPublic" : course.accessLevel === "authenticated" ? "content.accessAuthenticated" : "content.accessEntitled")}
                  </Badge>
                  {course.visibility === "featured" && <Badge tone="warning">★</Badge>}
                </div>
                <h2 className="text-lg font-semibold">
                  <Link to={`/courses/${course.slug}`} className="hover:underline">{c(course)}</Link>
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {c({ titleAr: course.programAr, titleEn: course.programEn })} ·{" "}
                  {c({ titleAr: course.gradeAr, titleEn: course.gradeEn })} ·{" "}
                  {c({ titleAr: course.subjectAr, titleEn: course.subjectEn })}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
