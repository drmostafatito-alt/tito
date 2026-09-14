/**
 * Real Lessons → Existing Public Pages Mapping (SEO Discovery, no homepage visibility)
 * Source: REAL_LESSONS from keyword-universe.csv (48 real lessons, no guessing)
 * Purpose: enrich SEO metadata of existing pages (grades, subjects, courses) with matching lesson names/semantic
 * without showing 48 lessons list to students.
 *
 * No new pages, no doorway, no thin content, no invented content.
 */

import { REAL_LESSONS, type RealLesson } from "./realLessons.server";

function normalizeAr(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Strict matching for grade:
 * - "الصف الأول الثانوي" ↔ any grade title containing "الأول"
 * - "مرحلة البكالوريا المصرية" ↔ grade title containing "بكالوريا"
 * - Otherwise exact or substring with at least 4 chars to avoid false positives like "صف فارغ"
 */
export function getRealLessonsForGrade(gradeTitleAr: string): RealLesson[] {
  const g = normalizeAr(gradeTitleAr);
  if (!g) return [];
  return REAL_LESSONS.filter((l) => {
    const csvGrade = normalizeAr(l.grade);
    if (g.includes("بكالوريا") && csvGrade.includes("بكالوريا")) return true;
    if (g.includes("الأول") && csvGrade.includes("الأول")) return true;
    if (g.includes("الثاني") && csvGrade.includes("الثاني")) return true;
    if (g.includes("الثالث") && csvGrade.includes("الثالث")) return true;
    // Avoid false positives: require at least 4 chars and not just generic "صف"
    if (g.length >= 4 && csvGrade.length >= 4) {
      if (csvGrade.includes(g) || g.includes(csvGrade)) return true;
    }
    return false;
  });
}

export function getRealLessonsForSubject(subjectTitleAr: string): RealLesson[] {
  const s = normalizeAr(subjectTitleAr);
  if (!s) return [];
  return REAL_LESSONS.filter((l) => {
    const csvSubject = normalizeAr(l.subject);
    // فلسفة ومنطق matching
    if (s.includes("فلسفة") && s.includes("منطق")) {
      return csvSubject.includes("فلسفة") || csvSubject.includes("منطق");
    }
    if (s.includes("فلسفة")) return csvSubject.includes("فلسفة");
    if (s.includes("منطق")) return csvSubject.includes("منطق") || csvSubject.includes("فلسفة");
    if (s.includes("نفس") || s.includes("سيكولوج") || s.includes("psychology")) {
      return csvSubject.includes("نفس") || csvSubject.includes("علم النفس");
    }
    // Fallback strict substring
    if (s.length >= 3 && csvSubject.length >= 3) {
      if (csvSubject.includes(s) || s.includes(csvSubject)) return true;
    }
    return false;
  });
}

export function getRealLessonsForCourse(subjectTitleAr: string, gradeTitleAr: string): RealLesson[] {
  const bySubject = getRealLessonsForSubject(subjectTitleAr);
  const byGrade = getRealLessonsForGrade(gradeTitleAr);
  // Intersection: lessons that match both subject and grade
  const byGradeSet = new Set(byGrade.map((l) => l.lesson));
  return bySubject.filter((l) => byGradeSet.has(l.lesson));
}

/**
 * Get up to N lesson names for meta description enrichment (natural, no stuffing)
 */
export function getLessonNamesForMeta(lessons: RealLesson[], max = 3): string[] {
  return lessons.slice(0, max).map((l) => l.lesson);
}

/**
 * Get semantic keywords from matching lessons (for DefinedTermSet)
 */
export function getSemanticForLessons(lessons: RealLesson[], maxTerms = 12): string[] {
  const all = lessons.flatMap((l) => l.semantic);
  // Deduplicate, keep order, cap
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of all) {
    const t = term.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxTerms) break;
  }
  return out;
}

/**
 * For reporting: which lessons lack real public page target (based on current DB seeding)
 * In production, if owner creates real grades/subjects, they will have targets.
 * This function is for audit only, not for creating pages.
 */
export function auditLessonsWithoutRealTarget(existingGrades: string[], existingSubjects: string[]): { lesson: RealLesson; missing: string[] }[] {
  const out: { lesson: RealLesson; missing: string[] }[] = [];
  for (const lesson of REAL_LESSONS) {
    const missing: string[] = [];
    const gradeMatch = existingGrades.some((g) => {
      const gn = normalizeAr(g);
      const csvGrade = normalizeAr(lesson.grade);
      return gn.includes("بكالوريا") && csvGrade.includes("بكالوريا") || gn.includes("الأول") && csvGrade.includes("الأول") || csvGrade.includes(gn) || gn.includes(csvGrade);
    });
    const subjectMatch = existingSubjects.some((s) => {
      const sn = normalizeAr(s);
      const csvSubject = normalizeAr(lesson.subject);
      return sn.includes("فلسفة") && csvSubject.includes("فلسفة") || sn.includes("نفس") && csvSubject.includes("نفس") || csvSubject.includes(sn) || sn.includes(csvSubject);
    });
    if (!gradeMatch) missing.push(`grade:${lesson.grade}`);
    if (!subjectMatch) missing.push(`subject:${lesson.subject}`);
    if (missing.length > 0) out.push({ lesson, missing });
  }
  return out;
}
