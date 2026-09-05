import { describe, expect, it } from "vitest";
import {
  clearCookieHeader,
  parseCookieHeader,
  serializeCookie,
} from "~server/auth/cookies.server";

describe("cookie helpers", () => {
  it("serializes with the security flags we mandate", () => {
    const header = serializeCookie("__edu_session", "tok", { maxAgeSeconds: 60 });
    expect(header).toContain("__edu_session=tok");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=60");
  });

  it("clears with expiry in the past", () => {
    const header = clearCookieHeader("__edu_session");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("parses multiple cookies", () => {
    const map = parseCookieHeader("__edu_session=abc; edu_locale=ar; __edu_dk=xyz");
    expect(map.get("__edu_session")).toBe("abc");
    expect(map.get("edu_locale")).toBe("ar");
    expect(map.get("__edu_dk")).toBe("xyz");
    expect(parseCookieHeader(null).size).toBe(0);
  });

  it("tolerates malformed input", () => {
    const map = parseCookieHeader("garbage-without-equals;; =empty-name; a=1");
    expect(map.get("a")).toBe("1");
    expect(map.size).toBe(1);
  });
});
