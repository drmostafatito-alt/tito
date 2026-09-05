import type { MetaDescriptor } from "react-router";
import type { Locale } from "~/lib/i18n";
import { seoSchema, type PageSeo, type PageSnapshot } from "~/cms/registry";

/**
 * Pure, client-safe SEO/snapshot helpers shared by route loaders AND meta()
 * (meta runs on the client during SPA navigation, so it must never import
 * .server modules).
 */

/** Structural guard for the stored snapshot JSON (blocks re-validated in renderSnapshot). */
export function asSnapshot(raw: unknown): PageSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<PageSnapshot>;
  if (s.v !== 1 || !Array.isArray(s.sections) || !s.page || typeof s.page !== "object") return null;
  return raw as PageSnapshot;
}

export function parseSeo(raw: unknown): PageSeo {
  const parsed = seoSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : seoSchema.parse({});
}

/** Route `meta()` descriptors from validated page SEO (per-page title/desc/canonical/OG/robots). */
export function seoMeta(
  seo: PageSeo,
  fallbackTitle: { ar: string; en: string },
  locale: Locale,
  requestUrl: string,
  ogImageUrl?: string | null
): MetaDescriptor[] {
  const pick = (l: { ar: string; en: string }) => (locale === "ar" ? l.ar || l.en : l.en || l.ar);
  const title = pick(seo.title) || (locale === "ar" ? fallbackTitle.ar : fallbackTitle.en) || fallbackTitle.ar || fallbackTitle.en;
  const description = pick(seo.description);
  let origin = "";
  let pathname = "/";
  try { const u = new URL(requestUrl); origin = u.origin; pathname = u.pathname; } catch { /* keep relative */ }
  const canonical = seo.canonical || (origin ? `${origin}${pathname}` : "");
  const meta: MetaDescriptor[] = [{ title }];
  if (description) meta.push({ name: "description", content: description });
  if (canonical) meta.push({ rel: "canonical", href: canonical });
  meta.push({ name: "robots", content: seo.robots });
  const ogTitle = pick(seo.ogTitle) || title;
  const ogDescription = pick(seo.ogDescription) || description;
  meta.push({ property: "og:title", content: ogTitle });
  if (ogDescription) meta.push({ property: "og:description", content: ogDescription });
  meta.push({ property: "og:type", content: "website" });
  if (ogImageUrl) meta.push({ property: "og:image", content: ogImageUrl });
  meta.push({ name: "twitter:card", content: ogImageUrl ? "summary_large_image" : "summary" });
  return meta;
}

