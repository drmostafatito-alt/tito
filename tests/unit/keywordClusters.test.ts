import { describe, expect, it } from "vitest";
import {
  buildLessonCluster,
  buildSubjectCluster,
  buildGradeCluster,
  buildBrandCluster,
  extractSemanticKeywords,
  buildSearchFormulas,
  CURRICULUM_SEMANTIC_MAP,
} from "~server/seo/keywordClusters.server";
import { CANONICAL_MAP, getCanonicalForIntent, validateCanonicalUniqueness } from "~server/seo/canonicalMap.server";

describe("keywordClusters — lesson clusters from real DB rows", () => {
  const ancestry = {
    programSlug: "al-Thanawiya-al-3amma",
    programTitleAr: "الثانوية العامة",
    programTitleEn: "General Secondary",
    gradeSlug: "grade-3-secondary",
    gradeTitleAr: "الصف الثالث الثانوي",
    gradeTitleEn: "Grade 12",
    subjectSlug: "falsafa-3rd",
    subjectTitleAr: "الفلسفة",
    subjectTitleEn: "Philosophy",
    subjectKind: "philosophy" as const,
    courseSlug: "falsafa-revision",
    courseTitleAr: "مراجعة شاملة فلسفة",
    courseTitleEn: "Full Revision Philosophy",
    unitId: "unit-1-id",
    unitTitleAr: "الوحدة الأولى: الفلسفة التطبيقية",
    unitTitleEn: "Unit 1: Applied Philosophy",
    lessonSlug: "falsafa-environment",
    lessonTitleAr: "الفلسفة وقضايا البيئة",
    lessonTitleEn: "Philosophy and Environmental Issues",
    lessonId: "lesson-1-id",
  };

  it("builds 7 clusters per real lesson (discovery + explanation + summary + revision + questions + video + pdf)", () => {
    const clusters = buildLessonCluster(ancestry);
    expect(clusters.length).toBe(7);
    const intents = clusters.map((c) => c.intent);
    expect(intents).toContain("lesson_discovery");
    expect(intents).toContain("lesson_explanation");
    expect(intents).toContain("lesson_summary");
    expect(intents).toContain("lesson_revision");
    expect(intents).toContain("lesson_questions");
    expect(intents).toContain("lesson_video");
    expect(intents).toContain("lesson_pdf");
  });

  it("uses one strong canonical per intent (not per formula)", () => {
    const clusters = buildLessonCluster(ancestry);
    const explanation = clusters.find((c) => c.intent === "lesson_explanation")!;
    expect(explanation.targetUrl).toBe("/courses/falsafa-revision");
    expect(explanation.searchFormulas.length).toBeGreaterThan(1);
    const summary = clusters.find((c) => c.intent === "lesson_summary")!;
    expect(summary.targetUrl).toBe("/courses/falsafa-revision");
  });

  it("lesson_discovery canonical is unit page (public, lists lessons)", () => {
    const clusters = buildLessonCluster(ancestry);
    const discovery = clusters.find((c) => c.intent === "lesson_discovery")!;
    expect(discovery.targetUrl).toBe("/courses/falsafa-revision/units/unit-1-id");
    expect(discovery.indexable).toBe(true);
  });

  it("extracts semantic keywords from real lesson titles (no guessing)", () => {
    const semantic = extractSemanticKeywords("الفلسفة وقضايا البيئة", "الفلسفة التطبيقية", "الفلسفة");
    expect(semantic.length).toBeGreaterThan(0);
    // Should contain subject and lesson itself
    expect(semantic).toContain("الفلسفة");
    expect(semantic).toContain("الفلسفة وقضايا البيئة");
  });

  it("builds search formulas with subject, grade, brand", () => {
    const formulas = buildSearchFormulas("الفلسفة وقضايا البيئة", "الفلسفة", "الصف الثالث الثانوي");
    expect(formulas.explanation[0]).toContain("الفلسفة وقضايا البيئة");
    expect(formulas.explanation.some((f) => f.includes("مصطفى تيتو"))).toBe(true);
    expect(formulas.summary.some((f) => f.includes("PDF"))).toBe(true);
  });

  it("subject cluster canonical is subject page (grade in title)", () => {
    const cluster = buildSubjectCluster({
      subjectTitleAr: "الفلسفة",
      subjectSlug: "falsafa-3rd",
      gradeTitleAr: "الصف الثالث الثانوي",
      gradeSlug: "grade-3-secondary",
      programTitleAr: "الثانوية العامة",
    });
    expect(cluster.targetUrl).toBe("/subjects/falsafa-3rd");
    expect(cluster.primary).toBe("الفلسفة");
    // Secondary should contain grade+subject in any form
    expect(cluster.secondary.some((s) => s.includes("الصف الثالث الثانوي") && s.includes("الفلسفة"))).toBe(true);
  });

  it("grade cluster canonical is grade page", () => {
    const cluster = buildGradeCluster({
      gradeTitleAr: "الصف الثالث الثانوي",
      gradeSlug: "grade-3-secondary",
      programTitleAr: "الثانوية العامة",
      programSlug: "thanaweya",
      subjectTitles: ["الفلسفة", "علم النفس"],
    });
    expect(cluster.targetUrl).toBe("/grades/grade-3-secondary");
  });

  it("brand cluster canonical is homepage", () => {
    const cluster = buildBrandCluster("د/ مصطفى تيتو");
    expect(cluster.targetUrl).toBe("/");
    expect(cluster.primary).toBe("د/ مصطفى تيتو");
  });

  it("curriculum semantic map has real Ministry concepts, not invented", () => {
    expect(CURRICULUM_SEMANTIC_MAP["البيئة"]).toContain("التنمية المستدامة");
    expect(CURRICULUM_SEMANTIC_MAP["الذكاء"]).toContain("جاردنر");
    expect(CURRICULUM_SEMANTIC_MAP["الاستدلال الاستقرائي"]).toContain("المنهج العلمي");
  });
});

