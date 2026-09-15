import { describe, expect, it } from "vitest";
import { applicationOrigin, parseAppOrigin } from "~server/http/origin.server";
import {
  declaredBodyTooLarge,
  hasSameOriginMutationEvidence,
  streamedBodyTooLarge,
} from "~server/http/csrf.server";
import { safeLocalRedirect } from "~server/http/redirect.server";
import { productionRuntimeConfigErrors } from "~server/runtime-config.server";
import { sanitizedVideoProviderFailure } from "~server/video/provider-error.server";
import {
  clearResetCookie,
  isResetTokenShape,
  resetTokenFromRequest,
  serializeResetCookie,
} from "~server/auth/reset-cookie.server";
import {
  normalizeUploadMime,
  parseByteRange,
  uploadBytesMatchMime,
} from "~server/files/storage.server";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe("trusted application origins", () => {
  it("accepts only bare HTTPS origins in production", () => {
    expect(parseAppOrigin("https://example.com")).toBe("https://example.com");
    expect(parseAppOrigin("https://example.com:8443/")).toBe("https://example.com:8443");
    expect(parseAppOrigin("http://example.com")).toBeNull();
    expect(parseAppOrigin("https://user@example.com")).toBeNull();
    expect(parseAppOrigin("https://example.com/path")).toBeNull();
    expect(parseAppOrigin("https://example.com/?next=evil")).toBeNull();
  });

  it("never trusts a production request Host over APP_ORIGIN", () => {
    const hostile = new Request("https://attacker.example/forgot-password");
    expect(applicationOrigin({ ENVIRONMENT: "production", APP_ORIGIN: "https://app.example" }, hostile)).toBe(
      "https://app.example"
    );
    expect(applicationOrigin({ ENVIRONMENT: "production" }, hostile)).toBeNull();
    expect(applicationOrigin({ ENVIRONMENT: "test" }, hostile)).toBe("https://attacker.example");
  });
});

describe("production runtime configuration", () => {
  const secret = (label: string, length = 72) => `${label}_${"x".repeat(length)}`;
  const valid = {
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://dr-tito.workers.dev",
    EMAIL_PROVIDER: "resend",
    EMAIL_FROM: "Dr Tito <noreply@verified.invalid>",
    RESEND_API_KEY: `re_${"x".repeat(32)}`,
    SESSION_PEPPER: secret("session"),
    FILE_URL_SECRET: secret("files"),
    MUX_TOKEN_ID: secret("muxid", 8),
    MUX_TOKEN_SECRET: secret("muxtoken"),
    MUX_SIGNING_KEY_ID: secret("muxsign", 8),
    MUX_SIGNING_PRIVATE_KEY: secret("muxprivate", 96),
    MUX_PLAYBACK_RESTRICTION_ID: secret("muxrestriction", 8),
    AUTH_PBKDF2_ITERATIONS: "100000",
  };

  it("accepts a structurally complete production environment and explicit local modes", () => {
    expect(productionRuntimeConfigErrors(valid)).toEqual([]);
    expect(productionRuntimeConfigErrors({ ENVIRONMENT: "development" })).toEqual([]);
    expect(productionRuntimeConfigErrors({ ENVIRONMENT: "test" })).toEqual([]);
  });

  it("fails closed for unknown/placeholder production configuration and reused secrets", () => {
    expect(productionRuntimeConfigErrors({})).toContain("ENVIRONMENT");
    expect(productionRuntimeConfigErrors({ ...valid, APP_ORIGIN: "https://127.0.0.1" })).toContain(
      "APP_ORIGIN"
    );
    const errors = productionRuntimeConfigErrors({
      ...valid,
      APP_ORIGIN: "https://example.com",
      RESEND_API_KEY: "re_replace_with_real_resend_key",
      FILE_URL_SECRET: valid.SESSION_PEPPER,
      MOCK_VIDEO_SECRET: "must-not-exist",
      MOCK_PAYMENTS_SECRET: "must-not-exist",
      MUX_PLAYBACK_RESTRICTION_ID: "",
      AUTH_PBKDF2_ITERATIONS: "50000",
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "APP_ORIGIN",
        "RESEND_API_KEY",
        "SECRET_REUSE",
        "MOCK_VIDEO_SECRET",
        "MOCK_PAYMENTS_SECRET",
        "MUX_PLAYBACK_RESTRICTION_ID",
        "AUTH_PBKDF2_ITERATIONS",
      ])
    );
  });
});

describe("same-origin mutation evidence", () => {
  const expected = "https://app.example";

  it("accepts exact Origin/Referer or browser-controlled same-origin evidence", () => {
    expect(
      hasSameOriginMutationEvidence(
        new Request(`${expected}/action`, { method: "POST", headers: { Origin: expected } }),
        expected
      )
    ).toBe(true);
    expect(
      hasSameOriginMutationEvidence(
        new Request(`${expected}/action`, { method: "POST", headers: { Referer: `${expected}/page` } }),
        expected
      )
    ).toBe(true);
    expect(
      hasSameOriginMutationEvidence(
        new Request(`${expected}/action`, { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } }),
        expected
      )
    ).toBe(true);
  });

  it("rejects sibling origins, malformed headers, same-site, cross-site and missing evidence", () => {
    const rejectedHeaders: Array<Record<string, string>> = [
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { Origin: "null", "Sec-Fetch-Site": "same-origin" },
      { Origin: `${expected}/not-valid-for-origin` },
      { Origin: "https://user:password@app.example" },
      { Origin: "not a URL", Referer: `${expected}/page`, "Sec-Fetch-Site": "same-origin" },
      { Referer: "https://sibling.app.example/page" },
      { Referer: "https://user:password@app.example/page" },
      { Referer: "not a URL", "Sec-Fetch-Site": "same-origin" },
      { "Sec-Fetch-Site": "same-site" },
      { "Sec-Fetch-Site": "cross-site" },
      {},
    ];
    for (const headers of rejectedHeaders) {
      expect(
        hasSameOriginMutationEvidence(new Request(`${expected}/action`, { method: "POST", headers }), expected)
      ).toBe(false);
    }
  });
});

