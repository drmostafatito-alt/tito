import { describe, expect, it } from "vitest";
import {
  getCurriculumLessons,
  getLessonBySlug,
  getLessonsBySubject,
  getLessonsByGrade,
  getRelatedLessons,
  groupCurriculum,
  groupBySubject,
  getCurriculumStats,
} from "~server/curriculum/service.server";
import { EXTERNAL_EXAMS_URL } from "~server/curriculum/constants";

describe("curriculum service — 48 real lessons", () => {
  it("has 48 lessons", () => {
    expect(getCurriculumLessons().length).toBe(48);
  });

  it("each lesson has official hierarchy from CSV (no guessing)", () => {
    for (const l of getCurriculumLessons()) {
      expect(l.subject).toBeTruthy();
      expect(l.grade).toBeTruthy();
      expect(l.term).toBeTruthy();
      expect(l.unit).toBeTruthy();
      expect(l.chapter).toBeTruthy();
      expect(l.lesson).toBeTruthy();
      expect(l.semantic.length).toBeGreaterThan(0);
      expect(l.slug).toBeTruthy();
    }
  });

  it("slug is stable and Arabic-aware", () => {
    const lesson = getLessonBySlug("معنى-التفكير-الإنساني-وتطبيقاته");
    expect(lesson).toBeTruthy();
    expect(lesson?.lesson).toBe("معنى التفكير الإنساني وتطبيقاته");
  });

  it("getLessonBySlug returns null for unknown", () => {
    expect(getLessonBySlug("non-existent-slug")).toBeNull();
  });

  it("groupCurriculum groups by term→unit→chapter", () => {
    const groups = groupCurriculum();
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.subject).toBeTruthy();
      expect(g.grade).toBeTruthy();
      expect(g.term).toBeTruthy();
      expect(g.unit).toBeTruthy();
      expect(g.chapter).toBeTruthy();
      expect(g.lessons.length).toBeGreaterThan(0);
    }
  });

  it("groupBySubject groups correctly", () => {
    const groups = groupBySubject();
    expect(groups.length).toBe(2); // فلسفة ومنطق + علم النفس
    const philosophy = groups.find((g) => g.subject.includes("فلسفة"));
    const psychology = groups.find((g) => g.subject.includes("علم النفس"));
    expect(philosophy).toBeTruthy();
    expect(psychology).toBeTruthy();
    expect(philosophy!.terms.length).toBeGreaterThan(0);
  });

  it("getLessonsBySubject filters correctly", () => {
    const philosophy = getLessonsBySubject("فلسفة ومنطق");
    expect(philosophy.length).toBe(24);
    const psychology = getLessonsBySubject("علم النفس");
    expect(psychology.length).toBe(24);
  });

  it("getLessonsByGrade filters correctly", () => {
    const firstSecondary = getLessonsByGrade("الصف الأول الثانوي");
    expect(firstSecondary.length).toBe(24);
    const bac = getLessonsByGrade("مرحلة البكالوريا المصرية");
    expect(bac.length).toBe(24);
  });

  it("getRelatedLessons returns same unit or chapter", () => {
    const lesson = getCurriculumLessons()[0];
    const related = getRelatedLessons(lesson);
    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(6);
    // Related should not include self
    expect(related.find((r) => r.slug === lesson.slug)).toBeUndefined();
    // At least one related shares unit or chapter
    const sameUnitOrChapter = related.some((r) => r.unit === lesson.unit || r.chapter === lesson.chapter);
    expect(sameUnitOrChapter).toBe(true);
  });

  it("stats are correct", () => {
    const stats = getCurriculumStats();
    expect(stats.totalLessons).toBe(48);
    expect(stats.subjects).toContain("فلسفة ومنطق");
    expect(stats.subjects).toContain("علم النفس");
    expect(stats.grades).toContain("الصف الأول الثانوي");
    expect(stats.grades).toContain("مرحلة البكالوريا المصرية");
    expect(stats.bySubject.find((s) => s.subject === "فلسفة ومنطق")?.count).toBe(24);
  });

  it("external exams URL is correct (no internal question bank)", () => {
    expect(EXTERNAL_EXAMS_URL).toBe("https://exams.mansa-eg.workers.dev/");
    expect(EXTERNAL_EXAMS_URL).toMatch(/^https:\/\//);
  });

  it("all lesson slugs are unique (no duplicate pages)", () => {
    const slugs = getCurriculumLessons().map((l) => l.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it("subjectSlug and gradeSlug are stable and public-friendly (no private paths)", () => {
    for (const l of getCurriculumLessons()) {
      expect(l.subjectSlug).not.toContain("/learn/");
      expect(l.gradeSlug).not.toContain("/admin/");
      expect(l.courseSlug).not.toContain("?");
    }
  });
});
