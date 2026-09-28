/**
 * THE public UI language — one source of truth for the shared class strings the
 * CMS renderer and the hand-written routes both use.
 *
 * Design system: "الفهرس" (The Index) — warm paper, ink-black type, hairline
 * rules, ordinal numerals, one highlighter accent. Rules encoded here:
 *
 *  - ink is the primary action, the mark (highlighter) is the single accent,
 *    paper/sheet are the surfaces — nothing else enters the public palette;
 *  - every interactive target is at least 44px tall (mobile-first);
 *  - one focus ring everywhere (2px ink, 2px offset — set in app.css `:focus-visible`);
 *  - only `--*-pub-*` tokens (LAYER A) are read, so an Appearance change in the
 *    admin console can never repaint a public surface.
 */

/* ── Buttons ───────────────────────────────────────────────────────────────
 * `primary`   ink fill — the default action anywhere on the public product
 * `secondary` paper + hairline — the alternative beside a primary
 * `outline`   transparent + hairline — kept for saved CMS props
 * `ghost`     text-only — row footers and quiet places
 * `gold`      THE accent button (highlighter fill), reserved for one CTA
 * `onDark`    the companion grammar on an ink band
 */
export const PUB_BTN =
  "inline-flex min-h-12 max-w-full items-center justify-center gap-2 rounded-pub-md px-6 text-pub-base font-bold leading-pub-snug transition-all duration-150 active:translate-y-px";

export const BTN_VARIANT: Record<string, string> = {
  primary: "bg-pub-navy py-3 text-pub-on-navy hover:bg-pub-navy-2",
  secondary: "border border-pub-line-strong bg-pub-sheet py-3 text-pub-ink hover:border-pub-ink hover:bg-pub-surface",
  outline: "border border-pub-line-strong bg-transparent py-3 text-pub-ink hover:border-pub-ink hover:bg-pub-surface",
  ghost: "px-2 py-3 text-pub-ink-soft underline decoration-pub-accent decoration-2 underline-offset-4 hover:text-pub-ink",
  gold: "bg-pub-accent py-3 text-pub-ink hover:bg-pub-accent-soft",
  onDark: "border border-pub-on-navy/25 bg-transparent py-3 text-pub-on-navy hover:border-pub-accent hover:text-pub-accent",
};

/** The only shape knob the owner gets (registry `ctaShape`); default = system. */
/**
 * The owner-editable `ctaShape` (CMS registry) still works, but its range is the
 * NEW shape language: this system is near-square, and the pill belongs to chips
 * and avatars, not to actions. A snapshot saved as "pill" therefore reads as the
 * softest button the system has rather than reintroducing the old rounded-LMS
 * look next to a square one.
 */
export const BTN_SHAPE: Record<string, string> = {
  rounded: "rounded-pub-md",
  soft: "rounded-pub-lg",
  pill: "rounded-pub-lg",
};

/** Compose a public button from a (validated) variant + shape key. */
export function pubBtn(variant?: string, shape?: string, extra = ""): string {
  const v = BTN_VARIANT[variant ?? ""] ?? BTN_VARIANT.primary;
  const s = BTN_SHAPE[shape ?? ""] ?? BTN_SHAPE.rounded;
  return [PUB_BTN.replace("rounded-pub-md", s), v, extra].filter(Boolean).join(" ");
}

/** A quieter button for rows and inline contexts (still 44px, same ring). */
export const PUB_BTN_SM =
  "inline-flex min-h-11 max-w-full items-center justify-center gap-1.5 rounded-pub-md px-4 text-pub-sm font-bold transition-all duration-150 active:translate-y-px";

export function pubBtnSm(variant?: string, extra = ""): string {
  return [PUB_BTN_SM, BTN_VARIANT[variant ?? ""] ?? BTN_VARIANT.primary, extra].filter(Boolean).join(" ");
}

/* ── Type roles ─────────────────────────────────────────────────────────── */
export const CARD_TITLE = "font-display text-pub-md font-bold leading-pub-snug tracking-[-0.01em] text-pub-ink";
export const CARD_BODY = "text-pub-sm leading-pub-normal text-pub-muted";
export const CARD_META = "text-pub-xs font-semibold tracking-wide text-pub-muted";
export const CARD_LINK =
  "inline-flex min-h-11 items-center gap-1.5 text-pub-sm font-bold text-pub-ink transition-colors hover:text-pub-accent-strong";
export const CARD_ARROW = "tito-arrow rtl:rotate-180";

/** The label grammar: tiny, letterspaced, muted — used for eyebrows and meta. */
export const LABEL = "tito-label";

/** A chip is data, not decoration: hairline box, tabular numerals inside. */
export const CHIP =
  "inline-flex items-center gap-1 rounded-pub-sm border border-pub-line bg-pub-sheet px-2 py-0.5 text-pub-xs font-semibold text-pub-ink-soft";

/**
 * THE sheet grammar. A "card" in this system is a lifted white sheet on warm
 * paper with a hairline and a near-square radius — used only where a row cannot
 * carry the content (media, forms, standalone offers).
 */
export const PUB_CARD =
  "group relative flex flex-col overflow-hidden rounded-pub-lg border border-pub-line bg-pub-sheet transition-colors duration-150 hover:border-pub-line-strong";

/** The ONE dark band: flat ink, no gradient, no image backing. */
export const PUB_BAND = "relative isolate overflow-hidden rounded-pub-xl bg-pub-navy text-pub-on-navy";

/** Icon plates — paper tint by default, the mark only when genuinely accent. */
export const TINT_CHIP: Record<string, string> = {
  default: "bg-pub-surface text-pub-ink",
  brand: "bg-pub-surface text-pub-ink",
  accent: "bg-pub-accent text-pub-ink",
  success: "bg-pub-surface text-pub-ink",
  warning: "bg-pub-accent-bg text-pub-accent-strong",
  error: "bg-pub-surface text-pub-ink",
  muted: "bg-pub-surface-2 text-pub-muted",
};

/**
 * Surfaces use only the identity palette. The registry's `tint` field stays
 * owner-editable; every tint maps into the same families, so a saved "brand"
 * block can never come out in a colour that is not part of the system.
 */
export const CARD_SURFACE: Record<string, string> = {
  default: "bg-pub-sheet ring-pub-line",
  brand: "bg-pub-sheet ring-pub-line",
  accent: "bg-pub-accent-bg ring-pub-accent-line",
  success: "bg-pub-sheet ring-pub-line",
  warning: "bg-pub-accent-bg ring-pub-accent-line",
  error: "bg-pub-sheet ring-pub-line",
  muted: "bg-pub-surface ring-pub-line",
};

export const TINT_ICON_ROLE: Record<string, string> = {
  default: "text-pub-ink",
  brand: "text-pub-ink",
  accent: "text-pub-accent-strong",
  success: "text-pub-ok",
  warning: "text-pub-accent-strong",
  error: "text-pub-danger",
  muted: "text-pub-muted",
};

/** Section rhythm helpers for hand-written public routes. */
export const PUB_SECTION = "pub-section";
export const PUB_INNER = "mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)]";
