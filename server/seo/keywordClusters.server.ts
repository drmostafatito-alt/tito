/**
 * SEO Keyword Universe — Lesson/Topic Level Clusters
 *
 * This module is the data-driven implementation of the SEO Keyword Universe
 * extracted from scientific content. It does NOT hardcode lesson names;
 * instead it builds clusters from live DB rows (program → grade → subject →
 * course → unit → lesson) and from the official Egyptian Ministry curriculum
 * structure (used only as semantic context, not as invented content).
 *
 * Design principles (per task requirements):
 * - لا تخمّن أسماء دروس: clusters are built from DB rows, not guesses
 * - لا تستبدل أسماء الدروس: lesson.titleAr/En is source of truth
 * - كل درس حقيقي = Keyword Cluster خاص به
 * - كل Keyword → الصفحة الأنسب داخل منصة Tito (canonical واحد قوي لكل Intent)
 * - صيغ البحث: شرح، ملخص، مراجعة، أسئلة، امتحان، تدريبات، حل أسئلة، فيديو شرح، PDF
 * - لا صفحة منفصلة لكل صيغة بحث؛ canonical واحد
 * - استخدم الكلمات الدلالية لبناء topical authority
 * - الهدف: Google يفهم العلاقة مصطفى تيتو → المنصة → المادة → الصف → الوحدة → الدرس → المفاهيم
 * - لا Keyword Stuffing، لا صفحات وهمية، لا Thin Content
 */

export type Intent =
  | "branded"
  | "brand_subject"
  | "subject"
  | "grade"
  | "grade_subject"
  | "course"
  | "unit"
  | "lesson_discovery"
  | "lesson_explanation"
  | "lesson_summary"
  | "lesson_revision"
  | "lesson_questions"
  | "lesson_exam"
  | "lesson_practice"
  | "lesson_video"
  | "lesson_pdf"
  | "resources"
  | "academic_year";

export type SubjectKind = "philosophy" | "psychology" | "logic" | "sociology" | "general";

export interface LessonAncestry {
  programSlug: string;
  programTitleAr: string;
  programTitleEn: string;
  gradeSlug: string;
  gradeTitleAr: string;
  gradeTitleEn: string;
  subjectSlug: string;
  subjectTitleAr: string;
  subjectTitleEn: string;
  subjectKind: SubjectKind;
  courseSlug: string;
  courseTitleAr: string;
  courseTitleEn: string;
  unitId: string;
  unitTitleAr: string;
  unitTitleEn: string;
  lessonSlug: string;
  lessonTitleAr: string;
  lessonTitleEn: string;
  lessonId: string;
}

export interface KeywordCluster {
  primary: string;
  secondary: string[];
  semantic: string[];
  searchFormulas: string[];
  intent: Intent;
  subject: string;
  grade: string;
  termPart: string | null;
  unit: string;
  chapter: string | null;
  lesson: string;
  targetUrl: string;
  indexable: boolean;
  indexabilityReason: string;
}

