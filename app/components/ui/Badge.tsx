type BadgeTone = "brand" | "neutral" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  brand: "bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200",
  neutral: "bg-sand-100 text-ink-soft ring-1 ring-inset ring-sand-300/60",
  success: "bg-success-soft text-success ring-1 ring-inset ring-success/25",
  warning: "bg-warning-soft text-warning ring-1 ring-inset ring-warning/25",
  danger: "bg-error-soft text-error ring-1 ring-inset ring-error/25",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}
