import { describe, expect, it } from "vitest";
import {
  CURRICULUM_PAGES,
  curriculumPageBySlug,
  curriculumPagePath,
  unmappedCurriculumGroups,
} from "~server/seo/curriculum-pages.server";
import { curriculumSummaryText } from "~/lib/curriculum-format";
import { REAL_LESSONS } from "~server/seo/realLessons.server";

/**
 * Public curriculum-overview pages (owner brief: "نبذة عن محتوى منهج الصف الأول
 * الثانوي – فلسفة ومنطق" + the psychology counterpart).
 *
 * These tests are the ethics gate: the pages must exist for every group in the
 * confirmed curriculum source, contain ONLY that source's structure, and never
 * leak lesson titles as a keyword block.
 */

const philosophy = curriculumPageBySlug("falsafa-manteq-grade-1-secondary")!;
const psychology = curriculumPageBySlug("psychology-baccalaureate")!;

describe("curriculum overview pages (source-derived, direct-link only)", () => {
  it("builds exactly one page per confirmed (grade, subject) group", () => {
    expect(unmappedCurriculumGroups()).toEqual([]);
    expect(CURRICULUM_PAGES.map((p) => p.slug)).toEqual([
      "falsafa-manteq-grade-1-secondary",
      "psychology-baccalaureate",
    ]);
    const totalLessons = CURRICULUM_PAGES.reduce((n, p) => n + p.lessonCount, 0);
    expect(totalLessons).toBe(REAL_LESSONS.length); // 48 — no lesson is dropped or duplicated
  });

  it("uses stable, URL-safe slugs and a single public prefix", () => {
    for (const page of CURRICULUM_PAGES) {
      expect(page.slug).toMatch(/^[a-z0-9-]+$/);
      expect(curriculumPagePath(page.slug)).toBe(`/curriculum/${page.slug}`);
    }
    expect(curriculumPageBySlug("does-not-exist")).toBeNull();
  });

  it("mirrors the real structure of the philosophy & logic group", () => {
    expect(philosophy.gradeAr).toBe("الصف الأول الثانوي");
    expect(philosophy.subjectAr).toBe("فلسفة ومنطق");
    expect(philosophy.lessonCount).toBe(24);
    expect(philosophy.terms.map((t) => t.titleAr)).toEqual(["الترم الأول", "الترم الثاني"]);
    // "الوحدة الأولى: الفلسفة" continues into the second term: it is listed once
    // per term (structure) but counted once as a unit.
    expect(philosophy.unitCount).toBe(2);
    expect(philosophy.unitTitles).toEqual(["الوحدة الأولى: الفلسفة", "الوحدة الثانية: المنطق"]);
    expect(philosophy.chapterCount).toBe(6);
    const firstTerm = philosophy.terms[0];
    expect(firstTerm.lessonCount).toBe(9);
    expect(firstTerm.units[0].chapters.map((c) => c.lessonCount)).toEqual([4, 5]);
  });

  it("drops the chapter level when it only repeats its unit name", () => {
    expect(psychology.lessonCount).toBe(24);
    expect(psychology.terms.map((t) => t.titleAr)).toEqual(["الجزء الأول", "الجزء الثاني"]);
    expect(psychology.unitCount).toBe(6);
    expect(psychology.chapterCount).toBe(0);
    for (const term of psychology.terms) {
      for (const unit of term.units) expect(unit.chapters).toEqual([]);
    }
  });

  it("describes structure only — honest counts, no lesson-name keyword block", () => {
    const ar = curriculumSummaryText(philosophy, "ar");
    expect(ar).toContain("وحدتان"); // Arabic dual form for exactly two units
    expect(ar).toContain("6 فصول");
    expect(ar).toContain("24 درسًا");
    const en = curriculumSummaryText(philosophy, "en");
    expect(en).toContain("2 units");
    expect(en).toContain("6 chapters");
    expect(en).toContain("24 lessons");
    // The نبذة must never quote individual lesson names (that would be the
    // keyword block the brief forbids) and never promise results.
    const lessonNames = REAL_LESSONS.map((l) => l.lesson);
    for (const text of [ar, en]) {
      for (const name of lessonNames) expect(text).not.toContain(name);
      expect(text).not.toMatch(/نتائج مضمونة|أفضل منصة|الأول على|guaranteed/i);
    }
  });

  it("keeps the two pages' texts unique (no duplicated meta content)", () => {
    for (const locale of ["ar", "en"] as const) {
      expect(curriculumSummaryText(philosophy, locale)).not.toBe(curriculumSummaryText(psychology, locale));
    }
  });
});
