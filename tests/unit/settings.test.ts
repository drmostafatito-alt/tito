import { describe, expect, it } from "vitest";
import {
  DASHBOARD_MODULE_IDS,
  dashboardSettingsSchema,
  deviceSettingsSchema,
  identitySettingsSchema,
  localeSettingsSchema,
  platformSettingsSchema,
  securitySettingsSchema,
  themeSettingsSchema,
  videoSettingsSchema,
} from "~server/settings/schema";

describe("settings schemas (ADR-012)", () => {
  it("defaults parse from an empty document", () => {
    const platform = platformSettingsSchema.parse({});
    expect(platform.maintenance).toBe(false);
    expect(platform.nameEn).toBe("Dr. Mostafa Tito");

    const devices = deviceSettingsSchema.parse({});
    expect(devices.maxPerStudent).toBe(1);
    expect(devices.onLimit).toBe("block");
    expect(devices.changeLimitPer30d).toBe(2);

    const security = securitySettingsSchema.parse({});
    expect(security.sessionDays).toBe(30);
    expect(security.rateLimits.loginPerMinute).toBe(10);

    const locale = localeSettingsSchema.parse({});
    expect(locale.default).toBe("ar");
    expect(locale.enabled).toEqual(["ar", "en"]);
  });

  it("video settings: Phase 4 progress knobs default to safe values", () => {
    const video = videoSettingsSchema.parse({});
    expect(video.completionThresholdPct).toBe(90);
    expect(video.replayLimit).toBe(0); // 0 = unlimited (no behavior change pre-Phase-4)

    // bounds are enforced fail-closed on write
    expect(videoSettingsSchema.safeParse({ completionThresholdPct: 49 }).success).toBe(false);
    expect(videoSettingsSchema.safeParse({ completionThresholdPct: 101 }).success).toBe(false);
    expect(videoSettingsSchema.safeParse({ replayLimit: -1 }).success).toBe(false);
    expect(videoSettingsSchema.safeParse({ replayLimit: 1001 }).success).toBe(false);
  });

  it("dashboard modules: canonical ids all enabled by default; unknown ids rejected", () => {
    const dash = dashboardSettingsSchema.parse({});
    expect(dash.modules.map((m) => m.id)).toEqual([...DASHBOARD_MODULE_IDS]);
    expect(dash.modules.every((m) => m.enabled)).toBe(true);
    expect(DASHBOARD_MODULE_IDS).toContain("continue");
    expect(DASHBOARD_MODULE_IDS).toContain("stats");
    expect(dashboardSettingsSchema.safeParse({ modules: [{ id: "crypto_miner", enabled: true }] }).success).toBe(false);
  });

  it("rejects invalid values (fail closed on write)", () => {
    expect(deviceSettingsSchema.safeParse({ maxPerStudent: 0 }).success).toBe(false);
    expect(deviceSettingsSchema.safeParse({ maxPerStudent: 99 }).success).toBe(false);
    expect(deviceSettingsSchema.safeParse({ onLimit: "evict-everyone" }).success).toBe(false);
    expect(securitySettingsSchema.safeParse({ sessionDays: 0 }).success).toBe(false);
    expect(platformSettingsSchema.safeParse({ nameEn: "" }).success).toBe(false);
  });

  it("locale settings: owner may choose the default language, but not an unservable site", () => {
    // the control that Appearance → System now exposes
    expect(localeSettingsSchema.safeParse({ default: "en", enabled: ["ar", "en"] }).success).toBe(true);
    expect(localeSettingsSchema.safeParse({ default: "ar", enabled: ["ar"] }).success).toBe(true);
    expect(localeSettingsSchema.safeParse({ default: "en", enabled: ["en"] }).success).toBe(true);

    // fail closed: a default the visitor can never be served, or no language at all
    expect(localeSettingsSchema.safeParse({ default: "en", enabled: ["ar"] }).success).toBe(false);
    expect(localeSettingsSchema.safeParse({ default: "ar", enabled: [] }).success).toBe(false);
    expect(localeSettingsSchema.safeParse({ default: "fr", enabled: ["ar", "en"] }).success).toBe(false);
    expect(localeSettingsSchema.safeParse({ enabled: ["fr"] }).success).toBe(false);
  });

  it("merging a partial patch over defaults keeps the rest", () => {
    const current = deviceSettingsSchema.parse({});
    const next = deviceSettingsSchema.parse({ ...current, maxPerStudent: 3 });
    expect(next.maxPerStudent).toBe(3);
    expect(next.onLimit).toBe("block");
  });
});
