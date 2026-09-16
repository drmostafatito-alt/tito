import { ART, type ArtName } from "~/lib/art";
import { DecorRings } from "~/components/visuals/PhilosophyDecor";

/**
 * Philosopher line-art slot — the placement system for the many-thinker visual
 * identity (Aristotle beside فلسفة ومنطق, Freud beside علم النفس, Marx in the
 * knowledge band, Socrates in the hero, others by context).
 *
 * All the art ships as engraved, monochrome, navy-tinted line drawings in
 * `/public/art` (see `~/lib/art`). A slot:
 *
 *   · reserves the geometry (size, position, cropping, layering) so the layout
 *     never depends on whether a given thinker has art yet;
 *   · renders the line-art and marks itself `data-visual-slot-state="filled"`,
 *     or falls back to a neutral soft-blue placeholder for an id that has no
 *     asset yet (`"empty"` — no broken image, no invented face);
 *   · is `aria-hidden` and `pointer-events-none` by construction: assistive
 *     technology and crawlers never learn a philosopher's name from decoration,
 *     and the art can never swallow a click meant for a card.
 *
 * Placement rules baked into the defaults: behind the content, low opacity,
 * cropped by the container edge, never over text or a button.
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

/**
 * Opacity ladder — the brief's band for decorative art is 0.06–0.12 over text
 * and 0.12–0.20 in empty space. The platform's CSP is `style-src 'self'`, so no
 * inline style is allowed: call sites pick from this fixed ladder instead, and a
 * value outside it simply falls back to the standard weight.
 */
const SLOT_OPACITY: Record<string, string> = {
  "0.06": "opacity-[0.06]",
  "0.08": "opacity-[0.08]",
  "0.1": "opacity-[0.1]",
  "0.12": "opacity-[0.12]",
  "0.14": "opacity-[0.14]",
  "0.16": "opacity-[0.16]",
  "0.18": "opacity-[0.18]",
  "0.2": "opacity-[0.2]",
};

/** Slots that already have real line-art in the registry. */
const ART_BY_SLOT: Partial<Record<PhilosopherSlotId, ArtName>> = {
  aristotle: "aristotle",
  freud: "freud",
  marx: "marx",
  socrates: "socrates",
  plato: "plato",
  descartes: "descartes",
  kant: "kant",
};

export function PhilosopherSlot({
  id,
  /** visual weight: `card` crops at the card corner, `banner` is the wider band */
  size = "card",
  className = "",
  /** explicit asset, when a call site wants a different thinker than the id */
  src = null,
  /** ink opacity inside the slot (brief: 0.06–0.12 over text, 0.12–0.20 in space) */
  opacity = 0.14,
  /** brighten the art slightly while the surrounding card is hovered */
  boostOnHover = false,
}: {
  id: PhilosopherSlotId;
  size?: "card" | "banner";
  className?: string;
  src?: string | null;
  opacity?: number;
  boostOnHover?: boolean;
}) {
  const box = size === "card" ? "h-40 w-40 sm:h-48 sm:w-48" : "h-36 w-60 sm:h-44 sm:w-80";
  const weight = SLOT_OPACITY[String(opacity)] ?? SLOT_OPACITY["0.14"];
  const art = ART_BY_SLOT[id];

  return (
    <div
      aria-hidden="true"
      data-visual-slot={id}
      data-visual-slot-state={src || art ? "filled" : "empty"}
      data-boost={boostOnHover ? "hover" : undefined}
      className={`pointer-events-none absolute select-none overflow-hidden transition-opacity ${weight} ${box} ${className}`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : art ? (
        <img
          src={ART[art].src}
          alt=""
          aria-hidden="true"
          draggable={false}
          loading="lazy"
          decoding="async"
          width={ART[art].w}
          height={ART[art].h}
          className="h-full w-full object-contain object-bottom"
        />
      ) : (
        <>
          {/* Neutral fallback for a thinker whose art has not been drawn yet:
              soft blue wash + the platform's existing rings motif, cropped by
              the slot. Reads as an intentional anchor, never as a person. */}
          <span className="studyslot absolute inset-0 block" />
          <DecorRings className="absolute inset-0 h-full w-full text-navy-400" />
        </>
      )}
    </div>
  );
}
