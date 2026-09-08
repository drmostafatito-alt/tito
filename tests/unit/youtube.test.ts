import { describe, expect, it } from "vitest";
import {
  YOUTUBE_ID_RE,
  parseYouTubeId,
  youTubeEmbedUrl,
  youTubeThumbnailUrl,
  youTubeWatchUrl,
} from "~server/video/youtube";
import { applySecurityHeaders } from "~server/http/headers.server";

/**
 * The owner pastes a YouTube URL in Admin. These tests pin the security boundary:
 * only a validated 11-char id ever leaves this module, and the embed URL is always
 * rebuilt from that id on a pinned host — so a crafted "URL" cannot smuggle HTML,
 * script, or an arbitrary origin into the page.
 */

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeId — accepted shapes", () => {
  const accepted: Array<[string, string]> = [
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}`, ID],
    [`http://www.youtube.com/watch?v=${ID}`, ID],
    [`https://m.youtube.com/watch?v=${ID}`, ID],
    [`https://music.youtube.com/watch?v=${ID}`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://www.youtu.be/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}`, ID],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/live/${ID}`, ID],
    [`https://www.youtube.com/v/${ID}`, ID],
    // ids may legitimately contain - and _
    ["https://youtu.be/a-_AbCdEf12", "a-_AbCdEf12"],
    // surrounding whitespace from a paste is tolerated
    [`  https://youtu.be/${ID}  `, ID],
  ];
  for (const [url, expected] of accepted) {
    it(`accepts ${url}`, () => expect(parseYouTubeId(url)).toBe(expected));
  }
});

describe("parseYouTubeId — extra query params are ignored, not trusted", () => {
  it("takes the id from a share URL carrying tracking params", () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}&t=42s&si=AbC123&list=PLxyz`)).toBe(ID);
  });
  it("takes the id when the URL is a playlist link that also names a video", () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?list=PLxyz&v=${ID}`)).toBe(ID);
  });
  it("ignores a path suffix after the id", () => {
    expect(parseYouTubeId(`https://youtu.be/${ID}?feature=share`)).toBe(ID);
  });
});

describe("parseYouTubeId — rejected input", () => {
  const rejected: Array<[string, string]> = [
    ["bare id is not a URL", ID],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["javascript scheme", `javascript:alert(1)//https://youtu.be/${ID}`],
    ["data scheme", `data:text/html,<script>alert(1)</script>`],
    ["unknown host", `https://evil.example.com/watch?v=${ID}`],
    ["host suffix spoof", `https://youtube.com.evil.example.com/watch?v=${ID}`],
    ["userinfo spoof", `https://youtube.com@evil.example.com/watch?v=${ID}`],
    ["id too short", "https://youtu.be/abc123"],
    ["id too long", "https://youtu.be/dQw4w9WgXcQEXTRA"],
    ["id with illegal char", "https://youtu.be/dQw4w9WgXc!"],
    ["playlist with no video", "https://www.youtube.com/playlist?list=PLxyz"],
    ["channel page", "https://www.youtube.com/@somechannel"],
    ["search page", "https://www.youtube.com/results?search_query=physics"],
    ["not a URL at all", "hello world"],
    ["overlong input", `https://youtu.be/${ID}?q=${"x".repeat(3000)}`],
  ];
  for (const [label, input] of rejected) {
    it(`rejects ${label}`, () => expect(parseYouTubeId(input)).toBeNull());
  }

  it("rejects non-string input", () => {
    expect(parseYouTubeId(undefined)).toBeNull();
    expect(parseYouTubeId(null)).toBeNull();
    expect(parseYouTubeId(12345)).toBeNull();
    expect(parseYouTubeId({ url: `https://youtu.be/${ID}` })).toBeNull();
  });
});

describe("derived URLs are pinned and built only from the id", () => {
  it("embed always targets the privacy-enhanced host", () => {
    const url = youTubeEmbedUrl(ID);
    expect(url.startsWith(`https://www.youtube-nocookie.com/embed/${ID}?`)).toBe(true);
    expect(new URL(url).hostname).toBe("www.youtube-nocookie.com");
    expect(new URL(url).pathname).toBe(`/embed/${ID}`);
  });

  it("thumbnail and watch URLs are pinned", () => {
    expect(youTubeThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    expect(youTubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it("refuses to build a URL from an unvalidated id", () => {
    expect(() => youTubeEmbedUrl(`../../etc/passwd`)).toThrow();
    expect(() => youTubeEmbedUrl(`${ID}" onload="alert(1)`)).toThrow();
    expect(() => youTubeThumbnailUrl("short")).toThrow();
    expect(() => youTubeWatchUrl("")).toThrow();
  });

  it("the id pattern is exactly 11 base64url chars", () => {
    expect(YOUTUBE_ID_RE.test("dQw4w9WgXcQ")).toBe(true);
    expect(YOUTUBE_ID_RE.test("dQw4w9WgXc")).toBe(false);
    expect(YOUTUBE_ID_RE.test("dQw4w9WgXcQQ")).toBe(false);
    expect(YOUTUBE_ID_RE.test("dQw4w9WgXc/")).toBe(false);
  });
});

describe("CSP allows the embedded player and nothing else", () => {
  const headers = new Headers();
  applySecurityHeaders(headers, false, "abc123");
  const csp = headers.get("Content-Security-Policy") ?? "";

  it("pins frame-src to youtube-nocookie only", () => {
    const frame = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-src"));
    expect(frame).toBe("frame-src https://www.youtube-nocookie.com");
  });

  it("still forbids being framed itself", () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("allows YouTube poster images", () => {
    const img = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src"));
    expect(img).toContain("https://i.ytimg.com");
  });
});
