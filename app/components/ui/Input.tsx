import { useId, useState } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string | null;
  /** Show a 44px reveal control on password fields. */
  reveal?: boolean;
  revealShowLabel?: string;
  revealHideLabel?: string;
}

export function Input({
  label,
  error,
  hint,
  className = "",
  id,
  type,
  reveal,
  revealShowLabel = "Show password",
  revealHideLabel = "Hide password",
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const actualType = reveal && isPassword ? (shown ? "text" : "password") : type;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={actualType}
          className={`min-h-11 w-full rounded-lg border bg-white px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            reveal && isPassword ? "pe-12" : ""
          } ${error ? "border-red-400" : "border-slate-300"}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          {...rest}
        />
        {reveal && isPassword && (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            className="absolute end-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:text-slate-800"
            aria-label={shown ? revealHideLabel : revealShowLabel}
            aria-pressed={shown}
          >
            {shown ? (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6A2 2 0 0 0 12 14a2 2 0 0 0 1.4-.6" />
                <path d="M9.9 5.1A10.5 10.5 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.2 3.9M6.1 6.1A17.6 17.6 0 0 0 2 12s4 7 10 7a10.4 10.4 0 0 0 4.2-.9" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
