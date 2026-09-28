/**
 * The wordmark.
 *
 * No logo chip, no book icon: the teacher's NAME is the brand, set in the
 * display face at a tight negative tracking, closed by a single highlighter
 * square — the same mark that highlights an answer anywhere else in the
 * product. It is the smallest possible statement of the identity, and it
 * survives at 320px because it is type, not an image.
 *
 * When the owner has uploaded a real logo the layouts use that instead; this is
 * the typographic fallback and the on-dark rendition.
 */
export function BrandMark({
  name,
  compact = false,
  tone = "onLight",
}: {
  name: string;
  compact?: boolean;
  /** `onDark` is the ink footer and any other deep band. */
  tone?: "onLight" | "onDark";
}) {
  const ink = tone === "onDark" ? "text-pub-on-navy" : "text-pub-ink";
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span
        className={`min-w-0 truncate font-display text-[1.0625rem] font-extrabold tracking-[-0.045em] whitespace-nowrap sm:text-xl ${ink}`}
      >
        {name}
      </span>
      {!compact && (
        <span className="inline-block h-[0.42em] w-[0.42em] shrink-0 bg-pub-accent" aria-hidden="true" />
      )}
    </span>
  );
}
