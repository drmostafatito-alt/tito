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

/**
 * Error-message lookup with graceful fallback: `ns.err_<reason>` when defined,
 * otherwise the namespace's generic message — dynamic service reasons never
 * render as raw keys (Phase 6 commerce uses this for service error reasons).
 */
export function et(locale: Locale, ns: string, reason: string): string {
  const key = `${ns}.err_${reason}`;
  const value = t(locale, key);
  return value === key ? t(locale, `${ns}.err_generic`) : value;
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "ar" || value === "en";
}

const EN_SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Locale-aware date/number formatting (ARCHITECTURE §9: Latin digits initially).
 *
 * Rendered manually from fixed pieces instead of a full `Intl.DateTimeFormat`
 * string so the server and the client produce byte-identical text: full
 * locale dateStyle/timeStyle patterns include runtime-sensitive punctuation
 * (e.g. `ar-EG` emits an Arabic comma `،` + RLM marks in workerd/ICU but an
 * ASCII comma in the browser), which breaks React hydration on any page that
 * shows a timestamp. Numbers stay Latin digits; en keeps an English month
 * abbreviation for readability.
 */

/** Date-only part in Latin digits: `8 Sep 2026` (en) / `08/09/2026` (ar). */
function datePart(locale: Locale, d: Date): string {
  if (locale === "en") {
    return `${d.getDate()} ${EN_SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function isValid(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

type TimeLike = number | Date;

/** Normalise an epoch-ms number or a Date to a Date. */
function toDate(value: TimeLike): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Join a date part + time with the locale's separator (en uses `, `, ar uses a space). */
function joinDateTime(locale: Locale, date: string, time: string): string {
  return locale === "en" ? `${date}, ${time}` : `${date} ${time}`;
}

/** Date + time (HH:MM) — e.g. `8 Sep 2026, 10:05` (en) / `08/09/2026 10:05` (ar). */
export function formatDate(locale: Locale, value: TimeLike): string {
  const d = toDate(value);
  if (!isValid(d)) return "";
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return joinDateTime(locale, datePart(locale, d), time);
}

/** Date only (no time) in Latin digits — for columns that show just a day. */
export function formatDateShort(locale: Locale, value: TimeLike): string {
  const d = toDate(value);
  if (!isValid(d)) return "";
  return datePart(locale, d);
}

/** Date + time with seconds (HH:MM:SS) — for edit/audit trails. */
export function formatDateTime(locale: Locale, value: TimeLike): string {
  const d = toDate(value);
  if (!isValid(d)) return "";
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return joinDateTime(locale, datePart(locale, d), time);
}

export function localeName(locale: Locale): string {
  return locale === "ar" ? "العربية" : "English";
}
