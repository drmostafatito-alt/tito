import { describe, expect, it } from "vitest";
import {
  AssessmentValidationError,
  choiceSeed,
  parseExamConfig,
  seededShuffle,
} from "~server/assessment/service.server";

/**
 * Phase 5 pure-function units: the FEATURE-SPEC §6 config contract and the
 * seeded randomization primitives (stable per attempt — the same seed must
 * always reproduce the same question/choice order).
 */

describe("parseExamConfig (FEATURE-SPEC §6 contract)", () => {
  it("applies documented defaults to an empty object", () => {
    const cfg = parseExamConfig({});
    expect(cfg.duration_minutes).toBe(30);
    expect(cfg.availability).toEqual({ starts_at: null, ends_at: null });
    expect(cfg.selection.mode).toBe("manual");
    expect(cfg.selection.pools).toEqual([]);
    expect(cfg.selection.max_questions).toBeNull();
    expect(cfg.selection.randomize_questions).toBe(false);
    expect(cfg.selection.randomize_choices).toBe(false);
    expect(cfg.attempts.max).toBe(1);
    expect(cfg.attempts.cooldown_minutes).toBe(0);
    expect(cfg.scoring.pass_percent).toBe(50);
    expect(cfg.scoring.partial_credit_multiselect).toBe(true);
    expect(cfg.results.show).toBe("immediate");
    expect(cfg.results.show_answers).toBe(true);
    expect(cfg.results.show_explanations).toBe(false);
    expect(cfg.results.review_mode).toBe(true);
  });

  it("accepts nulls for unlimited duration / unlimited attempts", () => {
    const cfg = parseExamConfig({ duration_minutes: null, attempts: { max: null } });
    expect(cfg.duration_minutes).toBeNull();
    expect(cfg.attempts.max).toBeNull();
    // sibling keys still default (prefault on the group)
    expect(cfg.attempts.cooldown_minutes).toBe(0);
  });

  it("keeps partial nested overrides without dropping sibling defaults", () => {
    const cfg = parseExamConfig({ scoring: { pass_percent: 70 } });
    expect(cfg.scoring.pass_percent).toBe(70);
    expect(cfg.scoring.partial_credit_multiselect).toBe(true);
  });

  it("rejects out-of-contract values with structured issues", () => {
    const bad = [
      { duration_minutes: 0 },
      { duration_minutes: 601 },
      { scoring: { pass_percent: 101 } },
      { attempts: { max: 0 } },
      { attempts: { cooldown_minutes: -1 } },
      { results: { show: "whenever" } },
      { selection: { pools: [{ count: 0 }] } },
    ];
    for (const input of bad) {
      expect(() => parseExamConfig(input)).toThrow(AssessmentValidationError);
    }
    try {
      parseExamConfig({ duration_minutes: 0 });
    } catch (e) {
      expect((e as AssessmentValidationError).issues.length).toBeGreaterThan(0);
      expect((e as AssessmentValidationError).issues[0]).toHaveProperty("path");
    }
  });

  it("treats null/undefined input as an empty config", () => {
    expect(parseExamConfig(null).duration_minutes).toBe(30);
    expect(parseExamConfig(undefined).duration_minutes).toBe(30);
  });
});

describe("seededShuffle (mulberry32)", () => {
  const items = Array.from({ length: 26 }, (_, i) => `q${i}`);

  it("is deterministic for the same seed", () => {
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
  });

  it("preserves all elements (permutation, no loss/dupes)", () => {
    const out = seededShuffle(items, 7);
    expect([...out].sort()).toEqual([...items].sort());
    expect(out).toHaveLength(items.length);
  });

  it("does not mutate the input array", () => {
    const input = [...items];
    seededShuffle(input, 99);
    expect(input).toEqual(items);
  });

  it("produces different orders for different seeds", () => {
    expect(seededShuffle(items, 1)).not.toEqual(seededShuffle(items, 2));
  });

  it("handles empty and single-element arrays", () => {
    expect(seededShuffle([], 5)).toEqual([]);
    expect(seededShuffle(["x"], 5)).toEqual(["x"]);
  });
});

describe("choiceSeed", () => {
  it("is stable for the same (seed, questionId)", () => {
    expect(choiceSeed(123, "q-a")).toBe(choiceSeed(123, "q-a"));
  });

  it("differs across question ids and attempt seeds", () => {
    expect(choiceSeed(123, "q-a")).not.toBe(choiceSeed(123, "q-b"));
    expect(choiceSeed(123, "q-a")).not.toBe(choiceSeed(456, "q-a"));
  });

  it("returns a 32-bit unsigned integer", () => {
    const s = choiceSeed(987654321, "some-question-id");
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});
