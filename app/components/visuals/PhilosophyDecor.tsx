/**
 * The public ornament system — deliberately ONE restrained vocabulary
 * (owner brief §14–§16: "ornaments belong to the identity, they are not the
 * content").
 *
 * It used to be six overlapping motifs (rings + meander + diamonds + laurel +
 * colonnade + the abstract watermark illustration) stacked on the same surface,
 * which is what made the hero and the CTA bands feel busy and unrelated. The
 * system is now:
 *
 *   DecorHairline — a hairline rule with ONE diamond: the only divider device
 *   SectionDecor  — the only backdrop: one faint arc, and only on a NAVY band
 *                   (light surfaces use the `decor-wash` CSS field from app.css
 *                   instead, so a white page never gets an SVG stack)
 *
 * Rules every consumer must keep:
 *   - decorative ONLY: `aria-hidden`, `pointer-events-none`, no text, no alt;
 *   - colour comes from `currentColor` (never a hardcoded hex), so the ornament
 *     is navy/gold/light-blue exactly like the surface it sits on;
 *   - opacity stays low (≤ ~14% light, ≤ ~25% on navy) — decoration must never
 *     compete with a heading, a card or a CTA, and never sits over text;
 *   - zero assets, zero network cost, zero layout cost (`absolute` + `-z-10`).
 */

const baseSvg = "pointer-events-none select-none";

/** Concentric hairline rings — the single "theory" motif, dark bands only. */
function DecorRings({ className = "" }: { className?: string }) {
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
      {[78, 116, 154, 192].map((r, i) => (
        <circle key={r} cx="200" cy="200" r={r} opacity={1 - i * 0.18} />
      ))}
    </svg>
  );
}

/** Gold hairline rule with a centered diamond — the one heading ornament. */
export function DecorHairline({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex w-full items-center gap-3 ${baseSvg} ${className}`}>
      <span className="h-px flex-1 bg-pub-accent opacity-40" />
      <span className="decor-diamond h-2 w-2 shrink-0" />
      <span className="h-px flex-1 bg-pub-accent opacity-40" />
    </div>
  );
}

export type DecorVariant = "hero" | "band" | "cta" | "page";

/**
 * One-call backdrop for a NAVY band only. `hero`/`page` intentionally render
 * nothing: those surfaces are white/light-blue and carry the `decor-wash`
 * gradient field instead — a second ornament stack on a light surface is the
 * overload this system removed.
 */
export function SectionDecor({ variant = "page", className = "" }: { variant?: DecorVariant; className?: string }) {
  if (variant !== "band" && variant !== "cta") return null;
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}>
      <DecorRings className="absolute -end-16 -top-28 h-[20rem] w-[20rem] text-pub-on-navy opacity-[0.10] sm:h-[26rem] sm:w-[26rem]" />
      {variant === "cta" && <span className="absolute inset-x-10 top-0 h-px bg-pub-accent opacity-30" />}
    </div>
  );
}
