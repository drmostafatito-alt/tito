/**
 * Client-safe presentation helpers for the public curriculum-overview pages.
 *
 * These live outside `server/` on purpose: the route COMPONENT renders the نبذة
 * as well, and React Router only strips server code from loader/action (not
 * from data used by the component), so the text builder must be pure and
 * dependency-free. It takes plain curriculum data — no database, no secrets.
 *
 * Same rule as the server module: only restates confirmed structure (terms,
 * units, chapters, real lesson counts) and never promises results.
 */

export interface CurriculumPageLike {
  /** Unique unit titles; when omitted, first-seen order from `terms` is used. */
  gradeAr: string;
  gradeEn: string;
  subjectAr: string;
  subjectEn: string;
  lessonCount: number;
  unitCount: number;
  chapterCount: number;
  unitTitles?: string[];
  terms: Array<{ titleAr: string; units: Array<{ titleAr: string }> }>;
}

/**
 * Honest, unique free-text نبذة for the page: it restates the confirmed
 * structure (terms, units, chapters, lesson counts) and nothing else. It never
 * describes the science of the subject and never promises ranking, grades or
 * results.
 */
/** Arabic counting: 1 / 2 / 3-10 / 11+ each take a different form. */
function arCount(n: number, forms: readonly [string, string, string, string]): string {
  if (n === 0) return "لا شيء";
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  if (n <= 10) return `${n} ${forms[2]}`;
  return `${n} ${forms[3]}`;
}

function enCount(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Honest, unique نبذة for the page: it restates the confirmed structure
 * (terms, units, chapters, real lesson counts) and nothing else. It never
 * describes the science of the subject and never promises ranking or results.
 */
export function curriculumSummaryText(page: CurriculumPageLike, locale: "ar" | "en"): string {
  const unitNames = page.unitTitles ?? [...new Set(page.terms.flatMap((t) => t.units).map((u) => u.titleAr))];
  if (locale === "en") {
    const counts = `${enCount(page.unitCount, "unit")}, ${enCount(page.chapterCount, "chapter")} and ${enCount(page.lessonCount, "lesson")}`;
    return [
      `This page outlines the structure of ${page.subjectEn} in ${page.gradeEn} as recorded in the platform's curriculum source:`,
      `${counts} in total.`,
      unitNames.length ? `Unit titles (as listed): ${unitNames.join("، ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const units = arCount(page.unitCount, ["وحدة واحدة", "وحدتان", "وحدات", "وحدة"]);
  const chapters = arCount(page.chapterCount, ["فصل واحد", "فصلان", "فصول", "فصلًا"]);
  const lessons = arCount(page.lessonCount, ["درس واحد", "درسان", "دروس", "درسًا"]);
  return [
    `توضح هذه الصفحة محتوى منهج ${page.subjectAr} في ${page.gradeAr} كما هو مسجَّل في مصدر المنهج المعتمد على المنصة:`,
    `${units} و${chapters} و${lessons}.`,
    unitNames.length ? `أسماء الوحدات كما وردت: ${unitNames.join("، ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
