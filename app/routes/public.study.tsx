import type { Route } from "./+types/public.study";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { studyHub } from "~server/content/service.server";
import { Card, CardBody } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { Icon } from "~/cms/icons";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";

/**
 * المحتوى التعليمي — the student-facing entry point to real published content.
 *
 * Information architecture (owner model, no "courses" vocabulary):
 *   السنة الدراسية → الصف → المادة → الترم → الدرس
 *
 * Everything rendered here comes from PUBLISHED rows the admin created; the page
 * is empty-first, so nothing is ever invented or shown as a placeholder.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const subjects = await studyHub(db);
  return { subjects, url: request.url };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  return [
    ...siteEntitiesMeta(matches),
    ...contentSeoMeta(
      {
        title: { ar: t("ar", "study.title"), en: t("en", "study.title") },
        description: root.tagline ?? {},
      },
      root.locale,
      loaderData.url,
      { siteName: root.siteName }
    ),
  ];
}

export default function StudyHubPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav className="mb-2 flex items-center gap-1 text-sm text-slate-500" aria-label={t(locale, "common.breadcrumb")}>
        <Link to="/" className="hover:underline">{t(locale, "study.breadcrumbHome")}</Link>
        <span aria-hidden="true"> / </span>
        <span className="font-medium text-slate-700">{t(locale, "study.title")}</span>
      </nav>
      <h1 className="text-2xl font-bold">{t(locale, "study.title")}</h1>
      <p className="mt-1 text-sm text-slate-600">{t(locale, "study.subtitle")}</p>

      {loaderData.subjects.length === 0 ? (
        <p className="mt-6 text-slate-500" data-testid="study-empty">{t(locale, "study.empty")}</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2" data-testid="study-subjects">
          {loaderData.subjects.map((s) => (
            <Card key={s.slug}>
              <CardBody>
                <Link to={`/study/${s.slug}`} className="group block" data-testid={`study-subject-${s.slug}`}>
                  <h2 className="flex items-center gap-2 font-semibold text-slate-800 group-hover:text-brand-600">
                    <Icon name="book-open" className="h-5 w-5 text-brand-500" aria-hidden />
                    {ar ? s.titleAr : s.titleEn}
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-600">
                    {t(locale, "study.gradeLabel")}: {ar ? s.gradeTitleAr : s.gradeTitleEn}
                  </p>
                  {(ar ? s.descriptionAr : s.descriptionEn) && (
                    <p className="mt-1 text-sm text-slate-500">{ar ? s.descriptionAr : s.descriptionEn}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone="neutral">{t(locale, "study.termsCount", { n: s.termCount })}</Badge>
                    <Badge tone="neutral">{t(locale, "study.lessonsCount", { n: s.lessonCount })}</Badge>
                  </div>
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
