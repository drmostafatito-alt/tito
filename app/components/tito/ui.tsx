import { Link } from "react-router";
import { Icon } from "~/cms/icons";
import { pubBtn, pubBtnSm } from "~/lib/publicStyles";

/**
 * "الفهرس" — the primitive set for the public product and the student
 * workspace. Everything here speaks the same grammar: paper, ink, hairline
 * rules, tabular ordinals, and one highlighter accent.
 *
 * No component in this file fetches, guesses or fabricates data. Empty input
 * renders an intentional empty state, never a placeholder.
 */

/* ── Numerals ──────────────────────────────────────────────────────────────
 * Every index in the product is set the same way: tabular, display face, and
 * (deliberately) in Western digits even in Arabic, because the whole product
 * mixes them with durations, prices and counts. */
export function Ordinal({
  n,
  pad = 2,
  className = "",
}: {
  n: number;
  pad?: number;
  className?: string;
}) {
  return (
    <span data-numeral className={`tabular-nums ${className}`}>
      {String(n).padStart(pad, "0")}
    </span>
  );
}

/* ── Actions ─────────────────────────────────────────────────────────────── */
type ActionVariant = "primary" | "secondary" | "outline" | "ghost" | "gold" | "onDark";

type ActionProps = {
  children: React.ReactNode;
  variant?: ActionVariant;
  size?: "sm" | "md";
  to?: string;
  href?: string;
  className?: string;
  arrow?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">;

/** One action component; renders `<Link>`, `<a>` or `<button>` as appropriate. */
export function Action({ children, variant = "primary", size = "md", to, href, className = "", arrow, ...rest }: ActionProps) {
  const cls = (size === "sm" ? pubBtnSm(variant) : pubBtn(variant)) + (className ? ` ${className}` : "");
  const body = (
    <>
      {children}
      {arrow ? <ArrowGlyph /> : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    );
  }
  if (href) {
    const external = /^https?:/i.test(href);
    return (
      <a className={cls} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {body}
      </a>
    );
  }
  return (
    <button className={cls} {...rest}>
      {body}
    </button>
  );
}

/** The travelling arrow. Points along the reading direction in both scripts. */
export function ArrowGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`tito-arrow h-4 w-4 shrink-0 rtl:rotate-180 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/* ── Tags ────────────────────────────────────────────────────────────────── */
const TAG_TONE: Record<string, string> = {
  neutral: "border-pub-line bg-pub-sheet text-pub-ink-soft",
  quiet: "border-transparent bg-pub-surface text-pub-muted",
  mark: "border-transparent bg-pub-accent text-pub-ink",
  ok: "border-pub-line bg-pub-success-bg text-pub-ok",
  warn: "border-pub-line bg-pub-warning-bg text-pub-warning",
  danger: "border-pub-line bg-pub-danger-bg text-pub-danger",
  ink: "border-transparent bg-pub-navy text-pub-on-navy",
  onDark: "border-pub-on-navy/25 bg-transparent text-pub-on-navy-soft",
};

export function Tag({
  children,
  tone = "neutral",
  icon,
  className = "",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TAG_TONE | string;
  icon?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pub-sm border px-2 py-[3px] text-pub-xs font-bold leading-tight ${
        TAG_TONE[tone] ?? TAG_TONE.neutral
      } ${className}`}
    >
      {icon ? <Icon name={icon} size="sm" className="h-3.5 w-3.5 text-current" /> : null}
      {children}
    </span>
  );
}

/* ── Progress ────────────────────────────────────────────────────────────── */
/**
 * A hairline that fills with the mark.
 *
 * Drawn as SVG rather than a styled div on purpose: the app ships
 * `style-src 'self'` (no 'unsafe-inline'), so a `style={{width}}` fill would be
 * dropped in production. SVG geometry attributes are not inline styles, so this
 * renders the EXACT percentage with no CSS enumeration and no CSP exception.
 */
export function Meter({ pct, className = "", label }: { pct: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <svg
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      className={`block h-1.5 w-full rtl:-scale-x-100 ${className}`}
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <rect x="0" y="0" width="100" height="6" fill="var(--color-pub-surface-2)" />
      {v > 0 ? <rect x="0" y="0" width={v} height="6" fill="var(--color-pub-accent)" /> : null}
    </svg>
  );
}

/* ── Rules & headings ────────────────────────────────────────────────────── */
/** A hairline rule; with `label` it becomes a section divider carrying a tag. */
export function Rule({ label, className = "" }: { label?: string; className?: string }) {
  if (!label) return <hr className={`border-0 border-t border-pub-line ${className}`} />;
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="tito-label whitespace-nowrap">{label}</span>
      <span className="h-px flex-1 bg-pub-line" />
    </div>
  );
}

/**
 * The section header used by every hand-written public surface: a numbered
 * eyebrow on a rule, a display title, an optional lede, and one trailing
 * action. Never centred — this product reads like a page, not a poster.
 */
