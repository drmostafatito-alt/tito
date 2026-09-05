import { describe, expect, it } from "vitest";
import { ar } from "~/locales/ar";
import { en } from "~/locales/en";
import { t, dirOf, formatDate } from "~/lib/i18n";

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
    expect(t("ar", "common.appName")).toBe("منصة إيدوكور");
  });

  it("unknown key falls back to the key itself", () => {
    expect(t("en", "does.not.exist")).toBe("does.not.exist");
  });

  it("direction and formatting", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
    expect(formatDate("en", 0)).toBeTruthy();
  });
});
