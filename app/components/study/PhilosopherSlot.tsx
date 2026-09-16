import { DecorRings } from "~/components/visuals/PhilosophyDecor";

/**
 * Philosopher illustration slot — RESERVED, EMPTY, CONTROLLED.
 *
 * The owner's visual direction (visual phase brief §10–15) is a many-thinker
 * visual system: Aristotle beside فلسفة ومنطق, Freud beside علم النفس, Marx in a
 * knowledge banner, and (later) Socrates / Plato / Ibn Rushd / Ibn Sina elsewhere
 * — line-art/engraving style, monochrome, low opacity, partially cropped behind
 * the content, never competing with it.
 *
 * This phase deliberately ships **no** illustration files: the brief forbids
 * generating images now, and the repository contains none. So every placement is
 * expressed as a slot:
 *
 *   · it reserves the exact geometry of the future artwork (size, position,
 *     cropping, layering) so the layout is already final and stable;
 *   · it renders a neutral, on-identity placeholder made only of the existing
 *     inline-SVG motif + a soft blue tint (no face, no fake portrait, no bitmap);
 *   · `data-visual-slot` publishes the reserved thinker id and
 *     `data-visual-slot-state="empty"` marks it as unfilled, so the later image
 *     step is a pure asset addition — one prop, no layout rework;
 *   · it is `aria-hidden` and `pointer-events-none` by construction: assistive
 *     technology and crawlers never learn a philosopher's name from decoration.
 *
 * Placement rules baked into the defaults (brief §11): behind the content, low
 * opacity, cropped by the container edge, never over text or buttons.
 */
export type PhilosopherSlotId =
  | "aristotle"
  | "freud"
  | "marx"
  | "socrates"
  | "plato"
  | "descartes"
  | "kant"
  | "nietzsche"
  | "ibn-rushd"
  | "ibn-sina";

/** Which slot belongs to which surface — the distribution the brief asked for. */
export const PHILOSOPHER_BY_AREA = {
  philosophySubject: "aristotle",
  psychologySubject: "freud",
  knowledgeBanner: "marx",
  hubHero: "socrates",
} as const satisfies Record<string, PhilosopherSlotId>;

export function PhilosopherSlot({
  id,
  /** visual weight: `card` crops at the card corner, `banner` is the wider band */
  size = "card",
  className = "",
  /** optional fill for the day the line-art asset exists (still decorative) */
  src = null,
}: {
  id: PhilosopherSlotId;
  size?: "card" | "banner";
  className?: string;
  src?: string | null;
}) {
  const box = size === "card" ? "h-36 w-36 sm:h-44 sm:w-44" : "h-32 w-56 sm:h-40 sm:w-72";

  return (
    <div
      aria-hidden="true"
      data-visual-slot={id}
      data-visual-slot-state={src ? "filled" : "empty"}
      className={`pointer-events-none absolute select-none overflow-hidden opacity-[0.16] ${box} ${className}`}
    >
      {src ? (
        // Reserved drop-in point for the engraved line-art asset (never a photo).
        <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <>
          {/* Neutral placeholder: soft blue wash + the platform's existing rings
              motif, cropped by the slot itself. It reads as an intentional
              visual anchor, never as a person and never as a broken image. */}
          <span className="studyslot absolute inset-0 block" />
          <DecorRings className="absolute inset-0 h-full w-full text-navy-400" />
        </>
      )}
    </div>
  );
}