export function SectionHead({
  eyebrow,
  index,
  title,
  lede,
  action,
  align = "start",
  as: As = "h2",
  id,
  className = "",
}: {
  eyebrow?: string;
  index?: number;
  title: React.ReactNode;
  lede?: React.ReactNode;
  action?: React.ReactNode;
  align?: "start" | "center";
  as?: "h1" | "h2" | "h3";
  id?: string;
  className?: string;
}) {
  return (
    <header className={`${align === "center" ? "text-center" : ""} ${className}`}>
      {eyebrow || index != null ? (
        <p className={`flex items-center gap-2.5 ${align === "center" ? "justify-center" : ""}`}>
          {index != null ? (
            <span className="tito-label text-pub-ink">
              <Ordinal n={index} />
            </span>
          ) : null}
          {index != null && eyebrow ? <span className="h-px w-6 bg-pub-line-strong" aria-hidden="true" /> : null}
          {eyebrow ? <span className="tito-label">{eyebrow}</span> : null}
        </p>
      ) : null}
      <div className={`mt-3 flex flex-wrap items-end gap-x-8 gap-y-4 ${align === "center" ? "justify-center" : "justify-between"}`}>
        <As
          id={id}
          className={`font-display font-extrabold tracking-[-0.03em] text-pub-ink ${
            As === "h1" ? "text-[length:var(--text-pub-h1)] leading-pub-tight" : "text-[length:var(--text-pub-h2)] leading-pub-tight"
          } ${align === "center" ? "mx-auto" : ""} max-w-[18ch]`}
        >
          {title}
        </As>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {lede ? (
        <p className={`mt-4 max-w-[52ch] text-pub-md leading-pub-normal text-pub-ink-soft ${align === "center" ? "mx-auto" : ""}`}>{lede}</p>
      ) : null}
    </header>
  );
}

/* ── Surfaces ────────────────────────────────────────────────────────────── */
/** A lifted sheet. The exception, not the rule — rows carry most content. */
export function Sheet({
  children,
  className = "",
  as: As = "div",
  tone = "sheet",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
  tone?: "sheet" | "paper" | "ink";
}) {
  const tones = {
    sheet: "border-pub-line bg-pub-sheet",
    paper: "border-pub-line bg-pub-surface",
    ink: "border-transparent bg-pub-navy text-pub-on-navy",
  } as const;
  return <As className={`rounded-pub-lg border ${tones[tone]} ${className}`}>{children}</As>;
}

/* ── Index rows ──────────────────────────────────────────────────────────── */
/**
 * THE content pattern. A ruled row with an ordinal in the gutter, a title that
 * carries the link, meta beneath, and a trailing slot for state.
 * The whole row is clickable via a stretched link on the title.
 */
export function IndexRow({
  index,
  title,
  to,
  href,
  meta,
  lede,
  trailing,
  leading,
  subdued,
  className = "",
}: {
  index?: number;
  title: React.ReactNode;
  to?: string;
  href?: string;
  meta?: React.ReactNode;
  lede?: React.ReactNode;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  subdued?: boolean;
  className?: string;
}) {
  const heading = (
    <span className={`font-display text-pub-md font-bold leading-pub-snug tracking-[-0.01em] ${subdued ? "text-pub-muted" : "text-pub-ink"}`}>
      {title}
    </span>
  );
  return (
    <li className={`tito-row grid-cols-[auto_1fr_auto] px-2 sm:px-3 ${className}`}>
      <span className="pt-0.5 text-pub-sm font-bold text-ink-300 select-none" aria-hidden="true">
        {leading ?? (index != null ? <Ordinal n={index} /> : null)}
      </span>
      <div className="min-w-0">
        {to ? (
          <Link to={to} className="after:absolute after:inset-0 focus-visible:outline-offset-4">
            {heading}
          </Link>
        ) : href ? (
          <a href={href} className="after:absolute after:inset-0 focus-visible:outline-offset-4">
            {heading}
          </a>
        ) : (
          heading
        )}
        {lede ? <p className="mt-1 text-pub-sm leading-pub-snug text-pub-muted">{lede}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-pub-xs text-pub-muted">{meta}</div> : null}
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-2 self-center">{trailing}</div>
    </li>
  );
}

/** The `<ul>` that hosts `IndexRow`s. */
export function IndexList({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <ul className={`tito-rows ${className}`}>{children}</ul>;
}

/* ── Empty states ────────────────────────────────────────────────────────── */
/**
 * There is no fake data in this product. When a surface has nothing real to
 * show it says so plainly, and offers the one action that would change that.
 */
export function EmptyNote({
  title,
  body,
  action,
  className = "",
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-pub-lg border border-dashed border-pub-line-strong bg-pub-surface/60 px-5 py-8 text-center ${className}`}>
      <p className="font-display text-pub-md font-bold text-pub-ink">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-[40ch] text-pub-sm leading-pub-normal text-pub-muted">{body}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ── Item-kind glyphs ─────────────────────────────────────────────────────
 * Lesson items are typed (video / pdf / file / quiz / link). The glyph is the
 * fastest way to read a lesson row, so it is a first-class primitive. */
const KIND_ICON: Record<string, string> = {
  video: "play-circle",
  pdf: "file-text",
  file: "download",
  quiz: "help-circle",
  link: "external-link",
  exam: "target",
};

export function KindGlyph({ kind, className = "" }: { kind: string; className?: string }) {
  const name = KIND_ICON[kind] ?? "file-text";
  return <Icon name={name} size="sm" className={`text-pub-muted ${className}`} />;
}

/* ── Stat ────────────────────────────────────────────────────────────────── */
/** A figure and its label. Numerals are always the display face, tabular. */
export function Stat({
  value,
  label,
  tone = "ink",
  className = "",
}: {
  value: React.ReactNode;
  label: string;
  tone?: "ink" | "onDark";
  className?: string;
}) {
  return (
    <div className={className}>
      <p
        data-numeral
        className={`text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.03em] ${
          tone === "onDark" ? "text-pub-on-navy" : "text-pub-ink"
        }`}
      >
        {value}
      </p>
      <p className={`mt-2 tito-label ${tone === "onDark" ? "text-pub-on-navy-muted" : ""}`}>{label}</p>
    </div>
  );
}
