import type { Route } from "./+types/public.courses.$slug.units.$unitId";
import { Link, useLoaderData, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { chainForCourse, courseBySlug, lessonsForUnit, unitsForCourse } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { resolveAccess } from "~server/entitlements/resolver.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

/** Unit page (owner Phase-2 scope): lessons of one unit, access-aware. */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const course = await courseBySlug(db, params.slug);
  if (!course) throw new Response("Not Found", { status: 404 });
  const unit = (await unitsForCourse(db, course.id)).find((u) => u.id === params.unitId);
  if (!unit) throw new Response("Not Found", { status: 404 });

  const { auth } = await resolveAuth(db, env, request);
  const subject = { userId: auth?.user.id ?? null, roleRank: auth?.user.rank ?? 0 };
  const courseChain = await chainForCourse(db, course.id);
  const courseVerdict = courseChain
    ? await resolveContentAccess(db, subject, courseChain)
    : { allowed: false as const, reason: "not_published" as const };

  const lessons = (await lessonsForUnit(db, unit.id)).map((l) => {
    const verdict = resolveAccess({
      subject,
      resource: {
        accessLevel: l.accessLevel,
        status: l.status,
        publishAt: l.publishAt,
        expiresAt: l.expiresAt,
        freePreview: l.freePreview,
      },
      chain: [
        { type: "lesson", id: l.id },
        { type: "unit", id: unit.id },
        { type: "course", id: course.id },
      ],
      entitlements: [], // lesson-level free_preview/public/authenticated verdicts only here
    });
    return {
      slug: l.slug,
      titleAr: l.titleAr,
      titleEn: l.titleEn,
      freePreview: l.freePreview,
      accessLevel: l.accessLevel,
      status: l.status,
      allowed: verdict.allowed || courseVerdict.allowed,
    };
  });

  return {
    course: { slug: course.slug, titleAr: course.titleAr, titleEn: course.titleEn },
    unit: { id: unit.id, titleAr: unit.titleAr, titleEn: unit.titleEn },
    courseAllowed: courseVerdict.allowed,
    lessons,
  };
}

export default function UnitPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { course, unit, lessons, courseAllowed } = loaderData;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        <Link to={`/courses/${course.slug}`} className="hover:underline">
          {locale === "ar" ? course.titleAr : course.titleEn}
        </Link>
      </p>
      <h1 className="mb-6 text-2xl font-bold">{locale === "ar" ? unit.titleAr : unit.titleEn}</h1>
      <ol className="space-y-2">
        {lessons.map((l, i) => (
          <li key={l.slug}>
            <Card>
              <CardBody className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="text-sm text-slate-400">{i + 1}.</span>
                  {l.allowed ? (
                    <Link to={`/learn/${course.slug}/${l.slug}`} className="font-medium text-blue-700 hover:underline">
                      {locale === "ar" ? l.titleAr : l.titleEn}
                    </Link>
                  ) : (
                    <span className="text-slate-500">{locale === "ar" ? l.titleAr : l.titleEn}</span>
                  )}
                  {l.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
                </span>
                {!l.allowed && <span className="text-xs text-slate-400">🔒</span>}
              </CardBody>
            </Card>
          </li>
        ))}
        {lessons.length === 0 && <p className="text-sm text-slate-400">—</p>}
      </ol>
      {!courseAllowed && (
        <p className="mt-4 text-sm text-slate-500">{t(locale, "content.locked")}</p>
      )}
    </div>
  );
}
