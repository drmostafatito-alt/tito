import { describe, expect, it } from "vitest";
import {
  deviceSettingsSchema,
  localeSettingsSchema,
  platformSettingsSchema,
  securitySettingsSchema,
} from "~server/settings/schema";

describe("settings schemas (ADR-012)", () => {
  it("defaults parse from an empty document", () => {
    const platform = platformSettingsSchema.parse({});
    expect(platform.maintenance).toBe(false);
    expect(platform.nameEn).toBe("EduCore");

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

  it("rejects invalid values (fail closed on write)", () => {
    expect(deviceSettingsSchema.safeParse({ maxPerStudent: 0 }).success).toBe(false);
    expect(deviceSettingsSchema.safeParse({ maxPerStudent: 99 }).success).toBe(false);
    expect(deviceSettingsSchema.safeParse({ onLimit: "evict-everyone" }).success).toBe(false);
    expect(securitySettingsSchema.safeParse({ sessionDays: 0 }).success).toBe(false);
    expect(platformSettingsSchema.safeParse({ nameEn: "" }).success).toBe(false);
  });

  it("merging a partial patch over defaults keeps the rest", () => {
    const current = deviceSettingsSchema.parse({});
    const next = deviceSettingsSchema.parse({ ...current, maxPerStudent: 3 });
    expect(next.maxPerStudent).toBe(3);
    expect(next.onLimit).toBe("block");
  });
});
