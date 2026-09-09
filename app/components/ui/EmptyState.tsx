export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-line bg-white px-6 py-12 text-center">
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-brand-800 text-2xl text-white" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="sig-display text-xl text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-ink-muted" role="status" aria-live="polite">
      <svg className="h-5 w-5 animate-spin text-accent-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
