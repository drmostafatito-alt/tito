import { t, type Locale } from "~/lib/i18n";

/**
 * Student content surface — pure VIEW-MODEL helpers (PART 4–10).
 *
 * Everything here is a pure transformation of data the SERVER already decided:
 * the access verdict comes from `resolveAccess` (server-side, id-based), the
 * material kinds come from real `lesson_items` rows. This module never decides
 * access, never fetches, and never invents content — it only turns resolver
 * output into the exact state/badge/CTA a student sees, which keeps the
 * rendering logic unit-testable and identical between SSR and hydration.
 *
 * No `~server/*` import may appear here (module boundary: only routes import
 * server code) — the vocabulary is mirrored from
 * `server/content/service.server.ts#LESSON_CONTENT_KINDS` and a unit test
 * asserts the two lists stay identical.
 */

/** Mirrors LESSON_CONTENT_KINDS (server). Kept in canonical display order. */
export const STUDY_CONTENT_KIND_ORDER = ["video", "pdf", "doc", "image", "audio", "archive", "file", "practice"] as const;
export type StudyContentKind = (typeof STUDY_CONTENT_KIND_ORDER)[number];

export function isStudyContentKind(value: string): value is StudyContentKind {
  return (STUDY_CONTENT_KIND_ORDER as readonly string[]).includes(value);
}

/** Server payload → typed kinds (unknown strings are dropped, never rendered raw). */
export function toStudyContentKinds(values: readonly string[] | null | undefined): StudyContentKind[] {
  return (values ?? []).filter(isStudyContentKind);
}

/** i18n key of a material chip: فيديو · PDF · تدريبات … */
export function contentKindLabelKey(kind: StudyContentKind): string {
  return `study.kind.${kind}`;
}

/** Existing controlled icon id for a material chip (never a raw SVG). */
export function contentKindIcon(kind: StudyContentKind): string {
  switch (kind) {
    case "video": return "play-circle";
    case "pdf": return "file-text";
    case "doc": return "file-text";
    case "image": return "image";
    case "audio": return "microphone";
    case "archive": return "download";
    case "practice": return "pencil";
    default: return "layers";
  }
}

/**
 * The five things a lesson can BE for one viewer. Derived from the server's
 * verdict (never from client state), so the same helper runs in the loader:
 *
 *   open              — the student may open the lesson now
 *   sign_in_required  — free content behind the existing auth architecture
 *   locked            — paid content without a valid entitlement/scope grant
 *   scheduled         — published, but the owner set a future publish date
 *   unavailable       — expired/incomplete lifecycle state (never a CTA to buy)
 */
export type StudyLessonState = "open" | "sign_in_required" | "locked" | "scheduled" | "unavailable";

export function studyLessonState(input: {
  allowed: boolean;
  reason: string;
  accessLevel: "public" | "authenticated" | "entitled";
  freePreview: boolean;
  /** signed-in viewer (anonymous visitors get the "sign in" path for free content) */
  signedIn: boolean;
}): StudyLessonState {
  if (input.allowed) return "open";
  if (input.reason === "scheduled") return "scheduled";
  if (input.reason === "content_expired" || input.reason === "not_published") return "unavailable";
  // "entitled" is the paid level; `freePreview` lessons are free for signed-in students.
  const paid = input.accessLevel === "entitled" && !input.freePreview;
  if (!paid && !input.signedIn) return "sign_in_required";
  if (input.reason === "anon") return paid ? "locked" : "sign_in_required";
  return "locked";
}

export interface LessonViewProgress {
  status: "not_started" | "in_progress" | "completed";
}

/**
 * Primary CTA key for a state — null means "this state has no call to action"
 * (a lesson that is not yet / no longer available must never offer a purchase).
 */
export function studyLessonCtaKey(
  state: StudyLessonState,
  opts: { hasOffer: boolean; progress: LessonViewProgress | null }
): string | null {
  switch (state) {
    case "open":
      if (opts.progress?.status === "completed") return "study.ctaReview";
      if (opts.progress?.status === "in_progress") return "study.ctaResume";
      return "study.ctaStart";
    case "sign_in_required": return "study.ctaSignIn";
    case "locked": return opts.hasOffer ? "content.lockedSubscribe" : "content.lockedActivate";
    default: return null;
  }
}

/** Secondary lock-state CTA: the activation-code flow is always available. */
export function studyLockedSecondaryCtaKey(state: StudyLessonState): string | null {
  return state === "locked" ? "content.lockedActivate" : null;
}

