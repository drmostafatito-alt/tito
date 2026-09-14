/**
 * Canonical URL Map — One strong URL per Intent
 *
 * Implements requirement #6: لا تنشئ صفحة منفصلة لكل صيغة بحث؛ استخدم Canonical URL واحد قوي لكل Intent.
 *
 * Each search formula (شرح، ملخص، مراجعة، أسئلة، ...) maps to the same canonical URL
 * for its intent cluster. This prevents cannibalization and doorway pages.
 */

export type Intent =
  | "branded"
  | "brand_entity"
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
  | "lesson_video"
  | "lesson_pdf"
  | "resources"
  | "academic_year";

export interface CanonicalMapping {
  intent: Intent;
  /** Example keywords that map to this canonical */
  exampleKeywords: string[];
  /** Canonical URL pattern (with placeholders) */
  canonicalPattern: string;
  /** Concrete example URL */
  exampleUrl: string;
  /** Indexability */
  indexable: boolean;
  /** Reason */
  reason: string;
}

/**
 * Canonical map for Tito platform (Egyptian Arabic search behavior)
 * All URLs are stable, no year, no query strings, no ids in query.
 */
export const CANONICAL_MAP: CanonicalMapping[] = [
  {
    intent: "branded",
    exampleKeywords: ["مصطفى تيتو", "مستر مصطفى تيتو", "منصة مصطفى تيتو", "د/ مصطفى تيتو"],
    canonicalPattern: "/",
    exampleUrl: "/",
    indexable: true,
    reason: "Brand-core intent → homepage (strongest brand signal, discovery links to subjects/grades)",
  },
  {
    intent: "brand_entity",
    exampleKeywords: ["دكتور مصطفى تيتو", "مدرس مصطفى تيتو", "مصطفى تيتو فلسفة مدرس"],
    canonicalPattern: "/about",
    exampleUrl: "/about",
    indexable: true,
    reason: "Entity intent → about page (Person LD, only when owner identity configured)",
  },
  {
    intent: "brand_subject",
    exampleKeywords: ["مصطفى تيتو فلسفة", "مصطفى تيتو علم نفس", "مستر مصطفى تيتو منطق"],
    canonicalPattern: "/subjects/:subjectSlug",
    exampleUrl: "/subjects/falsafa-3rd",
    indexable: true,
    reason: "Brand+subject → subject page (title carries brand, subject is real row)",
  },
  {
    intent: "subject",
    exampleKeywords: ["فلسفة", "مادة الفلسفة", "شرح الفلسفة", "دروس الفلسفة", "منهج الفلسفة", "مراجعة فلسفة", "ملخص فلسفة", "فلسفه (variant)"],
    canonicalPattern: "/subjects/:subjectSlug",
    exampleUrl: "/subjects/falsafa-3rd",
    indexable: true,
    reason: "Subject cluster → subject page (one canonical for all spelling variants, no duplicate pages)",
  },
  {
    intent: "grade",
    exampleKeywords: ["الصف الثالث الثانوي", "تالتة ثانوي", "الثانوية العامة", "ثانوية عامة", "الصف الأول الثانوي", "أولى ثانوي"],
    canonicalPattern: "/grades/:gradeSlug",
    exampleUrl: "/grades/grade-3-secondary",
    indexable: true,
    reason: "Grade intent → grade page (lists its subjects, cross-links, anti-thin)",
  },
  {
    intent: "grade_subject",
    exampleKeywords: ["تالتة ثانوي فلسفة", "فلسفة تالتة ثانوي", "تالتة ثانوي علم نفس", "أولى ثانوي فلسفة"],
    canonicalPattern: "/subjects/:subjectSlug (title = subject — grade — brand)",
    exampleUrl: "/subjects/falsafa-3rd (title: فلسفة — الصف الثالث الثانوي — د/ مصطفى تيتو)",
    indexable: true,
    reason: "Grade+subject (high value) → subject page wins, grade in title + breadcrumb, grade page cross-links",
  },
  {
    intent: "course",
    exampleKeywords: ["كورس فلسفة تالتة ثانوي", "محاضرة فلسفة", "شرح فلسفة كامل", "كورس علم نفس"],
    canonicalPattern: "/courses/:courseSlug",
    exampleUrl: "/courses/falsafa-revision",
    indexable: true,
    reason: "Course discovery → course page (is the lecture content, hasPart units)",
  },
  {
    intent: "unit",
    exampleKeywords: ["الوحدة الأولى فلسفة", "الفلسفة التطبيقية", "الوحدة الأولى فلسفة تالتة ثانوي", "الذكاء والتعلم"],
    canonicalPattern: "/courses/:courseSlug/units/:unitId",
    exampleUrl: "/courses/falsafa-revision/units/unit-1-id",
    indexable: true,
    reason: "Unit discovery → unit page (public, lists lessons, indexable, lesson discovery canonical)",
  },
  {
    intent: "lesson_discovery",
    exampleKeywords: ["درس الفلسفة وقضايا البيئة", "الفلسفة وقضايا البيئة", "درس الذكاءات المتعددة"],
    canonicalPattern: "/courses/:courseSlug/units/:unitId",
    exampleUrl: "/courses/falsafa-revision/units/unit-1-id",
    indexable: true,
    reason: "Lesson titles are public in unit page, lesson content private (learn noindex) — unit page is canonical",
  },
  {
    intent: "lesson_explanation",
    exampleKeywords: [
      "شرح الفلسفة وقضايا البيئة",
      "شرح درس الفلسفة وقضايا البيئة",
      "شرح الفلسفة وقضايا البيئة تالتة ثانوي",
      "شرح الفلسفة وقضايا البيئة مصطفى تيتو",
      "فيديو شرح الفلسفة وقضايا البيئة",
      "شرح الفلسفة وقضايا البيئة 2026",
    ],
    canonicalPattern: "/courses/:courseSlug",
    exampleUrl: "/courses/falsafa-revision",
    indexable: true,
    reason: "شرح intent → course page (one strong URL for all شرح variants, no separate page per formula)",
  },
  {
    intent: "lesson_summary",
    exampleKeywords: [
      "ملخص الفلسفة وقضايا البيئة",
      "ملخص درس الفلسفة وقضايا البيئة",
      "ملخص الفلسفة وقضايا البيئة PDF",
      "ملخص الفلسفة وقضايا البيئة تالتة ثانوي",
    ],
    canonicalPattern: "/courses/:courseSlug",
    exampleUrl: "/courses/falsafa-revision",
    indexable: true,
    reason: "ملخص intent → same course page canonical (description rich, no thin summary page)",
  },
  {
    intent: "lesson_revision",
    exampleKeywords: [
      "مراجعة الفلسفة وقضايا البيئة",
      "مراجعة نهائية الفلسفة وقضايا البيئة",
      "مراجعة الفلسفة وقضايا البيئة تالتة ثانوي",
    ],
    canonicalPattern: "/courses/:courseSlug",
    exampleUrl: "/courses/falsafa-revision",
    indexable: true,
    reason: "مراجعة intent → course page (revision courses are published as courses)",
  },
  {
    intent: "lesson_questions",
    exampleKeywords: [
      "أسئلة الفلسفة وقضايا البيئة",
      "أسئلة على الفلسفة وقضايا البيئة",
      "حل أسئلة الفلسفة وقضايا البيئة",
      "تدريبات الفلسفة وقضايا البيئة",
      "امتحان الفلسفة وقضايا البيئة",
      "امتحانات فلسفة",
      "بنك أسئلة فلسفة",
    ],
    canonicalPattern: "/courses/:courseSlug (→ external Questions Platform)",
    exampleUrl: "/courses/falsafa-revision (links to external Questions Platform)",
    indexable: true,
    reason: "أسئلة/امتحانات/تدريبات → external Questions Platform (Tito entry point), never a Tito questions page",
  },
  {
    intent: "lesson_video",
    exampleKeywords: ["فيديو شرح الفلسفة وقضايا البيئة", "محاضرة الفلسفة وقضايا البيئة", "فيديو الفلسفة وقضايا البيئة"],
    canonicalPattern: "/courses/:courseSlug",
    exampleUrl: "/courses/falsafa-revision",
    indexable: true,
    reason: "Video intent → course page (video lives inside course, course page canonical)",
  },
  {
    intent: "lesson_pdf",
    exampleKeywords: ["الفلسفة وقضايا البيئة PDF", "مذكرة الفلسفة وقضايا البيئة PDF", "ملزمة الفلسفة وقضايا البيئة"],
    canonicalPattern: "/courses/:courseSlug + /p/resources",
    exampleUrl: "/courses/falsafa-revision (lists PDFs) + /p/resources",
    indexable: true,
    reason: "PDFs are lesson items, course page lists them, resources page is library",
  },
  {
    intent: "resources",
    exampleKeywords: ["ملخص فلسفة", "مذكرات فلسفة", "ملفات فلسفة", "مذكرة علم نفس PDF"],
    canonicalPattern: "/p/resources + /subjects/:subjectSlug",
    exampleUrl: "/p/resources",
    indexable: true,
    reason: "Resources → CMS resources page + subject pages",
  },
  {
    intent: "academic_year",
    exampleKeywords: ["فلسفة 2026", "فلسفة 2026 2027", "علم النفس 2026", "منهج الفلسفة 2026", "تالتة ثانوي فلسفة 2026"],
    canonicalPattern: "Same dynamic pages (year in metadata only)",
    exampleUrl: "/subjects/falsafa-3rd (title: فلسفة — الصف الثالث الثانوي 2026 — د/ مصطفى تيتو)",
    indexable: true,
    reason: "No year in URL (no /2026/ doorway), year targeting in owner-editable title/description metadata",
  },
];

