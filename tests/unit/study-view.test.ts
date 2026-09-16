import { describe, expect, it } from "vitest";
import { LESSON_CONTENT_KINDS } from "~server/content/service.server";
import {
  countLabel,
  contentKindIcon,
  groupSubjectsByGrade,
  groupTermLessons,
  lessonNumber,
  shouldShowUnitHeadings,
  STUDY_CONTENT_KIND_ORDER,
  studyLessonBadgeKey,
  studyLessonBadgeTone,
  studyLessonCtaKey,
  studyLessonState,
  studyLockedSecondaryCtaKey,
  summarizeTermStates,
  termCompletion,
  toStudyContentKinds,
  type StudyLessonState,
} from "~/lib/study-view";

/**
 * Student content experience (PART 4–10) — the pure view model that turns the
 * SERVER's access verdict into the exact state / badge / CTA a lesson shows.
 * These are the rules the listing must never violate:
 *   - paid content is LISTED, never hidden;
 *   - an anonymous visitor is sent to sign-in for free content, and to the
 *     subscription path for paid content;
 *   - scheduled/expired content offers no purchase CTA at all;
 *   - the material vocabulary mirrors the server's kinds exactly.
 */

describe("content kind vocabulary", () => {
  it("mirrors the server's LESSON_CONTENT_KINDS exactly (order included)", () => {
    expect([...STUDY_CONTENT_KIND_ORDER]).toEqual([...LESSON_CONTENT_KINDS]);
  });

  it("drops unknown kinds instead of rendering them raw", () => {
    expect(toStudyContentKinds(["video", "exam", "pdf", ""])).toEqual(["video", "pdf"]);
    expect(toStudyContentKinds(null)).toEqual([]);
    expect(toStudyContentKinds(undefined)).toEqual([]);
  });

  it("maps every kind to a controlled icon id", () => {
    for (const kind of STUDY_CONTENT_KIND_ORDER) {
      expect(contentKindIcon(kind)).toMatch(/^[a-z-]+$/);
    }
  });
});

describe("lesson state (server verdict → student-facing state)", () => {
  const base = { accessLevel: "authenticated" as const, freePreview: false, signedIn: true };

  it("allowed content is open regardless of level", () => {
    expect(studyLessonState({ ...base, allowed: true, reason: "entitlement" })).toBe("open");
    expect(studyLessonState({ ...base, allowed: true, reason: "public", accessLevel: "public" })).toBe("open");
  });

  it("free content asks an anonymous visitor to sign in (existing auth architecture)", () => {
    expect(studyLessonState({ ...base, signedIn: false, allowed: false, reason: "anon" })).toBe("sign_in_required");
    expect(studyLessonState({ ...base, allowed: false, reason: "anon", accessLevel: "public" })).toBe("sign_in_required");
  });

  it("paid content without a grant is locked — and is never hidden", () => {
    expect(
      studyLessonState({ allowed: false, reason: "no_entitlement", accessLevel: "entitled", freePreview: false, signedIn: true })
    ).toBe("locked");
    expect(
      studyLessonState({ allowed: false, reason: "anon", accessLevel: "entitled", freePreview: false, signedIn: false })
    ).toBe("locked");
    expect(
      studyLessonState({ allowed: false, reason: "entitlement_inactive", accessLevel: "entitled", freePreview: false, signedIn: true })
    ).toBe("locked");
  });

  it("a free-preview lesson on the paid level is free, not locked (matches the resolver)", () => {
    expect(
      studyLessonState({ allowed: false, reason: "anon", accessLevel: "entitled", freePreview: true, signedIn: false })
    ).toBe("sign_in_required");
  });

  it("scheduled and expired content never looks purchasable", () => {
    expect(studyLessonState({ ...base, allowed: false, reason: "scheduled" })).toBe("scheduled");
    expect(studyLessonState({ ...base, allowed: false, reason: "content_expired" })).toBe("unavailable");
    expect(studyLessonState({ ...base, allowed: false, reason: "not_published" })).toBe("unavailable");
  });
});

describe("CTAs", () => {
  it("open lessons get start / continue / review", () => {
    expect(studyLessonCtaKey("open", { hasOffer: false, progress: null })).toBe("study.ctaStart");
    expect(studyLessonCtaKey("open", { hasOffer: false, progress: { status: "in_progress" } })).toBe("study.ctaResume");
    expect(studyLessonCtaKey("open", { hasOffer: false, progress: { status: "completed" } })).toBe("study.ctaReview");
  });

  it("locked lessons route to the real offer when one exists, else to activation", () => {
    expect(studyLessonCtaKey("locked", { hasOffer: true, progress: null })).toBe("content.lockedSubscribe");
    expect(studyLessonCtaKey("locked", { hasOffer: false, progress: null })).toBe("content.lockedActivate");
    // the activation path is a SECONDARY CTA only when the primary is a purchase
    expect(studyLockedSecondaryCtaKey("locked")).toBe("content.lockedActivate");
    expect(studyLockedSecondaryCtaKey("open")).toBeNull();
  });

  it("sign-in and unavailable states follow the existing flows", () => {
    expect(studyLessonCtaKey("sign_in_required", { hasOffer: false, progress: null })).toBe("study.ctaSignIn");
    expect(studyLessonCtaKey("scheduled", { hasOffer: true, progress: null })).toBeNull();
    expect(studyLessonCtaKey("unavailable", { hasOffer: true, progress: null })).toBeNull();
  });
});

