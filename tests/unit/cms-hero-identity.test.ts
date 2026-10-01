import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { SectionView } from "~/components/cms/blocks";
import type { CmsRenderCtx } from "~/cms/render-types";

/**
 * The hero identity (mockup v5 redesign, 2026-10).
 *
 * Rules:
 *   1. with an owner photo published, THAT photo is the hero visual — the slot
 *      is never filled with a stand-in;
 *   2. with the slot empty, NOTHING stands in: no photo, no illustration;
 *   3. the hero structure matches the mockup: .mk > .hero > .hero-grid.
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
        props: {
          heading: { ar: "مستر مصطفى تيتو", en: "Mr. Mostafa Tito" },
          docLine: { ar: "دكتور السعادة", en: "Doctor of Happiness" },
        },
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
    // mockup structure
    expect(html).toContain('class="mk"');
    expect(html).toContain('class="hero"');
  });

  it("does not repeat the owner photo", () => {
    const html = renderHero(PHOTO_URL);
    expect(count(html, `src="${PHOTO_URL}"`)).toBe(1);
  });

  it("keeps an empty slot empty — nothing stands in", () => {
    const html = renderHero(null);
    expect(html).not.toContain("/files/");
    // hero structure still renders
    expect(html).toContain('class="hero"');
  });
});
