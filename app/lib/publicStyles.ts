/**
 * THE public UI language — shared class strings for every public surface.
 *
 * Why this file exists: the public site used to carry three button systems
 * (CMS blocks, `~/components/ui/Button`, and hand-written `inline-flex …`
 * strings in routes), several card grammars and four radii. The fix is not a
 * CSS override — it is one source of truth that the CMS renderer AND the
 * route-level pages import, so a CTA on the homepage, a `/study` subject card
 * and a curriculum chip are visibly the same object.
 *
 * Rules encoded here (owner brief §4–§5):
 *  - navy is the primary action, white/light-blue are surfaces, gold is the
 *    single accent — nothing else enters the public palette;
 *  - every interactive target is at least 44px tall (mobile-first);
 *  - one focus ring everywhere (`focus-visible:outline-pub-accent-strong`);
 *  - only `--*-pub-*` tokens (LAYER A) are read, so an Appearance change in the
 *    admin console can never repaint a public surface.
 */

/**
 * `primary`   navy fill — the default action anywhere on the public site
 * `secondary` white + hairline — the alternative beside a primary
 * `outline`   transparent + hairline — same as secondary, kept for saved props
 * `ghost`     text-only — card footers and quiet places
 * `gold`      the ONE accent button, reserved for a closing/entry CTA
 * `onDark`    secondary grammar for a button sitting on a navy band
 */
export const PUB_BTN =
  "inline-flex min-h-12 max-w-full items-center justify-center gap-2 rounded-pub-md px-6 py-3 text-pub-base font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong";

export const BTN_VARIANT: Record<string, string> = {
  primary: "bg-pub-navy text-pub-bg hover:bg-pub-navy-2",
  secondary: "border border-pub-line-strong bg-pub-bg text-pub-ink hover:bg-pub-surface",
  outline: "border border-pub-line-strong bg-transparent text-pub-ink hover:bg-pub-surface",
  ghost: "px-2 text-pub-ink-soft hover:bg-pub-surface hover:text-pub-ink",
  gold: "bg-pub-accent text-pub-navy hover:bg-pub-accent-strong hover:text-pub-bg",
  onDark: "border border-pub-on-navy/25 bg-pub-on-navy/10 text-pub-on-navy hover:bg-pub-on-navy/20",
};

/** The only shape knob the owner gets (registry `ctaShape`); default = system. */
export const BTN_SHAPE: Record<string, string> = {
  rounded: "rounded-pub-md",
  soft: "rounded-pub-lg",
  pill: "rounded-pub-pill",
};

/** Compose a public button from a (validated) variant + shape key. */
export function pubBtn(variant?: string, shape?: string, extra = ""): string {
  const v = BTN_VARIANT[variant ?? ""] ?? BTN_VARIANT.primary;
  const s = BTN_SHAPE[shape ?? ""] ?? BTN_SHAPE.rounded;
  return [PUB_BTN.replace("rounded-pub-md", s), v, extra].filter(Boolean).join(" ");
}

/** A quieter button for cards and inline contexts (still 44px, same ring). */
export const PUB_BTN_SM =
  "inline-flex min-h-11 max-w-full items-center justify-center gap-1.5 rounded-pub-md px-4 py-2 text-pub-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong";

export function pubBtnSm(variant?: string, extra = ""): string {
  return [PUB_BTN_SM, BTN_VARIANT[variant ?? ""] ?? BTN_VARIANT.primary, extra].filter(Boolean).join(" ");
}

/** Card type roles — one place, so no surface redefines a card's anatomy. */
export const CARD_TITLE = "text-pub-md font-bold leading-pub-snug text-pub-ink";
export const CARD_BODY = "text-pub-sm leading-pub-normal text-pub-muted";
export const CARD_META = "text-pub-xs font-medium text-pub-muted";
export const CARD_LINK =
  "inline-flex min-h-11 items-center gap-1.5 text-pub-sm font-bold text-pub-ink-soft transition-colors hover:text-pub-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong";
export const CARD_ARROW = "transition-transform group-hover:-translate-x-0.5 rtl:rotate-180";
export const CHIP = "rounded-full bg-pub-surface px-2.5 py-1 text-pub-xs font-medium text-pub-ink-soft ring-1 ring-pub-line";

/**
 * THE public card grammar: white surface, hairline border, one radius, one soft
 * shadow, navy type. "Card" therefore means exactly one thing site-wide.
 */
export const PUB_CARD =
  "group relative flex flex-col overflow-hidden rounded-pub-xl border border-pub-line bg-pub-bg shadow-pub-card transition duration-200 hover:border-pub-line-strong hover:shadow-pub-md focus-within:border-pub-line-strong";

/**
 * The ONE dark band. Light-first means dark surfaces are rare and deliberate:
 * closing CTA / exams entry only. Flat navy, no gradient, no image backing.
 */
export const PUB_BAND = "relative isolate overflow-hidden rounded-pub-2xl bg-pub-navy text-pub-on-navy";

/** Icon chips (feature/step markers) — light-blue support, gold only when accent. */
export const TINT_CHIP: Record<string, string> = {
  default: "bg-pub-tint text-pub-ink-soft",
  brand: "bg-pub-tint text-pub-ink-soft",
  accent: "bg-pub-accent-bg text-pub-accent-strong",
  success: "bg-pub-tint text-pub-ink-soft",
  warning: "bg-pub-accent-bg text-pub-accent-strong",
  error: "bg-pub-tint text-pub-ink-soft",
  muted: "bg-pub-surface-2 text-pub-muted",
};

/**
 * Surfaces use ONLY the approved identity palette — navy, gold, light blue and
 * neutral. The registry's `tint` field stays owner-editable; every tint maps
 * into the same four families, so a saved "brand" card can never come out
 * violet the way the old `bg-navy-50` × `text-violet-*` pairing did.
 */
export const CARD_SURFACE: Record<string, string> = {
  default: "bg-pub-bg ring-pub-line",
  brand: "bg-pub-bg ring-pub-line",
  accent: "bg-pub-accent-bg ring-pub-accent-line",
  success: "bg-pub-bg ring-pub-line",
  warning: "bg-pub-accent-bg ring-pub-accent-line",
  error: "bg-pub-bg ring-pub-line",
  muted: "bg-pub-surface ring-pub-line",
};

export const TINT_ICON_ROLE: Record<string, string> = {
  default: "text-pub-ink-soft",
  brand: "text-pub-ink-soft",
  accent: "text-pub-accent-strong",
  success: "text-pub-ok",
  warning: "text-pub-accent-strong",
  error: "text-pub-danger",
  muted: "text-pub-muted",
};

/** Section rhythm helpers for hand-written public routes (same as `pub-section`). */
export const PUB_SECTION = "pub-section";
export const PUB_INNER = "mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)]";
