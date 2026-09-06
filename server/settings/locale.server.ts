import type { LocaleCode } from "./schema";

export const LOCALE_COOKIE = "edu_locale";

/**
 * Locale resolution order: explicit cookie → user preference → platform default.
 *
 * Fresh visitors always get the platform default (Arabic) so `lang="ar"` / `dir="rtl"`
 * even when the browser sends `Accept-Language: en-US`. The language switcher still
 * wins via the locale cookie, and a logged-in user's `localePref` still wins.
 * `acceptLanguage` is accepted for API compatibility but is not consulted.
 */
export function resolveLocale(args: {
  cookieValue?: string | null;
  userPref?: string | null;
  acceptLanguage?: string | null;
  defaultLocale: LocaleCode;
  enabled: LocaleCode[];
}): LocaleCode {
  const { enabled } = args;
  const candidates: (string | null | undefined)[] = [
    args.cookieValue,
    args.userPref,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const base = c.toLowerCase().split("-")[0] as LocaleCode;
    if (enabled.includes(base)) return base;
  }
  return args.defaultLocale;
}

export function dirOf(locale: LocaleCode): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