/** Human label key of the access/state chip shown on every lesson row. */
export function studyLessonBadgeKey(
  state: StudyLessonState,
  accessLevel: "public" | "authenticated" | "entitled",
  progress: LessonViewProgress | null
): string | null {
  if (state === "scheduled") return "study.soonBadge";
  if (state === "unavailable") return "study.unavailableBadge";
  if (state === "locked") return "study.paidBadge";
  if (state === "sign_in_required") return "study.freeBadge";
  if (progress?.status === "completed") return "progress.completed";
  if (progress?.status === "in_progress") return "progress.inProgress";
  return accessLevel === "entitled" ? null : "study.freeBadge";
}

/** Badge tone aligned with the existing Badge palette. */
export function studyLessonBadgeTone(
  state: StudyLessonState,
  progress: LessonViewProgress | null
): "success" | "warning" | "neutral" | "brand" {
  if (state === "locked") return "warning";
  if (state === "scheduled" || state === "unavailable") return "neutral";
  if (progress?.status === "completed") return "success";
  if (progress?.status === "in_progress") return "brand";
  return state === "sign_in_required" ? "success" : "neutral";
}

export interface StudyLessonLike {
  id: string;
  unitId: string;
  unitTitleAr: string;
  unitTitleEn: string;
}

export interface UnitGroupedLessons<T> {
  key: string;
  titleAr: string;
  titleEn: string;
  lessons: Array<{ lesson: T; position: number }>;
}

/**
 * Groups a term's lessons by their unit WITHOUT losing the term-wide numbering
 * (01, 02, 03 …). A term whose lessons all live in the single internal "الدروس"
 * grouping — what the admin flow creates by default — renders flat, so the
 * student sees the simple list from the brief; real owner-created units render
 * as visible groups.
 */
export function groupTermLessons<T extends StudyLessonLike>(lessons: T[]): Array<UnitGroupedLessons<T>> {
  const groups: Array<UnitGroupedLessons<T>> = [];
  const index = new Map<string, number>();
  lessons.forEach((lesson, i) => {
    let gi = index.get(lesson.unitId);
    if (gi === undefined) {
      gi = groups.length;
      index.set(lesson.unitId, gi);
      groups.push({ key: lesson.unitId, titleAr: lesson.unitTitleAr, titleEn: lesson.unitTitleEn, lessons: [] });
    }
    groups[gi].lessons.push({ lesson, position: i + 1 });
  });
  return groups;
}

/** True when unit headings add information (more than one unit, or a real unit name). */
export function shouldShowUnitHeadings(groups: Array<UnitGroupedLessons<StudyLessonLike>>, locale: Locale, defaultUnitTitles: string[]): boolean {
  if (groups.length > 1) return true;
  const only = groups[0];
  if (!only) return false;
  const title = locale === "ar" ? only.titleAr || only.titleEn : only.titleEn || only.titleAr;
  return !defaultUnitTitles.includes(title.trim());
}

/** Wide 2-digit lesson number used by the card ("01", "02", …). */
export function lessonNumber(position: number): string {
  return String(Math.max(1, position)).padStart(2, "0");
}

export interface TermSummary {
  total: number;
  open: number;
  locked: number;
  signIn: number;
  soon: number;
  unavailable: number;
}

export function summarizeTermStates(states: StudyLessonState[]): TermSummary {
  const s: TermSummary = { total: states.length, open: 0, locked: 0, signIn: 0, soon: 0, unavailable: 0 };
  for (const st of states) {
    if (st === "open") s.open += 1;
    else if (st === "locked") s.locked += 1;
    else if (st === "sign_in_required") s.signIn += 1;
    else if (st === "scheduled") s.soon += 1;
    else s.unavailable += 1;
  }
  return s;
}

export interface StudySubjectLike {
  slug: string;
  gradeSlug: string;
  gradeTitleAr: string;
  gradeTitleEn: string;
  programTitleAr: string;
  programTitleEn: string;
}

export interface GradeGroup<T> {
  key: string;
  gradeSlug: string;
  gradeTitleAr: string;
  gradeTitleEn: string;
  programTitleAr: string;
  programTitleEn: string;
  subjects: T[];
}

/**
 * The hub's second level (PART 2): subjects grouped under their REAL grade, in
 * the owner's ordering (the hub query already sorts programme → grade → subject).
 * A grade the admin has not published any subject for simply never appears.
 */
export function groupSubjectsByGrade<T extends StudySubjectLike>(subjects: T[]): Array<GradeGroup<T>> {
  const groups: Array<GradeGroup<T>> = [];
  const index = new Map<string, number>();
  for (const subject of subjects) {
    let gi = index.get(subject.gradeSlug);
    if (gi === undefined) {
      gi = groups.length;
      index.set(subject.gradeSlug, gi);
      groups.push({
        key: subject.gradeSlug,
        gradeSlug: subject.gradeSlug,
        gradeTitleAr: subject.gradeTitleAr,
        gradeTitleEn: subject.gradeTitleEn,
        programTitleAr: subject.programTitleAr,
        programTitleEn: subject.programTitleEn,
        subjects: [],
      });
    }
    groups[gi].subjects.push(subject);
  }
  return groups;
}

