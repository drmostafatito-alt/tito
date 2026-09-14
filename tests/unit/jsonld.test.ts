import { describe, expect, it } from "vitest";
import {
  absUrl,
  breadcrumbJsonLd,
  courseJsonLd,
  itemListJsonLd,
  organizationJsonLd,
  personJsonLd,
  safeHttpsUrl,
  webPageJsonLd,
  websiteJsonLd,
} from "~/cms/jsonld";

/**
 * JSON-LD builder contracts (SEO Master Phase, batch 3).
 *
 * The honesty rules are the whole point: builders must emit ONLY what the
 * page really shows — absolute URLs, no fake ratings/prices, https-only
 * external links, and silent omission (never an empty stub) for data the
 * owner has not configured.
 */

const ORIGIN = "https://tito.example";

describe("absUrl", () => {
  it("joins origin + path without a trailing-slash double", () => {
    expect(absUrl(ORIGIN, "/")).toBe(`${ORIGIN}/`);
    expect(absUrl(ORIGIN, "/courses")).toBe(`${ORIGIN}/courses`);
    expect(absUrl(ORIGIN, "courses")).toBe(`${ORIGIN}/courses`);
    expect(absUrl(`${ORIGIN}/`, "/courses")).toBe(`${ORIGIN}/courses`);
  });

  it("never emits a relative loc when origin is empty", () => {
    expect(absUrl("", "/x")).toBe("/x"); // still starts with "/" — no bare path
  });
});

describe("safeHttpsUrl", () => {
  it("keeps well-formed https URLs", () => {
    expect(safeHttpsUrl("https://facebook.com/tito")).toBe("https://facebook.com/tito");
  });

  it("rejects http, javascript:, data: and relative values", () => {
    expect(safeHttpsUrl("http://facebook.com/tito")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpsUrl("/files/logo.png")).toBeNull();
    expect(safeHttpsUrl("not a url")).toBeNull();
    expect(safeHttpsUrl("")).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
    expect(safeHttpsUrl(undefined)).toBeNull();
  });
});

describe("organizationJsonLd", () => {
  it("emits name + absolute url; logo and sameAs only when real", () => {
    const ld = organizationJsonLd({
      name: "د/ مصطفى تيتو",
      url: `${ORIGIN}/`,
      logo: `${ORIGIN}/files/logo.png`,
      sameAs: ["https://facebook.com/tito", "http://bad.example", "javascript:x", "", null],
    });
    expect(ld["@type"]).toBe("Organization");
    expect(ld.name).toBe("د/ مصطفى تيتو");
    expect(ld.url).toBe(`${ORIGIN}/`);
    // http logo would be caught by the https filter too (logo is a file URL, not sameAs)
    expect(ld.sameAs).toEqual(["https://facebook.com/tito"]);
  });

  it("omits logo and sameAs entirely when absent (no empty stubs)", () => {
    const ld = organizationJsonLd({ name: "Tito", url: `${ORIGIN}/` });
    expect(ld.logo).toBeUndefined();
    expect(ld.sameAs).toBeUndefined();
    expect(Object.keys(ld).sort()).toEqual(["@context", "@type", "name", "url"]);
  });
});

describe("websiteJsonLd", () => {
  it("emits only name + url — no SearchAction (the platform has no public search)", () => {
    const ld = websiteJsonLd({ name: "Tito", url: `${ORIGIN}/` });
    expect(ld["@type"]).toBe("WebSite");
    expect(ld.potentialAction).toBeUndefined();
    expect(ld.searchAction).toBeUndefined();
  });
});

