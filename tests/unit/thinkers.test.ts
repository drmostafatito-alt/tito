import { describe, expect, it } from "vitest";
import {
  collectItemKinds,
  familyForSubject,
  hashKey,
  thinkerAlternate,
  thinkerById,
  thinkerFor,
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
