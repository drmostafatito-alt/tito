import type { Thinker } from "~/lib/thinkers";

/**
 * Decorative thinker portrait. NEVER carries meaning for assistive tech
 * (empty alt + aria-hidden). Opacity and crop change with viewport so the
 * figure cannot cover titles or CTAs on a phone.
 *
 * intensity:
 *   whisper — barely there watermark
 *   subtle  — noticeable but not competing
 *   medium  — stronger side element (desktop only; still quiet on mobile)
 */
export function ThinkerPortrait({
  thinker,
  intensity = "subtle",
  eager = false,
  className = "",
}: {
  thinker: Thinker | null | undefined;
  intensity?: "whisper" | "subtle" | "medium";
  eager?: boolean;
  className?: string;
}) {
  if (!thinker) return null;
  const opacity =
    intensity === "whisper"
      ? "opacity-[0.10] sm:opacity-[0.16] lg:opacity-[0.22]"
      : intensity === "medium"
        ? "opacity-[0.14] sm:opacity-[0.26] lg:opacity-[0.38]"
        : "opacity-[0.12] sm:opacity-[0.22] lg:opacity-[0.30]";
  return (
    <img
      src={thinker.src}
      alt=""
      aria-hidden="true"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      width={900}
      height={604}
      className={`thinker-portrait pointer-events-none absolute inset-y-0 end-0 z-0 h-full w-[min(58%,20rem)] select-none object-contain object-bottom ltr:object-right rtl:object-left sm:w-[min(48%,24rem)] ${opacity} ${className}`}
    />
  );
}
