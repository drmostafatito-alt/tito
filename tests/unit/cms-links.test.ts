import { describe, expect, it } from "vitest";
import {
  EXAM_PLATFORM_HREF,
  fragmentId,
  isExternalHref,
  resolveCmsHref,
  safeHref,
} from "~/cms/links";

/**
 * CMS link resolution — the rules that keep every stored destination truthful.
 *
 * Two regressions are pinned here:
 *  1. an in-page fragment ("#exams") whose target section will not render used to
 *     be emitted as a link, producing a dead anchor (the exams section collapses
 *     while the external Questions Platform is disabled/unconfigured);
 *  2. there was no way to point a CMS block at the admin-configured external
 *     Questions Platform without hard-coding its URL into page data.
 */

const EXAMS_URL = "https://exams.mansa-eg.workers.dev/";

describe("safeHref", () => {
  it("accepts internal paths, fragments, https and empty", () => {
    expect(safeHref("")).toBe(true);
    expect(safeHref("/courses")).toBe(true);
    expect(safeHref("/courses/physics-3s-full?tab=units")).toBe(true);
    expect(safeHref("#videos")).toBe(true);
    expect(safeHref(EXAMS_URL)).toBe(true);
  });

  it("accepts the reserved external-Questions-Platform token", () => {
    expect(safeHref(EXAM_PLATFORM_HREF)).toBe(true);
  });

  it("still rejects unsafe schemes and protocol-relative hosts", () => {
    expect(safeHref("javascript:alert(1)")).toBe(false);
    expect(safeHref("data:text/html,<script>")).toBe(false);
    expect(safeHref("//evil.example")).toBe(false);
    expect(safeHref("http://insecure.example")).toBe(false);
  });
});

describe("fragmentId", () => {
  it("returns the anchor id for in-page fragments only", () => {
    expect(fragmentId("#videos")).toBe("videos");
    expect(fragmentId("#books")).toBe("books");
    expect(fragmentId("/courses")).toBeNull();
    expect(fragmentId(EXAMS_URL)).toBeNull();
    expect(fragmentId("")).toBeNull();
    // not a fragment → must never be treated as a same-document jump
    expect(fragmentId("#a b")).toBeNull();
  });
});

describe("resolveCmsHref — in-page fragments", () => {
  it("keeps a fragment whose section really renders", () => {
    expect(resolveCmsHref("#videos", { anchors: new Set(["videos", "books"]) })).toBe("#videos");
  });

  it("drops a fragment whose target section will not render (no dead anchor)", () => {
    // The exams section collapses while the Questions Platform is off, so no
    // element with id="exams" is ever emitted → the link must not be rendered.
    expect(resolveCmsHref("#exams", { anchors: new Set(["videos", "books"]) })).toBe("");
    expect(resolveCmsHref("#exams", { anchors: new Set() })).toBe("");
  });

  it("keeps the same fragment once the platform is configured", () => {
    expect(resolveCmsHref("#exams", { anchors: new Set(["exams"]) })).toBe("#exams");
  });

  it("leaves fragments untouched when the page context is unknown", () => {
    expect(resolveCmsHref("#exams")).toBe("#exams");
    expect(resolveCmsHref("#exams", {})).toBe("#exams");
  });
});

describe("resolveCmsHref — external Questions Platform token", () => {
  it("resolves to the configured https URL", () => {
    expect(resolveCmsHref(EXAM_PLATFORM_HREF, { questionPlatformUrl: EXAMS_URL })).toBe(EXAMS_URL);
  });

  it("resolves to no link while the platform is disabled or unconfigured", () => {
    expect(resolveCmsHref(EXAM_PLATFORM_HREF, { questionPlatformUrl: null })).toBe("");
    expect(resolveCmsHref(EXAM_PLATFORM_HREF, { questionPlatformUrl: "" })).toBe("");
    expect(resolveCmsHref(EXAM_PLATFORM_HREF, {})).toBe("");
    expect(resolveCmsHref(EXAM_PLATFORM_HREF)).toBe("");
  });

  it("never emits a non-https value, even if a bad URL reached the setting", () => {
    // Defence in depth: the setting is https-validated on write; render refuses too.
    expect(resolveCmsHref(EXAM_PLATFORM_HREF, { questionPlatformUrl: "javascript:alert(1)" })).toBe("");
    expect(resolveCmsHref(EXAM_PLATFORM_HREF, { questionPlatformUrl: "http://insecure.example" })).toBe("");
  });

  it("resolves to an external href so the renderer opens it safely", () => {
    const resolved = resolveCmsHref(EXAM_PLATFORM_HREF, { questionPlatformUrl: EXAMS_URL });
    expect(isExternalHref(resolved)).toBe(true);
    expect(resolved.startsWith("/")).toBe(false);
    expect(fragmentId(resolved)).toBeNull();
  });
});

describe("resolveCmsHref — ordinary destinations are untouched", () => {
  it("passes internal paths and empty values through", () => {
    expect(resolveCmsHref("/programs", { anchors: new Set() })).toBe("/programs");
    expect(resolveCmsHref("", { anchors: new Set() })).toBe("");
  });

  it("passes owner-entered https links through", () => {
    expect(resolveCmsHref("https://example.org/x", { anchors: new Set() })).toBe("https://example.org/x");
  });

  it("does not treat the reserved token as a fragment or an internal path", () => {
    expect(fragmentId(EXAM_PLATFORM_HREF)).toBeNull();
    expect(EXAM_PLATFORM_HREF.startsWith("/")).toBe(false);
  });
});
