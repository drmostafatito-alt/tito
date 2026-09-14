/**
 * JSON-LD structured-data builders (SEO Master Phase).
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
}

/** WebPage (or the given additionalType) for a public landing page. */
export function webPageJsonLd(i: WebPageInput): LdObject {
  const type = i.additionalType ? ["WebPage", i.additionalType] : "WebPage";
  return clean({
    "@context": "https://schema.org",
    "@type": type,
    name: i.name,
    url: i.url,
    description: i.description ?? undefined,
    isPartOf: i.isPartOf
      ? { "@type": "WebSite", url: i.isPartOf }
      : undefined,
  });
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
}

/**
 * Course — what the course page actually is. Deliberately NO price (prices
 * live on the product page and are server-evaluated promo-aware), NO
 * aggregateRating (no real ratings exist — faking them is forbidden).
 */
export function courseJsonLd(i: CourseInput): LdObject {
  return clean({
    "@context": "https://schema.org",
    "@type": "Course",
    name: i.name,
    url: i.url,
    description: i.description ?? undefined,
    provider: clean({ "@type": "Organization", name: i.provider.name, url: i.provider.url }),
    ...(i.numberOfItems && i.numberOfItems > 0 ? { numberOfItems: i.numberOfItems } : {}),
  });
}

export interface PersonInput {
  name: string;
  url: string; // absolute
  jobTitle?: string | null; // ONLY the owner-configured official title
  sameAs?: Array<string | null | undefined>;
  worksFor?: { name: string; url: string } | null;
}

/** Person — the teacher entity. Every field optional; nothing invented. */
export function personJsonLd(i: PersonInput): LdObject {
  return clean({
    "@context": "https://schema.org",
    "@type": "Person",
    name: i.name,
    url: i.url,
    jobTitle: i.jobTitle ?? undefined,
    sameAs: (i.sameAs ?? []).map(safeHttpsUrl).filter((u): u is string => Boolean(u)),
    worksFor: i.worksFor ? clean({ "@type": "Organization", name: i.worksFor.name, url: i.worksFor.url }) : undefined,
  });
}

export interface ItemListInput {
  name: string;
  url: string; // absolute
  items: Array<{ name: string; url: string }>;
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
