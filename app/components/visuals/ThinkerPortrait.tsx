import type { Thinker } from "~/lib/thinkers";

/**
 * The platform's ONE thinker-portrait renderer (owner brief §14–§19).
 *
 * What the assets actually are: 900×604 photographs of a thinker lit against a
 * deep navy field, with the face at roughly x = 65% / y = 30% (measured per
 * file — every asset in `public/visuals/thinkers/` shares that composition).
 * That single fact dictates the whole system:
 *
 *   • on a LIGHT surface a dark photo at 15% opacity is not "an elegant
 *     watermark", it is a grey smudge that hides the face and reads as a
 *     rendering bug. So light surfaces use the `avatar` presentation: a small,
 *     fully legible, precisely cropped face (also exactly what mobile wants).
 *   • on NAVY the photo belongs to the surface: the `plate` and `watermark`
 *     presentations sit at full tonal range, masked into the edge, so the
 *     figure is clearly noticeable without competing with the copy.
 *
 * Everything here is decorative: `alt=""` + `aria-hidden="true"`, never a
 * gallery, never the main content, never over text or a control.
 *
 * `heroVisual` marks the element as the page hero visual: the homepage plate
 * carries `data-hero-visual` + `fetchPriority=high` (it is the LCP element), and
 * every other portrait is `loading=lazy` + `fetchPriority=low` so decoration
 * never wins the browser's priority race.
 */
export type PortraitPresentation = "avatar" | "figure" | "engrave" | "watermark" | "plate";

export function ThinkerPortrait({
  thinker,
  presentation = "avatar",
  intensity = "subtle",
  eager = false,
  heroVisual = false,
  className = "",
}: {
  thinker: Thinker | null | undefined;
  /**
   * `avatar`    small cropped face for white / light-blue surfaces (default)
   * `figure`    the subject card's own figure: cropped, masked, never over text
   * `engrave`   corner signature on a LIGHT panel: duotone, masked, kept quiet
   * `watermark` edge-anchored figure for navy bands, faded into the surface
   * `plate`     the figure IS the plate: fills a navy panel, hero use only
   */
  presentation?: PortraitPresentation;
  /** Watermark strength only — three levels, mobile-first. */
  intensity?: "whisper" | "subtle" | "medium";
  /** Above-the-fold portraits are fetched eagerly (the hero plate). */
  eager?: boolean;
  /** Marks this element as the page hero visual (data-hero-visual). */
  heroVisual?: boolean;
  className?: string;
}) {
  if (!thinker) return null;

  const opacity =
    presentation === "plate" || presentation === "figure" || presentation === "engrave"
      ? ""
      : presentation === "watermark"
        ? intensity === "whisper"
          ? "opacity-[0.55] sm:opacity-[0.7] lg:opacity-[0.85]"
          : intensity === "medium"
            ? "opacity-[0.6] sm:opacity-[0.8] lg:opacity-[1]"
            : "opacity-[0.55] sm:opacity-[0.72] lg:opacity-[0.9]"
        : "";

  if (presentation === "avatar") {
    return (
      <span
        aria-hidden="true"
        className={`thinker-avatar-shell h-12 w-12 shrink-0 sm:h-14 sm:w-14 ${className}`}
      >
        <img
          src={thinker.src}
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

  if (presentation === "figure" || presentation === "engrave") {
    return (
      <img
        src={thinker.src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        width={900}
        height={604}
        className={`${presentation === "engrave" ? "thinker-engrave" : "thinker-figure"} h-full w-full select-none ${className}`}
      />
    );
  }

  if (presentation === "plate") {
    return (
      <img
        src={thinker.src}
        alt=""
        aria-hidden="true"
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        width={900}
        height={604}
        fetchPriority={heroVisual ? "high" : "low"}
        data-hero-visual={heroVisual ? "true" : undefined}
        className={`thinker-plate absolute inset-0 z-0 h-full w-full select-none object-cover object-[68%_26%] ${className}`}
      />
    );
  }

  // watermark — navy surfaces only
  return (
    <img
      src={thinker.src}
      alt=""
      aria-hidden="true"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      width={900}
      height={604}
      fetchPriority={heroVisual ? "high" : "low"}
      data-hero-visual={heroVisual ? "true" : undefined}
      className={`thinker-portrait pointer-events-none absolute inset-y-[-10%] end-[-10%] z-0 h-[120%] w-[min(72%,26rem)] max-w-none select-none ${opacity} ${className}`}
    />
  );
}
