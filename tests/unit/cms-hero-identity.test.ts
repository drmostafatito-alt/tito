import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { SectionView } from "~/components/cms/blocks";
import type { CmsRenderCtx } from "~/cms/render-types";

/**
 * The hero identity plate (owner brief §8 + §14–§19).
 *
 * Two rules are locked here because both were regressions at different points:
 *   1. with an owner photo published, THAT photo is the hero visual — the slot is
 *      never filled with a stand-in, and the same face never renders twice;
 *   2. with the slot empty, the plate falls back to the thinker engraving — the
 *      old abstract/violet hero image must never come back, and there is still
 *      exactly ONE eager hero visual on the page either way.
 */

const PHOTO_URL = "/files/2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f2f";

function renderHero(ownerPhoto: string | null) {
  const identity = {
    platformName: { ar: "منصة تيتو", en: "Tito" },
    shortName: { ar: "تيتو", en: "Tito" },
    tagline: { ar: "الفلسفة وعلم النفس", en: "Philosophy & Psychology" },
    ownerName: { ar: "د/ مصطفى تيتو", en: "Dr mostafa tito" },
    ownerTitle: { ar: "مدرس الفلسفة والمنطق", en: "Philosophy teacher" },
    ownerPhoto,
    logo: null,
    contactPhone: "",
    contactEmail: "",
    contactAddress: { ar: "", en: "" },
    whatsapp: "",
    telegram: "",
    socials: [],
    copyright: { ar: "", en: "" },
  };
  const ctx = {
    locale: "ar",
    images: {},
    dynamic: {},
    forms: {},
    formResults: {},
    identity,
    questionPlatformUrl: null,
    now: Date.UTC(2026, 0, 1),
  } as unknown as CmsRenderCtx;

  const section = {
    id: "sec-hero",
    type: "section",
    props: {},
    visible: true,
    children: [
      {
        id: "blk-hero",
        type: "hero_showcase",
        props: { heading: { ar: "محتوى تعليمي مرتّب", en: "Learning content" }, useIdentity: true },
        visible: true,
        children: [],
      },
    ],
  };
  return renderToStaticMarkup(h(MemoryRouter, null, h(SectionView, { section, ctx })));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("CMS hero identity plate", () => {
  it("uses the published owner photo as the hero visual, unaltered", () => {
    const html = renderHero(PHOTO_URL);
    expect(html).toContain(`src="${PHOTO_URL}"`);
    expect(html).toContain('data-hero-visual="true"');
    // the owner's picture is streamed from R2 through /files/:id — never an
    // embedded default, never a public/ asset baked into the bundle
    expect(html).not.toContain("hero-philosophy");
    // …and the identity caption keeps the name (photo + name, not photo only)
    expect(html).toContain("د/ مصطفى تيتو");
  });

  it("does not repeat the owner photo as a chip when it is already the plate", () => {
    const html = renderHero(PHOTO_URL);
    expect(count(html, `src="${PHOTO_URL}"`)).toBe(1);
  });

  it("falls back to the thinker plate — and never to an abstract illustration", () => {
    const html = renderHero(null);
    expect(html).toContain("thinker-plate");
    expect(html).not.toContain("/files/");
    expect(html).not.toContain("hero-philosophy");
    expect(html).toContain("د/ مصطفى تيتو");
  });

  it("renders exactly one eager hero visual either way (LCP discipline)", () => {
    for (const photo of [PHOTO_URL, null]) {
      const html = renderHero(photo);
      const heroImgs = html.match(/<img[^>]*data-hero-visual="true"[^>]*>/g) ?? [];
      expect(heroImgs).toHaveLength(1);
      const hero = String(heroImgs[0]);
      // React SSR keeps the camelCase spelling of the fetch-priority hint.
      expect(hero).toContain('fetchPriority="high"');
      expect(hero).toContain('loading="eager"');
      // …and the matching preload is emitted for the SAME url, so the LCP
      // element is the first byte the browser asks for (decorative portraits are
      // never preloaded).
      const heroSrc = String(hero.match(/src="([^"]+)"/)?.[1]);
      expect(heroSrc.length).toBeGreaterThan(0);
      const preloads = html.match(/<link rel="preload" as="image"[^>]*>/g) ?? [];
      for (const link of preloads) expect(link).toContain(heroSrc);
    }
  });

  it("preloads the owner photo itself when it is the hero visual", () => {
    expect(renderHero(PHOTO_URL)).toContain(`<link rel="preload" as="image" href="${PHOTO_URL}" fetchPriority="high"/>`);
  });
});
