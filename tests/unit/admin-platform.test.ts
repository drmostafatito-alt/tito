import { describe, expect, it } from "vitest";
import { parseRange, rangeSinceMs, RANGE_KEYS } from "~server/analytics/ranges";
import { fmtDuration } from "~/lib/format";
import { announcementInputSchema, isVisibleToRole } from "~server/announcements/service.server";
import { DASHBOARD_MODULE_IDS } from "~server/settings/schema";

/**
 * Phase 7 pure-logic units: analytics date windows, duration formatting,
 * announcement visibility rules (drafts/windows/audience) and input
 * validation. DB-backed behaviour lives in tests/integration/admin-platform.test.ts.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 5, 15, 30, 0); // 2026-09-05T15:30:00Z

describe("analytics ranges (P7 §4)", () => {
  it("covers exactly the four server-side windows", () => {
    expect([...RANGE_KEYS]).toEqual(["today", "7d", "30d", "all"]);
  });

  it("today starts at UTC midnight", () => {
    expect(rangeSinceMs("today", NOW)).toBe(NOW - ((NOW % DAY + 0) % DAY));
    expect(rangeSinceMs("today", NOW) % DAY).toBe(0);
  });

  it("7d/30d are exact rolling windows", () => {
    expect(rangeSinceMs("7d", NOW)).toBe(NOW - 7 * DAY);
    expect(rangeSinceMs("30d", NOW)).toBe(NOW - 30 * DAY);
  });

  it("all = 0 sentinel (callers skip the WHERE)", () => {
    expect(rangeSinceMs("all", NOW)).toBe(0);
  });

  it("parseRange defaults to 7d and never accepts junk", () => {
    expect(parseRange("today")).toBe("today");
    expect(parseRange("all")).toBe("all");
    expect(parseRange("99d")).toBe("7d");
    expect(parseRange(null)).toBe("7d");
    expect(parseRange(undefined)).toBe("7d");
    expect(parseRange("'; DROP TABLE events;--")).toBe("7d");
  });
});

describe("fmtDuration", () => {
  it("formats s/m/h buckets with latin digits", () => {
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(59)).toBe("59s");
    expect(fmtDuration(60)).toBe("1m 0s");
    expect(fmtDuration(125)).toBe("2m 5s");
    expect(fmtDuration(3600)).toBe("1h 0m");
    expect(fmtDuration(3661)).toBe("1h 1m");
    expect(fmtDuration(-5)).toBe("0s");
  });
});

describe("announcement visibility (FEATURE-SPEC §9 / P7 §12)", () => {
  const base = { status: "published", audience: "all", publishAt: null, expiresAt: null };

  it("drafts and archived are NEVER visible regardless of windows", () => {
    expect(isVisibleToRole("draft", "all", "student", null, null, NOW)).toBe(false);
    expect(isVisibleToRole("archived", "all", "student", null, null, NOW)).toBe(false);
    expect(isVisibleToRole("published", "all", "student", null, null, NOW)).toBe(true);
  });

  it("respects publish windows (scheduled start, expiry end)", () => {
    expect(isVisibleToRole(base.status, base.audience, "student", NOW + 1000, null, NOW)).toBe(false); // future
    expect(isVisibleToRole(base.status, base.audience, "student", NOW - 1000, null, NOW)).toBe(true); // started
    expect(isVisibleToRole(base.status, base.audience, "student", null, NOW - 1, NOW)).toBe(false); // expired
    expect(isVisibleToRole(base.status, base.audience, "student", null, NOW + DAY, NOW)).toBe(true); // open
    expect(isVisibleToRole(base.status, base.audience, "student", null, NOW, NOW)).toBe(false); // boundary: expires_at <= now is hidden
  });

  it("matches audiences by role — admins only ever match 'all'", () => {
    expect(isVisibleToRole("published", "students", "student", null, null, NOW)).toBe(true);
    expect(isVisibleToRole("published", "students", "teacher", null, null, NOW)).toBe(false);
    expect(isVisibleToRole("published", "students", "admin", null, null, NOW)).toBe(false);
    expect(isVisibleToRole("published", "teachers", "teacher", null, null, NOW)).toBe(true);
    expect(isVisibleToRole("published", "teachers", "student", null, null, NOW)).toBe(false);
    expect(isVisibleToRole("published", "all", "super_admin", null, null, NOW)).toBe(true);
  });
});

describe("announcementInputSchema", () => {
  const valid = { titleAr: "عنوان", titleEn: "Title", bodyAr: "", bodyEn: "", audience: "all", publishAt: null, expiresAt: null };

  it("accepts a minimal valid input", () => {
    expect(announcementInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty/oversized titles and oversized bodies", () => {
    expect(announcementInputSchema.safeParse({ ...valid, titleEn: "  " }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ ...valid, titleAr: "x".repeat(201) }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ ...valid, bodyEn: "x".repeat(5001) }).success).toBe(false);
  });

  it("rejects expiry at/before scheduled publish", () => {
    expect(announcementInputSchema.safeParse({ ...valid, publishAt: 2000, expiresAt: 1000 }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ ...valid, publishAt: 1000, expiresAt: 1000 }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ ...valid, publishAt: 1000, expiresAt: 2000 }).success).toBe(true);
  });

  it("rejects unknown audiences", () => {
    expect(announcementInputSchema.safeParse({ ...valid, audience: "parents" }).success).toBe(false);
  });
});

describe("dashboard module registry (P7 additive)", () => {
  it("keeps the Phase-4 ids and adds the Phase-7 ones", () => {
    expect(DASHBOARD_MODULE_IDS).toContain("my_courses");
    expect(DASHBOARD_MODULE_IDS).toContain("announcements");
    expect(DASHBOARD_MODULE_IDS).toContain("expiry");
  });
});
