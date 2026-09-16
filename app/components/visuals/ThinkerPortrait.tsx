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
      ? "opacity-[0.16] sm:opacity-[0.22] lg:opacity-[0.30]"
      : intensity === "medium"
        ? "opacity-[0.20] sm:opacity-[0.32] lg:opacity-[0.42]"
        : "opacity-[0.18] sm:opacity-[0.28] lg:opacity-[0.36]";
  return (
    <img
      src={thinker.src}
      alt=""
      aria-hidden="true"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      width={900}
      height={604}
      className={`thinker-portrait pointer-events-none absolute inset-y-[-14%] end-[-16%] z-0 h-[128%] w-[min(82%,34rem)] max-w-none select-none object-cover object-top ltr:object-right rtl:object-left sm:w-[min(68%,38rem)] ${opacity} ${className}`}
    />
  );
}
