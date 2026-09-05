import type { Route } from "./+types/public.courses.$slug";
import { Link, useLoaderData, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { allLessonsForCourse, chainForCourse, courseBySlug, unitsForCourse } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

/** Course page: units + lessons with access-aware rendering (verdict from resolver). */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const course = await courseBySlug(db, params.slug);
  if (!course || course.status === "archived") throw new Response("Not Found", { status: 404 });

  const { auth } = await resolveAuth(db, env, request);
  const chain = await chainForCourse(db, course.id);
  const verdict = chain
    ? await resolveContentAccess(db, { userId: auth?.user.id ?? null, roleRank: auth?.user.rank ?? 0 }, chain)
    : { allowed: false as const, reason: "not_published" as const };

  const [unitRows, lessonRows] = await Promise.all([
    unitsForCourse(db, course.id),
    allLessonsForCourse(db, course.id),
  ]);

  return {
    course: {
      slug: course.slug,
      titleAr: course.titleAr,
      titleEn: course.titleEn,
      descriptionAr: course.descriptionAr,
      descriptionEn: course.descriptionEn,
      accessLevel: course.accessLevel,
      status: course.status,
    },
    verdict,
    units: unitRows
      .filter((u) => u.status === "published" || verdict.allowed)
      .map((u) => ({
        id: u.id,
        titleAr: u.titleAr,
        titleEn: u.titleEn,
        lessons: lessonRows
          .filter((l) => l.unitId === u.id && (l.status === "published" || verdict.allowed))
          .map((l) => ({
            slug: l.slug,
            titleAr: l.titleAr,
            titleEn: l.titleEn,
            freePreview: l.freePreview,
            accessLevel: l.accessLevel,
          })),
      })),
  };
}

export default function CoursePage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { course, verdict, units } = loaderData;
  const title = locale === "ar" ? course.titleAr : course.titleEn;
  const desc = locale === "ar" ? course.descriptionAr : course.descriptionEn;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={course.accessLevel === "public" ? "success" : course.accessLevel === "authenticated" ? "brand" : "neutral"}>
          {t(locale, course.accessLevel === "public" ? "content.accessPublic" : course.accessLevel === "authenticated" ? "content.accessAuthenticated" : "content.accessEntitled")}
        </Badge>
        {!verdict.allowed && course.status !== "published" && (
          <span className="text-sm text-slate-400">{t(locale, "content.notAvailable")}</span>
        )}
      </div>
      <h1 className="text-2xl font-bold">{title}</h1>
      {desc && <p className="mt-2 text-slate-600">{desc}</p>}

      {!verdict.allowed && (
        <Card className="mt-4">
          <CardBody>
            <p className="text-sm text-slate-600">
              {verdict.reason === "anon" ? (
                <Link to="/login" className="font-medium text-blue-600 hover:underline">
                  {t(locale, "content.loginToContinue")}
                </Link>
              ) : (
                t(locale, "content.locked")
              )}
            </p>
          </CardBody>
        </Card>
      )}

      <div className="mt-6 space-y-5">
        {units.map((unit, ui) => (
          <Card key={unit.id}>
            <CardBody>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">
                  {ui + 1}. {locale === "ar" ? unit.titleAr : unit.titleEn}
                </h2>
                {verdict.allowed && (
                  <Link to={`/courses/${course.slug}/units/${unit.id}`} className="text-sm text-blue-600 hover:underline">
                    {t(locale, "content.openUnit")}
                  </Link>
                )}
              </div>
              <ol className="space-y-1.5">
                {unit.lessons.map((lesson) => (
                  <li key={lesson.slug} className="flex items-center gap-2 text-sm">
                    {verdict.allowed ? (
                      <Link to={`/learn/${course.slug}/${lesson.slug}`} className="text-blue-700 hover:underline">
                        {locale === "ar" ? lesson.titleAr : lesson.titleEn}
                      </Link>
                    ) : (
                      <span className="text-slate-500">{locale === "ar" ? lesson.titleAr : lesson.titleEn}</span>
                    )}
                    {lesson.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
                  </li>
                ))}
                {unit.lessons.length === 0 && <li className="text-sm text-slate-400">—</li>}
              </ol>
            </CardBody>
          </Card>
        ))}
        {units.length === 0 && <p className="text-sm text-slate-400">{t(locale, "content.catalogEmpty")}</p>}
      </div>
    </div>
  );
}
