import type { Route } from "./+types/public.courses.$slug.units.$unitId";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { chainForCourse, courseBySlug, lessonsForUnit, unitsForCourse } from "~server/content/service.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { lessonProgressMap } from "~server/progress/service.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";
import { contentSeoMeta, rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, definedTermSetJsonLd, learningResourceJsonLd, webPageJsonLd } from "~/cms/jsonld";
import { extractSemanticKeywords } from "~server/seo/keywordClusters.server";
import { eq } from "drizzle-orm";
import { grades, programs, subjects } from "~server/db/schema";
import { PageHeader } from "~/components/visuals/PageHeader";

/** Unit page: lessons of one unit with real per-lesson access verdicts + progress. */
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

  const allLessons = await lessonsForUnit(db, unit.id);
  const visible = allLessons.filter((l) => l.status === "published" || courseVerdict.allowed);

  // Per-lesson verdicts via the resolver WITH grants (entitled lessons inside an
  // allowed course stay locked without a grant — the old page leaked them as open).
  const verdicts: Record<string, boolean> = {};
  if (courseChain) {
    await Promise.all(
      visible.map(async (l) => {
        const v = await resolveContentAccess(db, subject, {
          lessonId: l.id,
          unitId: unit.id,
          courseId: course.id,
          subjectId: courseChain.subjectId,
          accessLevel: l.accessLevel,
          freePreview: l.freePreview,
          status: l.status,
          publishAt: l.publishAt ?? null,
          expiresAt: l.expiresAt ?? null,
        });
        verdicts[l.id] = v.allowed;
      })
    );
  }

  let progress: Record<string, { status: string }> = {};
  if (subject.userId && visible.length > 0) {
    const lmap = await lessonProgressMap(db, subject.userId, visible.map((l) => l.id));
    progress = Object.fromEntries([...lmap.entries()].map(([k, v]) => [k, { status: v.status }]));
  }

  // Fetch subject/grade/program for topical authority
  let subjectRow: { slug: string; titleAr: string; titleEn: string; gradeId: string } | null = null;
  let gradeRow: { slug: string; titleAr: string; titleEn: string; programId: string } | null = null;
  let programRow: { slug: string; titleAr: string; titleEn: string } | null = null;
  if (courseChain) {
    const sRows = await db
      .select({ slug: subjects.slug, titleAr: subjects.titleAr, titleEn: subjects.titleEn, gradeId: subjects.gradeId })
      .from(subjects)
      .where(eq(subjects.id, courseChain.subjectId))
      .limit(1);
    subjectRow = sRows[0] ?? null;
    if (subjectRow) {
      const gRows = await db
        .select({ slug: grades.slug, titleAr: grades.titleAr, titleEn: grades.titleEn, programId: grades.programId })
        .from(grades)
        .where(eq(grades.id, subjectRow.gradeId))
        .limit(1);
      gradeRow = gRows[0] ?? null;
      if (gradeRow) {
        const pRows = await db
          .select({ slug: programs.slug, titleAr: programs.titleAr, titleEn: programs.titleEn })
          .from(programs)
          .where(eq(programs.id, gradeRow.programId))
          .limit(1);
        programRow = pRows[0] ?? null;
      }
    }
  }

  // SEO Lesson Phase: semantic keywords from real lesson titles in this unit
  const semanticKeywords = extractSemanticKeywords(
    visible.map((l) => l.titleAr).join(" "),
    unit.titleAr,
    subjectRow?.titleAr ?? ""
  );

  return {
    url: request.url,
    course: { slug: course.slug, titleAr: course.titleAr, titleEn: course.titleEn },
    unit: { id: unit.id, titleAr: unit.titleAr, titleEn: unit.titleEn },
    subject: subjectRow,
    grade: gradeRow,
    program: programRow,
    semanticKeywords,
    courseAllowed: courseVerdict.allowed,
    lessons: visible.map((l) => ({
      id: l.id,
      slug: l.slug,
      titleAr: l.titleAr,
      titleEn: l.titleEn,
      freePreview: l.freePreview,
      allowed: verdicts[l.id] ?? false,
      progress: progress[l.id] ?? null,
    })),
  };
}

