import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Icon } from "~/cms/icons";
import { ls, type LStr } from "~/cms/l10n";
import { t } from "~/lib/i18n";
import { socialIconName } from "~/cms/social";
import { ANCHOR_ID_RE, fragmentId, resolveCmsHref, type CmsHrefContext } from "~/cms/links";
import { SectionDecor } from "~/components/visuals/PhilosophyDecor";
import { ThinkerPortrait, ThinkerWash } from "~/components/visuals/ThinkerPortrait";
import {
  BTN_SHAPE,
  BTN_VARIANT,
  CARD_BODY,
  CARD_LINK,
  CHIP,
  PUB_BAND,
  PUB_BTN,
  PUB_CARD,
} from "~/lib/publicStyles";
import { heroFrameThinkers, thinkerById } from "~/lib/thinkers";
import type { CardView, CmsRenderCtx, FormView } from "~/cms/render-types";

const VideoPlayer = lazy(() => import("~/components/player/VideoPlayer").then((m) => ({ default: m.VideoPlayer })));

/** Block types that render a thinker of their own — a section containing one
 *  of these keeps exactly that face and gets no backdrop philosopher. */
const THINKER_BLOCK_TYPES = new Set([
  "hero_showcase",
  "teacher_profile",
  "subject_cards",
  "course_cards",
  "program_cards",
  "free_content",
]);

/**
 * CMS block renderers (Phase 3). STRUCTURE ONLY — every visible string, image,
 * link and layout choice comes from validated block props / resolved view data
 * (owner brief: "Components contain structure and behavior. The CMS contains
 * the editable content"). No hard-coded marketing copy, no placeholder assets:
 * missing optional data renders NOTHING (empty-first principle).
 *
 * Constraints honored here:
 *  - no inline style attributes (production CSP style-src 'self')
 *  - responsive PRESETS only (no arbitrary CSS); mobile-first grids
 *  - touch targets ≥ 44px (py-3 buttons), no fixed-position traps except the
 *    opt-in floating WhatsApp/Telegram CTAs (bottom-safe-area aware)
 *  - images: loading=lazy + decoding=async below the fold, alt from props
 */

type P = Record<string, unknown>;

const str = (p: P, key: string, locale: "ar" | "en"): string => ls(p[key], locale);
const raw = (p: P, key: string): string => (typeof p[key] === "string" ? (p[key] as string) : "");
const bool = (p: P, key: string): boolean => p[key] === true;
const num = (p: P, key: string, fallback: number): number => (typeof p[key] === "number" ? (p[key] as number) : fallback);
const arr = (p: P, key: string): P[] => (Array.isArray(p[key]) ? (p[key] as P[]) : []);

const ALIGN = {
  start: "items-start text-start",
  center: "items-center text-center",
  end: "items-end text-end",
} as const;

/** Tint class → the exact colour `.mk .sic-<tint>` paints (app.css). */
const SIC_TINT_HEX: Record<string, string> = {
  blue: "#1877f2",
  green: "#25d366",
  dark: "#111111",
  red: "#ff0000",
  gold: "#c99a2e",
  teal: "#12a5a5",
  navy: "#113274",
};

/**
 * Legacy `iconBg` → the tint class that paints the same colour.
 *
 * `iconBg` was rendered as an inline `style` attribute, which the platform CSP
 * (`style-src 'self'`, no unsafe-inline) blocks outright — it never actually
 * coloured anything in production and only emitted console violations. Stored
 * values are preserved and mapped onto the equivalent CSP-safe class; anything
 * that is not one of the seven supported colours falls back to `tint`.
 */
function sicTintFor(tint: string, iconBg: string): string {
  const want = iconBg.trim().toLowerCase();
  if (!want) return tint;
  const hit = Object.keys(SIC_TINT_HEX).find((k) => SIC_TINT_HEX[k] === want);
  return hit ?? tint;
}

/**
 * Controlled icon id for a social/contact card, CSP-safe.
 *
 * Snapshots published before this fix stored absolute
 * `https://cdn.simpleicons.org/<network>/<colour>` URLs. `img-src 'self' …`
 * blocks them, so every one of those cards rendered a BROKEN image. The
 * network segment maps 1:1 onto the built-in inline-SVG set, so published
 * pages heal without an edit, with no third-party request and no CSP change.
 */
function iconIdFromUrl(url: string): string {
  const m = /^https?:\/\/cdn\.simpleicons\.org\/([a-z0-9-]+)/i.exec(url.trim());
  return m ? socialIconName(m[1].toLowerCase()) : "";
}

/** True for a URL the CSP will actually load (same-origin / relative / data:). */
function isRenderableImgSrc(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  return u.startsWith("/") || u.startsWith("data:") || u.startsWith("blob:");
}

/**
 * Page-level navigation facts (which in-page anchors really exist, and the
 * resolved external Questions Platform URL). Provided once by `PageView` and read
 * by every link renderer, so a stored destination can be resolved without
 * threading the render context through ~15 call sites. Default = unconstrained.
 */
const CmsNavContext = createContext<CmsHrefContext>({});

/**
 * Internal links → <Link>; in-page fragments → same-document <a href="#…">;
 * external https → <a target=_blank rel=noopener>; unresolved/empty → <span>.
 *
 * Resolution is what keeps destinations honest: an in-page fragment whose target
 * section will not render (the exams section collapses while the Questions
 * Platform is disabled/unconfigured) and the `exam:external` token with no URL
 * configured both resolve to "" — the block still renders, but never as a dead
 * or misleading link.
 */
