import { describe, expect, it } from "vitest";
import { contentSeoMeta, rootMetaFrom } from "~/cms/seo";

/** MetaDescriptor is a discriminated union; assertions inspect it as plain records. */
type Meta = Array<Record<string, unknown>>;
const seo = (...args: Parameters<typeof contentSeoMeta>) => contentSeoMeta(...args) as Meta;

/**
 * Owner-controllability regression: catalog/content routes (courses, programs,
 * subjects, products) have no per-row SEO form, because the owner already edits
 * their title / description / thumbnail in Admin → Content. These tests pin the
 * contract that those admin-edited fields ARE what reach <title>, the meta
 * description and the OpenGraph share card — in BOTH locales.
 */

const find = (meta: Array<Record<string, unknown>>, key: string, value: string) =>
  meta.find((m) => m[key] === value) as Record<string, unknown> | undefined;

const title = (meta: Array<Record<string, unknown>>) =>
  (meta.find((m) => typeof m.title === "string")?.title as string) ?? "";
const desc = (meta: Array<Record<string, unknown>>) =>
  (find(meta, "name", "description")?.content as string) ?? null;
const og = (meta: Array<Record<string, unknown>>, prop: string) =>
  (find(meta, "property", prop)?.content as string) ?? null;

const siteName = { ar: "د/ مصطفى تيتو", en: "Dr mostafa tito" };

describe("contentSeoMeta — admin-edited content drives SEO + social preview", () => {
  const course = {
    title: { ar: "مراجعة شاملة", en: "Full Revision" },
    description: { ar: "دورة شاملة تغطي المنهج بالكامل", en: "A complete course covering the syllabus" },
  };

  it("derives title, description and OG tags from the content row (Arabic)", () => {
    const meta = seo(course, "ar", "https://site.test/courses/full-revision", { siteName });
    expect(title(meta)).toBe("مراجعة شاملة — د/ مصطفى تيتو");
    expect(desc(meta)).toBe("دورة شاملة تغطي المنهج بالكامل");
    expect(og(meta, "og:title")).toBe("مراجعة شاملة — د/ مصطفى تيتو");
    expect(og(meta, "og:description")).toBe("دورة شاملة تغطي المنهج بالكامل");
    expect(og(meta, "og:type")).toBe("website");
  });

  it("is independently bilingual: the English render never leaks Arabic copy", () => {
    const meta = seo(course, "en", "https://site.test/courses/full-revision", { siteName });
    expect(title(meta)).toBe("Full Revision — Dr mostafa tito");
    expect(desc(meta)).toBe("A complete course covering the syllabus");
    expect(og(meta, "og:description")).toBe("A complete course covering the syllabus");
    expect(title(meta)).not.toContain("مراجعة");
  });

  it("emits the canonical as a real <link> element, not an inert <meta rel>", () => {
    const meta = seo(course, "ar", "https://site.test/courses/full-revision", { siteName });
    const canonical = meta.find((m) => m.rel === "canonical") as
      | { href?: string; tagName?: string }
      | undefined;
    expect(canonical?.href).toBe("https://site.test/courses/full-revision");
    // Regression: React Router renders a <link> ONLY for descriptors carrying
    // tagName:"link". Without it the tag degraded to `<meta rel="canonical">`,
    // which no crawler honours — the CMS SEO tab's canonical field was inert.
    expect(canonical?.tagName).toBe("link");
  });

  it("upgrades twitter:card to summary_large_image only when an OG image exists", () => {
    const withImage = seo(course, "ar", "https://site.test/c/x", {
      siteName,
      ogImageUrl: "https://site.test/files/abc.png",
    });
    expect(og(withImage, "og:image")).toBe("https://site.test/files/abc.png");
    expect(find(withImage, "name", "twitter:card")?.content).toBe("summary_large_image");

    const without = seo(course, "ar", "https://site.test/c/x", { siteName });
    expect(og(without, "og:image")).toBeNull();
    expect(find(without, "name", "twitter:card")?.content).toBe("summary");
  });

  it("falls back to the other language when one side is empty (never renders an empty title)", () => {
    const partial = { title: { ar: "", en: "Full Revision" }, description: { ar: "", en: "Only English" } };
    const arMeta = seo(partial, "ar", "https://site.test/c/x", { siteName });
    expect(title(arMeta)).toContain("Full Revision");
    expect(desc(arMeta)).toBe("Only English");
  });

  it("normalises whitespace and caps the description at the seoSchema's 300-char limit", () => {
    const long = "x".repeat(500);
    const meta = seo(
      { title: { ar: "ع", en: "t" }, description: { ar: `  multi\n  line   ${long}  `, en: "" } },
      "ar",
      "https://site.test/c/x",
      { siteName }
    );
    const d = desc(meta);
    expect(d).not.toBeNull();
    expect(d!.length).toBeLessThanOrEqual(300);
    expect(d).not.toContain("\n");
    expect(d).not.toMatch(/\s{2,}/);
  });

  it("omits the site-name suffix rather than duplicating it", () => {
    const meta = seo(
      { title: { ar: "مراجعة — د/ مصطفى تيتو", en: "Full Revision — Dr mostafa tito" } },
      "ar",
      "https://site.test/c/x",
      { siteName }
    );
    expect(title(meta)).toBe("مراجعة — د/ مصطفى تيتو");
  });

  it("still works with no site name (empty-first platforms)", () => {
    const meta = seo(course, "ar", "https://site.test/c/x");
    expect(title(meta)).toBe("مراجعة شاملة");
  });
});

describe("rootMetaFrom — meta() must reuse the locale the root loader picked", () => {
  it("reads locale + platform identity from the root match", () => {
    const r = rootMetaFrom([
      { id: "root", data: { locale: "en", platform: { nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito", taglineAr: "فلسفة", taglineEn: "Philosophy" } } },
      { id: "public", data: {} },
    ]);
    expect(r.locale).toBe("en");
    expect(r.siteName).toEqual({ ar: "د/ مصطفى تيتو", en: "Dr mostafa tito" });
    expect(r.tagline).toEqual({ ar: "فلسفة", en: "Philosophy" });
  });

  it("prefers the root match even when a later match also carries a locale", () => {
    const r = rootMetaFrom([
      { id: "root", data: { locale: "ar", platform: { nameAr: "م", nameEn: "P" } } },
      { id: "child", data: { locale: "en" } },
    ]);
    expect(r.locale).toBe("ar");
  });

  it("is defensive: malformed match data falls back to Arabic with no identity", () => {
    expect(rootMetaFrom(undefined)).toEqual({ locale: "ar", siteName: null, tagline: null });
    expect(rootMetaFrom([])).toEqual({ locale: "ar", siteName: null, tagline: null });
    expect(rootMetaFrom([{ id: "root", data: null }]).locale).toBe("ar");
    expect(rootMetaFrom([{ id: "root", data: { locale: "fr", platform: {} } }]).siteName).toBeNull();
  });
});
