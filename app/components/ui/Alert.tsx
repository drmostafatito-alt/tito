type AlertKind = "info" | "success" | "warning" | "error";

const kinds: Record<AlertKind, { box: string; icon: string }> = {
  info: { box: "bg-white text-ink border-brand-800", icon: "ℹ" },
  success: { box: "bg-emerald-50 text-emerald-900 border-emerald-200", icon: "✓" },
  warning: { box: "bg-amber-50 text-amber-900 border-amber-200", icon: "⚠" },
  error: { box: "bg-red-50 text-red-900 border-red-200", icon: "✕" },
};

export function Alert({
  kind = "info",
  children,
}: {
  kind?: AlertKind;
  children: React.ReactNode;
}) {
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-[var(--radius-base)] border-2 border-s-[6px] px-4 py-3 text-sm font-medium ${kinds[kind].box}`}>
      <span aria-hidden="true" className="mt-0.5 font-bold leading-none">
        {kinds[kind].icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
