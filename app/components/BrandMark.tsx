export function BrandMark({
  name,
  compact = false,
  tone = "onLight",
}: {
  name: string;
  compact?: boolean;
  /**
   * `onLight` (default) = white/light chrome, `onDark` = the navy footer and
   * other dark surfaces, where the slate label would be invisible.
   */
  tone?: "onLight" | "onDark";
}) {
  const labelCls = tone === "onDark" ? "text-pub-bg" : "text-pub-ink";
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pub-xl bg-pub-navy text-pub-bg shadow-pub-card"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z" />
          <path d="M22 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z" />
        </svg>
      </span>
      {!compact && (
        /* Arabic glyphs are far wider than the `0` that `ch` measures, so a
           max-width here used to clip the name away. It is allowed to shrink
           and ellipsize instead, and it stays hidden only on the narrowest
           phones, where the header would otherwise cram. */
        <span className={`hidden min-w-0 truncate align-middle text-sm font-bold tracking-tight whitespace-nowrap min-[380px]:inline min-[380px]:text-base sm:text-lg ${labelCls}`}>
          {name}
        </span>
      )}
    </span>
  );
}
