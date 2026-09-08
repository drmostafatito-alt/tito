import { useId } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string | null;
}

export function Input({ label, error, hint, className = "", id, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-bold text-ink">
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full rounded-[var(--radius-base,10px)] border bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-muted/70 focus:outline-none focus:ring-1 focus:ring-brand-600 ${
          error ? "border-error" : "border-line focus:border-brand-700"
        }`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-bold text-error">
          {error}
        </p>
      )}
    </div>
  );
}
