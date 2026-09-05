import { ar, type Dictionary } from "~/locales/ar";
import { en } from "~/locales/en";

export const dictionaries: Record<string, Dictionary> = { ar, en };
export type Locale = "ar" | "en";
export const LOCALES: Locale[] = ["ar", "en"];

/** Walks dot-paths like "auth.errors.invalid_credentials"; falls back ar→en→key. */
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const pick = (dict: Dictionary): unknown =>
    key.split(".").reduce<unknown>((acc, part) => {
      if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, dict);

  let value = pick(dictionaries[locale] ?? ar);
  if (value === undefined) value = pick(ar);
  if (typeof value !== "string") return key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = (value as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value as string;
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "ar" || value === "en";
}

/** Locale-aware date/number formatting (ARCHITECTURE §9: Latin digits initially). */
export function formatDate(locale: Locale, epochMs: number): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

export function localeName(locale: Locale): string {
  return locale === "ar" ? "العربية" : "English";
}
