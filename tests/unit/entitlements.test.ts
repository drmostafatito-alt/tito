import { describe, expect, it } from "vitest";
import { resolveAccess, type EntitlementLike } from "~server/entitlements/resolver.server";

/**
 * The authorization matrix (TEST-PLAN §3). Access decisions are the crown jewels —
 * every new access source extends this matrix FIRST (test-first rule).
 */
const NOW = 1_700_000_000_000;

const anon = { userId: null, roleRank: 0 };
const student = { userId: "u1", roleRank: 1 };
const teacher = { userId: "u2", roleRank: 2 };
const admin = { userId: "u3", roleRank: 3 };

const published = { accessLevel: "entitled" as const, status: "published" };
const chain = [
  { type: "lesson" as const, id: "l1" },
  { type: "unit" as const, id: "un1" },
  { type: "course" as const, id: "c1" },
  { type: "subject" as const, id: "s1" },
];

const ent = (over: Partial<EntitlementLike>): EntitlementLike => ({
  resourceType: "course",
  resourceId: "c1",
  status: "active",
  expiresAt: null,
  ...over,
});

describe("content lifecycle gates everything", () => {
  it("draft content is hidden even from admins", () => {
    expect(resolveAccess({ subject: admin, resource: { ...published, status: "draft" }, chain, entitlements: [], now: NOW }))
      .toEqual({ allowed: false, reason: "not_published" });
  });

  it("scheduled content is hidden before publish time", () => {
    expect(resolveAccess({ subject: student, resource: { ...published, publishAt: NOW + 1_000 }, chain, entitlements: [ent({})], now: NOW }))
      .toEqual({ allowed: false, reason: "scheduled" });
  });

  it("expired content is closed", () => {
    expect(resolveAccess({ subject: student, resource: { ...published, expiresAt: NOW - 1 }, chain, entitlements: [ent({})], now: NOW }))
      .toEqual({ allowed: false, reason: "content_expired" });
  });
});

describe("access levels", () => {
  it("public → anon allowed", () => {
    expect(resolveAccess({ subject: anon, resource: { ...published, accessLevel: "public" }, chain, entitlements: [], now: NOW }))
      .toEqual({ allowed: true, reason: "public" });
  });

  it("authenticated → anon denied, student allowed", () => {
    const resource = { ...published, accessLevel: "authenticated" as const };
    expect(resolveAccess({ subject: anon, resource, chain, entitlements: [], now: NOW }))
      .toEqual({ allowed: false, reason: "anon" });
    expect(resolveAccess({ subject: student, resource, chain, entitlements: [], now: NOW }))
      .toEqual({ allowed: true, reason: "authenticated" });
  });

  it("entitled → teacher (no entitlement) denied, admin allowed", () => {
    expect(resolveAccess({ subject: teacher, resource: published, chain, entitlements: [], now: NOW }))
      .toEqual({ allowed: false, reason: "no_entitlement" });
    expect(resolveAccess({ subject: admin, resource: published, chain, entitlements: [], now: NOW }))
      .toEqual({ allowed: true, reason: "admin" });
  });
});

describe("entitlement matching", () => {
  it("direct lesson entitlement", () => {
    expect(resolveAccess({ subject: student, resource: published, chain, entitlements: [ent({ resourceType: "lesson", resourceId: "l1" })], now: NOW }))
      .toEqual({ allowed: true, reason: "entitlement" });
  });

  it("ancestor subject entitlement covers nested lesson", () => {
    expect(resolveAccess({ subject: student, resource: published, chain, entitlements: [ent({ resourceType: "subject", resourceId: "s1" })], now: NOW }))
      .toEqual({ allowed: true, reason: "entitlement" });
  });

  it("entitlement on an unrelated resource does not cover", () => {
    expect(resolveAccess({ subject: student, resource: published, chain, entitlements: [ent({ resourceType: "course", resourceId: "other" })], now: NOW }))
      .toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("expired entitlement does not cover", () => {
    expect(resolveAccess({ subject: student, resource: published, chain, entitlements: [ent({ expiresAt: NOW - 1 })], now: NOW }))
      .toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("expires exactly now → denied (boundary is exclusive)", () => {
    expect(resolveAccess({ subject: student, resource: published, chain, entitlements: [ent({ expiresAt: NOW })], now: NOW }))
      .toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("revoked entitlement does not cover", () => {
    expect(resolveAccess({ subject: student, resource: published, chain, entitlements: [ent({ status: "revoked" })], now: NOW }))
      .toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("permanent entitlement (null expiry) covers", () => {
    expect(resolveAccess({ subject: student, resource: published, chain, entitlements: [ent({ expiresAt: null })], now: NOW }))
      .toEqual({ allowed: true, reason: "entitlement" });
  });
});

describe("free preview", () => {
  it("logged-in user can preview an entitled lesson flagged free", () => {
    expect(resolveAccess({ subject: student, resource: { ...published, freePreview: true }, chain, entitlements: [], now: NOW }))
      .toEqual({ allowed: true, reason: "free_preview" });
  });

  it("anon cannot use free preview", () => {
    expect(resolveAccess({ subject: anon, resource: { ...published, freePreview: true }, chain, entitlements: [], now: NOW }))
      .toEqual({ allowed: false, reason: "anon" });
  });
});