describe("declared mutation body limits", () => {
  it("accepts absent/in-range lengths and rejects malformed or oversized declarations", () => {
    const request = (value?: string) =>
      new Request("https://app.example/action", {
        method: "POST",
        headers: value === undefined ? {} : { "Content-Length": value },
      });
    expect(declaredBodyTooLarge(request(), 1_000)).toBe(false);
    expect(declaredBodyTooLarge(request("1000"), 1_000)).toBe(false);
    expect(declaredBodyTooLarge(request("1001"), 1_000)).toBe(true);
    expect(declaredBodyTooLarge(request("-1"), 1_000)).toBe(true);
    expect(declaredBodyTooLarge(request("not-a-number"), 1_000)).toBe(true);
    expect(declaredBodyTooLarge(request("9999999999999999"), 1_000)).toBe(true);
  });

  it("caps the actual stream even when Content-Length is absent or understated", async () => {
    const absent = new Request("https://app.example/action", { method: "POST", body: "abcd" });
    expect(await streamedBodyTooLarge(absent, 3)).toBe(true);
    expect(absent.bodyUsed).toBe(true);

    const understated = new Request("https://app.example/action", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: "abcd",
    });
    expect(await streamedBodyTooLarge(understated, 3)).toBe(true);
    expect(understated.bodyUsed).toBe(true);

    const inRange = new Request("https://app.example/action", { method: "POST", body: "abcd" });
    expect(await streamedBodyTooLarge(inRange, 4)).toBe(false);
    expect(await inRange.text()).toBe("abcd");
  });
});

describe("provider failure sanitization", () => {
  it("never serializes upstream video exception details", () => {
    const failure = sanitizedVideoProviderFailure(
      new Error("Bearer provider-secret internal-account-id https://private.invalid")
    );
    expect(failure).toEqual({ error: "provider" });
    expect(JSON.stringify(failure)).not.toMatch(/secret|account|private/i);
  });
});

describe("local redirect validation", () => {
  it("preserves safe local paths and query/hash", () => {
    expect(safeLocalRedirect(" /student?tab=1#top ")).toBe("/student?tab=1#top");
  });

  it("rejects scheme-relative, backslash, encoded slash, absolute and control-character tricks", () => {
    for (const input of [
      "//evil.example",
      "/\\evil.example",
      "/%5cevil.example",
      "/%2f%2fevil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "/ok\nLocation: https://evil.example",
    ]) {
      expect(safeLocalRedirect(input, "/safe")).toBe("/safe");
    }
  });
});

describe("transient reset cookie", () => {
  const token = "A".repeat(43);

  it("accepts only a 256-bit base64url token shape and emits strict flags", () => {
    expect(isResetTokenShape(token)).toBe(true);
    expect(isResetTokenShape(`${token}=`)).toBe(false);
    expect(isResetTokenShape("short")).toBe(false);
    const cookie = serializeResetCookie(token);
    expect(cookie).toContain("__Host-edu_reset=");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
    expect(clearResetCookie()).toContain("Max-Age=0");
  });

  it("parses only the exact cookie name and rejects oversized headers", () => {
    expect(
      resetTokenFromRequest(new Request("https://app.example/reset", { headers: { Cookie: `x=1; __Host-edu_reset=${token}` } }))
    ).toBe(token);
    expect(
      resetTokenFromRequest(new Request("https://app.example/reset", { headers: { Cookie: `edu_reset=${token}` } }))
    ).toBeNull();
    expect(
      resetTokenFromRequest(new Request("https://app.example/reset", { headers: { Cookie: `x=${"a".repeat(17_000)}` } }))
    ).toBeNull();
  });
});

describe("upload type and byte validation", () => {
  it("normalizes only explicitly supported declared MIME types", () => {
    expect(normalizeUploadMime("IMAGE/JPEG; charset=binary")).toBe("image/jpeg");
    expect(normalizeUploadMime("image/jpg")).toBe("image/jpeg");
    expect(normalizeUploadMime("application/x-zip-compressed")).toBe("application/zip");
    expect(normalizeUploadMime("text/html")).toBe("text/html");
  });

  it("matches representative magic bytes and rejects declaration mismatches", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0);
    const pdf = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
    const mp4 = bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
    expect(uploadBytesMatchMime(png, "image/png")).toBe(true);
    expect(uploadBytesMatchMime(jpeg, "image/jpeg")).toBe(true);
    expect(uploadBytesMatchMime(pdf, "application/pdf")).toBe(true);
    expect(uploadBytesMatchMime(mp4, "video/mp4")).toBe(true);
    expect(uploadBytesMatchMime(png, "image/jpeg")).toBe(false);
    expect(uploadBytesMatchMime(pdf, "application/zip")).toBe(false);
    expect(uploadBytesMatchMime(bytes(1, 2, 3), "application/octet-stream")).toBe(false);
  });
});

describe("single byte ranges", () => {
  it("supports closed, open-ended, suffix and clamped ranges", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=90-999", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-999", 100)).toEqual({ start: 0, end: 99 });
  });

  it("rejects malformed, multiple, empty and unsatisfiable ranges", () => {
    for (const value of ["bytes=", "bytes=-0", "bytes=100-", "bytes=20-10", "bytes=0-1,4-5", "items=0-1"]) {
      expect(parseByteRange(value, 100)).toBe(false);
    }
    expect(parseByteRange("bytes=0-1", 0)).toBe(false);
  });
});
