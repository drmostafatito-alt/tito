/**
 * Visual identity catalog — philosophers & thinkers used as DECORATIVE
 * background language across the student experience.
 *
 * Rules:
 *  - never shown as a gallery or as primary content
 *  - assignment is data-driven from the published subject (slug/title), so a
 *    new subject the admin adds later still gets a matching visual family
 *  - some slots intentionally return null so the page does not become noisy
 *  - missing files are skipped at render time (ThinkerPortrait)
 */

export type ThinkerFamily = "classical" | "modern" | "arabic" | "psych" | "social";

export type ThinkerSlot =
  | "landing-hero"
  | "subject-card"
  | "subject-hero"
  | "term-panel"
  | "lesson-page"
  | "lesson-locked"
  | "home-discover";

export interface Thinker {
  id: string;
  src: string;
  family: ThinkerFamily;
  /** Internal only — never rendered as page copy. Used by tests/docs. */
  nameEn: string;
  nameAr: string;
}

export const THINKERS: readonly Thinker[] = [
  { id: "socrates", src: "/visuals/thinkers/socrates.webp", family: "classical", nameEn: "Socrates", nameAr: "سقراط" },
  { id: "plato", src: "/visuals/thinkers/plato.webp", family: "classical", nameEn: "Plato", nameAr: "أفلاطون" },
  { id: "aristotle", src: "/visuals/thinkers/aristotle.webp", family: "classical", nameEn: "Aristotle", nameAr: "أرسطو" },
  { id: "descartes", src: "/visuals/thinkers/descartes.webp", family: "modern", nameEn: "Descartes", nameAr: "ديكارت" },
  { id: "kant", src: "/visuals/thinkers/kant.webp", family: "modern", nameEn: "Kant", nameAr: "كانط" },
  { id: "nietzsche", src: "/visuals/thinkers/nietzsche.webp", family: "modern", nameEn: "Nietzsche", nameAr: "نيتشه" },
  { id: "ibn-rushd", src: "/visuals/thinkers/ibn-rushd.webp", family: "arabic", nameEn: "Ibn Rushd", nameAr: "ابن رشد" },
  { id: "ibn-sina", src: "/visuals/thinkers/ibn-sina.webp", family: "arabic", nameEn: "Ibn Sina", nameAr: "ابن سينا" },
  { id: "al-farabi", src: "/visuals/thinkers/al-farabi.webp", family: "arabic", nameEn: "Al-Farabi", nameAr: "الفارابي" },
  { id: "marx", src: "/visuals/thinkers/marx.webp", family: "social", nameEn: "Marx", nameAr: "ماركس" },
  { id: "freud", src: "/visuals/thinkers/freud.webp", family: "psych", nameEn: "Freud", nameAr: "فرويد" },
  { id: "jung", src: "/visuals/thinkers/jung.webp", family: "psych", nameEn: "Jung", nameAr: "يونغ" },
] as const;

const BY_ID = new Map(THINKERS.map((t) => [t.id, t]));

export function thinkerById(id: string): Thinker | null {
  return BY_ID.get(id) ?? null;
}

/** FNV-1a — stable across SSR/client so the same subject always gets the same figure. */
export function hashKey(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function familyForSubject(input: { slug?: string; titleAr?: string | null; titleEn?: string | null }): ThinkerFamily {
  const hay = `${input.slug ?? ""} ${input.titleAr ?? ""} ${input.titleEn ?? ""}`.toLowerCase();
  if (/نفس|psych|سيكولوج|فرويد|يونغ/.test(hay)) return "psych";
  if (/اجتماع|sociol|marx|ماركس/.test(hay)) return "social";
  if (/رشد|سينا|فارابي|islamic|islam|عربي/.test(hay)) return "arabic";
  if (/منطق|manteq|logic|فلسف|falsafa|philos|أفلاط|أرسطو|سقراط/.test(hay)) return "classical";
  return "modern";
}

/**
 * Preferred figure per (family, slot). Falls back to a hashed pick from the
 * family pool so newly added subjects still get a thinker without a code change.
 *
 * Returning null is intentional for noisy slots (e.g. every other subject card).
 */
const PREFERRED: Record<ThinkerFamily, Partial<Record<ThinkerSlot, string>>> = {
  classical: {
    "landing-hero": "aristotle",
    "subject-card": "plato",
    "subject-hero": "socrates",
    "term-panel": "aristotle",
    "lesson-page": "nietzsche",
    "lesson-locked": "ibn-rushd",
    "home-discover": "plato",
  },
  psych: {
    "landing-hero": "jung",
    "subject-card": "freud",
    "subject-hero": "jung",
    "term-panel": "freud",
    "lesson-page": "jung",
    "lesson-locked": "ibn-rushd",
    "home-discover": "freud",
  },
  modern: {
    "landing-hero": "descartes",
    "subject-card": "kant",
    "subject-hero": "descartes",
    "term-panel": "kant",
    "lesson-page": "nietzsche",
    "lesson-locked": "ibn-rushd",
    "home-discover": "kant",
  },
  arabic: {
    "landing-hero": "ibn-rushd",
    "subject-card": "ibn-sina",
    "subject-hero": "al-farabi",
    "term-panel": "ibn-rushd",
    "lesson-page": "ibn-sina",
    "lesson-locked": "al-farabi",
    "home-discover": "ibn-sina",
  },
  social: {
    "landing-hero": "marx",
    "subject-card": "marx",
    "subject-hero": "marx",
    "term-panel": "kant",
    "lesson-page": "marx",
    "lesson-locked": "ibn-rushd",
    "home-discover": "marx",
  },
};

export function thinkerFor(input: {
  slot: ThinkerSlot;
  slug?: string;
  titleAr?: string | null;
  titleEn?: string | null;
  /** Extra salt so two terms of the same subject can differ. */
  salt?: string;
  /** When true, skip the portrait (elegant sparsity). */
  skip?: boolean;
}): Thinker | null {
  if (input.skip) return null;
  const family = familyForSubject(input);
  const preferredId = PREFERRED[family][input.slot];
  const preferred = preferredId ? thinkerById(preferredId) : null;
  if (preferred) return preferred;
  const pool = THINKERS.filter((t) => t.family === family);
  const src = pool.length ? pool : THINKERS;
  const key = `${input.slug ?? ""}:${input.slot}:${input.salt ?? ""}`;
  return src[hashKey(key) % src.length] ?? null;
}

/** Alternate thinker in the same family — used so two cards never share a face. */
export function thinkerAlternate(primary: Thinker | null, salt: string): Thinker | null {
  if (!primary) return null;
  const pool = THINKERS.filter((t) => t.family === primary.family && t.id !== primary.id);
  if (pool.length === 0) {
    const rest = THINKERS.filter((t) => t.id !== primary.id);
    return rest[hashKey(salt) % rest.length] ?? null;
  }
  return pool[hashKey(salt) % pool.length] ?? null;
}

export type StudyItemKind = "video" | "pdf" | "file" | "quiz";

export function collectItemKinds(
  rows: Array<{ itemType: string; fileKind?: string | null }>
): StudyItemKind[] {
  const set = new Set<StudyItemKind>();
  for (const r of rows) {
    if (r.itemType === "exam") continue;
    if (r.itemType === "video") set.add("video");
    else if (r.itemType === "link") set.add("quiz");
    else if (r.itemType === "file") set.add(r.fileKind === "pdf" ? "pdf" : "file");
  }
  const order: StudyItemKind[] = ["video", "pdf", "file", "quiz"];
  return order.filter((k) => set.has(k));
}
