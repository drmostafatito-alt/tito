import { describe, expect, it } from "vitest";
import {
  collectItemKinds,
  familyForSubject,
  hashKey,
  heroFrameThinkers,
  sectionBackdropThinker,
  thinkerAlternate,
  thinkerById,
  thinkerFor,
  THINKERS,
} from "~/lib/thinkers";

describe("thinker visual assignment", () => {
  it("classifies philosophy vs psychology from real titles, never by a hardcoded slug list", () => {
    expect(familyForSubject({ slug: "falsafa-manteq", titleAr: "فلسفة ومنطق", titleEn: "Philosophy & Logic" })).toBe("classical");
    expect(familyForSubject({ slug: "psychology-bac", titleAr: "علم النفس", titleEn: "Psychology" })).toBe("psych");
    expect(familyForSubject({ slug: "new-subject", titleAr: "مادة جديدة", titleEn: "A new subject" })).toBe("modern");
  });

  it("is stable across SSR/client for the same subject", () => {
    const a = thinkerFor({ slot: "subject-hero", slug: "falsafa-manteq", titleAr: "فلسفة ومنطق", titleEn: "Philosophy" });
    const b = thinkerFor({ slot: "subject-hero", slug: "falsafa-manteq", titleAr: "فلسفة ومنطق", titleEn: "Philosophy" });
    expect(a?.id).toBe(b?.id);
    expect(hashKey("x")).toBe(hashKey("x"));
  });

  it("does not put a portrait on skipped slots (elegant sparsity)", () => {
    expect(thinkerFor({ slot: "subject-card", slug: "x", skip: true })).toBeNull();
  });

  it("philosophy landing uses Aristotle; locked uses Ibn Rushd", () => {
    expect(thinkerFor({ slot: "landing-hero", slug: "falsafa", titleEn: "Philosophy" })?.id).toBe("aristotle");
    expect(thinkerFor({ slot: "lesson-locked", slug: "falsafa", titleEn: "Philosophy" })?.id).toBe("ibn-rushd");
    expect(thinkerById("socrates")?.src).toMatch(/socrates\.webp$/);
  });

  it("psychology subjects use Freud/Jung portraits as background layers", () => {
    expect(thinkerFor({ slot: "subject-card", slug: "psychology", titleAr: "علم النفس", titleEn: "Psychology" })?.id).toBe("freud");
    expect(thinkerFor({ slot: "subject-hero", slug: "psychology", titleAr: "علم النفس", titleEn: "Psychology" })?.id).toBe("jung");
    expect(thinkerById("freud")?.src).toMatch(/freud\.webp$/);
    expect(thinkerById("jung")?.src).toMatch(/jung\.webp$/);
  });

  it("two cards of the same family can take different faces", () => {
    const primary = thinkerFor({ slot: "subject-card", slug: "falsafa", titleEn: "Philosophy" });
    const alt = thinkerAlternate(primary, "other-card");
    expect(alt).toBeTruthy();
    expect(alt?.id).not.toBe(primary?.id);
  });
});

describe("lesson item kinds (real types only)", () => {
  it("maps video/file/pdf/quiz and drops legacy exams", () => {
    expect(
      collectItemKinds([
        { itemType: "video" },
        { itemType: "file", fileKind: "pdf" },
        { itemType: "file", fileKind: "doc" },
        { itemType: "link" },
        { itemType: "exam" },
      ])
    ).toEqual(["video", "pdf", "file", "quiz"]);
  });

  it("returns an empty list when the lesson has no items", () => {
    expect(collectItemKinds([])).toEqual([]);
  });
});

describe("section backdrop assignment (transparent cartoon wash)", () => {
  it("is deterministic per seed and skips the avoided face", () => {
    const a = sectionBackdropThinker("section:abc");
    const b = sectionBackdropThinker("section:abc");
    expect(a).not.toBeNull();
    expect(a?.id).toBe(b?.id);
    expect(sectionBackdropThinker("section:abc", a?.id ?? null)?.id).not.toBe(a?.id);
  });

  it("spreads across the catalog so adjacent sections differ", () => {
    const ids = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((s) => sectionBackdropThinker(s)?.id);
    expect(new Set(ids).size).toBeGreaterThan(3);
  });

  it("frames the hero with two distinct philosophers, never the subject card's Aristotle", () => {
    const [start, end] = heroFrameThinkers();
    expect(start?.id).toBe("ibn-rushd");
    expect(end?.id).toBe("plato");
  });

  it("ships a phone rendition next to every desktop asset", () => {
    for (const t of THINKERS) {
      expect(t.srcSmall).toMatch(new RegExp(`/${t.id}-sm\\.webp$`));
    }
  });
});