/**
 * Arabic-aware count label ("درسان", "3 دروس", "11 درسًا") with an English
 * fallback. Latin digits are preserved — the platform renders Latin numerals
 * deliberately (ARCHITECTURE §9).
 */
export function countLabel(locale: Locale, n: number, unit: "lessons" | "terms" | "items" | "years" | "subjects"): string {
  if (locale !== "ar") return t("en", `study.counts.${unit}_${n === 1 ? "one" : "other"}`, { n });
  const r = n % 100;
  const form =
    n === 0 ? "zero"
      : n === 1 ? "one"
        : n === 2 ? "two"
          : r >= 3 && r <= 10 ? "few"
            : r >= 11 && r <= 99 ? "many"
              : "other";
  return t(locale, `study.counts.${unit}_${form}`, { n });
}

/**
 * Completion of a term as the student experiences it: completed lessons over the
 * lessons the student can actually open (a lock must never read as "incomplete
 * work"). Absolute progress still comes from the server's progress service.
 */
export function termCompletion(
  entries: Array<{ state: StudyLessonState; progress: LessonViewProgress | null }>
): { completed: number; openable: number; pct: number } {
  const openable = entries.filter((e) => e.state === "open");
  const completed = openable.filter((e) => e.progress?.status === "completed").length;
  const pct = openable.length === 0 ? 0 : Math.round((completed / openable.length) * 100);
  return { completed, openable: openable.length, pct };
}

/**
 * Decorative icon for a subject tile.
 *
 * The subject rows carry no icon column (nothing to invent), so the tile icon is
 * chosen deterministically: a small keyword map for the subjects this platform
 * actually teaches (فلسفة/منطق · علم النفس) and a stable hash into a neutral
 * academic set for anything else the owner adds later. Purely decorative — the
 * real title is always the visible, accessible label next to it.
 */
const SUBJECT_ICON_KEYWORDS: Array<{ match: RegExp; icon: string }> = [
  { match: /فلسف|منطق|philos|logic/i, icon: "scale" },
  { match: /نفس|psych/i, icon: "brain" },
  { match: /تاريخ|history|civil/i, icon: "landmark" },
  { match: /لغة|عرب|english|language/i, icon: "scroll" },
  { match: /أحياء|كيمياء|فيزياء|science|biology|chem|phys/i, icon: "lightbulb" },
  { match: /رياض|math|algebra|geometry/i, icon: "puzzle" },
  { match: /اجتماع|جغراف|social|geo/i, icon: "compass" },
];

const SUBJECT_ICON_FALLBACK = ["book-open", "layers", "scroll", "lightbulb", "compass", "puzzle"] as const;

export function subjectIcon(title: string, slug: string): string {
  for (const rule of SUBJECT_ICON_KEYWORDS) {
    if (rule.match.test(title)) return rule.icon;
  }
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) % 100000;
  return SUBJECT_ICON_FALLBACK[hash % SUBJECT_ICON_FALLBACK.length];
}

/**
 * Reserved illustration slot for a subject card.
 *
 * The owner's direction is a many-thinker visual system (Aristotle for فلسفة
 * ومنطق, Freud for علم النفس, Marx in the knowledge band, and the rest of the
 * set elsewhere) distributed so the eye never finds a fixed rule. Like the icon,
 * it is derived deterministically from the subject itself: the two subjects this
 * platform teaches get their intended thinker, and any subject the owner adds
 * later maps onto the remaining set by a stable hash. Decoration only — the name
 * is never rendered, never announced and never a substitute for the real title.
 */
const SUBJECT_PHILOSOPHER_KEYWORDS: Array<{ match: RegExp; slot: string }> = [
  { match: /فلسف|منطق|philos|logic/i, slot: "aristotle" },
  { match: /نفس|psych/i, slot: "freud" },
  { match: /اجتماع|social/i, slot: "marx" },
  { match: /تاريخ|history/i, slot: "ibn-rushd" },
  { match: /طب|علوم|science|medic/i, slot: "ibn-sina" },
];

const SUBJECT_PHILOSOPHER_FALLBACK = ["socrates", "plato", "descartes", "kant", "nietzsche", "ibn-sina", "ibn-rushd"] as const;

export function subjectPhilosopher(title: string, slug: string): string {
  for (const rule of SUBJECT_PHILOSOPHER_KEYWORDS) {
    if (rule.match.test(title)) return rule.slot;
  }
  let hash = 7;
  for (let i = 0; i < slug.length; i++) hash = (hash * 33 + slug.charCodeAt(i)) % 100000;
  return SUBJECT_PHILOSOPHER_FALLBACK[hash % SUBJECT_PHILOSOPHER_FALLBACK.length];
}
