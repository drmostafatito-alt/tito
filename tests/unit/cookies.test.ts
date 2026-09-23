import { describe, expect, it } from "vitest";
import {
  applyEmbedClear,
  clearCookieHeader,
  cookieSameSite,
  EMBED_CLEAR_SESSION_HEADER,
  EMBED_SESSION_HEADER,
  parseCookieHeader,
  readEmbedHeader,
  serializeCookie,
} from "~server/auth/cookies.server";
import {
  applyAuthClear,
  applyAuthCookies,
  DEVICE_COOKIE,
  readSessionToken,
  SESSION_COOKIE,
} from "~server/auth/session.server";

describe("cookie helpers", () => {
  it("serializes with the security flags we mandate", () => {
    const header = serializeCookie("__Host-edu_session", "tok", { maxAgeSeconds: 60 });
    expect(header).toContain("__Host-edu_session=tok");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=60");
  });

  it("rejects prefix violations and header-injection characters", () => {
    expect(() => serializeCookie("__Host-edu_session", "tok", { path: "/admin" })).toThrow();
    expect(() => serializeCookie("__Host-edu_session", "tok", { secure: false })).toThrow();
    expect(() => serializeCookie("safe", "ok\r\nSet-Cookie=owned")).toThrow();
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

  it("emits Partitioned with SameSite=None", () => {
    const header = serializeCookie("edu_x", "tok", { sameSite: "None" });
    expect(header).toContain("SameSite=None");
    expect(header).toContain("Partitioned");
    expect(header).toContain("Secure");
  });

  it("reads COOKIE_SAMESITE", () => {
    expect(cookieSameSite({ COOKIE_SAMESITE: "None" } as unknown as Env)).toBe("None");
    expect(cookieSameSite({ COOKIE_SAMESITE: "strict" } as unknown as Env)).toBe("Strict");
    expect(cookieSameSite({} as unknown as Env)).toBe("Lax");
  });
});

describe("embed session transport (preview iframes)", () => {
  const token = "A".repeat(32);
  const noneEnv = { COOKIE_SAMESITE: "None" } as unknown as Env;
  const laxEnv = {} as unknown as Env;

  it("ignores the embed header unless COOKIE_SAMESITE=None", () => {
    const request = new Request("https://app.example/login", {
      headers: { [EMBED_SESSION_HEADER]: token },
    });
    expect(readEmbedHeader(request, EMBED_SESSION_HEADER, laxEnv)).toBeUndefined();
    expect(readSessionToken(request, laxEnv)).toBeUndefined();
    expect(readEmbedHeader(request, EMBED_SESSION_HEADER, noneEnv)).toBe(token);
    expect(readSessionToken(request, noneEnv)).toBe(token);
  });

  it("prefers the HttpOnly cookie over the embed header", () => {
    const request = new Request("https://app.example/admin", {
      headers: {
        Cookie: `${SESSION_COOKIE}=cookie-token-value-ok`,
        [EMBED_SESSION_HEADER]: token,
      },
    });
    expect(readSessionToken(request, noneEnv)).toBe("cookie-token-value-ok");
  });

  it("rejects malformed embed tokens", () => {
    const request = new Request("https://app.example/admin", {
      headers: { [EMBED_SESSION_HEADER]: "no spaces allowed here!!" },
    });
    expect(readSessionToken(request, noneEnv)).toBeUndefined();
  });

  it("emits embed headers next to Set-Cookie only in None mode", () => {
    const headers = new Headers();
    applyAuthCookies(headers, noneEnv, [
      { name: SESSION_COOKIE, value: token, maxAgeSeconds: 60 },
      { name: DEVICE_COOKIE, value: token, maxAgeSeconds: 60 },
    ]);
    expect(headers.get(EMBED_SESSION_HEADER)).toBe(token);
    expect(headers.get("Set-Cookie") ?? "").toContain("SameSite=None");
    expect(headers.get("Set-Cookie") ?? "").toContain("Partitioned");

    const laxHeaders = new Headers();
    applyAuthCookies(laxHeaders, laxEnv, [{ name: SESSION_COOKIE, value: token, maxAgeSeconds: 60 }]);
    expect(laxHeaders.get(EMBED_SESSION_HEADER)).toBeNull();
  });

  it("signals the client to drop the stored session on logout", () => {
    const headers = new Headers();
    applyAuthClear(headers, noneEnv);
    expect(headers.get(EMBED_CLEAR_SESSION_HEADER)).toBe("1");
    const lax = new Headers();
    applyEmbedClear(lax, laxEnv);
    expect(lax.get(EMBED_CLEAR_SESSION_HEADER)).toBeNull();
  });
});
