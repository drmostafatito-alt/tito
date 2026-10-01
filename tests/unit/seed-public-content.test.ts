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

describe("recommended homepage preset — mockup v5 composition", () => {
  const preset = JSON.parse(presetRaw) as {
    sections: Array<{
      children?: Array<{ type: string; props: Record<string, unknown> }>;
    }>;
  };
  const blocks = preset.sections.flatMap((sec) => sec.children ?? []);
  const types = blocks.map((b) => b.type);

  it("follows the mockup section order", () => {
    // hero → grades → videos → features → about → contact → quotes → cta
    expect(types).toEqual([
      "hero_showcase",
      "grade_cards",
      "video_showcase",
      "feature_cards",
      "teacher_profile",
      "social_links",
      "quote_cards",
      "cta_banner",
    ]);
  });

  it("never hardcodes the question-platform URL — it comes from settings", () => {
    // The preset must not contain exam:external or a hardcoded exams URL.
    // The question-platform entry is resolved from settings at render time.
    expect(presetRaw).not.toContain("exam:external");
  });

  it("sends CTAs to real destinations, never to /courses", () => {
    // The legacy catalog stays reachable by URL/SEO, never as a CTA.
    expect(presetRaw).not.toContain('"/courses"');
  });

  it("keeps every marketing string CMS-editable (no empty required copy)", () => {
    const hero = blocks.find((b) => b.type === "hero_showcase");
    expect(hero).toBeDefined();
    const props = hero!.props as Record<string, { ar?: string }>;
    expect(props.heading?.ar).toBeTruthy();
    expect(props.docLine?.ar).toBeTruthy();
  });
});
