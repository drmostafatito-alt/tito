import { hashKey, sectionBackdropThinker, type Thinker } from "~/lib/thinkers";

/**
 * The platform's ONE thinker renderer (owner brief §14–§19, restyled 2026-09).
 *
 * What the assets are NOW: the platform's own flat-cartoon philosophers
 * (owner-chosen style C) on transparent WebP, square 1:1 canvases —
 * `<id>.webp` 900×900 for desktop and `<id>-sm.webp` 420×420 for phones. They
 * replaced the photographic engravings, which never matched this identity.
 * Transparency is the whole point: a figure can now sit BEHIND a section or
 * AROUND the owner-photo frame and dissolve into the surface with plain
 * opacity — no duotone filter, no crop gymnastics, no grey smudge.
 *
 * Presentations:
 *   • `avatar`  small legible character chip for light surfaces (cards, hubs)
 *   • `figure`  a subject card's own figure, masked out under the copy
 *   • `engrave` corner signature on a LIGHT panel, dissolved by a mask
 *   • `wash`    the transparent background figure of a whole section/band —
 *               anchored to a bottom corner, masked away from the reading
 *               side, whisper-opacity on light surfaces and a pale ghost on
 *               navy, smaller + quieter on phones so copy always wins
 *
 * Everything here is decorative: `alt=""` + `aria-hidden="true"`, never a
 * gallery, never the main content, never over text or a control.
 *
 * `heroVisual` marks the element as the page hero visual (data-hero-visual +
 * fetchPriority=high; React 19 then preloads exactly that URL). Every other
 * portrait is lazy + low priority so decoration never wins the priority race.
 */
export type PortraitPresentation = "avatar" | "figure" | "engrave" | "wash";

export function ThinkerPortrait({
  thinker,
  presentation = "avatar",
  eager = false,
  heroVisual = false,
  className = "",
}: {
  thinker: Thinker | null | undefined;
  presentation?: PortraitPresentation;
  /** Above-the-fold portraits are fetched eagerly (the hero frame figure). */
  eager?: boolean;
  /** Marks this element as the page hero visual (data-hero-visual). */
  heroVisual?: boolean;
  className?: string;
}) {
  if (!thinker) return null;

  if (presentation === "avatar") {
    return (
      <span
        aria-hidden="true"
        className={`thinker-avatar-shell h-12 w-12 shrink-0 sm:h-14 sm:w-14 ${className}`}
      >
        <img
          src={thinker.srcSmall}
          srcSet={`${thinker.srcSmall} 420w, ${thinker.src} 900w`}
          sizes="56px"
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          width={48}
          height={48}
          fetchPriority="low"
          className="thinker-avatar"
        />
      </span>
    );
  }

  if (presentation === "wash") {
    return (
      <img
        src={thinker.srcSmall}
        srcSet={`${thinker.srcSmall} 420w, ${thinker.src} 900w`}
        sizes="(max-width: 40rem) 46vw, 24vw"
        alt=""
        aria-hidden="true"
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={heroVisual ? "high" : "low"}
        data-hero-visual={heroVisual ? "true" : undefined}
        data-thinker-wash={thinker.id}
        width={900}
        height={900}
        className={`thinker-wash pointer-events-none absolute -z-10 max-w-none select-none ${className}`}
      />
    );
  }

  // figure / engrave — light surfaces, masked so copy always sits on clean bg
  return (
    <img
      src={thinker.src}
      srcSet={`${thinker.srcSmall} 420w, ${thinker.src} 900w`}
      sizes="(max-width: 40rem) 40vw, 20vw"
      alt=""
      aria-hidden="true"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={heroVisual ? "high" : "low"}
      data-hero-visual={heroVisual ? "true" : undefined}
      width={900}
      height={900}
      className={`${presentation === "engrave" ? "thinker-engrave" : "thinker-figure"} h-full w-full select-none ${className}`}
    />
  );
}

/**
 * One-call section backdrop: picks the deterministic figure for a seed and
 * anchors it to a bottom corner of the (isolated) section, behind the content.
 *
 * Callers must sit inside a `relative isolate overflow-hidden` band whose copy
 * wrapper is positioned (`relative`), which every public section already is.
 * `surface` switches between the light whisper and the navy ghost treatment;
 * `edge` chooses the corner (logical, so RTL mirrors it for free).
 */
export function ThinkerWash({
  seed,
  surface = "light",
  edge,
  anchor = "bottom",
  avoid = null,
  strength = "wash",
  eager = false,
  heroVisual = false,
  className = "",
}: {
  seed: string;
  surface?: "light" | "navy";
  edge?: "start" | "end";
  /**
   * Tall bands (CMS sections) hug their BOTTOM corner; short page openings hug
   * the TOP corner instead, so the figure stays inside the visible band even
   * when the page content is shorter than the viewport.
   */
  anchor?: "bottom" | "top";
  avoid?: string | null;
  /** `wash` = whole-section backdrop; `frame` = around the owner-photo panel. */
  strength?: "wash" | "frame";
  eager?: boolean;
  heroVisual?: boolean;
  className?: string;
}) {
  const thinker = sectionBackdropThinker(seed, avoid);
  if (!thinker) return null;
  const side = edge ?? (hashKey(`wash:${seed}`) % 2 ? "start" : "end");
  return (
    <ThinkerPortrait
      thinker={thinker}
      presentation="wash"
      eager={eager}
      heroVisual={heroVisual}
      className={`thinker-wash--${surface} thinker-wash--${strength} thinker-wash--${side} ${
        anchor === "top" ? "thinker-wash--top " : ""
      }${className}`}
    />
  );
}
