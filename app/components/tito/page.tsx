import { Link } from "react-router";
import { ArrowGlyph, Ordinal } from "./ui";
import { SubjectPlate, SubjectSignature, type SubjectKind } from "./subject";
import { t, type Locale } from "~/lib/i18n";

/**
 * SHARED PAGE CHROME
 *
 * Every hand-written public page opens the same way, because an index is only
 * useful if its entries are set identically: a breadcrumb trail, a labelled
 * eyebrow on a hairline, the title at display size, one paragraph of lede, and
 * an optional action. No page invents its own masthead.
 */

export type Crumb = { label: string; to?: string };

export function Breadcrumb({ items, locale, onDark }: { items: Crumb[]; locale: Locale; onDark?: boolean }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={t(locale, "common.breadcrumb")} data-allow-small>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-pub-xs">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className={onDark ? "text-pub-on-navy-muted" : "text-ink-300"}>
                /
              </span>
            )}
            {c.to ? (
              <Link to={c.to} className={`font-semibold transition-colors ${onDark ? "text-pub-on-navy-soft hover:text-pub-accent" : "text-pub-muted hover:text-pub-ink"}`}>
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className={`font-semibold ${onDark ? "text-pub-on-navy" : "text-pub-ink"}`}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The page masthead. `signature` adds the subject mark and switches the rule to
 * the discipline colour; `plate` bleeds the discipline diagram into the corner.
 */
export function PageHead({
  locale,
  crumbs,
  eyebrow,
  title,
  lede,
  actions,
  aside,
  kind,
  plate = false,
  index,
  className = "",
}: {
  locale: Locale;
  crumbs?: Crumb[];
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  kind?: SubjectKind;
  plate?: boolean;
  index?: number;
  className?: string;
}) {
  return (
    <header data-subject={kind ?? "none"} className={`relative isolate overflow-hidden border-b border-pub-line bg-pub-surface ${className}`}>
      {plate && kind && kind !== "none" && (
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-12 -z-10 hidden opacity-[0.18] lg:block ltr:right-0 rtl:left-0">
          <SubjectPlate kind={kind} className="h-72 w-[30rem] text-[color:var(--subject-ink)]" />
        </span>
      )}
      <div className="mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] py-8 sm:py-12">
        {crumbs && crumbs.length > 0 && <Breadcrumb items={crumbs} locale={locale} />}

        <div className={`flex items-center gap-3 border-t pt-3.5 ${kind && kind !== "none" ? "border-[color:var(--subject-ink)]" : "border-pub-ink"} ${crumbs && crumbs.length > 0 ? "mt-5" : ""}`}>
          {index != null && (
            <span className="tito-label text-pub-ink" aria-hidden="true">
              <Ordinal n={index} />
            </span>
          )}
          {kind && kind !== "none" && (
            <span className="text-[color:var(--subject-ink)]">
              <SubjectSignature kind={kind} size={20} />
            </span>
          )}
          {eyebrow && <span className={`tito-label ${kind && kind !== "none" ? "text-[color:var(--subject-ink)]" : ""}`}>{eyebrow}</span>}
          <span className="h-px flex-1 bg-pub-line" aria-hidden="true" />
        </div>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div className="min-w-0 flex-1">
            <h1 className="max-w-[18ch] font-display text-[length:var(--text-pub-h1)] font-extrabold leading-pub-tight tracking-[-0.04em] text-pub-ink [overflow-wrap:anywhere]">
              {title}
            </h1>
            {lede && <p className="mt-4 max-w-[56ch] text-pub-md leading-pub-normal text-pub-ink-soft">{lede}</p>}
          </div>
          {aside}
        </div>

        {actions && <div className="mt-7 flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}

/** The standard body wrapper beneath a `PageHead`. */
export function PageBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] py-[var(--pub-pad-y)] ${className}`}>
      {children}
    </div>
  );
}

/** "Back to …" — the one return affordance, set as a quiet ruled link. */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="group inline-flex min-h-11 items-center gap-2 text-pub-sm font-bold text-pub-ink-soft transition-colors hover:text-pub-ink">
      <span className="rotate-180 rtl:rotate-0">
        <ArrowGlyph />
      </span>
      {label}
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   WORKSPACE HEAD
   The student area has no breadcrumbs (the rail already says where you are),
   so its pages open on a label, a display title, and at most one action.
   ──────────────────────────────────────────────────────────────────────── */
export function WorkHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      {eyebrow && <p className="tito-label">{eyebrow}</p>}
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-pub-line pb-4">
        <h1 className="max-w-[20ch] font-display text-[length:var(--text-pub-h2)] font-extrabold leading-pub-tight tracking-[-0.035em] text-pub-ink">
          {title}
        </h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {lede && <p className="mt-4 max-w-[62ch] text-pub-md leading-pub-normal text-pub-ink-soft">{lede}</p>}
    </header>
  );
}

/** A ruled block inside a workspace page: a label on a rule, then content. */
export function WorkSection({
  title,
  action,
  children,
  testId,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section data-testid={testId} className={`min-w-0 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t-2 border-pub-ink pt-3">
        <h2 className="font-display text-pub-md font-extrabold tracking-[-0.02em] text-pub-ink">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