/**
 * Unit page meta (previously inherited the bare brand title + no canonical).
 * The unit is a real, stable, public page (it lists the unit's published
 * lesson titles), so it is indexable. Description is synthesized from real
 * page data (unit + course + published lesson count) when the unit has no
 * description of its own — no keyword stuffing.
 *
 * Lesson Phase: enhanced with LearningResource + DefinedTermSet for topical authority,
 * and full breadcrumb chain program → grade → subject → course → unit.
 */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [];
  const root = rootMetaFrom(matches);
  const locale = root.locale;
  const course = { ar: loaderData.course.titleAr, en: loaderData.course.titleEn };
  const n = (loaderData.lessons as unknown[]).length;
  const base = contentSeoMeta(
    {
      title: { ar: loaderData.unit.titleAr, en: loaderData.unit.titleEn },
      description: null,
    },
    root.locale,
    loaderData.url as string,
    {
      intermediate: course,
      siteName: root.siteName,
      fallbackDescription: (loc) =>
        loc === "ar"
          ? `الوحدة "${loaderData.unit.titleAr}" من كورس ${loaderData.course.titleAr} — ${n} ${n === 1 ? "درس" : "دروس"}.`
          : `"${loaderData.unit.titleEn}" — a unit in ${loaderData.course.titleEn} (${n} lesson${n === 1 ? "" : "s"}).`,
    },
  );
  let origin = "";
  let pathname = "";
  try {
    const u = new URL(loaderData.url as string);
    origin = u.origin;
    pathname = u.pathname;
  } catch {
    return [...siteEntitiesMeta(matches), ...base];
  }
  const unitTitle = locale === "ar" ? loaderData.unit.titleAr : loaderData.unit.titleEn;
  const courseUrl = absUrl(origin, `/courses/${loaderData.course.slug}`);

  // Breadcrumb chain for topical authority
  const crumbs: Array<{ name: string; url?: string | null }> = [
    { name: locale === "ar" ? "الرئيسية" : "Home", url: "/" },
    { name: locale === "ar" ? "الكورسات" : "Courses", url: "/courses" },
  ];
  if (loaderData.program) {
    crumbs.push({
      name: locale === "ar" ? loaderData.program.titleAr : loaderData.program.titleEn,
      url: `/programs/${loaderData.program.slug}`,
    });
  }
  if (loaderData.grade) {
    crumbs.push({
      name: locale === "ar" ? loaderData.grade.titleAr : loaderData.grade.titleEn,
      url: `/grades/${loaderData.grade.slug}`,
    });
  }
  if (loaderData.subject) {
    crumbs.push({
      name: locale === "ar" ? loaderData.subject.titleAr : loaderData.subject.titleEn,
      url: `/subjects/${loaderData.subject.slug}`,
    });
  }
  crumbs.push({ name: locale === "ar" ? loaderData.course.titleAr : loaderData.course.titleEn, url: `/courses/${loaderData.course.slug}` });
  crumbs.push({ name: unitTitle });

  const teaches = (loaderData.semanticKeywords as string[]) ?? [];
  const educationalLevel = loaderData.grade ? (locale === "ar" ? loaderData.grade.titleAr : loaderData.grade.titleEn) : null;

  const extra: Array<Record<string, unknown>> = [];

  // LearningResource for unit
  extra.push(
    learningResourceJsonLd({
      name: unitTitle,
      url: absUrl(origin, pathname),
      description:
        locale === "ar"
          ? `الوحدة "${loaderData.unit.titleAr}" من كورس ${loaderData.course.titleAr} — ${n} ${n === 1 ? "درس" : "دروس"}.`
          : `"${loaderData.unit.titleEn}" — a unit in ${loaderData.course.titleEn} (${n} lesson${n === 1 ? "" : "s"}).`,
      educationalLevel,
      teaches: teaches.length > 0 ? teaches : undefined,
      isPartOf: courseUrl,
      learningResourceType: "Unit",
    })
  );

  // DefinedTermSet for semantic keywords
  if (teaches.length > 0) {
    extra.push(
      definedTermSetJsonLd({
        name: locale === "ar" ? `مفاهيم ${unitTitle}` : `Concepts of ${unitTitle}`,
        url: absUrl(origin, pathname),
        terms: teaches,
      })
    );
  }

  // Also include hasPart for lessons (lesson titles are public, content gated)
  const lessonParts = (loaderData.lessons as Array<{ titleAr: string; titleEn: string; slug: string }>).map((l) => ({
    "@type": "LearningResource",
    name: locale === "ar" ? l.titleAr : l.titleEn,
    url: absUrl(origin, `/courses/${loaderData.course.slug}`), // canonical for lesson discovery is unit/course, not private learn
    learningResourceType: "Lesson",
  }));

  return [
    ...siteEntitiesMeta(matches),
    ...base,
    {
      "script:ld+json": webPageJsonLd({
        name: unitTitle,
        url: absUrl(origin, pathname),
        description:
          locale === "ar"
            ? `الوحدة "${loaderData.unit.titleAr}" من كورس ${loaderData.course.titleAr} — ${n} ${n === 1 ? "درس" : "دروس"}.`
            : `"${loaderData.unit.titleEn}" — a unit in ${loaderData.course.titleEn} (${n} lesson${n === 1 ? "" : "s"}).`,
        isPartOf: absUrl(origin, "/"),
        additionalType: "https://schema.org/CollectionPage",
        educationalLevel,
      }),
    },
    ...extra.map((e) => ({ "script:ld+json": e })),
    // hasPart as separate Course-like structure for lessons
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "Course",
        name: unitTitle,
        url: absUrl(origin, pathname),
        hasPart: lessonParts,
      },
    },
    {
      "script:ld+json": breadcrumbJsonLd({
        items: crumbs,
        origin,
      }),
    },
  ];
}

