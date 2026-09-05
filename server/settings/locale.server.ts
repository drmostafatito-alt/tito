import type { LocaleCode } from "./schema";

export const LOCALE_COOKIE = "edu_locale";

/**
 * Locale resolution order: explicit cookie → user preference → Accept-Language →
 * platform default. Pure + testable; the set-locale resource route writes the cookie.
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
    parseAcceptLanguage(args.acceptLanguage),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const base = c.toLowerCase().split("-")[0] as LocaleCode;
    if (enabled.includes(base)) return base;
  }
  return args.defaultLocale;
}

function parseAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  const first = header.split(",")[0]?.trim();
  return first?.split(";")[0]?.trim() || null;
}

export function dirOf(locale: LocaleCode): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
