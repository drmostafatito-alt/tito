/**
 * Curriculum Service — 48 real lessons from Keyword Universe
 *
 * Provides grouping, slugify, related lessons, and mapping to Tito pages.
 * Uses static REAL_LESSONS as source of truth (no guessing, no invented names).
 * Future: can merge with DB curriculum_lessons table when real content available.
 */

import { REAL_LESSONS, type RealLesson } from "~server/seo/realLessons.server";

export interface CurriculumLesson extends RealLesson {
  slug: string;
  subjectSlug: string;
  gradeSlug: string;
  courseSlug: string;
  unitSlug: string;
  chapterSlug: string;
}

function slugifyAr(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

function inferSubjectSlug(subject: string, grade: string): string {
  const s = subject.toLowerCase();
  const g = grade.toLowerCase();
  if (s.includes("فلسفة") && s.includes("منطق")) {
    if (g.includes("الأول")) return "falsafa-manteq-1st";
    return "falsafa-manteq";
  }
  if (s.includes("فلسفة")) return g.includes("الأول") ? "falsafa-1st" : "falsafa";
  if (s.includes("منطق")) return g.includes("الأول") ? "manteq-1st" : "manteq";
  if (s.includes("علم النفس") || s.includes("علم نفس")) {
    if (g.includes("بكالوريا")) return "psychology-bac";
    return "psychology";
  }
  return slugifyAr(subject) || "subject";
}

function inferGradeSlug(grade: string): string {
  const g = grade.toLowerCase();
  if (g.includes("الأول الثانوي")) return "grade-1-secondary";
  if (g.includes("الثاني الثانوي")) return "grade-2-secondary";
  if (g.includes("الثالث الثانوي")) return "grade-3-secondary";
  if (g.includes("بكالوريا")) return "baccalaureate";
  return slugifyAr(grade) || "grade";
}

function lessonSlug(lesson: RealLesson): string {
  // Stable slug from official lesson name (حرفيًا من CSV)
  return slugifyAr(lesson.lesson);
}

function courseSlugFor(lesson: RealLesson): string {
  const subj = inferSubjectSlug(lesson.subject, lesson.grade);
  const grade = inferGradeSlug(lesson.grade);
  const unitSlug = slugifyAr(lesson.unit).slice(0, 20);
  return `${subj}-${grade}-${unitSlug}`.replace(/--+/g, "-");
}

export function getCurriculumLessons(): CurriculumLesson[] {
  return REAL_LESSONS.map((l) => ({
    ...l,
    slug: lessonSlug(l),
    subjectSlug: inferSubjectSlug(l.subject, l.grade),
    gradeSlug: inferGradeSlug(l.grade),
    courseSlug: courseSlugFor(l),
    unitSlug: slugifyAr(l.unit),
    chapterSlug: slugifyAr(l.chapter),
  }));
}

export function getLessonBySlug(slug: string): CurriculumLesson | null {
  return getCurriculumLessons().find((l) => l.slug === slug) ?? null;
}

export function getLessonsBySubject(subject: string, grade?: string): CurriculumLesson[] {
  return getCurriculumLessons().filter((l) => {
    if (grade) return l.subject === subject && l.grade === grade;
    return l.subject === subject;
  });
}

export function getLessonsByGrade(grade: string): CurriculumLesson[] {
  return getCurriculumLessons().filter((l) => l.grade === grade);
}

export function getLessonsByUnit(unit: string): CurriculumLesson[] {
  return getCurriculumLessons().filter((l) => l.unit === unit);
}

export function getLessonsByChapter(chapter: string): CurriculumLesson[] {
  return getCurriculumLessons().filter((l) => l.chapter === chapter);
}

export function getRelatedLessons(lesson: CurriculumLesson): CurriculumLesson[] {
  // Related = same unit, then same chapter, then same subject+grade, excluding self
  const sameUnit = getCurriculumLessons().filter((l) => l.unit === lesson.unit && l.slug !== lesson.slug);
  if (sameUnit.length > 0) return sameUnit.slice(0, 6);
  const sameChapter = getCurriculumLessons().filter((l) => l.chapter === lesson.chapter && l.slug !== lesson.slug);
  if (sameChapter.length > 0) return sameChapter.slice(0, 6);
  const sameSubjectGrade = getCurriculumLessons().filter((l) => l.subject === lesson.subject && l.grade === lesson.grade && l.slug !== lesson.slug);
  return sameSubjectGrade.slice(0, 6);
}

export interface CurriculumGroup {
  subject: string;
  grade: string;
  term: string;
  unit: string;
  chapter: string;
  lessons: CurriculumLesson[];
}

export function groupCurriculum(): CurriculumGroup[] {
  const map = new Map<string, CurriculumGroup>();
  for (const lesson of getCurriculumLessons()) {
    const key = `${lesson.subject}|${lesson.grade}|${lesson.term}|${lesson.unit}|${lesson.chapter}`;
    if (!map.has(key)) {
      map.set(key, {
        subject: lesson.subject,
        grade: lesson.grade,
        term: lesson.term,
        unit: lesson.unit,
        chapter: lesson.chapter,
        lessons: [],
      });
    }
    map.get(key)!.lessons.push(lesson);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject);
    if (a.grade !== b.grade) return a.grade.localeCompare(b.grade);
    if (a.term !== b.term) return a.term.localeCompare(b.term);
    if (a.unit !== b.unit) return a.unit.localeCompare(b.unit);
    return a.chapter.localeCompare(b.chapter);
  });
}

export interface SubjectGroup {
  subject: string;
  grade: string;
  terms: Array<{ term: string; units: Array<{ unit: string; chapters: Array<{ chapter: string; lessons: CurriculumLesson[] }> }> }>;
}

export function groupBySubject(): SubjectGroup[] {
  const bySubject = new Map<string, SubjectGroup>();
  for (const lesson of getCurriculumLessons()) {
    const key = `${lesson.subject}|${lesson.grade}`;
    if (!bySubject.has(key)) {
      bySubject.set(key, { subject: lesson.subject, grade: lesson.grade, terms: [] });
    }
    const subjGroup = bySubject.get(key)!;
    let termGroup = subjGroup.terms.find((t) => t.term === lesson.term);
    if (!termGroup) {
      termGroup = { term: lesson.term, units: [] };
      subjGroup.terms.push(termGroup);
    }
    let unitGroup = termGroup.units.find((u) => u.unit === lesson.unit);
    if (!unitGroup) {
      unitGroup = { unit: lesson.unit, chapters: [] };
      termGroup.units.push(unitGroup);
    }
    let chapterGroup = unitGroup.chapters.find((c) => c.chapter === lesson.chapter);
    if (!chapterGroup) {
      chapterGroup = { chapter: lesson.chapter, lessons: [] };
      unitGroup.chapters.push(chapterGroup);
    }
    chapterGroup.lessons.push(lesson);
  }
  return Array.from(bySubject.values());
}

export function getCurriculumStats() {
  const lessons = getCurriculumLessons();
  const subjects = [...new Set(lessons.map((l) => l.subject))];
  const grades = [...new Set(lessons.map((l) => l.grade))];
  const units = [...new Set(lessons.map((l) => l.unit))];
  const chapters = [...new Set(lessons.map((l) => l.chapter))];
  return {
    totalLessons: lessons.length,
    subjects,
    grades,
    units: units.length,
    chapters: chapters.length,
    bySubject: subjects.map((s) => ({ subject: s, count: lessons.filter((l) => l.subject === s).length })),
    byGrade: grades.map((g) => ({ grade: g, count: lessons.filter((l) => l.grade === g).length })),
  };
}
