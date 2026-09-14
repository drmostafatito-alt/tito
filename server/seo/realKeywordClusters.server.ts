/**
 * Real Keyword Universe → SEO Clusters (48 real lessons from user files)
 *
 * Source: docs/seo/keyword-universe.csv (tito_seo_keyword_universe.csv)
 * - لا تخمّن أسماء دروس، استخدم فقط الموجود في الملف
 * - لا تستبدل أسماء الدروس
 * - كل درس حقيقي = Keyword Cluster خاص به
 * - اربط كل Keyword بالصفحة الأنسب داخل منصة Tito
 * - غطِّ صيغ البحث: شرح، ملخص، مراجعة، أسئلة، امتحان، تدريبات، حل أسئلة، فيديو شرح، PDF + المادة والصف والسنة واسم مصطفى تيتو
 * - لا تنشئ صفحة منفصلة لكل صيغة بحث؛ استخدم Canonical URL واحد قوي لكل Intent
 * - استخدم الكلمات الدلالية لبناء topical authority
 *
 * Mapping to Tito platform:
 * - فلسفة ومنطق / الصف الأول الثانوي → /grades/{first-secondary} + /subjects/{philosophy-1} + /courses/{course-slug}
 * - علم النفس / مرحلة البكالوريا المصرية → /grades/{baccalaureate} + /subjects/{psychology-bac} + /courses/{course-slug}
 * Since exact slugs depend on live DB, we use slugified patterns that match typical seeding.
 * Canonical strategy: course page is strongest for lesson intents (شرح/ملخص/مراجعة...), unit page for discovery, subject page for subject clusters.
 */

import { REAL_LESSONS, type RealLesson } from "./realLessons.server";
import type { KeywordCluster, Intent } from "./keywordClusters.server";
import { buildSearchFormulas } from "./keywordClusters.server";

export interface RealKeywordCluster extends KeywordCluster {
  realLesson: RealLesson;
  searchFormulaCoverage: string[]; // all covered formulas
}

function slugifyAr(text: string): string {
  // Simple slug for URL purposes - keep readable, no actual DB dependency
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-\u0600-\u06FF]/g, "")
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

function inferCourseSlug(lesson: RealLesson): string {
  // Course slug is based on subject + grade + unit
  const subj = inferSubjectSlug(lesson.subject, lesson.grade);
  const grade = inferGradeSlug(lesson.grade);
  const unitSlug = slugifyAr(lesson.unit).slice(0, 20);
  return `${subj}-${grade}-${unitSlug}`.replace(/--+/g, "-");
}

function inferUnitId(lesson: RealLesson, index: number): string {
  // Stable unit id based on unit name + index (in real DB this would be UUID, here we use deterministic placeholder)
  return `unit-${inferGradeSlug(lesson.grade)}-${slugifyAr(lesson.unit).slice(0, 15)}-${index}`;
}

