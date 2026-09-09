type BadgeTone = "brand" | "neutral" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  brand: "bg-brand-800 text-white",
  neutral: "bg-slate-100 font-semibold text-ink ring-1 ring-inset ring-line",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
