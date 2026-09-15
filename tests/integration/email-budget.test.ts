/// <reference types="@cloudflare/vitest-plugin/types" />
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { claimTransactionalEmailBudget } from "~server/email/budget.server";

const db = getDb(env);
const DAY = 86_400_000;

async function clearBudget() {
  await db.run(`DELETE FROM rate_limit_counters WHERE bucket LIKE 'transactional-email-delivery:%'`);
}

beforeEach(clearBudget);
afterEach(clearBudget);

describe("transactional email rolling budget", () => {
  it("does not double the allowance across a fixed-day boundary", async () => {
    const now = 1_800_000_000_000;
    expect(await claimTransactionalEmailBudget(db, { now, limit: 3 })).toBe(true);
    expect(await claimTransactionalEmailBudget(db, { now, limit: 3 })).toBe(true);
    expect(await claimTransactionalEmailBudget(db, { now, limit: 3 })).toBe(true);
    expect(await claimTransactionalEmailBudget(db, { now, limit: 3 })).toBe(false);
    expect(await claimTransactionalEmailBudget(db, { now: now + DAY - 1, limit: 3 })).toBe(false);
    expect(await claimTransactionalEmailBudget(db, { now: now + DAY, limit: 3 })).toBe(true);
  });

  it("admits no more than the limit under concurrent claims", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        claimTransactionalEmailBudget(db, { now: 1_900_000_000_000, limit: 3 })
      )
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it("caps lower-priority welcome mail while preserving recovery slots", async () => {
    const now = 2_000_000_000_000;
    for (let i = 0; i < 2; i++) {
      expect(
        await claimTransactionalEmailBudget(db, {
          now: now + i,
          limit: 4,
          category: "welcome",
          categoryLimit: 2,
        })
      ).toBe(true);
    }
    expect(
      await claimTransactionalEmailBudget(db, {
        now: now + 3,
        limit: 4,
        category: "welcome",
        categoryLimit: 2,
      })
    ).toBe(false);
    expect(
      await claimTransactionalEmailBudget(db, {
        now: now + 4,
        limit: 4,
        category: "password_reset",
        categoryLimit: 4,
      })
    ).toBe(true);
    expect(
      await claimTransactionalEmailBudget(db, {
        now: now + 5,
        limit: 4,
        category: "password_reset",
        categoryLimit: 4,
      })
    ).toBe(true);
    expect(
      await claimTransactionalEmailBudget(db, {
        now: now + 6,
        limit: 4,
        category: "password_reset",
        categoryLimit: 4,
      })
    ).toBe(false);
  });
});