describe("canonicalMap — one strong URL per intent", () => {
  it("covers all required intents", () => {
    const intents = CANONICAL_MAP.map((m) => m.intent);
    expect(intents).toContain("branded");
    expect(intents).toContain("subject");
    expect(intents).toContain("grade");
    expect(intents).toContain("grade_subject");
    expect(intents).toContain("course");
    expect(intents).toContain("unit");
    expect(intents).toContain("lesson_discovery");
    expect(intents).toContain("lesson_explanation");
    expect(intents).toContain("lesson_questions");
    expect(intents).toContain("academic_year");
  });

  it("covers natural search formulas: شرح، ملخص، مراجعة، أسئلة، امتحان، تدريبات، حل أسئلة، فيديو شرح، PDF", () => {
    const allKeywords = CANONICAL_MAP.flatMap((m) => m.exampleKeywords).join(" ");
    expect(allKeywords).toContain("شرح");
    expect(allKeywords).toContain("ملخص");
    expect(allKeywords).toContain("مراجعة");
    expect(allKeywords).toContain("أسئلة");
    expect(allKeywords).toContain("امتحان");
    expect(allKeywords).toContain("تدريبات");
    expect(allKeywords).toContain("حل أسئلة");
    expect(allKeywords).toContain("فيديو شرح");
    expect(allKeywords).toContain("PDF");
  });

  it("includes brand + subject + grade + year + مصطفى تيتو when logical", () => {
    const all = CANONICAL_MAP.flatMap((m) => m.exampleKeywords).join(" ");
    expect(all).toContain("مصطفى تيتو");
    expect(all).toContain("فلسفة");
    expect(all).toContain("تالتة ثانوي");
    expect(all).toContain("2026");
  });

  it("getCanonicalForIntent returns stable URLs", () => {
    expect(getCanonicalForIntent("branded", {})).toBe("/");
    expect(getCanonicalForIntent("subject", { subjectSlug: "falsafa" })).toBe("/subjects/falsafa");
    expect(getCanonicalForIntent("lesson_explanation", { courseSlug: "falsafa-rev" })).toBe("/courses/falsafa-rev");
    expect(getCanonicalForIntent("lesson_discovery", { courseSlug: "falsafa-rev", unitId: "u1" })).toBe("/courses/falsafa-rev/units/u1");
  });

  it("canonical map has no exact duplicate example keywords across different intents", () => {
    // Allow some overlap for generic terms, but ensure primary keywords are unique
    const primaryKeywords = CANONICAL_MAP.map((m) => m.exampleKeywords[0]?.toLowerCase().trim()).filter(Boolean);
    const unique = new Set(primaryKeywords);
    expect(unique.size).toBe(primaryKeywords.length);
  });

  it("all canonicals are absolute paths, no query strings, no year in URL", () => {
    for (const m of CANONICAL_MAP) {
      expect(m.canonicalPattern).not.toContain("?");
      expect(m.canonicalPattern).not.toContain("2026");
      expect(m.exampleUrl).not.toContain("?");
    }
  });

  it("indexable URLs are public, not private", () => {
    for (const m of CANONICAL_MAP) {
      if (m.indexable) {
        expect(m.exampleUrl).not.toContain("/learn/");
        expect(m.exampleUrl).not.toContain("/admin/");
        expect(m.exampleUrl).not.toContain("/dashboard");
      }
    }
  });
});
