/** Localized string helper for CMS renderers (kept tiny so public pages do not import the full registry). */
export type LStr = { ar: string; en: string };

export function ls(value: unknown, locale: "ar" | "en"): string {
  if (value && typeof value === "object") {
    const o = value as Partial<LStr>;
    return (locale === "ar" ? o.ar : o.en) || o.ar || o.en || "";
  }
  return typeof value === "string" ? value : "";
}