function SmartLink({ href, className, children, ariaLabel }: { href: string; className?: string; children: React.ReactNode; ariaLabel?: string }) {
  const nav = useContext(CmsNavContext);
  const resolved = resolveCmsHref(href, nav);
  if (!resolved) return <span className={className}>{children}</span>;
  if (fragmentId(resolved)) {
    // Same-document jump — never target/rel (that would open a second tab).
    return <a href={resolved} className={className} aria-label={ariaLabel}>{children}</a>;
  }
  if (resolved.startsWith("/")) {
    return <Link to={resolved} className={className} aria-label={ariaLabel}>{children}</Link>;
  }
  return (
    <a href={resolved} target="_blank" rel="noopener noreferrer nofollow" className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
}

/**
 * Buttons and cards on public surfaces are composed in ~/lib/publicStyles.ts —
 * the same module the /study, curriculum and auth routes read, so a CTA can
 * never grow a second personality.
 */
function CtaButton({
  label,
  href,
  target,
  variant,
  icon,
  shape,
  className = "",
}: {
  label: string;
  href: string;
  target?: string;
  variant?: string;
  icon?: string;
  shape?: string;
  className?: string;
}) {
  if (!label && !href) return null; // nothing configured → render nothing
  const nav = useContext(CmsNavContext);
  const resolved = resolveCmsHref(href, nav);
  const v = BTN_VARIANT[variant ?? "primary"] ?? BTN_VARIANT.primary;
  // `!` in a className means a block is overriding the system — never needed now.
  const base = `${PUB_BTN} ${BTN_SHAPE[shape ?? ""] ?? ""} ${v} ${className}`.replace(/\s+/g, " ").trim();
  const iconEl = icon ? <Icon name={icon} size="sm" colorRole="default" className="text-current" /> : null;
  if (fragmentId(resolved)) {
    // Same-document jump — never target/rel (that would open a second tab).
    return <a href={resolved} className={base}>{iconEl}{label}</a>;
  }
  if (resolved && resolved.startsWith("/") && target !== "_blank") {
    return <Link to={resolved} className={base}>{iconEl}{label}</Link>;
  }
  if (resolved) {
    // External https (including the resolved Questions Platform URL) always
    // leaves the site safely — new tab, no opener, no referrer.
    return (
      <a href={resolved} target="_blank" rel="noopener noreferrer nofollow" className={base}>
        {iconEl}
        {label}
      </a>
    );
  }
  return <span className={base}>{iconEl}{label}</span>;
}

/** Rich text: snapshot html is server-sanitized at publish (allowlist + href validation). */
function RichText({ html, className = "" }: { html: string; className?: string }) {
  if (!html.trim()) return null;
  return <div className={`cms-richtext ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function CmsImage({ fileId, alt, ctx, className = "", fit = "cover", aspect = "auto", rounded = false, eager = false }: { fileId: string; alt: string; ctx: CmsRenderCtx; className?: string; fit?: string; aspect?: string; rounded?: boolean; eager?: boolean }) {
  const src = fileId ? ctx.images[fileId] : null;
  if (!src) return null; // empty-first: no placeholder substitution, ever
  const aspectClass = { auto: "", "16:9": "aspect-video", "4:3": "aspect-[4/3]", "1:1": "aspect-square", "3:4": "aspect-[3/4]" }[aspect] ?? "";
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`${aspectClass} w-full ${fit === "contain" ? "object-contain" : "object-cover"} ${rounded ? "rounded-pub-xl" : ""} ${className}`}
    />
  );
}

function CardGrid({ rows, ctx, ctaFallback, showPlay }: { rows: CardView[]; ctx: CmsRenderCtx; ctaFallback?: LStr | null; showPlay?: boolean }) {
  if (!rows.length) return null; // empty-first: section collapses; polished empty states live on catalog pages
  const L = ctx.locale;
  return (
    <div className="grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        // Prefer a direct https thumbnail (provider URL) over the file registry.
        const imgSrc = (row.imageUrl && /^https:\/\//i.test(row.imageUrl) ? row.imageUrl : null) ?? (row.image ? ctx.images[row.image] : null);
        const badge = row.badge ? ls(row.badge, L) : "";
        const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
        // A card whose CTA repeats its own title reads as a bug, so the fallback
        // is the system verb for opening a lesson ("ابدأ الدرس").
        const title = ls(row.title, L);
        const rawCta = (row.cta && ls(row.cta, L)) || (ctaFallback ? ls(ctaFallback, L) : "");
        const ctaLabel = rawCta && rawCta !== title ? rawCta : t(L, "study.openLesson");
        const meta = row.meta ? ls(row.meta, L) : "";
        const desc = ls(row.desc, L);
        return (
          <article key={row.id} className="group relative flex flex-col overflow-hidden rounded-[1.375rem] border border-pub-line bg-white shadow-pub-card transition duration-200 hover:-translate-y-1.5 hover:border-pub-line-strong hover:shadow-pub-md">
            {imgSrc && (
              <div className="relative aspect-video overflow-hidden bg-pub-card">
                <img
                  src={imgSrc}
                  alt={title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
                {showPlay ? (
                  /* Video card: white play disc, gold on hover (mockup .play). */
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-pub-blue shadow-pub-md transition duration-200 group-hover:scale-110 group-hover:bg-pub-accent group-hover:text-white">
                      <Icon name="play-circle" size="lg" colorRole="default" className="text-current" />
                    </span>
                  </span>
                ) : (
                  badge && (
                    <span className="absolute bottom-3 start-3 rounded-full bg-pub-accent/95 px-3 py-1 text-pub-xs font-bold text-white shadow-pub-card">
                      {badge}
                    </span>
                  )
                )}
              </div>
            )}
            <div className="flex flex-1 flex-col gap-2 p-5 sm:p-6">
              {/* Video card tag: gold-on-cream pill above the title. */}
              {showPlay && badge && (
                <span className="w-fit rounded-full bg-pub-accent-bg px-3.5 py-1 text-pub-xs font-extrabold text-pub-accent-strong">{badge}</span>
              )}
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-pub-base font-extrabold leading-[1.8] text-pub-ink [overflow-wrap:anywhere]">{title}</h3>
                {badge && !imgSrc && !showPlay && (
                  <span className="shrink-0 rounded-full bg-pub-accent-bg px-2.5 py-0.5 text-pub-xs font-semibold text-pub-accent-strong ring-1 ring-pub-accent-line">{badge}</span>
                )}
              </div>
              {desc && <p className="line-clamp-2 text-pub-sm leading-pub-normal text-pub-muted">{desc}</p>}
              {meta && (
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-pub-xs text-pub-muted" dir="auto">{meta}</p>
              )}
              {chips.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <li key={chip} className={CHIP}>
                      {chip}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto pt-3">
                <SmartLink href={row.href} ariaLabel={`${ctaLabel} — ${title}`} className={showPlay ? "inline-flex min-h-11 items-center gap-1.5 text-pub-sm font-extrabold text-pub-blue transition-colors hover:text-pub-navy-2" : CARD_LINK}>
                  {ctaLabel}
                  <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5 rtl:rotate-180">→</span>
                </SmartLink>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}


function Countdown({ props, ctx }: { props: P; ctx: CmsRenderCtx }) {
  const target = props.target;
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (typeof target !== "number") return;
    const tick = () => setRemaining(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);
  if (typeof target !== "number") return null;
  if (remaining !== null && remaining <= 0) return null; // expired countdown disappears (no fake urgency)
  const L = ctx.locale;
  const secs = remaining === null ? null : Math.floor(remaining / 1000);
  const cells: Array<[string | null, string]> = [
    [secs === null ? null : String(Math.floor(secs / 86400)), str(props, "labelDays", L)],
    [secs === null ? null : String(Math.floor((secs % 86400) / 3600)), str(props, "labelHours", L)],
    [secs === null ? null : String(Math.floor((secs % 3600) / 60)), str(props, "labelMinutes", L)],
    [secs === null ? null : String(secs % 60), str(props, "labelSeconds", L)],
  ];
  return (
    <div className="flex flex-col items-center gap-3">
      {str(props, "heading", L) && <p className="text-pub-md font-semibold">{str(props, "heading", L)}</p>}
      <div className="flex gap-3" dir="ltr" suppressHydrationWarning>
        {cells.map(([value, label], i) => (
          <div key={i} className="flex min-w-16 flex-col items-center rounded-pub-xl bg-pub-ink px-3 py-2 text-pub-bg">
            <span className="text-pub-h2 font-bold tabular-nums">{value ?? "--"}</span>
            <span className="text-[11px] text-pub-line-strong">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CmsForm({ form, ctx, compact }: { form: FormView; ctx: CmsRenderCtx; compact?: boolean }) {
  const L = ctx.locale;
  const result = ctx.formResults[form.slug];
  const input = "w-full rounded-pub-md border border-pub-line-strong bg-pub-bg px-3 py-2.5 text-pub-sm text-pub-ink placeholder:text-pub-muted/70 focus:border-pub-navy focus:outline-none";
  return (
    <form method="post" className={`flex flex-col gap-4 ${compact ? "" : "mx-auto w-full max-w-xl"}`} noValidate>
      <input type="hidden" name="_cmsForm" value={form.slug} />
      {result && (
        <p role="status" className={`rounded-pub-md px-4 py-3 text-pub-sm ${result.ok ? "bg-pub-success-bg text-pub-success" : "bg-pub-danger-bg text-pub-danger"}`}>
          {result.ok ? ls(form.success, L) : ls(form.failure, L) || t(L, "common.cmsFormFailed")}
        </p>
      )}
      {form.fields.map((f) => {
        const err = result && !result.ok ? result.errors[f.name] : undefined;
        const label = (
          <label htmlFor={`cmsf-${form.slug}-${f.name}`} className="mb-1 block text-pub-sm font-medium text-pub-ink-soft">
            {ls(f.label, L)}{f.required && <span className="text-pub-danger"> *</span>}
          </label>
        );
        const ph = ls(f.placeholder, L) || undefined;
        let control: React.ReactNode = null;
        switch (f.type) {
          case "textarea":
            control = <textarea id={`cmsf-${form.slug}-${f.name}`} name={f.name} placeholder={ph} rows={4} className={input} aria-invalid={err ? true : undefined} />;
            break;
          case "select":
            control = (
              <select id={`cmsf-${form.slug}-${f.name}`} name={f.name} className={input} aria-invalid={err ? true : undefined}>
                <option value="">{ph ?? ""}</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{ls(o.label, L)}</option>)}
              </select>
            );
            break;
          case "multiselect":
            control = (
              <select id={`cmsf-${form.slug}-${f.name}`} name={`${f.name}[]`} multiple className={`${input} h-auto min-h-24`} aria-invalid={err ? true : undefined}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{ls(o.label, L)}</option>)}
              </select>
            );
            break;
          case "radio":
            control = (
              <div className="flex flex-wrap gap-3" role="radiogroup" aria-labelledby={`cmsf-${form.slug}-${f.name}-legend`}>
                {f.options.map((o) => (
                  <label key={o.value} className="inline-flex min-h-11 items-center gap-2 text-pub-sm text-pub-ink-soft">
                    <input type="radio" name={f.name} value={o.value} className="h-4 w-4" />
                    {ls(o.label, L)}
                  </label>
                ))}
              </div>
            );
            break;
          case "checkbox":
            control = (
              <label className="inline-flex min-h-11 items-center gap-2 text-pub-sm text-pub-ink-soft">
                <input type="checkbox" id={`cmsf-${form.slug}-${f.name}`} name={f.name} value="on" className="h-4 w-4" />
                {ls(f.label, L)}
              </label>
            );
            break;
          case "hidden":
            return <input key={f.name} type="hidden" name={f.name} value="" />;
          default:
            control = (
              <input
                id={`cmsf-${form.slug}-${f.name}`}
                name={f.name}
                type={f.type === "phone" ? "tel" : f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
                placeholder={ph}
                className={input}
                aria-invalid={err ? true : undefined}
              />
            );
        }
        return (
          <div key={f.name}>
            {f.type !== "checkbox" && f.type !== "radio" && label}
            {f.type === "radio" && <span id={`cmsf-${form.slug}-${f.name}-legend`} className="mb-1 block text-pub-sm font-medium text-pub-ink-soft">{ls(f.label, L)}{f.required && <span className="text-pub-danger"> *</span>}</span>}
            {control}
            {ls(f.help, L) && <p className="mt-1 text-pub-xs text-pub-muted">{ls(f.help, L)}</p>}
            {err && <p className="mt-1 text-pub-xs text-pub-danger">{err}</p>}
          </div>
        );
      })}
      {form.consentRequired && (
        <label className="inline-flex min-h-11 items-start gap-2 text-pub-sm text-pub-muted">
          <input type="checkbox" name="__consent" value="on" className="mt-1 h-4 w-4" />
          <span>{ls(form.consent, L)}{result && !result.ok && result.errors.__consent && <span className="text-pub-danger"> *</span>}</span>
        </label>
      )}
      <button type="submit" className={`inline-flex min-h-11 items-center justify-center rounded-pub-md bg-pub-navy px-6 py-3 text-pub-base font-semibold text-pub-bg hover:bg-pub-ink-soft ${compact ? "shrink-0" : "self-start"}`}>
        {t(L, "common.cmsFormSubmit")}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Individual block renderers
// ---------------------------------------------------------------------------

/** Floating badge anchor positions (desktop); below lg badges flow as a normal grid. */
const BADGE_POS: Record<string, string> = {
  "top-start": "lg:top-6 lg:start-6",
  "top-end": "lg:top-6 lg:end-6",
  "bottom-start": "lg:bottom-6 lg:start-6",
  "bottom-end": "lg:bottom-6 lg:end-6",
};


/** Hero intro-video CTA: a real button that reveals the server-minted player. */
function VideoCta({ videoId, label }: { videoId: string; label: string }) {
  const [open, setOpen] = useState(false);
  if (!videoId) return null;
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? `hero-video-${videoId}` : undefined}
        className="inline-flex min-h-12 items-center gap-3 rounded-full px-1 py-1 text-start text-pub-sm font-semibold text-pub-ink hover:bg-pub-bg/70"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pub-navy text-pub-bg shadow-pub-card shadow-pub-navy/30">
          <Icon name="play-circle" size="md" colorRole="invert" className="text-pub-bg" />
        </span>
        <span className="max-w-[10rem] leading-snug">{label}</span>
      </button>
      {open && (
        <div id={`hero-video-${videoId}`} className="w-full max-w-xl">
          <Suspense fallback={<div className="h-40 rounded-xl bg-pub-surface-2" />}>
            <VideoPlayer videoId={videoId} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

function BlockBody({ block, ctx }: { block: { id: string; type: string; props: P }; ctx: CmsRenderCtx }) {
  const p = block.props;
  const L = ctx.locale;
  switch (block.type) {
    case "hero": {
      const heading = str(p, "heading", L);
      const subheading = str(p, "subheading", L);
      const ctas = arr(p, "ctas").filter((i) => str(i, "label", L) || raw(i, "href"));
      const bgId = raw(p, "image");
      const hasBg = Boolean(bgId && ctx.images[bgId]);
      if (!heading && !subheading && !ctas.length && !hasBg) return null;
      const height = {
        sm: "py-[calc(var(--pub-pad-y)*0.8)]",
        md: "py-[calc(var(--pub-pad-y)*1.4)]",
        lg: "py-[calc(var(--pub-pad-y)*2)]",
      }[raw(p, "height")] ?? "py-[calc(var(--pub-pad-y)*1.4)]";
      const align = raw(p, "align") || "center";
      const alignCls = align === "center" ? "items-center text-center" : align === "end" ? "items-end text-end" : "items-start text-start";
      const justify = align === "center" ? "justify-center" : align === "end" ? "justify-end" : "justify-start";
      return (
        <div className={`relative isolate -mx-4 overflow-hidden ${hasBg ? "" : "bg-pub-ink"} ${height} flex ${alignCls} flex-col gap-4 px-4 sm:mx-0 sm:rounded-pub-xl sm:px-10`}>
          {hasBg && (
            <>
              <img src={ctx.images[bgId]} alt="" aria-hidden="true" decoding="async" className="absolute inset-0 -z-10 h-full w-full object-cover" />
              <div className="absolute inset-0 -z-10 bg-pub-ink/60" aria-hidden="true" />
            </>
          )}
          {heading && <h1 className="max-w-3xl text-pub-xl font-extrabold leading-pub-tight text-pub-on-navy">{heading}</h1>}
          {subheading && <p className="pub-measure whitespace-pre-line text-pub-base leading-pub-normal text-pub-on-navy-soft">{subheading}</p>}
          {ctas.length > 0 && (
            <div className={`mt-2 flex w-full flex-wrap gap-3 ${justify} max-sm:flex-col max-sm:items-stretch`}>
              {ctas.map((cta, idx) => (
                <CtaButton key={idx} label={str(cta, "label", L)} href={raw(cta, "href")} target={raw(cta, "target")} variant={raw(cta, "variant") || "primary"} icon={raw(cta, "icon")} className="max-sm:w-full" />
              ))}
            </div>
          )}
        </div>
      );
    }
    case "hero_showcase": {
      // Mockup-faithful hero (mockup_v5.html). Every string, link, pill and
      // badge comes from CMS props — no hardcoded copy. Photo resolves from
      // the explicit `image` prop, else the owner's identity photo.
      const watermark = str(p, "watermark", L);
      const scribble1 = str(p, "scribble1", L);
      const scribble2 = str(p, "scribble2", L);
      const eyebrow = str(p, "eyebrow", L);
      const heading = str(p, "heading", L);
      const docLine = str(p, "docLine", L);
      const ledeHtml = str(p, "lede", L);
      const ctas = arr(p, "ctas").filter((i) => str(i, "label", L) || raw(i, "href"));
      const pills = arr(p, "pills").map((x) => str(x, "text", L)).filter(Boolean);
      const badges = arr(p, "badges").filter((b) => str(b, "text", L)).slice(0, 3);
      const signScript = str(p, "signScript", L);
      const signSmall = str(p, "signSmall", L);
      const imageId = raw(p, "image");
      const cmsSrc = imageId && ctx.images[imageId] ? ctx.images[imageId] : null;
      const idn = ctx.identity;
      const ownerName = idn ? ls(idn.ownerName, L) : "";
      const photoSrc = cmsSrc || idn?.ownerPhoto || null;
      const photoAlt = str(p, "imageAlt", L) || ownerName || heading;
      const hasContent = eyebrow || heading || docLine || ledeHtml || ctas.length > 0 || photoSrc;
      if (!hasContent) return null;
      const badgePos = ["b1", "b2", "b3"];
      return (
        <section className="hero" aria-label={heading || undefined}>
          {watermark && (
            <div aria-hidden="true" className="watermark">{watermark}</div>
          )}
          {scribble1 && <span aria-hidden="true" className="scribble s1">{scribble1}</span>}
          {scribble2 && <span aria-hidden="true" className="scribble s2">{scribble2}</span>}
          <div className="container hero-grid">
            <div>
              {eyebrow && <span className="eyebrow">{eyebrow}</span>}
              {heading && <h1 dir="auto">{heading}</h1>}
              {docLine && <div dir="auto" className="doc-line">{docLine}</div>}
              {ledeHtml && <RichText html={ledeHtml} className="lede" />}
              {ctas.length > 0 && (
                <div className="hero-cta">
                  {ctas.map((cta, idx) => {
                    const label = str(cta, "label", L);
                    const href = raw(cta, "href");
                    const variant = raw(cta, "variant") === "ghost" ? "btn-ghost" : "btn-blue";
                    const icon = str(cta, "icon", L);
                    return (
                      <SmartLink key={idx} href={href} ariaLabel={label} className={`btn ${variant}`}>
                        {icon ? <span aria-hidden="true">{icon}</span> : <span aria-hidden="true">←</span>}
                        {label}
                      </SmartLink>
                    );
                  })}
                </div>
              )}
              {pills.length > 0 && (
                <div className="mini-pills">
                  {pills.map((pill, idx) => (
                    <span key={idx} dir="auto">{pill}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="photo-wrap">
              <div aria-hidden="true" className="blob" />
              <svg aria-hidden="true" className="doodle d1" viewBox="0 0 64 64">
                <path d="M32 4c1.6 14.5 5.2 19.5 20.5 22.5C37.2 29.5 33.6 34.5 32 49c-1.6-14.5-5.2-19.5-20.5-22.5C26.8 23.5 30.4 18.5 32 4z" fill="#C99A2E" />
                <circle cx="53" cy="13" r="4.5" fill="#1E56C8" opacity=".5" />
              </svg>
              <svg aria-hidden="true" className="doodle d2" viewBox="0 0 80 40">
                <path d="M5 28c10-17 18 9 28-7s18 9 28-7" fill="none" stroke="#1E56C8" strokeWidth="5.5" strokeLinecap="round" opacity=".45" />
                <circle cx="70" cy="30" r="5" fill="#C99A2E" opacity=".7" />
              </svg>
              {photoSrc && (
                <img
                  className="photo"
                  // Marks the page's primary visual, same contract as
                  // ThinkerPortrait's `heroVisual`. The mockup transcription
                  // dropped it, so nothing identified the hero image anymore.
                  data-hero-visual="true"
                  src={photoSrc}
                  alt={photoAlt}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                />
              )}
              {badges.length > 0 && (
                <div className="fbadges">
                  {badges.map((b, idx) => (
                    <div key={idx} className={`badge ${badgePos[idx % badgePos.length]}`}>
                      <span aria-hidden="true" className={`dot dot-${raw(b, "dotTint") || "green"}`}>
                        {str(b, "icon", L) || "✓"}
                      </span>
                      <span dir="auto">{str(b, "text", L)}</span>
                    </div>
                  ))}
                </div>
              )}
              {(signScript || signSmall) && (
                <div className="sign">
                  {signScript && <div dir="auto" className="script">{signScript}</div>}
                  {signSmall && <small dir="auto">{signSmall}</small>}
                </div>
              )}
            </div>
          </div>
        </section>
      );
    }

    case "text": {
      const size = {
        body: "text-pub-base text-pub-muted",
        lead: "text-pub-md text-pub-muted",
        h3: "text-pub-h3 font-bold text-pub-ink",
        h2: "text-pub-h2 font-bold text-pub-ink",
        h1: "text-pub-h1 font-extrabold text-pub-ink",
      }[raw(p, "size")] ?? "text-pub-base text-pub-muted";
      const text = str(p, "content", L);
      if (!text) return null;
      const align = raw(p, "align") || "start";
      return <p className={`whitespace-pre-line ${size} ${ALIGN[align as keyof typeof ALIGN] ? (align === "center" ? "text-center" : align === "end" ? "text-end" : "text-start") : ""}`}>{text}</p>;
    }
    case "rich_text":
      return <RichText html={str(p, "html", L)} />;
    case "image": {
      const fileId = raw(p, "fileId");
      if (!fileId || !ctx.images[fileId]) return null;
      const img = <CmsImage fileId={fileId} alt={str(p, "alt", L)} ctx={ctx} fit={raw(p, "fit") || "cover"} aspect={raw(p, "aspect") || "auto"} rounded={bool(p, "rounded")} />;
      const href = raw(p, "href");
      if (!href) return img;
      return (
        <SmartLink href={href} className="block" ariaLabel={str(p, "alt", L)}>
          {img}
        </SmartLink>
      );
    }
    case "image_text": {
      const hasImage = raw(p, "fileId") && ctx.images[raw(p, "fileId")];
      const heading = str(p, "heading", L);
      const text = str(p, "text", L);
      if (!hasImage && !heading && !text) return null;
      const imageFirst = (raw(p, "imagePosition") || "start") === "start";
      const imgEl = hasImage ? <CmsImage fileId={raw(p, "fileId")} alt={str(p, "alt", L)} ctx={ctx} aspect="4:3" rounded /> : null;
      const textEl = (
        <div className="flex flex-col items-start gap-3">
          {heading && <h3 className="text-pub-h2 font-bold text-pub-ink">{heading}</h3>}
          {text && <p className="whitespace-pre-line text-pub-muted">{text}</p>}
          {str(p, "ctaLabel", L) && raw(p, "href") && (
            <CtaButton label={str(p, "ctaLabel", L)} href={raw(p, "href")} variant="primary" />
          )}
        </div>
      );
      return <div className={`grid items-center gap-6 md:grid-cols-2 ${imageFirst ? "" : "md:[direction:inherit]"}`}>{imageFirst ? <>{imgEl}{textEl}</> : <>{textEl}{imgEl}</>}</div>;
    }
    case "gallery": {
      const items = arr(p, "items").filter((i) => raw(i, "fileId") && ctx.images[raw(i, "fileId")]);
      if (!items.length) return null;
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, idx) => (
            <SmartLink key={idx} href={raw(item, "href")} className="block overflow-hidden rounded-pub-xl">
              <CmsImage fileId={raw(item, "fileId")} alt={str(item, "alt", L)} ctx={ctx} aspect="1:1" />
            </SmartLink>
          ))}
        </div>
      );
    }
    case "logo_cloud": {
      const items = arr(p, "items").filter((i) => raw(i, "fileId") && ctx.images[raw(i, "fileId")]);
      if (!items.length && !str(p, "heading", L)) return null;
      return (
        <div className="flex flex-col items-center gap-5">
          {str(p, "heading", L) && <p className="text-pub-sm font-medium text-pub-muted">{str(p, "heading", L)}</p>}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-6">
              {items.map((item, idx) => (
                <img key={idx} src={ctx.images[raw(item, "fileId")]} alt={str(item, "label", L)} loading="lazy" decoding="async" className="h-10 w-auto object-contain opacity-80" />
              ))}
            </div>
          )}
        </div>
      );
    }
    case "video": {
      const videoId = raw(p, "videoId");
      if (!videoId) return null;
      return (
        <div className="mx-auto w-full max-w-3xl">
          <Suspense fallback={<div className="h-40 rounded-xl bg-pub-surface-2" />}>
            <VideoPlayer videoId={videoId} title={str(p, "caption", L) || undefined} />
          </Suspense>
          {str(p, "caption", L) && <p className="mt-2 text-center text-pub-sm text-pub-muted">{str(p, "caption", L)}</p>}
        </div>
      );
    }
    case "buttons": {
      const items = arr(p, "items").filter((i) => str(i, "label", L) || raw(i, "href"));
      if (!items.length) return null;
      const align = raw(p, "align") || "start";
      const justify = align === "center" ? "justify-center" : align === "end" ? "justify-end" : "justify-start";
      return (
        <div className={`flex w-full flex-wrap gap-3 ${justify} ${bool(p, "stackMobile") ? "max-sm:flex-col max-sm:items-stretch" : ""}`}>
          {items.map((item, idx) => (
            <CtaButton key={idx} label={str(item, "label", L)} href={raw(item, "href")} target={raw(item, "target")} variant={raw(item, "variant")} icon={raw(item, "icon")} className={bool(p, "stackMobile") ? "max-sm:w-full" : ""} />
          ))}
        </div>
      );
    }
    case "icon_feature": {
      const icon = raw(p, "icon");
      const label = str(p, "label", L);
      if (!icon && !label) return null;
      const align = raw(p, "align") || "center";
      return (
        <div className={`flex flex-col gap-2 ${ALIGN[align as keyof typeof ALIGN] ?? ALIGN.center}`}>
          {icon && <Icon name={icon} size={raw(p, "size") || "lg"} colorRole={raw(p, "colorRole") || "brand"} />}
          {label && <p className="font-medium text-pub-ink-soft">{label}</p>}
        </div>
      );
    }
    case "icon_grid": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || raw(i, "icon"));
      if (!items.length) return null;
      return (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => (
            <SmartLink key={idx} href={raw(item, "href")} className={`${PUB_CARD} flex-row items-start gap-3 p-5`}>
              {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" colorRole="brand" />}
              <span className="flex flex-col gap-1">
                {str(item, "title", L) && <span className="font-semibold text-pub-ink">{str(item, "title", L)}</span>}
                {str(item, "text", L) && <span className="text-pub-sm text-pub-muted">{str(item, "text", L)}</span>}
              </span>
            </SmartLink>
          ))}
        </div>
      );
    }
    case "feature_cards": {
      // Mockup-faithful features (mockup_v5.html #feats).
      // Every card: icon (emoji/text), title, text, tint — all CMS props.
      const items = arr(p, "items").filter((i) => str(i, "title", L) || str(i, "text", L));
      if (!items.length) return null;
      return (
        <div className="feats">
          {items.map((item, idx) => {
            const tint = raw(item, "tint");
            const tintCls = tint === "cream" ? "tint-cream" : tint === "mint" ? "tint-mint" : "tint-blue";
            return (
              <div key={idx} className="feat">
                <div aria-hidden="true" className={`ic ${tintCls}`}>{str(item, "icon", L) || "✨"}</div>
                <h3 dir="auto">{str(item, "title", L)}</h3>
                {str(item, "text", L) && <p dir="auto">{str(item, "text", L)}</p>}
              </div>
            );
          })}
        </div>
      );
    }

    case "pricing_cards": {
      const items = arr(p, "items").filter((i) => str(i, "name", L));
      if (!items.length) return null;
      return (
        <div className="grid items-stretch gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => {
            const features = str(item, "features", L).split("\n").map((s) => s.trim()).filter(Boolean);
            const highlighted = bool(item, "highlighted");
            return (
              <div key={idx} className={`flex flex-col gap-4 rounded-pub-xl border p-6 ${highlighted ? "border-pub-navy bg-pub-surface/50 ring-1 ring-pub-navy" : "border-pub-line bg-pub-bg"}`}>
                <div>
                  <h3 className="text-pub-md font-bold text-pub-ink">{str(item, "name", L)}</h3>
                  <p className="mt-2 text-pub-h1 font-extrabold text-pub-ink" dir="auto">{raw(item, "price")}</p>
                  {str(item, "period", L) && <p className="text-pub-sm text-pub-muted">{str(item, "period", L)}</p>}
                </div>
                {features.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-pub-sm text-pub-muted">
                        <Icon name="check" size="sm" colorRole="success" className="mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {str(item, "ctaLabel", L) && (
                  <CtaButton label={str(item, "ctaLabel", L)} href={raw(item, "ctaHref")} variant={highlighted ? "primary" : "outline"} className="mt-auto w-full" />
                )}
              </div>
            );
          })}
        </div>
      );
    }
    case "statistics": {
      const items = arr(p, "items").filter((i) => str(i, "value", L) || str(i, "label", L));
      if (!items.length) return null;
      const style = raw(p, "style") || "cards";
      if (style === "bar") {
        return (
          <div className={`${PUB_BAND} px-3 py-4 sm:px-4`}>
            <div className="pub-grid grid-cols-2 gap-0 lg:grid-cols-4">
              {items.map((item, idx) => {
                const label = str(item, "label", L);
                const value = str(item, "value", L);
                const icon = raw(item, "icon");
                const href = raw(item, "href");
                const inner = (
                  <span className="flex items-center gap-3">
                    {icon && (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pub-md bg-pub-on-navy/10 text-pub-accent-soft">
                        <Icon name={icon} size="md" colorRole="invert" className="text-pub-accent-soft" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      {value && <span className="text-pub-md font-extrabold text-pub-on-navy" dir="auto">{value}</span>}
                      {label && <span className="text-pub-xs leading-pub-snug text-pub-on-navy-soft">{label}</span>}
                    </span>
                  </span>
                );
                const wrapCls = `flex min-h-16 items-center px-3 py-3 sm:px-4 ${idx < items.length - 1 ? "lg:border-e lg:border-pub-on-navy/15" : ""}`;
                return href ? (
                  <SmartLink key={idx} href={href} className={`${wrapCls} rounded-pub-lg transition-colors hover:bg-pub-on-navy/5`}>
                    {inner}
                  </SmartLink>
                ) : (
                  <div key={idx} className={wrapCls}>{inner}</div>
                );
              })}
            </div>
          </div>
        );
      }
      return (
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {items.map((item, idx) => (
            <div key={idx} className={`${PUB_CARD} items-center gap-1 p-5 text-center`}>
              {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" colorRole="accent" />}
              <span className="text-pub-lg font-extrabold text-pub-ink" dir="auto">{str(item, "value", L)}</span>
              {str(item, "label", L) && <span className={CARD_BODY}>{str(item, "label", L)}</span>}
            </div>
          ))}
        </div>
      );
    }
    case "testimonials": {
      const items = arr(p, "items").filter((i) => str(i, "quote", L));
      if (!items.length) return null;
      return (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => (
            <figure key={idx} className="flex flex-col gap-3 rounded-pub-xl border border-pub-line bg-pub-bg p-6">
              <Icon name="quote" size="md" colorRole="brand" />
              <blockquote className="text-pub-sm leading-pub-normal text-pub-ink-soft">{str(item, "quote", L)}</blockquote>
              <figcaption className="mt-auto flex items-center gap-3">
                {raw(item, "image") && ctx.images[raw(item, "image")] && (
                  <img src={ctx.images[raw(item, "image")]} alt={str(item, "name", L)} loading="lazy" decoding="async" className="h-10 w-10 rounded-full object-cover" />
                )}
                <span className="flex flex-col">
                  {str(item, "name", L) && <span className="text-pub-sm font-semibold text-pub-ink">{str(item, "name", L)}</span>}
                  {str(item, "role", L) && <span className="text-pub-xs text-pub-muted">{str(item, "role", L)}</span>}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      );
    }
    case "faq": {
      const items = arr(p, "items").filter((i) => str(i, "q", L));
      if (!items.length) return null;
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {items.map((item, idx) => (
            <details key={idx} className="group rounded-pub-xl border border-pub-line bg-pub-bg px-5 py-1 open:pb-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-pub-sm font-semibold text-pub-ink [&::-webkit-details-marker]:hidden">
                {str(item, "q", L)}
                <Icon name="chevron-down" size="sm" colorRole="muted" className="transition-transform group-open:rotate-180" />
              </summary>
              <p className="whitespace-pre-line pb-2 text-pub-sm leading-pub-normal text-pub-muted">{str(item, "a", L)}</p>
            </details>
          ))}
        </div>
      );
    }
    case "accordion": {
      const items = arr(p, "items").filter((i) => str(i, "title", L));
      if (!items.length) return null;
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {items.map((item, idx) => (
            <details key={idx} className="group rounded-pub-xl border border-pub-line bg-pub-bg px-5 py-1 open:pb-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-pub-sm font-semibold text-pub-ink [&::-webkit-details-marker]:hidden">
                {str(item, "title", L)}
                <Icon name="chevron-down" size="sm" colorRole="muted" className="transition-transform group-open:rotate-180" />
              </summary>
              <RichText html={str(item, "content", L)} className="pb-2 text-pub-sm leading-pub-normal text-pub-muted" />
            </details>
          ))}
        </div>
      );
    }
    case "announcement": {
      const text = str(p, "text", L);
      if (!text) return null;
      const tone = { info: "bg-pub-surface-2 text-pub-ink", success: "bg-pub-success-bg text-pub-success", warning: "bg-pub-warning-bg text-pub-warning", brand: "bg-pub-surface text-pub-navy" }[raw(p, "tone")] ?? "bg-pub-surface-2 text-pub-ink";
      return (
        <div className={`flex flex-wrap items-center justify-center gap-3 rounded-pub-xl px-5 py-3 text-pub-sm font-medium ${tone}`}>
          {raw(p, "icon") && <Icon name={raw(p, "icon")} size="sm" colorRole="default" className="text-current" />}
          <span>{text}</span>
          {str(p, "ctaLabel", L) && raw(p, "href") && (
            <SmartLink href={raw(p, "href")} className="inline-flex min-h-9 items-center font-semibold underline underline-offset-4">{str(p, "ctaLabel", L)}</SmartLink>
          )}
        </div>
      );
    }
    case "promo_banner": {
      const nowMs = ctx.now;
      const startsAt = typeof p.startsAt === "number" ? p.startsAt : null;
      const endsAt = typeof p.endsAt === "number" ? p.endsAt : null;
      if (startsAt && nowMs < startsAt) return null;   // window not open yet
      if (endsAt && nowMs > endsAt) return null;       // expired — disappears
      const heading = str(p, "heading", L);
      const text = str(p, "text", L);
      if (!heading && !text) return null;
      return (
        <div className="grid items-center gap-6 overflow-hidden rounded-pub-2xl bg-pub-navy md:grid-cols-2">
          <div className="flex flex-col items-start gap-3 p-5 sm:p-8">
            {heading && <h3 className="text-pub-lg font-extrabold leading-pub-tight text-pub-on-navy">{heading}</h3>}
            {text && <p className="whitespace-pre-line text-pub-sm leading-pub-normal text-pub-on-navy-soft">{text}</p>}
            {str(p, "ctaLabel", L) && raw(p, "ctaHref") && (
              <CtaButton label={str(p, "ctaLabel", L)} href={raw(p, "ctaHref")} variant="gold" shape="pill" />
            )}
          </div>
          {raw(p, "image") && ctx.images[raw(p, "image")] && (
            <CmsImage fileId={raw(p, "image")} alt={heading} ctx={ctx} aspect="4:3" className="h-full" />
          )}
        </div>
      );
    }
    case "countdown":
      return <Countdown props={p} ctx={ctx} />;
    case "teacher_profile": {
      // Mockup-faithful about (mockup_v5.html #about).
      // Photo from identity (ownerPhotoFileId) or explicit image prop.
      // Script line, heading, paragraphs, stamp — all CMS props.
      const scriptLine = str(p, "scriptLine", L);
      const heading = str(p, "heading", L);
      const paragraphs = arr(p, "paragraphs").map((x) => str(x, "text", L)).filter(Boolean);
      const stamp = str(p, "stamp", L);
      const imageId = raw(p, "image");
      const cmsSrc = imageId && ctx.images[imageId] ? ctx.images[imageId] : null;
      const idn = ctx.identity;
      const ownerName = idn ? ls(idn.ownerName, L) : "";
      const photoSrc = cmsSrc || idn?.ownerPhoto || null;
      const photoAlt = str(p, "imageAlt", L) || ownerName || heading;
      if (!heading && !paragraphs.length && !photoSrc) return null;
      return (
        <div className="about-grid">
          <div className="about-photo">
            {photoSrc && (
              <img className="about-avatar" src={photoSrc} alt={photoAlt} loading="lazy" decoding="async" />
            )}
            {stamp && <span dir="auto" className="stamp">{stamp}</span>}
          </div>
          <div className="about-txt">
            {scriptLine && <div dir="auto" className="script">{scriptLine}</div>}
            {heading && <h2 dir="auto">{heading}</h2>}
            {paragraphs.map((para, idx) => (
              <p key={idx} dir="auto">{para}</p>
            ))}
          </div>
        </div>
      );
    }

    case "login_cta":
    case "register_cta": {
      const href = block.type === "login_cta" ? "/login" : "/register";
      const label = str(p, "label", L) || (block.type === "login_cta" ? (L === "ar" ? "تسجيل الدخول" : "Log in") : L === "ar" ? "إنشاء حساب" : "Create account");
      return (
        <div className={`${PUB_CARD} gap-4 p-6 text-center sm:p-8`}>
          {str(p, "sublabel", L) && <p className="max-w-md text-pub-md text-pub-muted">{str(p, "sublabel", L)}</p>}
          <CtaButton label={label} href={href} variant="primary" />
        </div>
      );
    }
    case "social_links": {
      // Mockup-faithful contact grid (mockup_v5.html #contact).
      // Each card: icon (image URL or emoji), label, sub, href, tint — CMS props.
      // Special hrefs: `whatsapp:` resolves from settings, `exam:external`
      // resolves from questionPlatformUrl (hidden when unconfigured).
      const cards = arr(p, "cards").filter((c) => str(c, "label", L) || raw(c, "href"));
      if (!cards.length) return null;
      return (
        <div className="contact-grid">
          {cards.map((card, idx) => {
            const label = str(card, "label", L);
            const sub = str(card, "sub", L);
            const href = raw(card, "href");
            const iconUrl = raw(card, "iconUrl");
            const iconEmoji = str(card, "iconEmoji", L);
            const tint = sicTintFor(raw(card, "tint") || "blue", raw(card, "iconBg"));
            // Icon source, in CSP-safe order: controlled icon id → an image the
            // CSP can actually load → the legacy simpleicons URL healed into a
            // built-in glyph → emoji. `.mk .sic svg` already sizes the inline
            // SVG exactly like the <img> it replaces, so the card is unchanged.
            const iconId = raw(card, "icon") || (iconUrl && !isRenderableImgSrc(iconUrl) ? iconIdFromUrl(iconUrl) : "");
            return (
              <SmartLink key={idx} href={href} ariaLabel={label} className="scard">
                <span aria-hidden="true" className={`sic sic-${tint}`}>
                  {iconId ? (
                    <Icon name={iconId} size="md" colorRole="invert" />
                  ) : isRenderableImgSrc(iconUrl) ? (
                    <img src={iconUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span>{iconEmoji || "🔗"}</span>
                  )}
                </span>
                <b dir="auto">{label}</b>
                {sub && <small dir="auto">{sub}</small>}
              </SmartLink>
            );
          })}
        </div>
      );
    }

    case "contact_info": {
      // Identity-driven rows (reads kept exactly): phone / email / address
      // from Settings → Identity, gated by the show* toggles. Only the surface
      // changed — bordered cards with a tinted icon disc (mockup .scard).
      const idn = ctx.identity;
      const rows: Array<{ icon: string; label: string; value: string; ltr: boolean }> = [];
      if (bool(p, "showPhone") && idn.contactPhone)
        rows.push({ icon: "phone", label: L === "en" ? "Phone" : "الهاتف", value: idn.contactPhone, ltr: true });
      if (bool(p, "showEmail") && idn.contactEmail)
        rows.push({ icon: "mail", label: L === "en" ? "Email" : "البريد الإلكتروني", value: idn.contactEmail, ltr: true });
      const address = str(p, "addressOverride", L) || ls(idn.contactAddress, L);
      if (bool(p, "showAddress") && address)
        rows.push({ icon: "map-pin", label: L === "en" ? "Address" : "العنوان", value: address, ltr: false });
      if (!rows.length) return null;
      return (
        <ul className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, idx) => (
            <li
              key={idx}
              className="flex w-full items-center gap-3.5 rounded-[1.375rem] border border-pub-line bg-white p-4 shadow-pub-card transition duration-200 hover:-translate-y-1 hover:border-pub-line-strong hover:shadow-pub-md"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pub-card text-pub-blue">
                <Icon name={row.icon} size="md" colorRole="default" className="text-current" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-pub-xs font-bold text-pub-muted">{row.label}</span>
                <span dir={row.ltr ? "ltr" : "auto"} className="block text-pub-sm font-extrabold text-pub-ink [overflow-wrap:anywhere]">{row.value}</span>
              </span>
            </li>
          ))}
        </ul>
      );
    }

    case "whatsapp_cta": {
      const phone = (raw(p, "phone") || ctx.identity.whatsapp).replace(/[^\d]/g, "");
      if (!phone) return null; // not configured → nothing renders
      const label = str(p, "label", L) || (L === "ar" ? "تواصل عبر واتساب" : "Chat on WhatsApp");
      const href = `https://wa.me/${phone}`;
      if (raw(p, "style") === "floating") {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} className="fixed bottom-[var(--pub-fab-inset)] end-[var(--pub-fab-inset)] z-40 inline-flex h-[var(--pub-fab-size)] w-[var(--pub-fab-size)] items-center justify-center rounded-pub-pill bg-pub-whatsapp text-pub-bg shadow-pub-lg hover:bg-pub-whatsapp-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-navy">
            <Icon name="whatsapp" size="lg" colorRole="default" className="text-pub-bg" />
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-pub-md bg-pub-navy px-6 py-3 text-pub-base font-semibold text-pub-bg hover:bg-pub-whatsapp-strong">
          <Icon name="whatsapp" size="sm" colorRole="default" className="text-pub-bg" />
          {label}
        </a>
      );
    }
    case "telegram_cta": {
      const url = raw(p, "url") || ctx.identity.telegram;
      if (!url) return null;
      const label = str(p, "label", L) || (L === "ar" ? "انضم إلى تليجرام" : "Join on Telegram");
      if (raw(p, "style") === "floating") {
        return (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} className="fixed bottom-[calc(var(--pub-fab-inset)+var(--pub-fab-clear))] end-[var(--pub-fab-inset)] z-40 inline-flex h-[var(--pub-fab-size)] w-[var(--pub-fab-size)] items-center justify-center rounded-pub-pill bg-pub-navy text-pub-bg shadow-pub-lg hover:bg-pub-navy-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong">
            <Icon name="telegram" size="lg" colorRole="default" className="text-pub-bg" />
          </a>
        );
      }
      return (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-pub-md bg-pub-navy px-6 py-3 text-pub-base font-semibold text-pub-bg hover:bg-pub-navy-2">
          <Icon name="telegram" size="sm" colorRole="default" className="text-pub-bg" />
          {label}
        </a>
      );
    }
    case "form_block":
    case "newsletter_form": {
      const form = ctx.forms[raw(p, "formId")] ?? Object.values(ctx.forms).find((f) => f.slug === raw(p, "formSlug"));
      const heading = str(p, "heading", L);
      const text = str(p, "text", L);
      if (!form) return null; // form deleted/disabled → block disappears (no crash)
      return (
        <div className="flex flex-col gap-4">
          {heading && <h3 className="text-center text-pub-h2 font-bold text-pub-ink">{heading}</h3>}
          {text && <p className="text-center text-pub-muted">{text}</p>}
          <CmsForm form={form} ctx={ctx} compact={block.type === "newsletter_form"} />
        </div>
      );
    }
    // Thumbnail rows shared by course / subject / program / product / featured.
    case "course_cards":
    case "subject_cards":
    case "program_cards":
    case "product_cards":
    case "featured_content": {
      const rows = ctx.dynamic[block.id] ?? [];
      return <CardGrid rows={rows} ctx={ctx} />;
    }

    case "free_content":
    case "latest_lessons":
    case "video_showcase": {
      // Mockup-faithful video cards (mockup_v5.html #vids).
      // Dynamic rows from ctx.dynamic; static `videos` prop as CMS fallback.
      const rows = (ctx.dynamic[block.id] ?? []).filter((r) => ls(r.title, L));
      const staticVids = arr(p, "videos").filter((v) => str(v, "title", L));
      const vids = rows.length > 0
        ? rows.map((r) => ({
            title: ls(r.title, L),
            tag: ls(r.badge, L) || "",
            meta: (r.chips ?? []).map((c) => ls(c, L)).filter(Boolean).join(" • "),
            href: r.href,
            thumb: r.imageUrl || (r.image && ctx.images[r.image] ? ctx.images[r.image] : null),
            emoji: "",
            duration: "",
          }))
        : staticVids.map((v) => ({
            title: str(v, "title", L),
            tag: str(v, "tag", L),
            meta: str(v, "meta", L),
            href: raw(v, "href"),
            thumb: null,
            emoji: str(v, "emoji", L),
            duration: raw(v, "duration"),
          }));
      if (!vids.length) return null;
      const thumbTones = ["t1", "t2", "t3"];
      return (
        <div className="vids">
          {vids.map((vid, idx) => (
            <div key={idx} className="vcard">
              <div className={`thumb ${thumbTones[idx % thumbTones.length]}`}>
                {vid.thumb ? (
                  <img src={vid.thumb} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span aria-hidden="true" className="big">{vid.emoji || "🎬"}</span>
                )}
                <div aria-hidden="true" className="play">▶</div>
                {vid.duration && <span className="dur">{vid.duration}</span>}
              </div>
              <div className="vbody">
                {vid.tag && <span dir="auto" className="tag">{vid.tag}</span>}
                <h3 dir="auto">{vid.href ? <SmartLink href={vid.href}>{vid.title}</SmartLink> : vid.title}</h3>
                {vid.meta && <div dir="auto" className="meta"><span>{vid.meta}</span></div>}
              </div>
            </div>
          ))}
        </div>
      );
    }

    case "study_subjects": {
      const rows = ctx.dynamic[block.id] ?? [];
      if (!rows.length) return null;
      const cols = {
        "1": "grid-cols-1",
        "2": "grid-cols-1 lg:grid-cols-2",
        "3": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      }[raw(p, "columns")] ?? "grid-cols-1 lg:grid-cols-2";
      // Unset means show (older snapshots): the journey meta line defaults on.
      const showJourney = p.showJourney !== false;
      const allLabel = str(p, "allLabel", L);
      const allHref = raw(p, "allHref");
      return (
        <div className="flex w-full flex-col gap-10">
          <ul className={`pub-grid ${cols}`}>
            {rows.map((row) => {
              const titleAr = ls(row.title, "ar");
              const titleEn = ls(row.title, "en");
              const title = L === "ar" ? titleAr || titleEn : titleEn || titleAr;
              const meta = showJourney ? ls(row.meta, L) : "";
              const desc = ls(row.desc, L);
              const cta = ls(row.cta, L) || title;
              const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
              return (
                <li key={row.id} className="h-full min-w-0">
                  {/* Subject card: white icon tile, bold title, meta line, and a
                      quiet text CTA — the whole card stays a single link. */}
                  <SmartLink
                    href={row.href}
                    ariaLabel={`${cta} — ${title}`}
                    className="group flex h-full min-h-[11rem] flex-col rounded-[1.375rem] border border-pub-line bg-white p-6 shadow-pub-card transition duration-200 hover:-translate-y-1.5 hover:border-pub-line-strong hover:shadow-pub-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong"
                  >
                    <span className="mb-4 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-pub-card text-pub-blue">
                      <Icon name="book-open" size="lg" colorRole="default" className="text-current" />
                    </span>
                    <h3 className="min-w-0 text-pub-base font-extrabold leading-pub-normal text-pub-ink [overflow-wrap:anywhere]">{title}</h3>
                    {meta && <p className="mt-1 text-pub-xs font-semibold text-pub-muted" dir="auto">{meta}</p>}
                    {desc && <p className="mt-1.5 line-clamp-2 text-pub-sm leading-pub-normal text-pub-muted">{desc}</p>}
                    {chips.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {chips.map((chip) => (
                          <li key={chip} className={CHIP}>{chip}</li>
                        ))}
                      </ul>
                    )}
                    <span className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-3 text-pub-sm font-extrabold text-pub-blue transition-colors group-hover:text-pub-navy-2">
                      {cta}
                      <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5 rtl:rotate-180">→</span>
                    </span>
                  </SmartLink>
                </li>
              );
            })}
          </ul>
          {allLabel && allHref && (
            <p>
              <CtaButton label={allLabel} href={allHref} variant="secondary" />
            </p>
          )}
        </div>
      );
    }

    case "grade_cards": {
      // Mockup-faithful grade cards (mockup_v5.html #grades).
      // Rows come from ctx.dynamic (CMS-driven grades); static fallback cards
      // from props keep the section editable even without dynamic data.
      const rows = (ctx.dynamic[block.id] ?? []).filter((r) => ls(r.title, L));
      const staticCards = arr(p, "cards").filter((c) => str(c, "title", L));
      const cards = rows.length > 0
        ? rows.map((r) => ({
            title: ls(r.title, L),
            sub: ls(r.desc, L),
            icon: ls(r.badge, L) || "🏛️",
            pills: (r.chips ?? []).map((c) => ls(c, L)).filter(Boolean),
            ctaLabel: (r.cta && ls(r.cta, L)) || "",
            href: r.href,
          }))
        : staticCards.map((c) => ({
            title: str(c, "title", L),
            sub: str(c, "sub", L),
            icon: str(c, "icon", L) || "🏛️",
            pills: arr(c, "pills").map((x) => str(x, "text", L)).filter(Boolean),
            ctaLabel: str(c, "ctaLabel", L),
            href: raw(c, "href"),
          }));
      if (!cards.length) return null;
      return (
        <div className="grades">
          {cards.map((card, idx) => {
            const tone = idx % 2 === 1 ? "blue" : "cream";
            return (
              <div key={idx} className={`gcard ${tone}`}>
                <div aria-hidden="true" className="giant">{card.icon}</div>
                <div aria-hidden="true" className="medal">{card.icon}</div>
                <h3 dir="auto">{card.title}</h3>
                {card.sub && <div dir="auto" className="sub">{card.sub}</div>}
                {card.pills.length > 0 && (
                  <div className="stat-pills">
                    {card.pills.map((pill, pi) => (
                      <span key={pi} dir="auto">{pill}</span>
                    ))}
                  </div>
                )}
                {(card.ctaLabel || card.href) && (
                  <SmartLink
                    href={card.href || "#grades"}
                    ariaLabel={card.ctaLabel || card.title}
                    className={`btn ${tone === "blue" ? "btn-blue" : "btn-gold"}`}
                  >
                    <span aria-hidden="true">←</span>
                    {card.ctaLabel || card.title}
                  </SmartLink>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    case "exam_platform": {
      const url = ctx.questionPlatformUrl;
      // `exam_platform` is a banner for a platform the site may or may not
      // configure; without a configured URL it must collapse, never render a
      // dead button.
      if (!url) return null;
      const headingText = str(p, "heading", L);
      const text = str(p, "text", L);
      const cta = str(p, "ctaLabel", L) || t(L, "home.examCta");
      const note = str(p, "note", L);
      return (
        <div className={`${PUB_BAND} relative overflow-hidden rounded-pub-2xl px-6 py-12 text-center sm:px-10 sm:py-14`}>
          <SectionDecor variant="band" />
          <span className="mb-4 inline-flex min-h-9 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-pub-sm font-extrabold text-pub-accent-soft">
              <Icon name="external-link" size="sm" colorRole="default" className="text-current" />
              {t(L, "home.externalTag")}
            </span>
            {headingText && (
              <h2 className="mx-auto max-w-[26ch] text-pub-xl font-black leading-[1.5] text-white [overflow-wrap:anywhere]">{headingText}</h2>
            )}
            {text && <p className="pub-measure mx-auto mt-3 text-pub-base leading-pub-normal text-pub-on-dark">{text}</p>}
            <div className="mt-7 flex flex-col items-center justify-center gap-3">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pub-pill bg-pub-accent px-10 py-3.5 text-pub-base font-extrabold text-white shadow-pub-md transition-all hover:-translate-y-0.5 hover:bg-pub-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong"
              >
                {cta}
                <span aria-hidden="true" className="rtl:rotate-180">→</span>
              </a>
              {note && <p className="text-pub-xs text-pub-on-dark">{note}</p>}
            </div>
          </div>
      );
    }

    case "journey_steps": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || str(i, "text", L));
      if (!items.length) return null;
      return (
        <ol className="grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, idx) => {
            const href = raw(item, "href");
            const title = str(item, "title", L);
            const icon = raw(item, "icon");
            const body = (
              <>
                <span className="mb-4 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-pub-card text-pub-xl font-black text-pub-blue">
                  {icon ? (
                    <Icon name={icon} size="lg" colorRole="default" className="text-current" />
                  ) : (
                    idx + 1
                  )}
                </span>
                {title && <h3 className="text-pub-base font-extrabold leading-pub-normal text-pub-ink [overflow-wrap:anywhere]">{title}</h3>}
                {str(item, "text", L) && <p className="mt-2 text-pub-sm leading-pub-normal text-pub-muted">{str(item, "text", L)}</p>}
              </>
            );
            const cls =
              "flex h-full flex-col rounded-[1.375rem] border border-pub-line bg-white p-6 shadow-pub-card transition duration-200 hover:-translate-y-1.5 hover:border-pub-line-strong hover:shadow-pub-md";
            return (
              <li key={idx} className="h-full">
                {href ? (
                  <SmartLink href={href} ariaLabel={title} className={cls}>
                    {body}
                  </SmartLink>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      );
    }

    case "benefit_list": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || str(i, "text", L));
      if (!items.length) return null;
      return (
        <ul className="grid w-full gap-x-8 gap-y-5 sm:grid-cols-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-pub-md bg-pub-tint text-pub-ink-soft">
                <Icon name={raw(item, "icon") || "check"} size="sm" colorRole="accent" />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                {str(item, "title", L) && <span className="text-pub-base font-bold text-pub-ink">{str(item, "title", L)}</span>}
                {str(item, "text", L) && <span className={CARD_BODY}>{str(item, "text", L)}</span>}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    case "cta_banner": {
      // Mockup-faithful final CTA (mockup_v5.html .cta).
      // Navy band with cream wave, heading, text, gold button — CMS props.
      const heading = str(p, "heading", L);
      const text = str(p, "text", L);
      const ctaLabel = str(p, "ctaLabel", L);
      const ctaHref = raw(p, "ctaHref");
      const ctaIcon = str(p, "ctaIcon", L);
      if (!heading && !text && !ctaLabel) return null;
      return (
        <section className="cta" aria-label={heading || undefined}>
          <svg aria-hidden="true" className="wave" viewBox="0 0 1440 70" preserveAspectRatio="none">
            <path d="M0,0 C360,70 1080,70 1440,0 L1440,0 L0,0 Z" fill="#F9F3E6" />
          </svg>
          <div className="container">
            {heading && <h2 dir="auto">{heading}</h2>}
            {text && <p dir="auto">{text}</p>}
            {ctaLabel && (
              <SmartLink href={ctaHref || "#grades"} ariaLabel={ctaLabel} className="btn btn-gold">
                <span aria-hidden="true">{ctaIcon || "←"}</span>
                {ctaLabel}
              </SmartLink>
            )}
          </div>
        </section>
      );
    }

    case "divider": {
      const variant = raw(p, "variant") || "line";
      if (variant === "dots") return <div className="flex justify-center gap-2 py-2" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-pub-line-strong" />)}</div>;
      if (variant === "gradient") return <hr className="h-px border-0 bg-pub-line-strong" aria-hidden="true" />;
      return <hr className="h-px border-0 bg-pub-line" aria-hidden="true" />;
    }
    case "spacer": {
      const size = { sm: "h-4", md: "h-8", lg: "h-14", xl: "h-24" }[raw(p, "size")] ?? "h-8";
      return <div className={size} aria-hidden="true" />;
    }

    case "quote_cards": {
      // Mockup-faithful quotes (mockup_v5.html #quotes — "أقوال مأثورة").
      // Each quote: text + author + optional thinker portrait — all CMS props.
      // `figure` is a thinker id (socrates, plato, ...) resolving to the
      // platform's own illustration in /visuals/thinkers/.
      const quotes = arr(p, "quotes").filter((q) => str(q, "text", L));
      if (!quotes.length) return null;
      return (
        <div className="qgrid">
          {quotes.map((q, idx) => {
            const figure = raw(q, "figure");
            const figSrc = figure ? `/visuals/thinkers/${figure}.webp` : "";
            return (
              <div key={idx} className="q">
                {figSrc && (
                  <img src={figSrc} alt="" aria-hidden="true" loading="lazy" decoding="async" className="qfig" />
                )}
                <p dir="auto">{str(q, "text", L)}</p>
                {str(q, "author", L) && <b dir="auto">{str(q, "author", L)}</b>}
              </div>
            );
          })}
        </div>
      );
    }
    default:
      return null; // unknown/legacy type → skipped, never crashes the page
  }
}

// ---------------------------------------------------------------------------
// Section + page composition
// ---------------------------------------------------------------------------

/**
 * Section chrome, expressed in LAYER A only. `brand`/`dark` both become the same
 * flat navy band (the two used to differ by themeable tokens, which is how a
 * saved page could end up violet on one band and navy on the next); `default`,
 * `surface` and `muted` are the light steps that carry 70–80% of the page.
 */
const SECTION_BG: Record<string, string> = {
  default: "bg-pub-bg",
  surface: "bg-pub-surface",
  muted: "bg-pub-surface-2",
  brand: "bg-pub-navy text-pub-on-navy",
  dark: "bg-pub-navy text-pub-on-navy",
  image: "bg-pub-bg",
};
/** One rhythm (mobile-first clamp in app.css) instead of density-scaled px. */
const SECTION_PAD: Record<string, string> = {
  none: "",
  sm: "py-[calc(var(--pub-pad-y)*0.55)]",
  md: "py-[var(--pub-pad-y)]",
  lg: "py-[calc(var(--pub-pad-y)*1.35)]",
  xl: "py-[calc(var(--pub-pad-y)*1.7)]",
};
const SECTION_CONTAINER: Record<string, string> = {
  narrow: "max-w-[var(--pub-measure)]",
  normal: "max-w-[var(--pub-maxw)]",
  wide: "max-w-[calc(var(--pub-maxw)+4rem)]",
  full: "max-w-none",
};
/** Every grid declares its mobile column count — no implicit desktop-first grids. */
const SECTION_GRID: Record<string, string> = {
  "1": "grid-cols-1",
  "2": "grid-cols-1 sm:grid-cols-2",
  "3": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  "4": "grid-cols-2 lg:grid-cols-4",
};
const SECTION_GAP: Record<string, string> = {
  none: "gap-0",
  sm: "gap-[calc(var(--pub-gap)*0.6)]",
  md: "gap-[var(--pub-gap)]",
  lg: "gap-[calc(var(--pub-gap)*1.6)]",
};

export interface RenderBlock { id: string; type: string; props: P; visible: boolean; children?: RenderBlock[] }

/**
 * Block types whose content is resolved from the database at render time (or
 * from a platform setting). When such a block has nothing to show it renders
 * NOTHING — and a section whose only visible children are all empty like this
 * collapses completely (no orphan heading, no empty padded band). This is the
 * empty-first rule applied to composition: the owner never gets a section that
 * announces content the platform does not have yet.
 */
const DATA_DRIVEN_BLOCKS = new Set([
  "study_subjects", "course_cards", "subject_cards", "program_cards", "free_content",
  "featured_content", "latest_lessons", "product_cards",
]);
// grade_cards / video_showcase: dynamic rows OR static CMS cards (mockup fallback).
// They collapse only when BOTH are empty — see the explicit checks below.

function blockIsEmpty(block: RenderBlock, ctx: CmsRenderCtx): boolean {
  const type = block.type;
  if (DATA_DRIVEN_BLOCKS.has(type)) return (ctx.dynamic[block.id] ?? []).length === 0;
  if (type === "grade_cards") {
    const hasDynamic = (ctx.dynamic[block.id] ?? []).some((r) => ls(r.title, ctx.locale));
    const hasStatic = arr(block.props, "cards").some((c) => str(c, "title", ctx.locale));
    return !hasDynamic && !hasStatic;
  }
  if (type === "video_showcase") {
    const hasDynamic = (ctx.dynamic[block.id] ?? []).some((r) => ls(r.title, ctx.locale));
    const hasStatic = arr(block.props, "videos").some((v) => str(v, "title", ctx.locale));
    return !hasDynamic && !hasStatic;
  }
  if (type === "quote_cards") {
    return !arr(block.props, "quotes").some((q) => str(q, "text", ctx.locale));
  }
  // External exams entry: hidden while the platform is disabled/unconfigured.
  if (type === "exam_platform") return !ctx.questionPlatformUrl;
  /**
   * Identity/settings-driven blocks read the owner's OWN fields (Settings →
   * Identity, Appearance) — an unset field means there is nothing to show, so
   * the section has to collapse with it. Without this rule a fresh install
   * would render a padded "contact" band with no contact details in it.
   */
  if (type === "contact_info") {
    const p = block.props;
    const idn = ctx.identity;
    if (!idn) return true;
    return !(
      (bool(p, "showPhone") && idn.contactPhone) ||
      (bool(p, "showEmail") && idn.contactEmail) ||
      (bool(p, "showAddress") && (str(p, "addressOverride", ctx.locale) || ls(idn.contactAddress, ctx.locale)))
    );
  }
  if (type === "social_links") {
    const p = block.props;
    return !arr(p, "cards").some((c) => str(c, "label", ctx.locale) || raw(c, "href"));
  }
  if (type === "teacher_profile") {
    const p = block.props;
    if (str(p, "heading", ctx.locale) || arr(p, "paragraphs").some((x) => str(x, "text", ctx.locale))) return false;
    if (raw(p, "image") && ctx.images[raw(p, "image")]) return false;
    if (ctx.identity?.ownerPhoto) return false;
    return true;
  }
  return false;
}

/**
 * Anchor ids of the sections that will ACTUALLY render, using the same predicate
 * `SectionView` uses to decide whether to emit its `id` at all.
 *
 * This is what keeps fragment links (#videos, #books, #exams…) truthful: a
 * collapsed section emits no `id`, so a link to it would be a dead anchor. Keeping
 * the predicate in one place (here) and consuming it in `resolveCmsHref` means the
 * link layer can never disagree with the section layer.
 */
function renderedAnchorIds(sections: RenderBlock[], ctx: CmsRenderCtx): Set<string> {
  const ids = new Set<string>();
  for (const s of sections) {
    if (!s.visible) continue;
    const children = (s.children ?? []).filter((c) => c.visible);
    if (children.length > 0 && children.every((c) => blockIsEmpty(c, ctx))) continue;
    const anchor = raw(s.props, "anchor");
    if (ANCHOR_ID_RE.test(anchor)) ids.add(anchor);
  }
  return ids;
}

// Blocks that render a COMPLETE mockup <section> themselves (hero, final CTA).
// SectionView passes them through without adding another wrapper.
const FULL_SECTION_BLOCKS = new Set(["hero_showcase", "cta_banner"]);

export function SectionView({ section, ctx, index = 0 }: { section: RenderBlock; ctx: CmsRenderCtx; index?: number }) {
  const p = section.props;
  const L = ctx.locale;
  if (!section.visible) return null;
  const children = (section.children ?? []).filter((c) => c.visible);
  // Section collapse rule (see DATA_DRIVEN_BLOCKS above).
  if (children.length > 0 && children.every((c) => blockIsEmpty(c, ctx))) return null;
  // Full-section blocks (hero / final CTA) render their own <section>.
  if (children.length === 1 && FULL_SECTION_BLOCKS.has(children[0].type)) {
    return (
      <div className="mk">
        <BlockBody block={children[0]} ctx={ctx} />
      </div>
    );
  }
  const heading = str(p, "heading", L);
  const subheading = str(p, "subheading", L);
  // Mockup section variants: `sectionStyle` prop selects the mockup treatment.
  // `quotes` → cream background; `about` → muted surface; `vids` → white.
  const sectionStyle = raw(p, "sectionStyle") || "default";
  const styleCls = sectionStyle === "quotes" ? "quotes" : sectionStyle === "about" ? "about" : sectionStyle === "vids" ? "sec-white" : "";
  // Owner-supplied anchor id — strict pattern + length, never arbitrary text.
  const rawAnchor = raw(p, "anchor");
  const anchorId = /^[A-Za-z0-9_-]{1,40}$/.test(rawAnchor) ? rawAnchor : undefined;
  const headingEl = (heading || subheading) ? (
    <div className="sec-head">
      <div aria-hidden="true" className="tick" />
      {heading && <h2 dir="auto">{heading}</h2>}
      {subheading && <p dir="auto">{subheading}</p>}
    </div>
  ) : null;
  return (
    <div className="mk">
      <section id={anchorId} className={`sec ${styleCls}`}>
        <div className="container">
          {headingEl}
          {children.map((child) => (
            <BlockBody key={child.id} block={child} ctx={ctx} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function PageView({ sections, ctx, main = true }: { sections: RenderBlock[]; ctx: CmsRenderCtx; main?: boolean }) {
  // `main` is false when the page is already wrapped in a <main> landmark by its
  // layout (e.g. the public layout) — nesting a second <main> would violate the
  // "one main landmark" rule (axe: landmark-no-duplicate-main / landmark-unique).
  const Wrapper = main ? "main" : "div";
  // Resolve link destinations once per page. The provider renders no DOM element,
  // so the emitted markup (and therefore the layout) is unchanged.
  const nav = useMemo<CmsHrefContext>(
    () => ({
      anchors: renderedAnchorIds(sections, ctx),
      questionPlatformUrl: ctx.questionPlatformUrl ?? null,
      whatsappNumber: ctx.identity.whatsapp || null,
    }),
    [sections, ctx],
  );
  return (
    <Wrapper className="flex flex-col bg-pub-bg">
      <CmsNavContext.Provider value={nav}>
        {sections.map((s, i) => (
          <SectionView key={s.id} section={s} ctx={ctx} index={i} />
        ))}
      </CmsNavContext.Provider>
    </Wrapper>
  );
}
