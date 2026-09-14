/**
 * JSON-LD structured-data builders (SEO Master Phase + Lesson Phase).
 *
 * React Router 7 renders `{ "script:ld+json": ... }` meta descriptors as
 * `<script type="application/ld+json">` in <head> (SSR + hydration-safe).
 * These builders are the SINGLE place schema is composed so every page shares
 * the same honest-shape rules:
 *
 *   - ONLY fields that correspond to real, visible page data are emitted;
 *   - URLs are always ABSOLUTE (the caller passes the serving origin);
 *   - NO invented properties: no aggregateRating, no price, no numberOfCredits
 *     counts the page does not show, no "author" that isn't the platform,
 *     no dateModified from content we don't display.
 *   - pure + client-safe (meta() runs during SPA navigation) — no .server
 *     imports.
 *
 * Lesson Phase enhancements:
 *   - Course with hasPart (units) for topical authority
 *   - LearningResource for unit/lesson concepts
 *   - DefinedTermSet for semantic keywords
 *   - Educational context (educationalLevel, teaches)
 */

export type LdObject = Record<string, unknown>;

/** Trim to a clean JSON-LD object (drop null/undefined/empty-string values). */
function clean(obj: LdObject): LdObject {
  const out: LdObject = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** Absolute URL from an origin + path (defensive: never emits relative locs). */
export function absUrl(origin: string, path = "/"): string {
  const base = (origin || "").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Keep only well-formed https URLs (schema sameAs/homeUrl safety). */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface OrganizationInput {
  name: string;
  url: string; // absolute
  logo?: string | null; // absolute URL, only when a real logo file exists
  sameAs?: Array<string | null | undefined>; // official social profiles (https only)
}

/** Organization — the platform entity. No invented employees/addresses. */
export function organizationJsonLd(i: OrganizationInput): LdObject {
  return clean({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: i.name,
    url: i.url,
    logo: safeHttpsUrl(i.logo) ?? undefined,
    sameAs: (i.sameAs ?? []).map(safeHttpsUrl).filter((u): u is string => Boolean(u)),
  });
}

export interface WebsiteInput {
  name: string;
  url: string; // absolute
}

/** WebSite — the site entity (no SearchAction: the platform has no public search page). */
export function websiteJsonLd(i: WebsiteInput): LdObject {
  return clean({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: i.name,
    url: i.url,
  });
}

export interface WebPageInput {
  name: string;
  url: string; // absolute
  description?: string | null;
  isPartOf?: string; // absolute website URL
  additionalType?: string | null; // e.g. https://schema.org/CollectionPage
  /** For topical authority: breadcrumb of hierarchy */
  breadcrumb?: string[]; // e.g. ["الثانوية العامة", "الصف الثالث", "الفلسفة"]
  /** Educational context */
  educationalLevel?: string | null;
}

/** WebPage (or the given additionalType) for a public landing page. */
export function webPageJsonLd(i: WebPageInput): LdObject {
  const type = i.additionalType ? ["WebPage", i.additionalType] : "WebPage";
  const base: LdObject = {
    "@context": "https://schema.org",
    "@type": type,
    name: i.name,
    url: i.url,
    description: i.description ?? undefined,
    isPartOf: i.isPartOf
      ? { "@type": "WebSite", url: i.isPartOf }
      : undefined,
  };
  if (i.educationalLevel) {
    (base as Record<string, unknown>).educationalLevel = i.educationalLevel;
  }
  return clean(base);
}

export interface BreadcrumbInput {
  /** Ordered, deepest last. `url` optional for the current (last) crumb. */
  items: Array<{ name: string; url?: string | null }>;
  origin: string;
}

/** BreadcrumbList — mirrors the visible breadcrumb trail, links absolute. */
export function breadcrumbJsonLd(i: BreadcrumbInput): LdObject {
  const list = i.items
    .map((c, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: c.name,
      ...(c.url ? { item: absUrl(i.origin, c.url) } : {}),
    }))
    .filter((c) => typeof c.name === "string" && c.name.trim() !== "");
  return clean({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: list,
  });
}

export interface CourseInput {
  name: string;
  url: string; // absolute
  description?: string | null;
  provider: { name: string; url: string }; // the platform (Organization)
  numberOfItems?: number | null; // ONLY the visible published lesson count
  /** Topical authority: hasPart for units */
  hasPart?: Array<{ name: string; url: string }>;
  /** Educational context */
  educationalLevel?: string | null;
  /** What the course teaches (semantic keywords) */
  teaches?: string[];
  /** In language */
  inLanguage?: string;
}

/**
 * Course — what the course page actually is. Deliberately NO price (prices
 * live on the product page and are server-evaluated promo-aware), NO
 * aggregateRating (no real ratings exist — faking them is forbidden).
 *
 * Enhanced with hasPart for units and teaches for topical authority.
 */
export function courseJsonLd(i: CourseInput): LdObject {
  const base: LdObject = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: i.name,
    url: i.url,
    description: i.description ?? undefined,
    provider: clean({ "@type": "Organization", name: i.provider.name, url: i.provider.url }),
    ...(i.numberOfItems && i.numberOfItems > 0 ? { numberOfItems: i.numberOfItems } : {}),
  };
  if (i.hasPart && i.hasPart.length > 0) {
    (base as Record<string, unknown>).hasPart = i.hasPart.map((p) =>
      clean({
        "@type": "Course",
        name: p.name,
        url: p.url,
      })
    );
  }
  if (i.educationalLevel) {
    (base as Record<string, unknown>).educationalLevel = i.educationalLevel;
  }
  if (i.teaches && i.teaches.length > 0) {
    (base as Record<string, unknown>).teaches = i.teaches.slice(0, 8);
  }
  if (i.inLanguage) {
    (base as Record<string, unknown>).inLanguage = i.inLanguage;
  }
  return clean(base);
}

