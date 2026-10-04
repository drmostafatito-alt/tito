import { describe, expect, it } from "vitest";
import { t } from "~/lib/i18n";
import { isPluralForms } from "~/lib/plural";
import { ar } from "~/locales/ar";
import { en } from "~/locales/en";

/**
 * Count-dependent copy must be grammatical in Arabic, which has six plural
 * categories. Before this, the homepage grade cards printed "1 مواد" and
 * "11 مواد" from a single "{n} مواد" template.
 */
describe("Arabic plural forms for counted labels", () => {
  it("picks the singular, dual, few and many forms", () => {
    expect(t("ar", "home.chipSubjects", { n: 1 })).toBe("مادة واحدة");
    expect(t("ar", "home.chipSubjects", { n: 2 })).toBe("مادتان");
    expect(t("ar", "home.chipSubjects", { n: 5 })).toBe("5 مواد");
    expect(t("ar", "home.chipSubjects", { n: 24 })).toBe("24 مادة");
  });

  it("never leaves a literal {n} in the output", () => {
    for (const key of ["home.chipSubjects", "home.chipTerms", "home.chipLessons", "home.chipVideos", "study.termsCount", "study.lessonsCount"]) {
      for (const n of [0, 1, 2, 3, 10, 11, 24, 48, 100, 101]) {
        for (const locale of ["ar", "en"] as const) {
          const out = t(locale, key, { n });
          expect(out, `${locale} ${key} n=${n}`).not.toContain("{n}");
          expect(out, `${locale} ${key} n=${n}`).not.toBe(key);
        }
      }
    }
  });

  it("English stays correct for 1 vs many", () => {
    expect(t("en", "home.chipLessons", { n: 1 })).toBe("1 lesson");
    expect(t("en", "home.chipLessons", { n: 48 })).toBe("48 lessons");
    expect(t("en", "study.termsCount", { n: 2 })).toBe("2 terms");
  });

  it("falls back to `other` when no count is supplied", () => {
    expect(t("ar", "home.chipLessons")).toBe("{n} درس");
  });

  it("every plural entry declares the same categories in both dictionaries", () => {
    const walk = (node: unknown, path: string[] = []): Array<[string, string[]]> => {
      if (isPluralForms(node)) return [[path.join("."), Object.keys(node as object).sort()]];
      if (node && typeof node === "object") {
        return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => walk(v, [...path, k]));
      }
      return [];
    };
    const arForms = Object.fromEntries(walk(ar));
    const enForms = Object.fromEntries(walk(en));
    expect(Object.keys(arForms).sort()).toEqual(Object.keys(enForms).sort());
    for (const key of Object.keys(arForms)) {
      expect(enForms[key], key).toEqual(arForms[key]);
    }
  });

  it("isPluralForms only accepts objects with an `other` string", () => {
    expect(isPluralForms({ other: "x" })).toBe(true);
    expect(isPluralForms({ one: "x" })).toBe(false);
    expect(isPluralForms("plain string")).toBe(false);
    expect(isPluralForms(null)).toBe(false);
  });
});
