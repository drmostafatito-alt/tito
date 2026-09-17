/**
 * Semantic banners — one implementation, controlled tokens only.
 *
 * Public surfaces and the consoles share this component, so it deliberately
 * reads the frozen LAYER A state tokens (owner brief §5: semantic states are
 * tokens, never `emerald-50`/`amber-50`/`red-50` from a raw Tailwind ramp, and
 * never the owner's themeable brand ramp either). A rate-limit notice on
 * /login must therefore be the exact same object as an audit notice in the
 * console, and no Appearance change can tint it violet or amber.
 */
type AlertKind = "info" | "success" | "warning" | "error";

const kinds: Record<AlertKind, { box: string; icon: string }> = {
  info: { box: "bg-pub-info-bg text-pub-info border-pub-info/25", icon: "ℹ" },
  success: { box: "bg-pub-success-bg text-pub-success border-pub-success/25", icon: "✓" },
  warning: { box: "bg-pub-warning-bg text-pub-warning border-pub-warning/30", icon: "⚠" },
  error: { box: "bg-pub-danger-bg text-pub-danger border-pub-danger/25", icon: "✕" },
};

export function Alert({
  kind = "info",
  children,
}: {
  kind?: AlertKind;
  children: React.ReactNode;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-pub-md border px-4 py-3 text-pub-sm leading-pub-normal ${kinds[kind].box}`}
    >
      <span aria-hidden="true" className="mt-0.5 font-bold leading-none">
        {kinds[kind].icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
