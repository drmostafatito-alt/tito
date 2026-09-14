import { describe, expect, it } from "vitest";
import { REAL_LESSONS, REAL_LESSON_COUNT } from "~server/seo/realLessons.server";
import {
  buildRealLessonClusters,
  buildRealSubjectClusters,
  buildRealGradeClusters,
  getRealKeywordStats,
} from "~server/seo/realKeywordClusters.server";

describe("realKeywordClusters — 48 real lessons from CSV (no guessing)", () => {
  it("has 48 real lessons from user file", () => {
    expect(REAL_LESSON_COUNT).toBe(48);
    expect(REAL_LESSONS.length).toBe(48);
  });

  it("uses exact lesson names from CSV (no replacement)", () => {
    const lessonNames = REAL_LESSONS.map((l) => l.lesson);
    expect(lessonNames).toContain("معنى التفكير الإنساني وتطبيقاته");
    expect(lessonNames).toContain("من الفلسفة إلى المعمل: كيف نشأ علم النفس؟");
    expect(lessonNames).toContain("الذكاءات المتعددة (كيف نكون أذكياء بطرق مختلفة؟)");
    expect(lessonNames).toContain("الفلسفة وأخلاقيات المهنة");
  });

  it("each real lesson has subject, grade, term, unit, chapter, semantic", () => {
    for (const l of REAL_LESSONS) {
      expect(l.subject).toBeTruthy();
      expect(l.grade).toBeTruthy();
      expect(l.term).toBeTruthy();
      expect(l.unit).toBeTruthy();
      expect(l.chapter).toBeTruthy();
      expect(l.lesson).toBeTruthy();
      expect(l.semantic.length).toBeGreaterThan(0);
    }
  });

  it("covers both فلسفة ومنطق and علم النفس", () => {
    const subjects = [...new Set(REAL_LESSONS.map((l) => l.subject))];
    expect(subjects).toContain("فلسفة ومنطق");
    expect(subjects).toContain("علم النفس");
  });

  it("covers الصف الأول الثانوي and مرحلة البكالوريا المصرية", () => {
    const grades = [...new Set(REAL_LESSONS.map((l) => l.grade))];
    expect(grades).toContain("الصف الأول الثانوي");
    expect(grades).toContain("مرحلة البكالوريا المصرية");
  });

  it("builds 8 clusters per real lesson (discovery + explanation + summary + revision + questions + video + pdf + academic_year)", () => {
    const clusters = buildRealLessonClusters();
    expect(clusters.length).toBe(48 * 8);
    // Check one lesson has all intents
    const sampleLesson = REAL_LESSONS[0].lesson;
    const sampleClusters = clusters.filter((c) => c.lesson === sampleLesson);
    expect(sampleClusters.length).toBe(8);
    const intents = sampleClusters.map((c) => c.intent);
    expect(intents).toContain("lesson_discovery");
    expect(intents).toContain("lesson_explanation");
    expect(intents).toContain("lesson_summary");
    expect(intents).toContain("lesson_revision");
    expect(intents).toContain("lesson_questions");
    expect(intents).toContain("lesson_video");
    expect(intents).toContain("lesson_pdf");
    expect(intents).toContain("academic_year");
  });

  it("uses one strong canonical per intent (not per formula)", () => {
    const clusters = buildRealLessonClusters();
    const sampleLesson = REAL_LESSONS[0].lesson;
    const sampleClusters = clusters.filter((c) => c.lesson === sampleLesson);
    const explanation = sampleClusters.find((c) => c.intent === "lesson_explanation")!;
    const summary = sampleClusters.find((c) => c.intent === "lesson_summary")!;
    // Same canonical for explanation/summary/revision/video/pdf/year
    expect(explanation.targetUrl).toBe(summary.targetUrl);
    expect(explanation.targetUrl).toMatch(/^\/courses\//);
  });

  it("discovery canonical is unit page (public, lists lessons)", () => {
    const clusters = buildRealLessonClusters();
    const discovery = clusters.find((c) => c.intent === "lesson_discovery")!;
    expect(discovery.targetUrl).toContain("/units/");
    expect(discovery.indexable).toBe(true);
  });

  it("covers natural search formulas: شرح، ملخص، مراجعة، أسئلة، امتحان، تدريبات، حل أسئلة، فيديو شرح، PDF + مصطفى تيتو + 2026", () => {
    const clusters = buildRealLessonClusters();
    const allFormulas = clusters.flatMap((c) => c.searchFormulas).join(" ");
    expect(allFormulas).toContain("شرح");
    expect(allFormulas).toContain("ملخص");
    expect(allFormulas).toContain("مراجعة");
    expect(allFormulas).toContain("أسئلة");
    expect(allFormulas).toContain("امتحان");
    expect(allFormulas).toContain("تدريبات");
    expect(allFormulas).toContain("حل أسئلة");
    expect(allFormulas).toContain("فيديو شرح");
    expect(allFormulas).toContain("PDF");
    // Brand + year
    const allSecondary = clusters.flatMap((c) => c.secondary).join(" ");
    expect(allSecondary).toContain("مصطفى تيتو");
    expect(allSecondary).toContain("2026");
  });

  it("uses semantic keywords from CSV (no guessing)", () => {
    const first = REAL_LESSONS[0];
    expect(first.semantic).toContain("معنى التفكير الإنساني");
    expect(first.semantic).toContain("التفكير الإنساني");
    const clusters = buildRealLessonClusters();
    const firstClusters = clusters.filter((c) => c.lesson === first.lesson);
    expect(firstClusters[0].semantic).toContain("معنى التفكير الإنساني");
  });

  it("subject clusters canonical is subject page", () => {
    const clusters = buildRealSubjectClusters();
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      expect(c.targetUrl).toMatch(/^\/subjects\//);
      expect(c.indexable).toBe(true);
    }
  });

  it("grade clusters canonical is grade page", () => {
    const clusters = buildRealGradeClusters();
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      expect(c.targetUrl).toMatch(/^\/grades\//);
      expect(c.indexable).toBe(true);
    }
  });

  it("stats report correct counts", () => {
    const stats = getRealKeywordStats();
    expect(stats.realLessons).toBe(48);
    expect(stats.lessonClusters).toBe(48 * 8);
    expect(stats.totalClusters).toBeGreaterThan(48 * 8);
    expect(stats.searchFormulasCovered).toContain("شرح");
    expect(stats.searchFormulasCovered).toContain("مصطفى تيتو");
    expect(stats.searchFormulasCovered).toContain("2026");
  });

  it("all indexable URLs are public, not private", () => {
    const clusters = buildRealLessonClusters();
    for (const c of clusters) {
      if (c.indexable) {
        expect(c.targetUrl).not.toContain("/learn/");
        expect(c.targetUrl).not.toContain("/admin/");
        expect(c.targetUrl).not.toContain("/dashboard");
      }
    }
  });

  it("no duplicate lesson names (each real lesson = unique cluster)", () => {
    const lessonNames = REAL_LESSONS.map((l) => l.lesson);
    const unique = new Set(lessonNames);
    expect(unique.size).toBe(lessonNames.length);
  });
});
