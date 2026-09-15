/**
 * Academic decorative visual system (owner brief §16 — "philosophy / psychology
 * academic atmosphere", NOT "a page full of philosopher portraits").
 *
 * WHY THIS SHAPE: the repository contains **no** philosopher imagery (verified:
 * 0 hits for philosopher names/portraits in assets, code and docs) and the brief
 * forbids generating images. So the identity is expressed with a small, shared,
 * server-renderable ornament set built from inline SVG + CSS only:
 *
 *   DecorRings      concentric "theory" rings (hero / section backdrop)
 *   DecorColumns    classical colonnade + pediment (academic architecture)
 *   DecorLaurel     olive-branch pair (achievement / CTA banners)
 *   DecorMeander    classical meander band (section dividers)
 *   DecorHairline   gold rule with a diamond (heading ornaments)
 *   WatermarkVisual the EXISTING abstract illustration used as a low-opacity
 *                   watermark — the only bitmap in the system, already shipped
 *
 * Rules enforced here (and by every consumer):
 *   - decorative ONLY: every element is aria-hidden + pointer-events-none and
 *     carries no text, so assistive tech and crawlers see nothing;
 *   - tone comes from the caller via `currentColor` (never a hardcoded hex), so
 *     the ornament can be navy, gold or light blue per surface;
 *   - opacity stays low (callers use opacity-*; defaults keep the 6–14% range)
 *     so decoration can never compete with the real content;
 *   - zero new assets, zero layout cost (`absolute` + `-z-10`), no animation
 *     except the already-reduced-motion-guarded transitions.
 */

const baseSvg = "pointer-events-none select-none";

/** Concentric hairline rings — the "philosophy/theory" motif. */
export function DecorRings({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
      focusable="false"
      className={`${baseSvg} ${className}`}
    >
      {[40, 78, 116, 154, 192].map((r, i) => (
        <circle key={r} cx="200" cy="200" r={r} opacity={1 - i * 0.16} />
      ))}
      <circle cx="200" cy="200" r="6" fill="currentColor" stroke="none" opacity="0.5" />
      <path d="M200 8v34M200 358v34M8 200h34M358 200h34" opacity="0.45" />
    </svg>
  );
}

/** Classical colonnade with pediment — academic architecture, not a portrait. */
export function DecorColumns({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 260"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      focusable="false"
      className={`${baseSvg} ${className}`}
    >
      {/* pediment */}
      <path d="M240 6 462 96H18L240 6Z" />
      <path d="M240 30 414 96H66L240 30Z" opacity="0.6" />
      {/* entablature */}
      <path d="M30 96h420M30 114h420M30 132h420" opacity="0.85" />
      {/* colonnade */}
      {[
        [56, 132],
        [150, 132],
        [244, 132],
        [338, 132],
        [408, 132],
      ].map(([x, y]) => (
        <g key={x} opacity="0.75">
          <path d={`M${x} ${y}h44v10h-44z`} />
          <path d={`M${x + 6} ${y + 10}h32v96h-32z`} />
          <path d={`M${x} ${y + 106}h44v12h-44z`} />
          <path d={`M${x + 12} ${y + 118}h20v8h-20z`} opacity="0.55" />
        </g>
      ))}
      {/* stylobate */}
      <path d="M14 226h452M18 238h444" opacity="0.8" />
    </svg>
  );
}

/** Olive-branch pair — the classical achievement motif (used behind CTAs). */
export function DecorLaurel({ className = "" }: { className?: string }) {
  const leaf = (cx: number, cy: number, rot: number, rx = 17, ry = 6.5) => (
    <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rot} ${cx} ${cy})`} opacity="0.8" />
  );
  return (
    <svg
      viewBox="0 0 320 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
      focusable="false"
      className={`${baseSvg} ${className}`}
    >
      <path d="M20 112C64 108 106 86 132 50" />
      <path d="M300 112C256 108 214 86 188 50" />
      {[
        [40, 108, -18],
        [62, 100, -28],
        [82, 89, -36],
        [100, 75, -46],
        [115, 61, -56],
        [126, 46, -70],
      ].map(([cx, cy, rot]) => leaf(cx, cy, rot))}
      {[
        [280, 108, 18],
        [258, 100, 28],
        [238, 89, 36],
        [220, 75, 46],
        [205, 61, 56],
        [194, 46, 70],
      ].map(([cx, cy, rot]) => leaf(cx, cy, rot))}
      <path d="M150 40h20M160 30v20" opacity="0.7" />
    </svg>
  );
}

/** Classical meander (key) band — used as a thin section divider. */
export function DecorMeander({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`decor-meander h-2 w-32 ${baseSvg} ${className}`} />;
}

/** Gold hairline rule with a centered diamond — heading ornament. */
export function DecorHairline({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex w-full items-center gap-3 ${baseSvg} ${className}`}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-current to-current opacity-40" />
      <span className="decor-diamond h-2 w-2 shrink-0" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-current to-current opacity-40" />
    </div>
  );
}

/**
 * The platform's existing abstract illustration, used as a low-opacity watermark
 * (decorative: empty alt + aria-hidden; the file already ships in `public/`).
 */
export function WatermarkVisual({ className = "", src = "/hero-philosophy.webp" }: { className?: string; src?: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      className={`${baseSvg} ${className}`}
    />
  );
}

export type DecorVariant = "hero" | "band" | "cta" | "page";

/**
 * One-call backdrop for a surface. Variants differ only in WHICH ornaments and
 * where — the visual language (navy + gold hairlines, low opacity, never over
 * text) is identical on every page, which is what makes it read as one identity.
 */
export function SectionDecor({ variant = "page", className = "" }: { variant?: DecorVariant; className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}>
      {variant === "hero" && (
        <>
          <DecorRings className="absolute -top-24 end-[-6rem] h-[26rem] w-[26rem] text-gold-500 opacity-[0.14] sm:h-[34rem] sm:w-[34rem]" />
          <DecorRings className="absolute -bottom-40 start-[-10rem] h-[22rem] w-[22rem] text-navy-400 opacity-[0.09]" />
          <DecorColumns className="absolute bottom-0 start-1/2 hidden h-40 w-[36rem] -translate-x-1/2 text-navy-900 opacity-[0.06] lg:block" />
          <DecorMeander className="absolute bottom-6 start-1/2 hidden -translate-x-1/2 text-gold-500 opacity-30 sm:block" />
        </>
      )}
      {variant === "band" && (
        <>
          <DecorRings className="absolute -top-40 end-[-8rem] h-[28rem] w-[28rem] text-gold-300 opacity-[0.10]" />
          <DecorColumns className="absolute -bottom-6 end-8 hidden h-32 w-[22rem] text-gold-200 opacity-[0.08] lg:block" />
        </>
      )}
      {variant === "cta" && (
        <>
          <DecorLaurel className="absolute -bottom-6 start-1/2 hidden h-32 w-[26rem] -translate-x-1/2 text-gold-300 opacity-25 sm:block" />
          <DecorRings className="absolute -top-28 start-[-6rem] h-[20rem] w-[20rem] text-gold-200 opacity-[0.10]" />
          <WatermarkVisual className="absolute -bottom-10 end-[-2rem] h-64 w-auto opacity-[0.07]" />
        </>
      )}
      {variant === "page" && (
        <>
          <DecorRings className="absolute -top-32 end-[-8rem] h-[24rem] w-[24rem] text-navy-400 opacity-[0.10]" />
          <DecorMeander className="absolute bottom-8 start-6 hidden text-gold-500 opacity-25 sm:block" />
        </>
      )}
    </div>
  );
}
