/**
 * <Art> — the one component the platform renders decorative line-art with.
 *
 * It exists so the accessibility and performance rules cannot drift per call
 * site: the image is always decorative (`aria-hidden`, empty `alt`), always
 * `pointer-events-none` (it can never swallow a click meant for a card or
 * button), always lazy + async-decoded, and always sized from the registry so
 * nothing shifts while it loads.
 *
 * Tinting: the files carry navy-900 ink with alpha, so they sit on white and on
 * the soft blue sections as-is. On the navy footer/panels pass `tone="light"`,
 * which inverts the single-colour ink to a soft off-white.
 */
import { ART, type ArtName } from "~/lib/art";

export interface ArtProps {
  name: ArtName;
  /** extra positioning/cropping utilities; opacity is set here or by the caller */
  className?: string;
  /** ink for light surfaces (default) or inverted ink for navy surfaces */
  tone?: "ink" | "light";
}

export function Art({ name, className = "", tone = "ink" }: ArtProps) {
  const asset = ART[name];
  return (
    <span aria-hidden="true" className={`pointer-events-none block select-none ${className}`}>
      <img
        src={asset.src}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        decoding="async"
        width={asset.w}
        height={asset.h}
        className={`h-full w-full object-contain ${tone === "light" ? "invert" : ""}`}
      />
    </span>
  );
}