export const CURRICULUM_SEMANTIC_MAP: Record<string, string[]> = {
  "البيئة": ["فلسفة البيئة", "أخلاقيات البيئة", "التلوث البيئي", "التنمية المستدامة", "حماية البيئة", "الفكر البيئي"],
  "الأخلاق البيولوجية": ["الأخلاق الطبية", "الهندسة الوراثية", "الاستنساخ", "أخلاقيات البحث العلمي", "الطب الحيوي"],
  "أخلاقيات المهنة": ["أخلاقيات العمل", "المسؤولية المهنية", "القيم المهنية", "أخلاقيات المهندس", "أخلاقيات الطبيب"],
  "التفلسف": ["القيم", "الحكمة", "التفكير الفلسفي", "الموقف الفلسفي", "التأمل الفلسفي"],
  "الاستدلال الاستقرائي": ["المنهج العلمي", "التجربة", "الملاحظة", "الفرضية", "القانون العلمي", "الاستقراء الناقص"],
  "الاستنباط": ["القياس", "المنطق الصوري", "البديهيات", "البرهنة", "الاستدلال المباشر", "الاستدلال غير المباشر"],
  "التكامل": ["المنهج الاستقرائي", "المنهج الاستنباطي", "التكامل المنهجي", "العلوم الطبيعية", "العلوم الصورية"],
  "تكنولوجيا الاتصال": ["المنطق الرقمي", "الذكاء الاصطناعي", "الخوارزميات", "البرمجة المنطقية"],
  "الذكاء": ["الذكاء الواحد", "الذكاءات المتعددة", "جاردنر", "الذكاء اللغوي", "الذكاء المنطقي", "الذكاء الاجتماعي"],
  "نظريات التعلم": ["التعلم الشرطي", "بافلوف", "التعلم بالمحاولة والخطأ", "ثورندايك", "التعلم بالفهم", "الجشطلت"],
  "الاستذكار": ["أسس الاستذكار", "التعلم الجيد", "الذاكرة", "النسيان", "المراجعة", "التركيز"],
  "النمو": ["النمو الإنساني", "مبادئ النمو", "العوامل المؤثرة", "الوراثة", "البيئة", "النضج", "التعلم"],
  "الطفولة": ["مرحلة الرضاعة", "الطفولة المبكرة", "الطفولة الوسطى", "الطفولة المتأخرة", "النمو الحركي", "النمو اللغوي"],
  "المراهقة": ["مظاهر النمو", "المراهقة المبكرة", "المراهقة المتأخرة", "الهوية", "النمو الانفعالي"],
  "الشخصية": ["مفهوم الشخصية", "نظريات الشخصية", "التحليل النفسي", "فرويد", "السمات", "الأنماط"],
  "الاتجاهات": ["القيم", "الاتجاه النفسي", "مكونات الاتجاه", "وظائف الاتجاهات", "التعصب"],
  "التوافق": ["التوافق النفسي", "أساليب التوافق", "الإحباط", "الصراع", "الدفاعات النفسية", "حل الصراعات"],
  "النظرية الاجتماعية": ["بناء النظرية", "وظائف النظرية", "النظرية البنائية", "النظرية الوظيفية"],
  "التفاعل الاجتماعي": ["العلاقات الاجتماعية", "العمليات الاجتماعية", "التعاون", "الصراع", "المنافسة"],
  "الظاهرة الاجتماعية": ["خصائص الظاهرة", "دوركايم", "الموضوعية", "العمومية"],
  "الثقافة": ["الثقافة المادية", "الثقافة اللامادية", "التغير الثقافي", "العولمة الثقافية"],
  "العمل التطوعي": ["ثقافة التطوع", "العمل الحر", "ريادة الأعمال", "التنمية"],
  "البحوث الاجتماعية": ["توظيف البحوث", "خدمة التنمية", "البحث العلمي"],
  "التطرف": ["العنف", "التطرف الفكري", "أسباب التطرف", "مواجهة التطرف"],
  "التفكير الإنساني": ["التفكير", "الخرافة", "العلم", "التفكير الناقد", "التفكير الإبداعي"],
  "الفلسفة والدين": ["العلاقة بين الفلسفة والدين", "التوفيق", "الفلسفة والعلم"],
  "نشأة الفلسفة": ["تعريف الفلسفة", "الموقف الفلسفي", "أصل الفلسفة"],
  "المنطق": ["مبادئ المنطق", "أخطاء التفكير", "المنطق واللغة", "الحدود المنطقية", "الكليات الخمس", "القضية المنطقية"],
};

export function inferSubjectKind(titleAr: string): SubjectKind {
  const t = titleAr.toLowerCase();
  if (t.includes("فلسفة") || t.includes("منطق")) {
    if (t.includes("منطق")) return "logic";
    return "philosophy";
  }
  if (t.includes("نفس") || t.includes("سيكولوج")) return "psychology";
  if (t.includes("اجتماع")) return "sociology";
  return "general";
}