export interface PersonInput {
  name: string;
  url: string; // absolute
  jobTitle?: string | null; // ONLY the owner-configured official title
  photo?: string | null; // ONLY the owner-configured photo file (https-only)
  sameAs?: Array<string | null | undefined>;
  worksFor?: { name: string; url: string } | null;
  /** For topical authority: knowsAbout */
  knowsAbout?: string[];
}

/** Person — the teacher entity. Every field optional; nothing invented. */
export function personJsonLd(i: PersonInput): LdObject {
  const base: LdObject = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: i.name,
    url: i.url,
    jobTitle: i.jobTitle ?? undefined,
    photo: safeHttpsUrl(i.photo) ?? undefined,
    sameAs: (i.sameAs ?? []).map(safeHttpsUrl).filter((u): u is string => Boolean(u)),
    worksFor: i.worksFor ? clean({ "@type": "Organization", name: i.worksFor.name, url: i.worksFor.url }) : undefined,
  };
  if (i.knowsAbout && i.knowsAbout.length > 0) {
    (base as Record<string, unknown>).knowsAbout = i.knowsAbout.slice(0, 12);
  }
  return clean(base);
}

export interface ItemListInput {
  name: string;
  url: string; // absolute
  items: Array<{ name: string; url: string }>;
}

export interface LearningResourceInput {
  name: string;
  url: string;
  description?: string | null;
  educationalLevel?: string | null;
  teaches?: string[];
  isPartOf?: string; // parent course URL
  learningResourceType?: string; // e.g. "Lesson", "Unit"
}

/** LearningResource for units and lessons (topical authority) */
export function learningResourceJsonLd(i: LearningResourceInput): LdObject {
  return clean({
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: i.name,
    url: i.url,
    description: i.description ?? undefined,
    educationalLevel: i.educationalLevel ?? undefined,
    teaches: i.teaches && i.teaches.length > 0 ? i.teaches.slice(0, 8) : undefined,
    isPartOf: i.isPartOf ? { "@type": "Course", url: i.isPartOf } : undefined,
    learningResourceType: i.learningResourceType ?? undefined,
  });
}

export interface DefinedTermSetInput {
  name: string;
  url: string;
  terms: string[]; // semantic keywords
}

/** DefinedTermSet for semantic keywords (topical authority) */
export function definedTermSetJsonLd(i: DefinedTermSetInput): LdObject {
  return clean({
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name: i.name,
    url: i.url,
    hasDefinedTerm: i.terms.slice(0, 15).map((term) =>
      clean({
        "@type": "DefinedTerm",
        name: term,
        inDefinedTermSet: i.url,
      })
    ),
  });
}

/** ItemList — e.g. the course catalog. */
export function itemListJsonLd(i: ItemListInput): LdObject {
  return clean({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: i.name,
    url: i.url,
    numberOfItems: i.items.length,
    itemListElement: i.items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      url: item.url,
    })),
  });
}
