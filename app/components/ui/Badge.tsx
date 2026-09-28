/**
 * A badge is DATA, not decoration.
 *
 * In the Index language state is stated on a hairline in a near-square box with
 * tabular, letterspaced type — never a soft coloured pill. Semantic tones read
 * the frozen LAYER A state tokens, so an Appearance change can never repaint
 * "paid" or "locked".
 */
type BadgeTone = "brand" | "neutral" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  brand: "border-transparent bg-pub-accent text-pub-ink",
  neutral: "border-pub-line bg-pub-sheet text-pub-ink-soft",
  success: "border-pub-line bg-pub-success-bg text-pub-ok",
  warning: "border-pub-line bg-pub-warning-bg text-pub-warning",
  danger: "border-pub-line bg-pub-danger-bg text-pub-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pub-sm border px-2 py-[3px] text-pub-xs font-bold leading-tight ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