describe("badges", () => {
  it("labels access and progress without contradicting each other", () => {
    expect(studyLessonBadgeKey("sign_in_required", "authenticated", null)).toBe("study.freeBadge");
    expect(studyLessonBadgeKey("locked", "entitled", null)).toBe("study.paidBadge");
    expect(studyLessonBadgeKey("scheduled", "entitled", null)).toBe("study.soonBadge");
    expect(studyLessonBadgeKey("unavailable", "entitled", null)).toBe("study.unavailableBadge");
    expect(studyLessonBadgeKey("open", "authenticated", { status: "completed" })).toBe("progress.completed");
    expect(studyLessonBadgeKey("open", "authenticated", { status: "in_progress" })).toBe("progress.inProgress");
    // an open paid lesson with no progress carries no access badge (it is simply open)
    expect(studyLessonBadgeKey("open", "entitled", null)).toBeNull();
    expect(studyLessonBadgeKey("open", "public", null)).toBe("study.freeBadge");
  });

  it("tones: locked is a warning, completed is success", () => {
    expect(studyLessonBadgeTone("locked", null)).toBe("warning");
    expect(studyLessonBadgeTone("open", { status: "completed" })).toBe("success");
    expect(studyLessonBadgeTone("scheduled", null)).toBe("neutral");
  });
});

describe("term grouping + numbering", () => {
  const lesson = (id: string, unitId: string, unitTitleAr = "الدروس") => ({
    id,
    unitId,
    unitTitleAr,
    unitTitleEn: "Lessons",
  });

  it("numbers lessons across the whole term (01, 02, 03 …), not per unit", () => {
    const groups = groupTermLessons([lesson("a", "u1"), lesson("b", "u2"), lesson("c", "u1")]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lessons.map((l) => l.position)).toEqual([1, 3]);
    expect(groups[1].lessons.map((l) => l.position)).toEqual([2]);
    expect(lessonNumber(1)).toBe("01");
    expect(lessonNumber(11)).toBe("11");
  });

  it("hides unit headings for the automatic single grouping, shows real ones", () => {
    const flat = groupTermLessons([lesson("a", "u1")]);
    expect(shouldShowUnitHeadings(flat, "ar", ["الدروس", "Lessons"])).toBe(false);
    expect(shouldShowUnitHeadings(flat, "en", ["الدروس", "Lessons"])).toBe(false);

    const named = groupTermLessons([lesson("a", "u1", "الوحدة الأولى")]);
    expect(shouldShowUnitHeadings(named, "ar", ["الدروس", "Lessons"])).toBe(true);

    const twoUnits = groupTermLessons([lesson("a", "u1"), lesson("b", "u2")]);
    expect(shouldShowUnitHeadings(twoUnits, "ar", ["الدروس", "Lessons"])).toBe(true);
  });

  it("summarizes term states and measures completion over OPENABLE lessons only", () => {
    const states: StudyLessonState[] = ["open", "open", "locked", "sign_in_required", "scheduled", "unavailable"];
    expect(summarizeTermStates(states)).toEqual({ total: 6, open: 2, locked: 1, signIn: 1, soon: 1, unavailable: 1 });

    const done = termCompletion([
      { state: "open", progress: { status: "completed" } },
      { state: "open", progress: { status: "in_progress" } },
      { state: "locked", progress: null },
    ]);
    expect(done).toEqual({ completed: 1, openable: 2, pct: 50 });
    expect(termCompletion([{ state: "locked", progress: null }])).toEqual({ completed: 0, openable: 0, pct: 0 });
  });
});

describe("hub grouping + counts", () => {
  const subject = (slug: string, gradeSlug: string, gradeTitleAr: string) => ({
    slug,
    gradeSlug,
    gradeTitleAr,
    gradeTitleEn: gradeSlug,
    programTitleAr: "المرحلة الثانوية",
    programTitleEn: "Secondary",
  });

  it("groups subjects by their real grade, preserving owner order", () => {
    const groups = groupSubjectsByGrade([
      subject("falsafa-manteq", "grade-1-secondary", "الصف الأول الثانوي"),
      subject("elm-nafs", "grade-2-secondary", "الصف الثاني الثانوي"),
      subject("mantiq", "grade-1-secondary", "الصف الأول الثانوي"),
    ]);
    expect(groups.map((g) => g.gradeSlug)).toEqual(["grade-1-secondary", "grade-2-secondary"]);
    expect(groups[0].subjects.map((s) => s.slug)).toEqual(["falsafa-manteq", "mantiq"]);
  });

  it("uses Arabic-aware counts with Latin digits (never Arabic-Indic numerals)", () => {
    expect(countLabel("ar", 0, "lessons")).not.toContain("{");
    expect(countLabel("ar", 1, "lessons")).not.toMatch(/[٠-٩]/);
    expect(countLabel("ar", 2, "lessons")).not.toContain("{");
    expect(countLabel("ar", 6, "lessons")).toContain("6");
    expect(countLabel("ar", 15, "lessons")).toContain("15");
    expect(countLabel("ar", 6, "terms")).toContain("6");
    expect(countLabel("en", 1, "lessons")).toBe("1 lesson");
    expect(countLabel("en", 4, "lessons")).toBe("4 lessons");
  });
});
