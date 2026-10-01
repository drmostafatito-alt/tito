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
    // hero → grades → videos → features → about → contact → cta
    //
    // `quote_cards` (the mockup's "أقوال مأثورة" band) is deliberately NOT in
    // the recommended preset: the owner confirmed the quotes band is not part
    // of the current homepage composition. The block itself stays registered
    // and fully rendered — `.mk .quotes/.qgrid/.q/.qfig` in app.css and the
    // `quote_cards` renderer in blocks.tsx are live for any page the owner
    // adds it to — it is just not seeded on the homepage.
    expect(types).toEqual([
      "hero_showcase",
      "grade_cards",
      "video_showcase",
      "feature_cards",
      "teacher_profile",
      "social_links",
      "cta_banner",
    ]);
  });

  it("never hardcodes the question-platform URL — it comes from settings", () => {
    // The preset must not contain a hardcoded exams URL. `exam:external` is
    // allowed: it is a stored placeholder that resolveCmsHref replaces with
    // the admin-configured questionPlatformUrl at render time (or renders no
    // link while unconfigured) — the URL lives in settings only.
    expect(presetRaw).not.toMatch(/https?:\/\/[^\s"]*exam/i);
  });

  it("sends CTAs to real destinations, never to /courses", () => {
    // The legacy catalog stays reachable by URL/SEO, never as a CTA.
    expect(presetRaw).not.toContain('"/courses"');
  });

  it("invents no engagement metrics in the video fallback", () => {
    // The static `videos` prop is the CMS fallback shown only until real video
    // rows exist. It must never ship fabricated social proof: view counts,
    // relative timestamps or runtimes that no row backs. Real rows supply
    // `meta`/`duration` from the database (see blocks.tsx video_showcase).
    const showcase = blocks.find((b) => b.type === "video_showcase");
    expect(showcase).toBeDefined();
    const videos = (showcase!.props.videos ?? []) as Array<Record<string, { ar?: string; en?: string } | string>>;
    expect(videos.length).toBeGreaterThan(0);
    for (const v of videos) {
      const meta = (v.meta ?? {}) as { ar?: string; en?: string };
      expect(meta.ar ?? "").toBe("");
      expect(meta.en ?? "").toBe("");
      expect(v.duration ?? "").toBe("");
    }
  });

  it("states no fabricated counts anywhere in the preset", () => {
    // Guards the whole document, not just the block above: "12.4K مشاهدة",
    // "9.1K views • 5 days ago", "منذ أسبوع", "24:15" …
    expect(presetRaw).not.toMatch(/\d+(\.\d+)?\s*K\b/);
    expect(presetRaw).not.toMatch(/\bviews\b/i);
    expect(presetRaw).not.toMatch(/مشاهدة\s*•/);
    expect(presetRaw).not.toMatch(/\bago\b/i);
    expect(presetRaw).not.toMatch(/"\d{1,2}:\d{2}"/);
  });

  it("keeps every marketing string CMS-editable (no empty required copy)", () => {
    const hero = blocks.find((b) => b.type === "hero_showcase");
    expect(hero).toBeDefined();
    const props = hero!.props as Record<string, { ar?: string }>;
    expect(props.heading?.ar).toBeTruthy();
    expect(props.docLine?.ar).toBeTruthy();
  });
});
