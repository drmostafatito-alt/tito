import { describe, expect, it } from "vitest";
import { filterRtClassAttr, isAllowedRtClass, RT_COLOR_CLASSES } from "~/cms/richtext";
import { safeHref } from "~/cms/links";

describe("rich-text class allowlist (token colors, no arbitrary CSS)", () => {
  it("keeps only registry color/align/weight classes", () => {
    expect(filterRtClassAttr("rt-c-brand rt-align-center")).toBe("rt-c-brand rt-align-center");
    expect(filterRtClassAttr("rt-c-brand text-red-500 style-injected")).toBe("rt-c-brand");
    expect(filterRtClassAttr("font-[comic] bg-[#ff0]")).toBe("");
    expect(isAllowedRtClass("rt-c-error")).toBe(true);
    expect(isAllowedRtClass("text-red-600")).toBe(false);
  });

  it("every token color class is allowlisted", () => {
    for (const c of RT_COLOR_CLASSES) expect(isAllowedRtClass(c)).toBe(true);
  });
});

describe("link safety used by the sanitizer", () => {
  it("rejects javascript/data and keeps https + internal paths", () => {
    expect(safeHref("https://example.com/x")).toBe(true);
    expect(safeHref("/p/about")).toBe(true);
    expect(safeHref("javascript:alert(1)")).toBe(false);
    expect(safeHref("data:text/html,x")).toBe(false);
    expect(safeHref("//evil.example")).toBe(false);
  });
});
