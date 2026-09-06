import { describe, expect, it } from "vitest";
import { resolveLocale } from "~server/settings/locale.server";
import { serializeCookie } from "~server/auth/cookies.server";
import { ar } from "~/locales/ar";
import { en } from "~/locales/en";

describe("resolveLocale — Arabic default for fresh visitors", () => {
  const base = { defaultLocale: "ar" as const, enabled: ["ar", "en"] as ("ar" | "en")[] };

  it("ignores Accept-Language so en-US browsers still land on Arabic", () => {
    expect(resolveLocale({ ...base, acceptLanguage: "en-US,en;q=0.9" })).toBe("ar");
    expect(resolveLocale({ ...base, cookieValue: null, userPref: null, acceptLanguage: "en" })).toBe("ar");
  });

  it("honors an explicit locale cookie (language switcher)", () => {
    expect(resolveLocale({ ...base, cookieValue: "en", acceptLanguage: "ar" })).toBe("en");
    expect(resolveLocale({ ...base, cookieValue: "ar", acceptLanguage: "en-US" })).toBe("ar");
  });

  it("honors a logged-in user's locale preference", () => {
    expect(resolveLocale({ ...base, userPref: "en", acceptLanguage: "ar" })).toBe("en");
    expect(resolveLocale({ ...base, cookieValue: "ar", userPref: "en" })).toBe("ar"); // cookie wins
  });

  it("falls back to the platform default when the candidate is not enabled", () => {
    expect(resolveLocale({ ...base, cookieValue: "fr", defaultLocale: "ar" })).toBe("ar");
  });
});

describe("locale cookie localhost (no Secure on HTTP)", () => {
  it("omits Secure when requested", () => {
    const header = serializeCookie("edu_locale", "en", {
      maxAgeSeconds: 31536000,
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    });
    expect(header).toContain("edu_locale=en");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Secure");
  });

  it("keeps Secure on HTTPS (default)", () => {
    const header = serializeCookie("edu_locale", "ar", { maxAgeSeconds: 31536000 });
    expect(header).toContain("Secure");
  });
});

describe("user-facing branding", () => {
  it("does not expose EduCore as the app name", () => {
    expect(ar.common.appName).not.toMatch(/EduCore|إيدوكور/i);
    expect(en.common.appName).not.toMatch(/EduCore|إيدوكور/i);
    expect(ar.common.appName).toBe("د/ مصطفى تيتو");
    expect(en.common.appName).toBe("Dr mostafa tito");
  });
});