describe("webPageJsonLd", () => {
  it("uses the additionalType when given", () => {
    const ld = webPageJsonLd({
      name: "الفيزياء",
      url: `${ORIGIN}/subjects/physics`,
      description: "كورسات فيزياء",
      isPartOf: `${ORIGIN}/`,
      additionalType: "https://schema.org/CollectionPage",
    });
    expect(ld["@type"]).toEqual(["WebPage", "https://schema.org/CollectionPage"]);
    expect(ld.isPartOf).toEqual({ "@type": "WebSite", url: `${ORIGIN}/` });
  });

  it("drops empty description", () => {
    const ld = webPageJsonLd({ name: "P", url: `${ORIGIN}/x`, description: "   " });
    expect(ld.description).toBeUndefined();
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers items, absolutizes links, and lets the last crumb omit item", () => {
    const ld = breadcrumbJsonLd({
      origin: ORIGIN,
      items: [
        { name: "الرئيسية", url: "/" },
        { name: "الكورسات", url: "/courses" },
        { name: "الفيزياء" },
      ],
    });
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ position: 1, name: "الرئيسية", item: `${ORIGIN}/` });
    expect(items[1].item).toBe(`${ORIGIN}/courses`);
    expect(items[2]).toMatchObject({ position: 3, name: "الفيزياء" });
    expect(items[2].item).toBeUndefined();
  });

  it("skips empty names rather than emitting blank crumbs", () => {
    const ld = breadcrumbJsonLd({
      origin: ORIGIN,
      items: [{ name: "  " }, { name: "B", url: "/b" }],
    });
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("B");
  });
});

describe("courseJsonLd", () => {
  it("carries provider + real lesson count; never price or ratings", () => {
    const ld = courseJsonLd({
      name: "الفيزياء — الثالث",
      url: `${ORIGIN}/courses/physics-3s`,
      description: "مراجعة كاملة",
      provider: { name: "د/ مصطفى تيتو", url: `${ORIGIN}/` },
      numberOfItems: 12,
    });
    expect(ld["@type"]).toBe("Course");
    expect(ld.numberOfItems).toBe(12);
    expect(ld.provider).toEqual({ "@type": "Organization", name: "د/ مصطفى تيتو", url: `${ORIGIN}/` });
    expect(ld.offers).toBeUndefined();
    expect(ld.price).toBeUndefined();
    expect(ld.aggregateRating).toBeUndefined();
    expect(ld.ratingValue).toBeUndefined();
    expect(ld.ratingCount).toBeUndefined();
  });

  it("omits numberOfItems when 0/null (a page showing no lessons must not claim a count)", () => {
    expect(courseJsonLd({ name: "C", url: `${ORIGIN}/c`, provider: { name: "P", url: `${ORIGIN}/` }, numberOfItems: 0 }).numberOfItems).toBeUndefined();
    expect(courseJsonLd({ name: "C", url: `${ORIGIN}/c`, provider: { name: "P", url: `${ORIGIN}/` }, numberOfItems: null }).numberOfItems).toBeUndefined();
  });
});

describe("personJsonLd", () => {
  it("is minimal when only name + url are known (no invented credentials)", () => {
    const ld = personJsonLd({ name: "مصطفى تيتو", url: `${ORIGIN}/about` });
    expect(Object.keys(ld).sort()).toEqual(["@context", "@type", "name", "url"]);
  });

  it("adds jobTitle/sameAs/worksFor only when provided", () => {
    const ld = personJsonLd({
      name: "مصطفى تيتو",
      url: `${ORIGIN}/about`,
      jobTitle: "مدرس الفلسفة وعلم النفس",
      sameAs: ["https://facebook.com/tito"],
      worksFor: { name: "المنصة", url: `${ORIGIN}/` },
    });
    expect(ld.jobTitle).toBe("مدرس الفلسفة وعلم النفس");
    expect(ld.sameAs).toEqual(["https://facebook.com/tito"]);
    expect(ld.worksFor).toEqual({ "@type": "Organization", name: "المنصة", url: `${ORIGIN}/` });
  });
});

describe("itemListJsonLd", () => {
  it("lists published items with positions and absolute urls", () => {
    const ld = itemListJsonLd({
      name: "الكورسات",
      url: `${ORIGIN}/courses`,
      items: [
        { name: "الفيزياء", url: `${ORIGIN}/courses/physics` },
        { name: "الفلسفة", url: `${ORIGIN}/courses/philosophy` },
      ],
    });
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.numberOfItems).toBe(2);
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[1].url).toBe(`${ORIGIN}/courses/philosophy`);
  });

  it("works with an empty list (empty catalog → no items, count 0)", () => {
    const ld = itemListJsonLd({ name: "الكورسات", url: `${ORIGIN}/courses`, items: [] });
    expect(ld.numberOfItems).toBe(0);
    // clean() drops the empty array; an ItemList with zero entries is still honest
    expect(ld.itemListElement).toBeUndefined();
  });
});
