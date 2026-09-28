import { Link, useRouteLoaderData } from "react-router";
import { BrandMark } from "~/components/BrandMark";
import { SubjectPlate } from "./subject";
import { Ordinal } from "./ui";
import { t, type Locale } from "~/lib/i18n";

/**
 * THE AUTH FRAME.
 *
 * Signing in is not a floating card on an empty page — it is the front matter
 * of the book. The frame is a two-column spread: an ink panel carrying the
 * real platform identity (name and tagline straight from Appearance settings,
 * never invented copy) and the numbered form on paper beside it.
 *
 * Nothing here weakens the server: every form inside still posts to its own
 * route action, which remains the sole authority.
 */
export function AuthFrame({
  locale,
  step,
  title,
  lede,
  children,
  footer,
  aside,
}: {
  locale: Locale;
  /** The ordinal shown beside the title — auth is a numbered sequence. */
  step?: number;
  title: string;
  lede?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const root = useRouteLoaderData("root") as
    | { platform?: { nameAr?: string; nameEn?: string; taglineAr?: string; taglineEn?: string } }
    | undefined;
  const ar = locale === "ar";
  const name = (ar ? root?.platform?.nameAr : root?.platform?.nameEn) || root?.platform?.nameAr || "";
  const tagline = (ar ? root?.platform?.taglineAr : root?.platform?.taglineEn) || "";

  return (
    <div className="auth-page grid min-h-[70vh] items-stretch lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      {/* The spine: ink, the brand, and the discipline diagram. Config only. */}
      <aside className="relative isolate hidden overflow-hidden bg-pub-navy px-10 py-14 text-pub-on-navy lg:flex lg:flex-col">
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-10 -z-10 opacity-20 ltr:-right-16 rtl:-left-16">
          <SubjectPlate kind="logic" className="h-80 w-[34rem] text-pub-accent" />
        </span>
        <Link to="/" className="inline-flex w-fit items-center">
          <BrandMark name={name} tone="onDark" />
        </Link>
        {tagline && (
          <p className="mt-auto max-w-[24ch] font-display text-[length:var(--text-pub-h3)] font-extrabold leading-pub-tight tracking-[-0.03em] text-pub-on-navy">
            {tagline}
          </p>
        )}
        {aside}
      </aside>

      <div className="flex items-start justify-center px-[var(--pub-pad-x)] py-10 sm:py-14 lg:justify-start lg:ps-16 xl:ps-24">
        <div className="w-full max-w-[26rem]">
          <div className="flex items-baseline gap-3 border-t-2 border-pub-ink pt-3.5">
            {step != null && (
              <span className="tito-label text-pub-ink" aria-hidden="true">
                <Ordinal n={step} />
              </span>
            )}
            <span className="tito-label">{t(locale, "auth.frameLabel")}</span>
          </div>
          <h1 className="mt-4 font-display text-[length:var(--text-pub-h2)] font-extrabold leading-pub-tight tracking-[-0.035em] text-pub-ink">
            {title}
          </h1>
          {lede && <p className="mt-3 text-pub-sm leading-pub-normal text-pub-muted">{lede}</p>}

          <div className="mt-8 flex flex-col gap-4">{children}</div>

          {footer && <div className="mt-8 border-t border-pub-line pt-5 text-pub-sm text-pub-muted">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

/** The inline text link used beneath an auth form. */
export function AuthLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="font-bold text-pub-ink underline decoration-pub-accent decoration-2 underline-offset-4 hover:decoration-pub-ink">
      {children}
    </Link>
  );
}