export function extractSemanticKeywords(lessonTitleAr: string, unitTitleAr: string, subjectTitleAr: string): string[] {
  const haystack = `${lessonTitleAr} ${unitTitleAr} ${subjectTitleAr}`;
  const found = new Set<string>();
  for (const [key, concepts] of Object.entries(CURRICULUM_SEMANTIC_MAP)) {
    if (haystack.includes(key)) {
      concepts.forEach((c) => found.add(c));
    }
  }
  if (subjectTitleAr) found.add(subjectTitleAr);
  if (lessonTitleAr) found.add(lessonTitleAr);
  return Array.from(found).slice(0, 12);
}

export const SEARCH_FORMULA_TEMPLATES = {
  explanation: ["شرح {lesson}", "شرح درس {lesson}", "شرح {lesson} {subject}", "فيديو شرح {lesson}", "شرح {lesson} {grade}", "شرح {lesson} مصطفى تيتو"],
  summary: ["ملخص {lesson}", "ملخص درس {lesson}", "ملخص {lesson} {subject}", "ملخص {lesson} PDF", "ملخص {lesson} {grade}"],
  revision: ["مراجعة {lesson}", "مراجعة درس {lesson}", "مراجعة {lesson} {subject}", "مراجعة نهائية {lesson}", "مراجعة {lesson} {grade}"],
  questions: ["أسئلة {lesson}", "أسئلة درس {lesson}", "أسئلة على {lesson}", "حل أسئلة {lesson}", "تدريبات {lesson}", "أسئلة {lesson} {subject}"],
  exam: ["امتحان {lesson}", "امتحان على {lesson}", "امتحان {lesson} {subject}", "اختبار {lesson}"],
  practice: ["تدريبات {lesson}", "تدريبات على {lesson}", "حل تدريبات {lesson}", "تمارين {lesson}"],
  video: ["فيديو شرح {lesson}", "فيديو {lesson}", "شرح {lesson} فيديو", "محاضرة {lesson}"],
  pdf: ["{lesson} PDF", "ملخص {lesson} PDF", "مذكرة {lesson} PDF", "ملزمة {lesson}"],
  general: ["{lesson} {subject}", "{lesson} {grade}", "{subject} {grade} {lesson}"],
};

export function buildSearchFormulas(lessonTitleAr: string, subjectTitleAr: string, gradeTitleAr: string): Record<string, string[]> {
  const vars = { lesson: lessonTitleAr, subject: subjectTitleAr, grade: gradeTitleAr };
  const replace = (tpl: string) => tpl.replace("{lesson}", vars.lesson).replace("{subject}", vars.subject).replace("{grade}", vars.grade);
  const out: Record<string, string[]> = {};
  for (const [k, templates] of Object.entries(SEARCH_FORMULA_TEMPLATES)) {
    out[k] = templates.map(replace);
  }
  return out;
}