/**
 * Get canonical URL for a given keyword intent
 */
export function getCanonicalForIntent(intent: Intent, params: { courseSlug?: string; unitId?: string; subjectSlug?: string; gradeSlug?: string }): string {
  switch (intent) {
    case "branded":
      return "/";
    case "brand_entity":
      return "/about";
    case "brand_subject":
    case "subject":
    case "grade_subject":
      return params.subjectSlug ? `/subjects/${params.subjectSlug}` : "/subjects";
    case "grade":
      return params.gradeSlug ? `/grades/${params.gradeSlug}` : "/grades";
    case "course":
    case "lesson_explanation":
    case "lesson_summary":
    case "lesson_revision":
    case "lesson_questions":
    case "lesson_video":
    case "lesson_pdf":
      return params.courseSlug ? `/courses/${params.courseSlug}` : "/courses";
    case "unit":
    case "lesson_discovery":
      return params.courseSlug && params.unitId ? `/courses/${params.courseSlug}/units/${params.unitId}` : "/courses";
    case "resources":
      return "/p/resources";
    case "academic_year":
      return params.subjectSlug ? `/subjects/${params.subjectSlug}` : "/";
    default:
      return "/";
  }
}

/**
 * Validate that a keyword maps to exactly one canonical (no cannibalization)
 */
export function validateCanonicalUniqueness(): { ok: boolean; duplicates: string[] } {
  const seen = new Map<string, Intent[]>();
  for (const m of CANONICAL_MAP) {
    for (const kw of m.exampleKeywords) {
      const normalized = kw.trim().toLowerCase();
      const list = seen.get(normalized) ?? [];
      list.push(m.intent);
      seen.set(normalized, list);
    }
  }
  const duplicates = Array.from(seen.entries())
    .filter(([_, intents]) => intents.length > 1)
    .map(([kw, intents]) => `${kw}: ${intents.join(", ")}`);
  return { ok: duplicates.length === 0, duplicates };
}
