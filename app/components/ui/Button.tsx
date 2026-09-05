import { useNavigation } from "react-router";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800",
  secondary: "bg-white text-brand-700 border border-brand-200 hover:bg-brand-50",
  ghost: "text-brand-700 hover:bg-brand-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};

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
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
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
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={submitting || disabled}
      aria-busy={submitting || undefined}
    >
      {submitting && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
