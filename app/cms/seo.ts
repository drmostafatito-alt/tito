import type { MetaDescriptor } from "react-router";
import type { Locale } from "~/lib/i18n";
import { seoSchema, type PageSeo, type PageSnapshot } from "~/cms/seo-schema";

/** Root-loader data that `meta()` needs but must not re-resolve (single source of truth). */
export interface RootMetaSource {
  locale: Locale;
  siteName: { ar: string; en: string } | null;
  /** Platform tagline — owner-editable in Appearance → System; used as the
   *  meta description on catalog index pages, which have no content row. */
  tagline: { ar: string; en: string } | null;
}

/**
 * Read `locale` + platform identity from the ROOT loader through
 * `meta({ matches })`. Every public route renders its copy in the locale the
 * root loader picked, so meta must reuse that exact value rather than resolving
 * a second time — the two could otherwise disagree (cookie vs. user preference)
 * and emit a title in the wrong language.
 */
export function rootMetaFrom(matches: unknown): RootMetaSource {
  const list = Array.isArray(matches) ? (matches as Array<Record<string, unknown>>) : [];
  const pair = (v: unknown): { ar: string; en: string } | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const ar = typeof o.ar === "string" ? o.ar : "";
    const en = typeof o.en === "string" ? o.en : "";
    return ar || en ? { ar, en } : null;
  };
  const pick = (m: Record<string, unknown> | undefined) => {
    const d = m?.data as { locale?: unknown; platform?: Record<string, unknown> } | undefined;
    if (!d || typeof d !== "object" || !d.platform || typeof d.platform !== "object") return null;
    const p = d.platform;
    const locale: Locale = d.locale === "en" ? "en" : "ar";
    const siteName = pair({ ar: p.nameAr, en: p.nameEn });
    const tagline = pair({ ar: p.taglineAr, en: p.taglineEn });
    return { locale, siteName, tagline };
  };
  for (const m of list) if (m?.id === "root") { const r = pick(m); if (r) return r; }
  for (const m of list) { const r = pick(m); if (r) return r; }
  return { locale: "ar", siteName: null, tagline: null };
}

/** Collapse whitespace and cap at the seoSchema's 300-char description limit. */
function metaDescriptionText(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * SEO/social descriptors for catalog & content routes (courses, programs,
 * subjects, products).
 *
 * Those rows have NO per-row SEO record, and deliberately so: the owner already
 * edits their title / description / thumbnail in Admin → Content, and those
 * fields ARE the source of truth for the document title and the share card.
 * Deriving meta here means an admin edit propagates to search results and to
 * WhatsApp/Telegram/Facebook previews with zero code deployment — the same
 * promise the CMS pages make through their SEO tab.
 *
 * Delegates to `seoMeta` so canonical / robots / OG fallbacks / twitter:card
 * behave exactly as they do on CMS pages (one implementation, no drift).
 */
export function contentSeoMeta(
  content: {
    title: { ar: string; en: string };
    description?: { ar?: string | null; en?: string | null } | null;
  },
  locale: Locale,
  requestUrl: string,
  opts?: { ogImageUrl?: string | null; siteName?: { ar: string; en: string } | null }
): MetaDescriptor[] {
  const base = { ar: content.title.ar ?? "", en: content.title.en ?? "" };
  const site = opts?.siteName ?? null;
  const withSite = (v: string, suffix: string) =>
    v && suffix && !v.includes(suffix) ? `${v} — ${suffix}` : v;
  const seo: PageSeo = {
    ...parseSeo({}),
    title: {
      ar: withSite(base.ar, site?.ar ?? ""),
      en: withSite(base.en, site?.en ?? ""),
    },
    description: {
      ar: metaDescriptionText(content.description?.ar),
      en: metaDescriptionText(content.description?.en),
    },
  };
  return seoMeta(seo, seo.title, locale, requestUrl, opts?.ogImageUrl ?? null);
}

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
  // A canonical MUST be a <link> element. React Router's <Meta /> only renders a
  // <link> when the descriptor carries `tagName: "link"` — a bare {rel, href}
  // descriptor silently renders as `<meta rel="canonical" href=…>`, which no
  // crawler honours. Without `tagName` the CMS SEO tab's canonical field (and
  // every derived one) was inert.
  if (canonical) meta.push({ tagName: "link", rel: "canonical", href: canonical });
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

