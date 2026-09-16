/**
 * A gold hairline rule with a small solid diamond — the study surface's heading
 * ornament.
 *
 * The app-wide `DecorHairline` draws its centre mark with two crossed gradient
 * strokes; at ornament scale (8px) the crossing reads like a small "×" / close
 * glyph rather than a diamond, which is the last thing a section divider should
 * look like. The study pages therefore use this filled variant: one rotated
 * square, one readable shape.
 *
 * Purely decorative: no text, `aria-hidden`, never captures pointer events.
 */
export function StudyRule({ className = "mt-5" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none flex w-full select-none items-center gap-3 text-gold-500 ${className}`}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-current to-current opacity-40" />
      <span className="block h-1.5 w-1.5 shrink-0 rotate-45 rounded-[1px] bg-current opacity-70" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-current to-current opacity-40" />
    </div>
  );
}
