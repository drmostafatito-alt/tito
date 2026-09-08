import { describe, expect, it } from "vitest";
import { parseGoogleFormUrl } from "~server/content/external-links";
import { applySecurityHeaders } from "~server/http/headers.server";

/**
 * The owner pastes a Google Forms (or Google Forms quiz) URL. These tests pin the
 * boundary: only docs.google.com /forms/d/[e/]<id>/viewform is accepted, only the
 * form id is kept, and the embed URL is rebuilt — so a crafted URL cannot inject
 * HTML/JS or point the iframe at another origin.
 */

const E_ID = "1FAIpQLSdExampleFormId0123456789";
const D_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcde";

describe("parseGoogleFormUrl — accepted shapes", () => {
  const accepted: Array<[string, string, "e" | "d"]> = [
    [`https://docs.google.com/forms/d/e/${E_ID}/viewform`, E_ID, "e"],
    [`https://docs.google.com/forms/d/e/${E_ID}/viewform?usp=sf_link`, E_ID, "e"],
    [`https://docs.google.com/forms/d/e/${E_ID}/viewform?embedded=true`, E_ID, "e"],
    [`https://docs.google.com/forms/d/${D_ID}/viewform`, D_ID, "d"],
    [`https://docs.google.com/forms/d/${D_ID}/viewform?usp=pp_url`, D_ID, "d"],
    [`  https://docs.google.com/forms/d/e/${E_ID}/viewform  `, E_ID, "e"],
  ];
  for (const [url, id, segment] of accepted) {
    it(`accepts ${url}`, () => {
      const r = parseGoogleFormUrl(url);
      expect(r).not.toBeNull();
      expect(r!.id).toBe(id);
      expect(r!.segment).toBe(segment);
      expect(r!.kind).toBe("google_form");
    });
  }

  it("rebuilds a canonical embed URL and drops tracking params", () => {
    const r = parseGoogleFormUrl(`https://docs.google.com/forms/d/e/${E_ID}/viewform?usp=sf_link&foo=bar`)!;
    expect(r.embedUrl).toBe(`https://docs.google.com/forms/d/e/${E_ID}/viewform?embedded=true`);
    expect(r.openUrl).toBe(`https://docs.google.com/forms/d/e/${E_ID}/viewform`);
    expect(r.embedUrl).not.toContain("usp");
    expect(r.embedUrl).not.toContain("foo");
  });

  it("uses the /d/ shape for non-published ids", () => {
    const r = parseGoogleFormUrl(`https://docs.google.com/forms/d/${D_ID}/viewform`)!;
    expect(r.embedUrl).toBe(`https://docs.google.com/forms/d/${D_ID}/viewform?embedded=true`);
  });
});

describe("parseGoogleFormUrl — rejected input", () => {
  const rejected: Array<[string, string]> = [
    ["other host", `https://evil.example.com/forms/d/e/${E_ID}/viewform`],
    ["host suffix spoof", `https://docs.google.com.evil.example.com/forms/d/e/${E_ID}/viewform`],
    ["userinfo spoof", `https://docs.google.com@evil.example.com/forms/d/e/${E_ID}/viewform`],
    ["http (not https)", `http://docs.google.com/forms/d/e/${E_ID}/viewform`],
    ["javascript scheme", `javascript:alert(1)//https://docs.google.com/forms/d/e/${E_ID}/viewform`],
    ["data scheme", `data:text/html,<script>alert(1)</script>`],
    ["google spreadsheets", `https://docs.google.com/spreadsheets/d/${D_ID}/edit`],
    ["google docs", `https://docs.google.com/document/d/${D_ID}/edit`],
    ["forms editor, not viewform", `https://docs.google.com/forms/d/${D_ID}/edit`],
    ["missing viewform segment", `https://docs.google.com/forms/d/e/${E_ID}`],
    ["id too short", "https://docs.google.com/forms/d/e/abc/viewform"],
    ["id with illegal char", `https://docs.google.com/forms/d/e/${E_ID}!x/viewform`],
    ["empty string", ""],
    ["not a URL", "docs.google.com/forms"],
    ["bare id", E_ID],
    ["overlong input", `https://docs.google.com/forms/d/e/${E_ID}/viewform?q=${"x".repeat(3000)}`],
  ];
  for (const [label, input] of rejected) {
    it(`rejects ${label}`, () => expect(parseGoogleFormUrl(input)).toBeNull());
  }

  it("rejects non-string input", () => {
    expect(parseGoogleFormUrl(undefined)).toBeNull();
    expect(parseGoogleFormUrl(null)).toBeNull();
    expect(parseGoogleFormUrl(42)).toBeNull();
    expect(parseGoogleFormUrl({ url: `https://docs.google.com/forms/d/e/${E_ID}/viewform` })).toBeNull();
  });
});

describe("CSP allows the embedded Google Form", () => {
  const headers = new Headers();
  applySecurityHeaders(headers, false, "abc123");
  const csp = headers.get("Content-Security-Policy") ?? "";
  const frame = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-src")) ?? "";

  it("includes docs.google.com and nothing broader", () => {
    expect(frame).toBe("frame-src https://www.youtube-nocookie.com https://docs.google.com");
    expect(frame).not.toContain("*");
  });
});
