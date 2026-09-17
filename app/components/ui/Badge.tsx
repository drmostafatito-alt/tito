type BadgeTone = "brand" | "neutral" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  brand: "bg-pub-surface-2 text-pub-navy",
  neutral: "bg-pub-surface-2 text-pub-ink-soft",
  success: "bg-pub-success-bg text-pub-success",
  warning: "bg-pub-warning-bg text-pub-warning",
  danger: "bg-pub-danger-bg text-pub-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