export default function UnitPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { course, unit, lessons, courseAllowed } = loaderData;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <nav aria-label="breadcrumb" className="mb-1 text-sm text-slate-500">
        <Link to="/courses" className="hover:text-brand-600">{t(locale, "content.catalogTitle")}</Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <Link to={`/courses/${course.slug}`} className="hover:text-brand-600">
          {locale === "ar" ? course.titleAr : course.titleEn}
        </Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-slate-700">{locale === "ar" ? unit.titleAr : unit.titleEn}</span>
      </nav>
      <PageHeader art="scroll" title={locale === "ar" ? unit.titleAr : unit.titleEn} />
      <ol className="space-y-2">
        {lessons.map((l, i) => (
          <li key={l.slug}>
            <Card>
              <CardBody className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-sm text-slate-500">{i + 1}.</span>
                  {l.progress?.status === "completed" && (
                    <Icon name="check-circle" className="h-4 w-4 shrink-0 text-emerald-600" aria-label={t(locale, "progress.completed")} />
                  )}
                  {l.progress && l.progress.status !== "completed" && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand-400" aria-hidden />
                  )}
                  {l.allowed ? (
                    <Link to={`/learn/${course.slug}/${l.slug}`} className="truncate font-medium text-blue-700 hover:underline">
                      {locale === "ar" ? l.titleAr : l.titleEn}
                    </Link>
                  ) : (
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-500">
                      <Icon name="lock" className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{locale === "ar" ? l.titleAr : l.titleEn}</span>
                    </span>
                  )}
                  {l.freePreview && <Badge tone="success">{t(locale, "content.freePreview")}</Badge>}
                </span>
                {l.allowed && l.progress?.status !== "completed" && (
                  <Link
                    to={`/learn/${course.slug}/${l.slug}`}
                    className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
                  >
                    {l.progress ? t(locale, "progress.resume") : t(locale, "content.openLesson")}
                  </Link>
                )}
              </CardBody>
            </Card>
          </li>
        ))}
        {lessons.length === 0 && <p className="text-sm text-slate-500">—</p>}
      </ol>
      {!courseAllowed && (
        <p className="mt-4 text-sm text-slate-500">{t(locale, "content.locked")}</p>
      )}
    </div>
  );
}
