/**
 * Plural-aware dictionary values.
 *
 * Arabic has six plural categories and "{n} مواد" is simply wrong for n = 1
 * or n = 11 — which is exactly what the homepage grade cards were printing
 * ("1 مواد"). A dictionary entry can therefore be a `PluralForms` object
 * instead of a string; `t(locale, key, { n })` then picks the right form with
 * `Intl.PluralRules`.
 *
 * Both dictionaries must declare the SAME category keys (tests/unit/i18n.test.ts
 * walks every leaf and asserts ar/en parity), so English repeats its plural
 * form across `two`/`few`/`many`. That redundancy is deliberate: it keeps the
 * parity check honest and makes the shape obvious at the call site.
 */
export type PluralForms = {
  /** n = 1 */
  one: string;
  /** n = 2 (Arabic dual) */
  two: string;
  /** n = 3…10 in Arabic */
  few: string;
  /** n = 11…99 in Arabic */
  many: string;
  /** everything else, and the fallback when `n` is absent */
  other: string;
};

export function isPluralForms(value: unknown): value is PluralForms {
  return !!value && typeof value === "object" && typeof (value as PluralForms).other === "string";
}
