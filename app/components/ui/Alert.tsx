type AlertKind = "info" | "success" | "warning" | "error";

const kinds: Record<AlertKind, { box: string; icon: string }> = {
  info: { box: "bg-brand-50 text-brand-900 border-brand-200", icon: "✦" },
  success: { box: "bg-success-soft text-success border-success/25", icon: "✓" },
  warning: { box: "bg-warning-soft text-warning border-warning/25", icon: "⚠" },
  error: { box: "bg-error-soft text-error border-error/25", icon: "✕" },
};

export function Alert({
  kind = "info",
  children,
}: {
  kind?: AlertKind;
  children: React.ReactNode;
}) {
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-[var(--radius-base,10px)] border px-4 py-3 text-sm font-medium ${kinds[kind].box}`}>
      <span aria-hidden="true" className="mt-0.5 font-bold leading-none">
        {kinds[kind].icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
