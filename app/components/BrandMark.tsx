/** Ink-square wordmark: solid black block with the initial + Cairo ExtraBold name.
 * The signal tick (red corner) is the only color on the mark. */
export function BrandMark({ name, compact = false }: { name: string; compact?: boolean }) {
  const initial = (name || "T").trim().charAt(0);
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-white"
        aria-hidden="true"
      >
        <span className="sig-display text-xl leading-none">{initial}</span>
        <span className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-[3px] bg-accent-500" />
      </span>
      {!compact && <span className="sig-display text-base text-ink sm:text-lg">{name}</span>}
    </span>
  );
}
