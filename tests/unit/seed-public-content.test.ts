import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Public-content guards for the LOCAL seed and the recommended homepage preset.
 *
 * The seed is the only thing that can put rows in front of a visitor before the
 * owner publishes anything, and the preset is what a fresh install applies — so
 * both are pinned here:
 *
 *  - the physics demo/fixture catalog must be OPT-IN (`--with-demo`), because the
 *    homepage's data-driven blocks and the public catalog/discovery read
 *    PUBLISHED rows and would otherwise surface demo courses, videos and a
 *    300 EGP product under this platform's philosophy & psychology identity;
 *  - no fake payment destination may be seeded: bank/InstaPay details are owner
 *    data configured in Appearance → System → Payments, never invented here.
 */

const seedSrc = readFileSync(new URL("../../scripts/seed.mjs", import.meta.url), "utf8");
const presetRaw = readFileSync(new URL("../../server/cms/home-preset.json", import.meta.url), "utf8");

describe("seed — demo/fixture catalog is opt-in", () => {
  it("declares the --with-demo gate", () => {
    expect(seedSrc).toContain('const WITH_DEMO = process.argv.includes("--with-demo");');
  });

  it("creates every physics fixture only inside the gated region", () => {
    const gate = seedSrc.indexOf("if (WITH_DEMO) {");
    expect(gate).toBeGreaterThan(-1);

    // Look at the ensureContent() CREATION calls, not at prose in comments.
    const calls = new Map<string, number>();
    for (const m of seedSrc.matchAll(/ensureContent\(\s*"[a-z_]+"\s*,\s*"([^"]+)"/g)) {
      calls.set(m[1], m.index ?? -1);
    }
    const fixtures = ["physics-3s", "physics-3s-full", "study-skills", "physics-3s-full-access", "electrostatics-intro", "coulomb-law"];
    for (const slug of fixtures) {
      const at = calls.get(slug);
      expect(at, `expected an ensureContent() call for ${slug}`).toBeTypeOf("number");
      expect(at as number, `expected ${slug} to be created after the --with-demo gate`).toBeGreaterThan(gate);
    }
  });

  it("keeps the demo catalog reachable for the browser suites", () => {
    // scripts/e2e-reset.mjs opts in explicitly, so the e2e fixtures survive.
    const resetSrc = readFileSync(new URL("../../scripts/e2e-reset.mjs", import.meta.url), "utf8");
    expect(resetSrc).toContain("--with-demo");
  });
});

describe("seed — student navigation default", () => {
  it("defaults the header entry to learning content, not courses", () => {
    expect(seedSrc).toContain('["المحتوى التعليمي", "Learning", "/study"]');
    expect(seedSrc).not.toMatch(/\["الكورسات", "Courses", "\/courses"\]/);
  });
});

describe("seed — no fabricated payment destination", () => {
  it("does not contain the placeholder InstaPay number", () => {
    expect(seedSrc).not.toContain("01000000000");
  });

  it("seeds empty manual payment instructions (owner fills them in the admin)", () => {
    expect(seedSrc).toMatch(/manualInstructionsAr:\s*"",/);
    expect(seedSrc).toMatch(/manualInstructionsEn:\s*"",/);
  });
});

describe("recommended homepage preset — no dead destinations", () => {
  it("points exam destinations at the resolved Questions Platform, not at a fragment", () => {
    expect(presetRaw).toContain("exam:external");
    // A bare "#exams" would be a dead anchor whenever the exams section collapses.
    expect(presetRaw).not.toContain('"#exams"');
  });

  it("no longer sends five different journey steps to the course catalog", () => {
    const preset = JSON.parse(presetRaw) as {
      sections: Array<{ children?: Array<{ type: string; props: { items?: Array<{ title?: { ar?: string }; href?: string }> } }> }>;
    };
    const steps = preset.sections
      .flatMap((s) => s.children ?? [])
      .filter((c) => c.type === "journey_steps")
      .flatMap((c) => c.props.items ?? []);

    expect(steps.length).toBeGreaterThan(0);
    const hrefs = steps.map((s) => s.href ?? "");
    // Each step must have its own destination: at most the two steps that are
    // genuinely the catalog ("ابدأ الشرح") may repeat /courses.
    expect(hrefs.filter((h) => h === "/courses").length).toBeLessThanOrEqual(1);
    // Real in-page anchors and real routes only — no 404s, no invented pages.
    for (const h of hrefs) {
      expect(h === "" || h.startsWith("/") || h === "#videos" || h === "#books" || h === "exam:external").toBe(true);
    }
  });
});