export function buildRealLessonClusters(): RealKeywordCluster[] {
  const clusters: RealKeywordCluster[] = [];

  REAL_LESSONS.forEach((lesson, idx) => {
    const gradeSlug = inferGradeSlug(lesson.grade);
    const subjectSlug = inferSubjectSlug(lesson.subject, lesson.grade);
    const courseSlug = inferCourseSlug(lesson);
    const unitId = inferUnitId(lesson, idx);
    const courseUrl = `/courses/${courseSlug}`;
    const unitUrl = `/courses/${courseSlug}/units/${unitId}`;
    const subjectUrl = `/subjects/${subjectSlug}`;
    const gradeUrl = `/grades/${gradeSlug}`;

    const formulas = buildSearchFormulas(lesson.lesson, lesson.subject, lesson.grade);
    const allFormulas = [
      ...formulas.explanation,
      ...formulas.summary,
      ...formulas.revision,
      ...formulas.questions,
      ...formulas.exam,
      ...formulas.practice,
      ...formulas.video,
      ...formulas.pdf,
      ...formulas.general,
    ];

    // Add brand + year variants (logical)
    const brandedFormulas = [
      `${lesson.lesson} مصطفى تيتو`,
      `شرح ${lesson.lesson} مصطفى تيتو`,
      `ملخص ${lesson.lesson} مصطفى تيتو`,
      `مراجعة ${lesson.lesson} مصطفى تيتو`,
      `${lesson.lesson} ${lesson.subject} مصطفى تيتو`,
      `${lesson.lesson} ${lesson.grade} مصطفى تيتو`,
      `${lesson.lesson} 2026`,
      `شرح ${lesson.lesson} 2026`,
      `ملخص ${lesson.lesson} PDF`,
      `فيديو شرح ${lesson.lesson}`,
      `حل أسئلة ${lesson.lesson}`,
      `تدريبات ${lesson.lesson}`,
      `امتحان ${lesson.lesson}`,
      `أسئلة ${lesson.lesson}`,
    ];

    const semantic = lesson.semantic.slice(0, 12); // cap to avoid stuffing

    // Discovery cluster — unit page (public, lists lessons)
    clusters.push({
      primary: `${lesson.lesson} ${lesson.subject}`,
      secondary: [lesson.lesson, `${lesson.lesson} ${lesson.grade}`, `${lesson.subject} ${lesson.lesson}`],
      semantic,
      searchFormulas: [...formulas.general, ...formulas.explanation.slice(0, 2), ...brandedFormulas.slice(0, 3)],
      intent: "lesson_discovery" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: lesson.term,
      unit: lesson.unit,
      chapter: lesson.chapter,
      lesson: lesson.lesson,
      targetUrl: unitUrl,
      indexable: true,
      indexabilityReason: "Unit page public, lists published lessons, indexable — lesson itself private (learn noindex)",
      realLesson: lesson,
      searchFormulaCoverage: allFormulas,
    });

    // Explanation — course page (one strong canonical)
    clusters.push({
      primary: `شرح ${lesson.lesson}`,
      secondary: [...formulas.explanation, ...brandedFormulas.filter((f) => f.includes("شرح"))],
      semantic,
      searchFormulas: formulas.explanation,
      intent: "lesson_explanation" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: lesson.term,
      unit: lesson.unit,
      chapter: lesson.chapter,
      lesson: lesson.lesson,
      targetUrl: courseUrl,
      indexable: true,
      indexabilityReason: "Course page canonical for شرح intent — one strong URL per intent, not per formula",
      realLesson: lesson,
      searchFormulaCoverage: formulas.explanation,
    });

    // Summary — same canonical
    clusters.push({
      primary: `ملخص ${lesson.lesson}`,
      secondary: [...formulas.summary, ...brandedFormulas.filter((f) => f.includes("ملخص"))],
      semantic,
      searchFormulas: formulas.summary,
      intent: "lesson_summary" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: lesson.term,
      unit: lesson.unit,
      chapter: lesson.chapter,
      lesson: lesson.lesson,
      targetUrl: courseUrl,
      indexable: true,
      indexabilityReason: "Canonical واحد قوي لكل Intent — ملخص يخدمه نفس صفحة الكورس مع وصف غني",
      realLesson: lesson,
      searchFormulaCoverage: formulas.summary,
    });

    // Revision
    clusters.push({
      primary: `مراجعة ${lesson.lesson}`,
      secondary: [...formulas.revision, ...brandedFormulas.filter((f) => f.includes("مراجعة"))],
      semantic,
      searchFormulas: formulas.revision,
      intent: "lesson_revision" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: lesson.term,
      unit: lesson.unit,
      chapter: lesson.chapter,
      lesson: lesson.lesson,
      targetUrl: courseUrl,
      indexable: true,
      indexabilityReason: "Revision courses are published as courses — course page canonical",
      realLesson: lesson,
      searchFormulaCoverage: formulas.revision,
    });

    // Questions / Exams / Practice → external Questions Platform, canonical inside Tito = course page
    clusters.push({
      primary: `أسئلة ${lesson.lesson}`,
      secondary: [...formulas.questions, ...formulas.practice, ...formulas.exam, ...brandedFormulas.filter((f) => f.includes("أسئلة") || f.includes("امتحان") || f.includes("تدريبات") || f.includes("حل أسئلة"))],
      semantic,
      searchFormulas: [...formulas.questions, ...formulas.practice, ...formulas.exam],
      intent: "lesson_questions" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: lesson.term,
      unit: lesson.unit,
      chapter: lesson.chapter,
      lesson: lesson.lesson,
      targetUrl: courseUrl,
      indexable: true,
      indexabilityReason: "أسئلة/امتحانات/تدريبات → external Questions Platform (Tito entry point) — course page canonical inside Tito",
      realLesson: lesson,
      searchFormulaCoverage: [...formulas.questions, ...formulas.exam, ...formulas.practice],
    });

    // Video
    clusters.push({
      primary: `فيديو شرح ${lesson.lesson}`,
      secondary: [...formulas.video, ...brandedFormulas.filter((f) => f.includes("فيديو"))],
      semantic,
      searchFormulas: formulas.video,
      intent: "lesson_video" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: lesson.term,
      unit: lesson.unit,
      chapter: lesson.chapter,
      lesson: lesson.lesson,
      targetUrl: courseUrl,
      indexable: true,
      indexabilityReason: "Video content lives inside course — course page canonical",
      realLesson: lesson,
      searchFormulaCoverage: formulas.video,
    });

    // PDF
    clusters.push({
      primary: `${lesson.lesson} PDF`,
      secondary: [...formulas.pdf, ...brandedFormulas.filter((f) => f.includes("PDF"))],
      semantic,
      searchFormulas: formulas.pdf,
      intent: "lesson_pdf" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: lesson.term,
      unit: lesson.unit,
      chapter: lesson.chapter,
      lesson: lesson.lesson,
      targetUrl: courseUrl,
      indexable: true,
      indexabilityReason: "PDFs are lesson items — course page lists them, canonical",
      realLesson: lesson,
      searchFormulaCoverage: formulas.pdf,
    });

    // Brand + year + subject+grade combined — still course page, but we note it for reporting
    clusters.push({
      primary: `${lesson.lesson} ${lesson.subject} ${lesson.grade} مصطفى تيتو 2026`,
      secondary: brandedFormulas,
      semantic,
      searchFormulas: brandedFormulas,
      intent: "academic_year" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: lesson.term,
      unit: lesson.unit,
      chapter: lesson.chapter,
      lesson: lesson.lesson,
      targetUrl: courseUrl,
      indexable: true,
      indexabilityReason: "Year 2026 in metadata only, no /2026/ URL — same canonical, title carries year+brand",
      realLesson: lesson,
      searchFormulaCoverage: brandedFormulas,
    });
  });

  return clusters;
}

