import { Art } from "~/components/visuals/Art";
import type { ArtName } from "~/lib/art";

export function EmptyState({
  title,
  body,
  icon,
  action,
  /** optional engraved emblem behind the state (public/student surfaces only) */
  art,
}: {
  title: string;
  body?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  art?: ArtName;
}) {
  return (
    <div className="relative isolate flex flex-col items-center justify-center gap-2 overflow-hidden rounded-[var(--radius-card)] border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      {art && (
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-6 -end-6 hidden h-32 w-32 select-none opacity-[0.07] sm:block">
          <Art name={art} />
        </div>
      )}
      {icon && <div className="relative text-3xl text-slate-500" aria-hidden="true">{icon}</div>}
      <p className="relative font-medium text-slate-700">{title}</p>
      {body && <p className="relative max-w-sm text-sm text-slate-500">{body}</p>}
      {action && <div className="relative mt-2">{action}</div>}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-slate-500" role="status" aria-live="polite">
      <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-sm">{label}</span>
    </div>
  );
}
