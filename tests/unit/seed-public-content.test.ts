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
  const preset = JSON.parse(presetRaw) as {
    sections: Array<{
      children?: Array<{ type: string; props: { items?: Array<{ title?: { ar?: string }; href?: string }> } }>;
    }>;
  };
  const blocks = preset.sections.flatMap((sec) => sec.children ?? []);
  const types = blocks.map((b) => b.type);

  it("enters exams through the data-driven exam_platform block, never a fake link", () => {
    // v2 dropped `exam:external` from the preset: a hard-coded external exam
    // destination would send students somewhere the owner never configured.
    // The exam entry is now ONE block that renders only while the Questions
    // Platform URL is set (server/cms/render.server.ts), and disappears with it.
    expect(types).toContain("exam_platform");
    expect(presetRaw).not.toContain("exam:external");
    // A bare "#exams" would be a dead anchor whenever the exams section collapses.
    expect(presetRaw).not.toContain('"#exams"');
  });

  it("ships exactly one subject-discovery experience", () => {
    expect(types.filter((t) => t === "study_subjects")).toHaveLength(1);
    // …and no legacy catalog/grade shelves next to it (they would duplicate it).
    expect(types).not.toContain("course_cards");
    expect(types).not.toContain("grade_cards");
  });

  it("sends every journey step to a real destination and never to /courses", () => {
    const steps = blocks.filter((b) => b.type === "journey_steps").flatMap((b) => b.props?.items ?? []);
    expect(steps.length).toBeGreaterThan(0);
    const hrefs = steps.map((st) => st.href ?? "");
    // The public journey is السنة → الصف → المادة → الترم → الدرس and it starts at
    // /study; the legacy catalog stays reachable by URL/SEO, never as a CTA.
    expect(hrefs.filter((h) => h === "/courses")).toHaveLength(0);
    for (const h of hrefs) {
      expect(h === "" || h.startsWith("/")).toBe(true);
    }
  });
});
