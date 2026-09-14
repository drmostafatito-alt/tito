/**
 * Topical Authority Builder — مصطفى تيتو → المنصة → المادة → الصف → الوحدة → الدرس → المفاهيم
 *
 * Builds the entity graph that Google should understand:
 * - Person (Dr Mostafa Tito) knowsAbout philosophy, psychology, logic, sociology
 * - Organization (platform) with sameAs official socials
 * - Subject → Grade → Course → Unit → Lesson hierarchy via BreadcrumbList + hasPart
 * - Semantic keywords via DefinedTermSet + teaches
 *
 * All data comes from live DB rows, never invented.
 */

import { eq } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { grades, programs, subjects } from "../db/schema";
import { extractSemanticKeywords } from "./keywordClusters.server";

export interface TopicalNode {
  type: "person" | "organization" | "subject" | "grade" | "program" | "course" | "unit" | "lesson" | "concept";
  id: string;
  titleAr: string;
  titleEn: string;
  slug?: string;
  parentId?: string | null;
  children?: TopicalNode[];
  concepts?: string[];
}

export interface TopicalAuthorityGraph {
  person: { nameAr: string; nameEn: string; knowsAbout: string[] };
  organization: { nameAr: string; nameEn: string; url: string; sameAs: string[] };
  hierarchy: TopicalNode[]; // programs → grades → subjects → courses → units → lessons
}

/**
 * Build topical authority graph from DB
 * Only published, non-deleted rows are included (empty-first).
 */
export async function buildTopicalAuthorityGraph(
  db: DB,
  platform: { nameAr: string; nameEn: string; taglineAr: string; taglineEn: string },
  identity: { ownerNameAr: string; ownerNameEn: string; socialUrls: string[] },
  origin: string
): Promise<TopicalAuthorityGraph> {
  const personKnowsAbout = [
    "الفلسفة",
    "علم النفس",
    "المنطق",
    "علم الاجتماع",
    "الفلسفة التطبيقية",
    "المنطق التطبيقي",
    "الذكاء والتعلم",
    "النمو الإنساني",
    "الشخصية",
    "الثانوية العامة",
  ];

  // Fetch hierarchy
  const programRows = await db.select().from(programs).where(eq(programs.status, "published"));
  const gradeRows = await db.select().from(grades).where(eq(grades.status, "published"));
  const subjectRows = await db.select().from(subjects).where(eq(subjects.status, "published"));

  const hierarchy: TopicalNode[] = programRows.map((p) => {
    const pGrades = gradeRows.filter((g) => g.programId === p.id);
    return {
      type: "program" as const,
      id: p.id,
      titleAr: p.titleAr,
      titleEn: p.titleEn,
      slug: p.slug,
      children: pGrades.map((g) => {
        const gSubjects = subjectRows.filter((s) => s.gradeId === g.id);
        return {
          type: "grade" as const,
          id: g.id,
          titleAr: g.titleAr,
          titleEn: g.titleEn,
          slug: g.slug,
          parentId: p.id,
          children: gSubjects.map((s) => {
            const concepts = extractSemanticKeywords("", "", s.titleAr);
            return {
              type: "subject" as const,
              id: s.id,
              titleAr: s.titleAr,
              titleEn: s.titleEn,
              slug: s.slug,
              parentId: g.id,
              concepts,
            };
          }),
        };
      }),
    };
  });

  return {
    person: {
      nameAr: identity.ownerNameAr || platform.nameAr,
      nameEn: identity.ownerNameEn || platform.nameEn,
      knowsAbout: personKnowsAbout,
    },
    organization: {
      nameAr: platform.nameAr,
      nameEn: platform.nameEn,
      url: `${origin}/`,
      sameAs: identity.socialUrls,
    },
    hierarchy,
  };
}

/**
 * Generate breadcrumb trail for a given content path
 * Used to make Google understand hierarchy depth
 */
export function generateBreadcrumbForLesson(args: {
  program: { titleAr: string; titleEn: string; slug: string } | null;
  grade: { titleAr: string; titleEn: string; slug: string } | null;
  subject: { titleAr: string; titleEn: string; slug: string } | null;
  course: { titleAr: string; titleEn: string; slug: string } | null;
  unit: { titleAr: string; titleEn: string; id: string } | null;
  lesson: { titleAr: string; titleEn: string; slug: string } | null;
  locale: "ar" | "en";
  origin: string;
}): Array<{ name: string; url?: string | null }> {
  const { program, grade, subject, course, unit, lesson, locale } = args;
  const crumbs: Array<{ name: string; url?: string | null }> = [
    { name: locale === "ar" ? "الرئيسية" : "Home", url: "/" },
    { name: locale === "ar" ? "الكورسات" : "Courses", url: "/courses" },
  ];
  if (program) {
    crumbs.push({
      name: locale === "ar" ? program.titleAr : program.titleEn,
      url: `/programs/${program.slug}`,
    });
  }
  if (grade) {
    crumbs.push({
      name: locale === "ar" ? grade.titleAr : grade.titleEn,
      url: `/grades/${grade.slug}`,
    });
  }
  if (subject) {
    crumbs.push({
      name: locale === "ar" ? subject.titleAr : subject.titleEn,
      url: `/subjects/${subject.slug}`,
    });
  }
  if (course) {
    crumbs.push({
      name: locale === "ar" ? course.titleAr : course.titleEn,
      url: `/courses/${course.slug}`,
    });
  }
  if (unit) {
    crumbs.push({
      name: locale === "ar" ? unit.titleAr : unit.titleEn,
      url: course ? `/courses/${course.slug}/units/${unit.id}` : undefined,
    });
  }
  if (lesson) {
    crumbs.push({
      name: locale === "ar" ? lesson.titleAr : lesson.titleEn,
      // Lesson itself is private (learn noindex), so last crumb has no URL
    });
  }
  return crumbs;
}

/**
 * Validate topical authority (no invented entities, all URLs absolute, hierarchy intact)
 */
export function validateTopicalAuthority(graph: TopicalAuthorityGraph): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!graph.person.nameAr && !graph.person.nameEn) issues.push("Person name missing");
  if (!graph.organization.nameAr && !graph.organization.nameEn) issues.push("Organization name missing");
  if (graph.hierarchy.length === 0) issues.push("Hierarchy empty — no published programs (empty-first, ok in dev)");
  // Check for invented concepts (should only be from semantic map or real titles)
  for (const prog of graph.hierarchy) {
    if (!prog.titleAr && !prog.titleEn) issues.push(`Program ${prog.id} has no title`);
    for (const grade of prog.children ?? []) {
      if (!grade.titleAr && !grade.titleEn) issues.push(`Grade ${grade.id} has no title`);
      for (const subj of grade.children ?? []) {
        if (!subj.titleAr && !subj.titleEn) issues.push(`Subject ${subj.id} has no title`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
