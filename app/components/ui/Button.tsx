import { useNavigation } from "react-router";

/**
 * THE button, in the Index language: ink is the action, paper + hairline is the
 * alternative, and everything is near-square. Reads LAYER A tokens only (no
 * `brand-*`/`red-*` ramps), so the owner's Appearance settings can never
 * repaint a submit control.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-pub-navy text-pub-on-navy hover:bg-pub-navy-2",
  secondary: "border border-pub-line-strong bg-pub-sheet text-pub-ink hover:border-pub-ink hover:bg-pub-surface",
  ghost: "text-pub-ink-soft underline decoration-pub-accent decoration-2 underline-offset-4 hover:text-pub-ink",
  danger: "bg-pub-danger text-white hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "min-h-11 px-3.5 py-2 text-pub-sm",
  md: "min-h-11 px-4 py-2.5 text-pub-sm",
  lg: "min-h-12 px-6 py-3 text-pub-base",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-pub-md font-bold leading-pub-snug transition-all duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60";

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className = "",
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${BASE} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

/** Submit button for a surrounding <Form> — pending state derived from the router. */
export function SubmitButton({
  variant = "primary",
  size = "md",
  className = "",
  children,
  name,
  value,
  disabled = false,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const navigation = useNavigation();
  const submitting =
    navigation.state !== "idle" &&
    navigation.formData != null &&
    (name === undefined ? true : navigation.formData.get("_action") === value);

  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`${BASE} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={submitting || disabled}
      aria-busy={submitting || undefined}
    >
      {submitting && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
