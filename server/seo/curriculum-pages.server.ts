/**
 * Public curriculum-overview pages (owner brief: "نبذة عن محتوى منهج الصف الأول
 * الثانوي – فلسفة ومنطق" and the psychology counterpart).
 *
 * WHY THIS IS NOT A DATABASE PAGE: the platform's catalog tables start empty in
 * production, so a DB-keyed page would not exist on day one — yet these
 * overviews are exactly what a student searching for the curriculum needs. The
 * structure below is derived ENTIRELY from the owner-provided curriculum source
 * (`REAL_LESSONS`, i.e. docs/seo/keyword-universe.csv) — the same data the SEO
 * phase already treats as confirmed. Nothing here is authored, expanded or
 * guessed: the module only groups the real units/chapters and counts the real
 * lessons in each of them.
 *
 * ETHICS (unchanged): these pages are public, indexable, DIRECT-LINK only —
 * they are never injected into the homepage, the navigation or any homepage
 * section, they never redirect, and they carry no keyword blocks. They list
 * unit and chapter NAMES (curriculum structure a student actually wants) and
 * never invent science text, prices, statistics or testimonials.
 *
 * GROWTH RULE: `PAGE_IDENTITY` is the only place a new (grade, subject) pair
 * earns a public URL, and it needs a stable slug + English label. The unit test
 * asserts every group in the source is mapped, so adding rows to the source
 * forces a deliberate decision instead of a silently unreachable page.
 */

import { REAL_LESSONS, type RealLesson } from "./realLessons.server";

export interface CurriculumChapter {
  titleAr: string;
  lessonCount: number;
}

export interface CurriculumUnit {
  titleAr: string;
  lessonCount: number;
  chapters: CurriculumChapter[];
}

export interface CurriculumTerm {
  titleAr: string;
  lessonCount: number;
  units: CurriculumUnit[];
}

export interface CurriculumPage {
  slug: string;
  gradeAr: string;
  gradeEn: string;
  subjectAr: string;
  subjectEn: string;
  lessonCount: number;
  unitCount: number;
  chapterCount: number;
  /** Unique unit titles (a unit that continues across two terms is listed once). */
  unitTitles: string[];
  terms: CurriculumTerm[];
}

interface PageIdentity {
  slug: string;
  gradeEn: string;
  subjectEn: string;
}

/** The public URL space. Direct-link only; never linked from the homepage. */
export const CURRICULUM_PAGE_PATH_PREFIX = "/curriculum/";

const PAGE_IDENTITY: Record<string, PageIdentity> = {
  "الصف الأول الثانوي|فلسفة ومنطق": {
    slug: "falsafa-manteq-grade-1-secondary",
    gradeEn: "Grade 1 secondary",
    subjectEn: "Philosophy & Logic",
  },
  "مرحلة البكالوريا المصرية|علم النفس": {
    slug: "psychology-baccalaureate",
    gradeEn: "Egyptian Baccalaureate stage",
    subjectEn: "Psychology",
  },
};

function groupLessons(rows: RealLesson[]): { terms: CurriculumTerm[]; unitTitles: string[]; chapterCount: number } {
  const terms: CurriculumTerm[] = [];
  const unitTitles = new Set<string>();
  const chapterTitles = new Set<string>();
  for (const row of rows) {
    let term = terms.find((t) => t.titleAr === row.term);
    if (!term) {
      term = { titleAr: row.term, lessonCount: 0, units: [] };
      terms.push(term);
    }
    term.lessonCount += 1;
    let unit = term.units.find((u) => u.titleAr === row.unit);
    if (!unit) {
      unit = { titleAr: row.unit, lessonCount: 0, chapters: [] };
      term.units.push(unit);
      unitTitles.add(unit.titleAr);
    }
    unit.lessonCount += 1;
    // Some real sources use the unit name as the chapter name ("الوحدة الأولى"
    // inside "الوحدة الأولى: علم النفس…"): never render a chapter that only
    // repeats its unit — the unit keeps the full lesson count instead.
    if (row.unit.trim().startsWith(row.chapter.trim())) continue;
    let chapter = unit.chapters.find((c) => c.titleAr === row.chapter);
    if (!chapter) {
      chapter = { titleAr: row.chapter, lessonCount: 0 };
      unit.chapters.push(chapter);
    }
    chapter.lessonCount += 1;
    chapterTitles.add(chapter.titleAr);
  }
  return { terms, unitTitles: [...unitTitles], chapterCount: chapterTitles.size };
}

function buildPages(): CurriculumPage[] {
  const groups = new Map<string, RealLesson[]>();
  for (const row of REAL_LESSONS) {
    const key = `${row.grade}|${row.subject}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const pages: CurriculumPage[] = [];
  for (const [key, rows] of groups) {
    const identity = PAGE_IDENTITY[key];
    if (!identity) continue; // unmapped source group → asserted by tests, never published silently
    const { terms, unitTitles, chapterCount } = groupLessons(rows);
    pages.push({
      slug: identity.slug,
      gradeAr: rows[0].grade,
      gradeEn: identity.gradeEn,
      subjectAr: rows[0].subject,
      subjectEn: identity.subjectEn,
      lessonCount: rows.length,
      unitCount: unitTitles.length,
      chapterCount,
      unitTitles,
      terms,
    });
  }
  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}

export const CURRICULUM_PAGES: CurriculumPage[] = buildPages();

/** Source groups with no public page configured yet (used by tests + audit). */
export function unmappedCurriculumGroups(): string[] {
  const known = new Set(Object.keys(PAGE_IDENTITY));
  return [...new Set(REAL_LESSONS.map((l) => `${l.grade}|${l.subject}`))].filter((k) => !known.has(k));
}

export function curriculumPageBySlug(slug: string): CurriculumPage | null {
  return CURRICULUM_PAGES.find((p) => p.slug === slug) ?? null;
}

export function curriculumPagePath(slug: string): string {
  return `${CURRICULUM_PAGE_PATH_PREFIX}${slug}`;
}

// NOTE: the human-readable نبذة builder lives in `~/lib/curriculum-format`
// (client-safe: the route component renders it too). Server code must not
// import app code, so this module deliberately does not re-export it.