export function buildRealSubjectClusters(): KeywordCluster[] {
  const seen = new Map<string, RealLesson>();
  for (const l of REAL_LESSONS) {
    const key = `${l.subject}|${l.grade}`;
    if (!seen.has(key)) seen.set(key, l);
  }
  const clusters: KeywordCluster[] = [];
  for (const lesson of seen.values()) {
    const subjectSlug = inferSubjectSlug(lesson.subject, lesson.grade);
    const gradeSlug = inferGradeSlug(lesson.grade);
    clusters.push({
      primary: lesson.subject,
      secondary: [
        `مادة ${lesson.subject}`,
        `شرح ${lesson.subject}`,
        `دروس ${lesson.subject}`,
        `منهج ${lesson.subject}`,
        `مراجعة ${lesson.subject}`,
        `ملخص ${lesson.subject}`,
        `${lesson.grade} ${lesson.subject}`,
        `${lesson.subject} ${lesson.grade}`,
        `مصطفى تيتو ${lesson.subject}`,
        `مستر مصطفى تيتو ${lesson.subject}`,
        `${lesson.subject} 2026`,
      ],
      semantic: lesson.semantic.slice(0, 10),
      searchFormulas: [
        `شرح ${lesson.subject}`,
        `ملخص ${lesson.subject}`,
        `مراجعة ${lesson.subject}`,
        `دروس ${lesson.subject}`,
        `${lesson.grade} ${lesson.subject}`,
        `${lesson.subject} 2026`,
        `منهج ${lesson.subject} 2026`,
        `مصطفى تيتو ${lesson.subject}`,
      ],
      intent: "subject" as Intent,
      subject: lesson.subject,
      grade: lesson.grade,
      termPart: null,
      unit: "",
      chapter: null,
      lesson: "",
      targetUrl: `/subjects/${subjectSlug}`,
      indexable: true,
      indexabilityReason: "Subject page canonical for subject cluster + grade+subject (title carries grade)",
    });
  }
  return clusters;
}

export function buildRealGradeClusters(): KeywordCluster[] {
  const seen = new Map<string, RealLesson[]>();
  for (const l of REAL_LESSONS) {
    if (!seen.has(l.grade)) seen.set(l.grade, []);
    seen.get(l.grade)!.push(l);
  }
  const clusters: KeywordCluster[] = [];
  for (const [grade, lessons] of seen.entries()) {
    const gradeSlug = inferGradeSlug(grade);
    const subjects = [...new Set(lessons.map((l) => l.subject))];
    clusters.push({
      primary: grade,
      secondary: [
        `${grade} فلسفة`,
        `${grade} علم نفس`,
        `${grade} منطق`,
        `تالتة ثانوي`,
        `تانية ثانوي`,
        `أولى ثانوي`,
        `${grade} مصطفى تيتو`,
        `بكالوريا`,
        `مرحلة البكالوريا`,
      ],
      semantic: subjects,
      searchFormulas: [grade, `${grade} فلسفة`, `${grade} علم نفس`, `${grade} مصطفى تيتو`],
      intent: "grade" as Intent,
      subject: subjects.join("، "),
      grade,
      termPart: null,
      unit: "",
      chapter: null,
      lesson: "",
      targetUrl: `/grades/${gradeSlug}`,
      indexable: true,
      indexabilityReason: "Grade page canonical for grade intent, cross-links to subjects",
    });
  }
  return clusters;
}

export function getRealKeywordStats() {
  const lessonClusters = buildRealLessonClusters();
  const subjectClusters = buildRealSubjectClusters();
  const gradeClusters = buildRealGradeClusters();
  return {
    realLessons: REAL_LESSONS.length,
    lessonClusters: lessonClusters.length,
    subjectClusters: subjectClusters.length,
    gradeClusters: gradeClusters.length,
    totalClusters: lessonClusters.length + subjectClusters.length + gradeClusters.length,
    intentsCovered: [...new Set(lessonClusters.map((c) => c.intent))],
    searchFormulasCovered: ["شرح", "ملخص", "مراجعة", "أسئلة", "امتحان", "تدريبات", "حل أسئلة", "فيديو شرح", "PDF", "مصطفى تيتو", "2026"],
  };
}