export function buildLessonCluster(ancestry: LessonAncestry): KeywordCluster[] {
  const { gradeTitleAr, subjectTitleAr, unitTitleAr, lessonTitleAr, courseSlug, unitId } = ancestry;
  const semantic = extractSemanticKeywords(lessonTitleAr, unitTitleAr, subjectTitleAr);
  const formulas = buildSearchFormulas(lessonTitleAr, subjectTitleAr, gradeTitleAr);
  const courseUrl = `/courses/${courseSlug}`;
  const unitUrl = `/courses/${courseSlug}/units/${unitId}`;
  const clusters: KeywordCluster[] = [];
  clusters.push({
    primary: `${lessonTitleAr} ${subjectTitleAr}`,
    secondary: [lessonTitleAr, `${lessonTitleAr} ${gradeTitleAr}`, `${subjectTitleAr} ${lessonTitleAr}`],
    semantic,
    searchFormulas: [...formulas.general, ...formulas.explanation.slice(0, 2)],
    intent: "lesson_discovery",
    subject: subjectTitleAr,
    grade: gradeTitleAr,
    termPart: null,
    unit: unitTitleAr,
    chapter: null,
    lesson: lessonTitleAr,
    targetUrl: unitUrl,
    indexable: true,
    indexabilityReason: "Unit page is public, lists published lessons, indexable — lesson itself is private (learn route noindex)",
  });
  clusters.push({
    primary: `شرح ${lessonTitleAr}`,
    secondary: formulas.explanation,
    semantic,
    searchFormulas: formulas.explanation,
    intent: "lesson_explanation",
    subject: subjectTitleAr,
    grade: gradeTitleAr,
    termPart: null,
    unit: unitTitleAr,
    chapter: null,
    lesson: lessonTitleAr,
    targetUrl: courseUrl,
    indexable: true,
    indexabilityReason: "Course page is canonical for شرح intent — one strong URL per intent, not per formula",
  });
  clusters.push({
    primary: `ملخص ${lessonTitleAr}`,
    secondary: formulas.summary,
    semantic,
    searchFormulas: formulas.summary,
    intent: "lesson_summary",
    subject: subjectTitleAr,
    grade: gradeTitleAr,
    termPart: null,
    unit: unitTitleAr,
    chapter: null,
    lesson: lessonTitleAr,
    targetUrl: courseUrl,
    indexable: true,
    indexabilityReason: "Canonical واحد قوي لكل Intent — ملخص يخدمه نفس صفحة الكورس مع وصف غني",
  });
  clusters.push({
    primary: `مراجعة ${lessonTitleAr}`,
    secondary: formulas.revision,
    semantic,
    searchFormulas: formulas.revision,
    intent: "lesson_revision",
    subject: subjectTitleAr,
    grade: gradeTitleAr,
    termPart: null,
    unit: unitTitleAr,
    chapter: null,
    lesson: lessonTitleAr,
    targetUrl: courseUrl,
    indexable: true,
    indexabilityReason: "Revision courses are published as courses — course page is canonical",
  });
  clusters.push({
    primary: `أسئلة ${lessonTitleAr}`,
    secondary: [...formulas.questions, ...formulas.practice, ...formulas.exam],
    semantic,
    searchFormulas: [...formulas.questions, ...formulas.practice, ...formulas.exam],
    intent: "lesson_questions",
    subject: subjectTitleAr,
    grade: gradeTitleAr,
    termPart: null,
    unit: unitTitleAr,
    chapter: null,
    lesson: lessonTitleAr,
    targetUrl: courseUrl,
    indexable: true,
    indexabilityReason: "أسئلة/امتحانات/تدريبات → external Questions Platform (Tito entry point) — course page is canonical inside Tito",
  });
  clusters.push({
    primary: `فيديو شرح ${lessonTitleAr}`,
    secondary: formulas.video,
    semantic,
    searchFormulas: formulas.video,
    intent: "lesson_video",
    subject: subjectTitleAr,
    grade: gradeTitleAr,
    termPart: null,
    unit: unitTitleAr,
    chapter: null,
    lesson: lessonTitleAr,
    targetUrl: courseUrl,
    indexable: true,
    indexabilityReason: "Video content lives inside course — course page canonical",
  });
  clusters.push({
    primary: `${lessonTitleAr} PDF`,
    secondary: formulas.pdf,
    semantic,
    searchFormulas: formulas.pdf,
    intent: "lesson_pdf",
    subject: subjectTitleAr,
    grade: gradeTitleAr,
    termPart: null,
    unit: unitTitleAr,
    chapter: null,
    lesson: lessonTitleAr,
    targetUrl: courseUrl,
    indexable: true,
    indexabilityReason: "PDFs are lesson items — course page lists them, canonical",
  });
  return clusters;
}

