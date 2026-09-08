import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "~/lib/i18n";
import { ar } from "~/locales/ar";
import { en } from "~/locales/en";

/**
 * User-facing copy must live in the dictionaries, not inline in components.
 * These strings were previously hardcoded Arabic/English ternaries in the CMS
 * form renderer, the student dashboard and the student security page — which
 * meant they could not be kept consistent and were invisible to translation.
 */

describe("copy moved out of components into the dictionaries", () => {
  it("CMS form button and failure fallback exist in both locales", () => {
    expect(t("ar", "common.cmsFormSubmit")).toBe("إرسال");
    expect(t("en", "common.cmsFormSubmit")).toBe("Submit");
    expect(t("ar", "common.cmsFormFailed")).toBe("تعذر إرسال النموذج.");
    expect(t("en", "common.cmsFormFailed")).toBe("The form could not be submitted.");
  });

  it("student role labels exist in both locales", () => {
    expect(t("en", "dashboard.roleStudent")).toBe("Student");
    expect(t("ar", "dashboard.roleStudent")).toBe("طالب");
    expect(t("en", "dashboard.roleSuperAdmin")).toBe("Super admin");
    expect(t("ar", "dashboard.roleSuperAdmin")).toBe("مشرف عام");
  });

  it("device-management notice exists in both locales and drops internal roadmap wording", () => {
    const enText = t("en", "security.devicesAdminOnly");
    const arText = t("ar", "security.devicesAdminOnly");
    expect(enText.length).toBeGreaterThan(20);
    expect(arText.length).toBeGreaterThan(20);
    // "Phase 1"/"Phase 3" is internal planning language and must not reach students
    expect(enText).not.toMatch(/phase/i);
    expect(arText).not.toContain("المرحلة");
  });

  it("both dictionaries still agree in shape (en is typed Dictionary)", () => {
    // en.ts is declared `export const en: Dictionary`, so a missing key fails
    // typecheck; this asserts the new keys are genuinely reachable at runtime.
    expect((en.common as Record<string, string>).cmsFormSubmit).toBeTruthy();
    expect((ar.common as Record<string, string>).cmsFormSubmit).toBeTruthy();
  });
});

describe("the hardcoded literals are gone from the components", () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

  it("CMS form renderer reads its copy from the dictionary", () => {
    const src = read("app/components/cms/blocks.tsx");
    expect(src).toContain('t(L, "common.cmsFormSubmit")');
    expect(src).toContain('t(L, "common.cmsFormFailed")');
    expect(src).not.toContain('"إرسال"');
    expect(src).not.toContain('"تعذر إرسال النموذج."');
  });

  it("student dashboard reads role labels from the dictionary", () => {
    const src = read("app/routes/student/dashboard.tsx");
    expect(src).toContain('t(locale, "dashboard.roleStudent")');
    expect(src).not.toContain('"طالب"');
    expect(src).not.toContain('"مشرف عام"');
  });

  it("student security page reads the device notice from the dictionary", () => {
    const src = read("app/routes/student/security.tsx");
    expect(src).toContain('t(locale, "security.devicesAdminOnly")');
    expect(src).not.toContain("Phase 1");
    expect(src).not.toContain("Phase 3");
  });
});
