import { describe, expect, it } from "vitest";
import { ar } from "~/locales/ar";
import { en } from "~/locales/en";
import { t, dirOf, formatDate, formatDateShort, formatDateTime } from "~/lib/i18n";

function keysOf(obj: unknown, prefix = ""): string[] {
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    v && typeof v === "object" ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

describe("dictionary parity (ar/en must not drift)", () => {
  it("en covers every ar key and vice versa", () => {
    expect(new Set(keysOf(en))).toEqual(new Set(keysOf(ar)));
  });

  it("lookup resolves nested keys and interpolates", () => {
    expect(t("en", "auth.errors.invalid_credentials")).toBe("Incorrect email or password.");
    expect(t("ar", "common.appName")).toBe("د/ مصطفى تيتو");
  });

  it("unknown key falls back to the key itself", () => {
    expect(t("en", "does.not.exist")).toBe("does.not.exist");
  });

  it("direction and formatting", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
    expect(formatDate("en", 0)).toBeTruthy();
  });

  it("formatDate is deterministic/ASCII so SSR === client (no hydration drift)", () => {
    // Local-time construction so the expected fields are stable for any TZ runner.
    const ts = new Date(2026, 8, 8, 10, 5, 0).getTime();
    expect(formatDate("ar", ts)).toBe("08/09/2026 10:05");
    expect(formatDate("en", ts)).toBe("8 Sep 2026, 10:05");
    // Never emit runtime-sensitive Arabic punctuation / RLM marks (bug: React #418).
    for (const out of [formatDate("ar", ts), formatDate("en", ts)]) {
      expect(out).not.toMatch(/[،‏]/);
    }
  });

  it("formatDateShort / formatDateTime stay ASCII and match ar/en", () => {
    const ts = new Date(2026, 8, 8, 9, 5, 7).getTime();
    expect(formatDateShort("ar", ts)).toBe("08/09/2026");
    expect(formatDateShort("en", ts)).toBe("8 Sep 2026");
    expect(formatDateTime("ar", ts)).toBe("08/09/2026 09:05:07");
    expect(formatDateTime("en", ts)).toBe("8 Sep 2026, 09:05:07");
    // Accepts a Date too (used where components already hold Date objects).
    expect(formatDateTime("en", new Date(ts))).toBe("8 Sep 2026, 09:05:07");
    // No Arabic-Indic digits or Arabic comma anywhere (bug: React #418 on CMS trails).
    for (const out of [formatDateShort("ar", ts), formatDateTime("ar", ts), formatDateTime("en", ts)]) {
      expect(out).not.toMatch(/[٠-٩،‏]/);
    }
  });
});
