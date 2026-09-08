import type { Locale } from "~/lib/i18n";

/**
 * Tito signet: a personal wax-seal roundel (pine ink, brass inner ring,
 * El Messiri «م» / Fraunces «T») beside the platform name set in the
 * display voice. Rendered only when the owner has NOT uploaded a logo —
 * an uploaded logo always wins (identity settings stay authoritative).
 */
export function BrandMark({
  name,
  tagline,
  locale = "ar",
  tone = "light",
  compact = false,
}: {
  name: string;
  tagline?: string;
  locale?: Locale;
  tone?: "light" | "dark";
  compact?: boolean;
}) {
  const dark = tone === "dark";
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`font-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl leading-none ${
          dark
            ? "bg-[#f4eee1] text-brand-950 ring-1 ring-inset ring-accent-500"
            : "bg-brand-950 text-[#f4eee1] ring-1 ring-inset ring-accent-400/70"
        }`}
      >
        <span className="-translate-y-px">{locale === "ar" ? "م" : "T"}</span>
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            className={`font-display truncate text-lg font-semibold tracking-normal ${
              dark ? "text-parchment" : "text-ink"
            }`}
          >
            {name}
          </span>
          {tagline && (
            <span
              className={`truncate text-[11px] font-semibold ${
                dark ? "text-accent-300" : "text-accent-800"
              }`}
            >
              {tagline}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