export function buildSubjectCluster(args: { subjectTitleAr: string; subjectSlug: string; gradeTitleAr: string; gradeSlug: string; programTitleAr: string }): KeywordCluster {
  const { subjectTitleAr, subjectSlug, gradeTitleAr, programTitleAr } = args;
  const semantic = extractSemanticKeywords(subjectTitleAr, "", subjectTitleAr);
  return {
    primary: subjectTitleAr,
    secondary: [
      `مادة ${subjectTitleAr}`,
      `شرح ${subjectTitleAr}`,
      `دروس ${subjectTitleAr}`,
      `منهج ${subjectTitleAr}`,
      `مراجعة ${subjectTitleAr}`,
      `ملخص ${subjectTitleAr}`,
      `${gradeTitleAr} ${subjectTitleAr}`,
      `${subjectTitleAr} ${gradeTitleAr}`,
      `${subjectTitleAr} ${programTitleAr}`,
      `مصطفى تيتو ${subjectTitleAr}`,
      `مستر مصطفى تيتو ${subjectTitleAr}`,
    ],
    semantic,
    searchFormulas: [
      `شرح ${subjectTitleAr}`,
      `ملخص ${subjectTitleAr}`,
      `مراجعة ${subjectTitleAr}`,
      `دروس ${subjectTitleAr}`,
      `${gradeTitleAr} ${subjectTitleAr}`,
      `${subjectTitleAr} 2026`,
      `منهج ${subjectTitleAr} 2026`,
    ],
    intent: "subject",
    subject: subjectTitleAr,
    grade: gradeTitleAr,
    termPart: null,
    unit: "",
    chapter: null,
    lesson: "",
    targetUrl: `/subjects/${subjectSlug}`,
    indexable: true,
    indexabilityReason: "Subject page is canonical for subject cluster + grade+subject (title carries grade)",
  };
}

export function buildGradeCluster(args: { gradeTitleAr: string; gradeSlug: string; programTitleAr: string; programSlug: string; subjectTitles: string[] }): KeywordCluster {
  const { gradeTitleAr, gradeSlug, programTitleAr, subjectTitles } = args;
  return {
    primary: gradeTitleAr,
    secondary: [
      programTitleAr,
      `${gradeTitleAr} فلسفة`,
      `${gradeTitleAr} علم نفس`,
      `${gradeTitleAr} علم النفس`,
      `${gradeTitleAr} منطق`,
      `تالتة ثانوي`,
      `تانية ثانوي`,
      `أولى ثانوي`,
      `${gradeTitleAr} مصطفى تيتو`,
    ],
    semantic: subjectTitles,
    searchFormulas: [gradeTitleAr, programTitleAr, `${gradeTitleAr} فلسفة`, `${gradeTitleAr} علم نفس`],
    intent: "grade",
    subject: subjectTitles.join("، "),
    grade: gradeTitleAr,
    termPart: null,
    unit: "",
    chapter: null,
    lesson: "",
    targetUrl: `/grades/${gradeSlug}`,
    indexable: true,
    indexabilityReason: "Grade page is canonical for grade intent, cross-links to subjects",
  };
}

export function buildBrandCluster(siteNameAr: string): KeywordCluster {
  return {
    primary: siteNameAr,
    secondary: [
      "مصطفى تيتو",
      "مستر مصطفى تيتو",
      "دكتور مصطفى تيتو",
      "د/ مصطفى تيتو",
      "مدرس مصطفى تيتو",
      "منصة مصطفى تيتو",
      "مصطفى تيتو فلسفة",
      "مصطفى تيتو علم نفس",
      "مصطفى تيتو منطق",
    ],
    semantic: ["الفلسفة", "علم النفس", "المنطق", "الثانوية العامة", "شرح", "مراجعة", "ملخص"],
    searchFormulas: ["مصطفى تيتو", "مستر مصطفى تيتو فلسفة", "منصة مصطفى تيتو"],
    intent: "branded",
    subject: "الفلسفة وعلم النفس",
    grade: "الثانوية العامة",
    termPart: null,
    unit: "",
    chapter: null,
    lesson: "",
    targetUrl: "/",
    indexable: true,
    indexabilityReason: "Homepage is canonical for brand-core",
  };
}
