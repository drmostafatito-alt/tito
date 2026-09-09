/**
 * CSP-safe segmented progress bar (no inline styles anywhere — Phase 3 rule).
 * 10 segments; `pct` 0..100. Accessible via role=progressbar.
 * Signal color: progress is one of the few things the signal marks.
 */
export function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round(clamped / 10);
  return (
    <div
      className="flex h-1.5 w-full items-stretch gap-[3px] overflow-hidden rounded-sm bg-slate-200"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`h-full flex-1 rounded-sm ${i < filled ? "bg-accent-600" : "bg-transparent"}`} />
      ))}
    </div>
  );
}
