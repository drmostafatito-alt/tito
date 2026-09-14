import type { Route } from "./+types/admin.seo";
import { Link, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { indexablePublicUrls, ROBOTS_PRIVATE_PATHS } from "~server/seo/inventory.server";
import { CANONICAL_MAP, validateCanonicalUniqueness } from "~server/seo/canonicalMap.server";
import { courses, grades, lessons, pages, programs, subjects, units } from "~server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Badge } from "~/components/ui/Badge";
import { formatDate, t, type Locale } from "~/lib/i18n";

export type SeoIssue = "maintenance" | "noOwner" | "missingDesc" | "dupTitles" | "drafts" | "robotsOverlap";

/**
 * Admin SEO dashboard (SEO Master Phase, batch 6 + Lesson Phase).
 *
 * Factual crawl-readiness audit computed server-side from the database —
 * the same inventory function that feeds /sitemap.xml, the same content
 * rows that feed the public pages. NO invented scores, no heuristics
 * dressed up as a health percentage: every number on this page is a count
 * the owner can verify in Admin → Content, and every finding names the
 * rows behind it.
 *
 * Per-page SEO controls (title/description/canonical/OG/robots) already
 * live in the CMS page SEO tab and the content editors — this page is the
 * dashboard that tells the owner WHAT to fix, not another editor.
 *
 * Lesson Phase: adds canonical map + keyword cluster overview.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const settings = await getSettings(db);

  const [programRows, gradeRows, subjectRows, courseRows, unitRows, lessonRows, pageRows] = await Promise.all([
    db.select({ id: programs.id, titleAr: programs.titleAr, titleEn: programs.titleEn, descriptionAr: programs.descriptionAr, descriptionEn: programs.descriptionEn }).from(programs).where(and(eq(programs.status, "published"), isNull(programs.deletedAt))),
    db.select({ id: grades.id }).from(grades).where(and(eq(grades.status, "published"), isNull(grades.deletedAt))),
    db.select({ id: subjects.id, titleAr: subjects.titleAr, titleEn: subjects.titleEn, descriptionAr: subjects.descriptionAr, descriptionEn: subjects.descriptionEn }).from(subjects).where(and(eq(subjects.status, "published"), isNull(subjects.deletedAt))),
    db.select({ id: courses.id, titleAr: courses.titleAr, titleEn: courses.titleEn, descriptionAr: courses.descriptionAr, descriptionEn: courses.descriptionEn }).from(courses).where(and(eq(courses.status, "published"), isNull(courses.deletedAt))),
    db.select({ id: units.id }).from(units).where(and(eq(units.status, "published"), isNull(units.deletedAt))),
    db.select({ id: lessons.id }).from(lessons).where(and(eq(lessons.status, "published"), isNull(lessons.deletedAt))),
    db.select({ id: pages.id }).from(pages).where(and(eq(pages.status, "published"), isNull(pages.deletedAt))),
  ]);

  const [draftPrograms, draftGrades, draftSubjects, draftCourses, draftUnits, draftLessons] = await Promise.all([
    db.select({ id: programs.id }).from(programs).where(and(eq(programs.status, "draft"), isNull(programs.deletedAt))),
    db.select({ id: grades.id }).from(grades).where(and(eq(grades.status, "draft"), isNull(grades.deletedAt))),
    db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.status, "draft"), isNull(subjects.deletedAt))),
    db.select({ id: courses.id }).from(courses).where(and(eq(courses.status, "draft"), isNull(courses.deletedAt))),
    db.select({ id: units.id }).from(units).where(and(eq(units.status, "draft"), isNull(units.deletedAt))),
    db.select({ id: lessons.id }).from(lessons).where(and(eq(lessons.status, "draft"), isNull(lessons.deletedAt))),
  ]);

  const missingDesc: Array<{ type: "program" | "subject" | "course"; titleAr: string; titleEn: string }> = [];
  for (const [type, rows] of [
    ["program", programRows],
    ["subject", subjectRows],
    ["course", courseRows],
  ] as const) {
    for (const r of rows) {
      const noDesc = !(r.descriptionAr?.trim()) && !(r.descriptionEn?.trim());
      if (noDesc) missingDesc.push({ type, titleAr: r.titleAr, titleEn: r.titleEn });
    }
  }

  const dupGroups: Array<{ type: "program" | "subject" | "course"; titleAr: string; titleEn: string; count: number }> = [];
  for (const [type, rows] of [
    ["program", programRows],
    ["subject", subjectRows],
    ["course", courseRows],
  ] as const) {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(`${r.titleAr}\u0000${r.titleEn}`, (seen.get(`${r.titleAr}\u0000${r.titleEn}`) ?? 0) + 1);
    for (const [key, count] of seen) {
      if (count > 1) {
        const [titleAr, titleEn] = key.split("\u0000");
        dupGroups.push({ type, titleAr, titleEn, count });
      }
    }
  }

  const urls = await indexablePublicUrls(db);
  const robotsOverlap = urls.filter((u) => ROBOTS_PRIVATE_PATHS.some((p) => u.path === p || u.path.startsWith(p + "/")));

  const issues: SeoIssue[] = [];
  if (settings.platform.maintenance) issues.push("maintenance");
  if (!settings.identity.ownerNameAr.trim() && !settings.identity.ownerNameEn.trim()) issues.push("noOwner");
  if (missingDesc.length) issues.push("missingDesc");
  if (dupGroups.length) issues.push("dupTitles");
  if (draftPrograms.length + draftGrades.length + draftSubjects.length + draftCourses.length + draftUnits.length + draftLessons.length > 0) issues.push("drafts");
  if (robotsOverlap.length) issues.push("robotsOverlap");

  const canonicalValidation = validateCanonicalUniqueness();

  return {
    issues,
    maintenance: settings.platform.maintenance,
    ownerConfigured: Boolean(settings.identity.ownerNameAr.trim() || settings.identity.ownerNameEn.trim()),
    missingDesc,
    dupGroups,
    draftCount:
      draftPrograms.length + draftGrades.length + draftSubjects.length + draftCourses.length + draftUnits.length + draftLessons.length,
    counts: {
      programs: programRows.length,
      grades: gradeRows.length,
      subjects: subjectRows.length,
      courses: courseRows.length,
      units: unitRows.length,
      lessons: lessonRows.length,
      cmsPages: pageRows.length,
    },
    urls,
    canonicalMap: CANONICAL_MAP,
    canonicalValidation,
  };
}

export default function AdminSeo({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { issues, missingDesc, dupGroups, draftCount, counts, urls, canonicalMap, canonicalValidation } = loaderData;

  const typeLabel: Record<string, string> = {
    program: t(locale, "seoAdmin.typeProgram"),
    subject: t(locale, "seoAdmin.typeSubject"),
    course: t(locale, "seoAdmin.typeCourse"),
  };

  const findings: Array<{ id: string; label: string; tone: "warning" | "neutral" }> = [];
  if (issues.includes("maintenance")) findings.push({ id: "maintenance", label: t(locale, "seoAdmin.issueMaintenance"), tone: "warning" });
  if (issues.includes("noOwner")) findings.push({ id: "noOwner", label: t(locale, "seoAdmin.issueNoOwner"), tone: "warning" });
  if (issues.includes("missingDesc")) findings.push({ id: "missingDesc", label: t(locale, "seoAdmin.issueMissingDesc", { n: missingDesc.length }), tone: "warning" });
  if (issues.includes("dupTitles")) findings.push({ id: "dupTitles", label: t(locale, "seoAdmin.issueDupTitles", { n: dupGroups.length }), tone: "warning" });
  if (issues.includes("drafts")) findings.push({ id: "drafts", label: t(locale, "seoAdmin.issueDrafts", { n: draftCount }), tone: "neutral" });
  if (issues.includes("robotsOverlap")) findings.push({ id: "robotsOverlap", label: t(locale, "seoAdmin.issueRobotsOverlap"), tone: "warning" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t(locale, "seoAdmin.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t(locale, "seoAdmin.note")}</p>
      </div>

      <Card>
        <CardHeader title={t(locale, "seoAdmin.quickLinks")} />
        <CardBody className="flex flex-wrap items-center gap-4 text-sm">
          <Link to="/sitemap.xml" target="_blank" className="font-medium text-brand-600 hover:text-brand-700" data-testid="seo-sitemap-link">
            {t(locale, "seoAdmin.sitemap")}
          </Link>
          <Link to="/robots.txt" target="_blank" className="font-medium text-brand-600 hover:text-brand-700" data-testid="seo-robots-link">
            {t(locale, "seoAdmin.robots")}
          </Link>
          <span className="text-slate-500">
            {t(locale, "seoAdmin.gsc")}: {t(locale, "seoAdmin.gscHint")}
          </span>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "seoAdmin.issues")} />
        <CardBody className="space-y-2">
          {findings.length === 0 && <p className="text-sm text-slate-500" data-testid="seo-no-issues">{t(locale, "seoAdmin.noIssues")}</p>}
          {findings.map((f) => (
            <div key={f.id} className="flex items-center gap-3 text-sm" data-testid={`seo-issue-${f.id}`}>
              <Badge tone={f.tone === "warning" ? "warning" : "neutral"}>{f.tone === "warning" ? "!" : "i"}</Badge>
              <span className="text-slate-700">{f.label}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      {missingDesc.length > 0 && (
        <Card>
          <CardHeader title={t(locale, "seoAdmin.missingDescList")} />
          <CardBody>
            <ul className="space-y-1 text-sm text-slate-600">
              {missingDesc.map((m, i) => (
                <li key={i} dir="auto">
                  <span className="text-slate-400">[{typeLabel[m.type]}]</span>{" "}
                  {locale === "ar" ? m.titleAr : m.titleEn}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {dupGroups.length > 0 && (
        <Card>
          <CardHeader title={t(locale, "seoAdmin.dupList")} />
          <CardBody>
            <ul className="space-y-1 text-sm text-slate-600">
              {dupGroups.map((m, i) => (
                <li key={i} dir="auto">
                  <span className="text-slate-400">[{typeLabel[m.type]}]</span> {locale === "ar" ? m.titleAr : m.titleEn} ×{m.count}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t(locale, "seoAdmin.counts")} />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(
              [
                ["countsPrograms", counts.programs],
                ["countsGrades", counts.grades],
                ["countsSubjects", counts.subjects],
                ["countsCourses", counts.courses],
                ["countsUnits", counts.units],
                ["countsLessons", counts.lessons],
                ["countsCmsPages", counts.cmsPages],
              ] as Array<[string, number]>
            ).map(([key, n]) => (
              <div key={key} className="rounded-lg border border-slate-200/70 p-3 text-center">
                <div className="text-lg font-bold text-slate-800" dir="ltr">{n}</div>
                <div className="text-xs text-slate-500">{t(locale, `seoAdmin.${key}`)}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Lesson Phase: Canonical Map */}
      <Card>
        <CardHeader title="خريطة Canonical (Intent → URL)" description={`${canonicalMap.length} intents — واحد قوي لكل Intent`} />
        <CardBody>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <Badge tone={canonicalValidation.ok ? "success" : "warning"}>{canonicalValidation.ok ? "✓ No duplicates" : `⚠ ${canonicalValidation.duplicates.length} duplicates`}</Badge>
            <span className="text-slate-500">لا صفحة منفصلة لكل صيغة بحث؛ canonical واحد قوي لكل Intent</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-start text-xs text-slate-500">
                  <th className="pb-2 text-start font-medium">Intent</th>
                  <th className="pb-2 text-start font-medium">أمثلة Keywords</th>
                  <th className="pb-2 text-start font-medium">Canonical Pattern</th>
                  <th className="pb-2 text-start font-medium">مثال URL</th>
                  <th className="pb-2 text-start font-medium">Index</th>
                </tr>
              </thead>
              <tbody>
                {canonicalMap.map((m) => (
                  <tr key={m.intent} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 font-mono text-xs font-medium text-slate-800">{m.intent}</td>
                    <td className="py-1.5 text-xs text-slate-600" dir="auto">{m.exampleKeywords.slice(0, 3).join("، ")}</td>
                    <td className="py-1.5 font-mono text-xs text-slate-700" dir="ltr">{m.canonicalPattern}</td>
                    <td className="py-1.5 font-mono text-xs text-brand-600" dir="ltr">{m.exampleUrl}</td>
                    <td className="py-1.5 text-xs">{m.indexable ? "✓" : "noindex"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "seoAdmin.inventory")} description={`${urls.length}`} />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-start text-xs text-slate-500">
                  <th className="pb-2 text-start font-medium">{t(locale, "seoAdmin.inventoryPath")}</th>
                  <th className="pb-2 text-start font-medium">{t(locale, "seoAdmin.inventoryUpdated")}</th>
                </tr>
              </thead>
              <tbody>
                {urls.map((u) => (
                  <tr key={u.path} className="border-b border-slate-100 last:border-0" data-testid={`seo-url-${u.path.replace(/[^a-z0-9]/gi, "")}`}>
                    <td className="py-1.5 font-mono text-xs text-slate-700" dir="ltr">{u.path}</td>
                    <td className="py-1.5 text-xs text-slate-500">
                      {u.lastmodMs ? formatDate(locale, u.lastmodMs) : t(locale, "seoAdmin.inventoryNever")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
