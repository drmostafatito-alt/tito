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
      const eyebrow = str(p, "eyebrow", L);
      const heading = str(p, "heading", L);
      const subtitleHtml = str(p, "subtitle", L);
      const ctas = arr(p, "ctas").filter((i) => str(i, "label", L) || raw(i, "href"));
      const videoLabel = str(p, "videoLabel", L);
      const videoId = raw(p, "videoId");
      const imageId = raw(p, "image");
      const cmsSrc = imageId && ctx.images[imageId] ? ctx.images[imageId] : null;
      const badges = arr(p, "badges").filter((b) => raw(b, "icon") || str(b, "title", L) || str(b, "text", L));
      // Identity plate: the owner's own name/photo, straight from Settings →
      // Identity, resolved through the same R2 file registry as every other
      // image. Nothing here invents or substitutes a picture: with no owner
      // photo the visual slot stays honestly empty, never a stand-in.
      const idn = ctx.identity;
      const ownerName = idn ? ls(idn.ownerName, L) : "";
      const ownerTitle = idn ? ls(idn.ownerTitle, L) : "";
      const ownerPhoto = idn?.ownerPhoto ?? null;
      const showIdentity = p.useIdentity !== false && Boolean(ownerName || ownerPhoto);
      const platePhoto = showIdentity ? ownerPhoto : null;
      const tagline = idn ? ls(idn.tagline, L) : "";
      if (!eyebrow && !heading && !subtitleHtml && !ctas.length && !videoId && !cmsSrc && !showIdentity) return null;
      const imageAlt = str(p, "imageAlt", L) || heading;
      // Floating badge chips cycle three corner slots over the visual.
      const badgeSlots = ["top-[4%] end-0", "anim-delay-1 top-[42%] start-0", "anim-delay-2 bottom-[12%] end-[6%]"];
      const visualBadges = badges.slice(0, 3).filter((b) => str(b, "title", L) || str(b, "text", L));
      const [heroFrameStart, heroFrameEnd] = heroFrameThinkers();
      const visual = cmsSrc ? (
        <div className="relative overflow-hidden rounded-pub-2xl border border-pub-line bg-white shadow-pub-md">
          <img
            data-hero-visual="true"
            src={cmsSrc}
            alt={imageAlt}
            width={900}
            height={675}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="aspect-[4/3] w-full object-cover"
          />
        </div>
      ) : (
        /* The owner's reference stage (owner brief §14–§19): one organic brand
           blob with semi-transparent philosophers standing behind it, and the
           teacher's own picture floating with its gold ring. With no published
           photo the reserved slot stays honestly empty — nothing stands in for
           the teacher — while the stage keeps exactly one eager hero visual
           (the frame's start figure) for LCP discipline. */
        <div className="relative mx-auto flex w-full max-w-[34rem] flex-col items-center">
          <div className={`relative isolate flex w-full items-end justify-center pb-2 ${platePhoto ? "min-h-[24rem] sm:min-h-[28rem]" : "min-h-[14rem] sm:min-h-[16rem]"}`}>
            <span aria-hidden="true" className="hero-blob absolute inset-x-2 bottom-6 top-0 -z-20 sm:inset-x-6" />
            <span aria-hidden="true" className="absolute -start-1 top-10 h-11 w-11 rounded-full bg-pub-accent opacity-90" />
            <span aria-hidden="true" className="absolute start-12 top-3 h-5 w-5 rounded-full bg-pub-tint" />
            <span aria-hidden="true" className="hero-orbit absolute -end-3 top-14 h-24 w-24 rounded-full opacity-60 sm:h-28 sm:w-28" />
            {heroFrameStart && (
              <ThinkerPortrait
                thinker={heroFrameStart}
                presentation="statue"
                eager={!platePhoto}
                heroVisual={!platePhoto}
                className="absolute -start-4 bottom-4 -z-10 h-[58%] w-auto sm:-start-8 sm:h-[64%]"
              />
            )}
            {heroFrameEnd && (
              <ThinkerPortrait
                thinker={heroFrameEnd}
                presentation="statue"
                className="absolute bottom-14 end-0 -z-10 h-[36%] w-auto sm:end-2 sm:h-[40%]"
              />
            )}
            {platePhoto && (
              <img
                src={platePhoto}
                alt={ownerName || ""}
                width={640}
                height={640}
                data-hero-visual="true"
                loading="eager"
                decoding="async"
                fetchPriority="high"
                className="animate-float relative z-[1] aspect-square w-full max-w-[25rem] rounded-full border-4 border-white object-cover shadow-pub-lg ring-4 ring-pub-accent"
              />
            )}
          </div>
          {(ownerName || ownerTitle) && (
            <div className="z-[1] -mt-9 flex max-w-full flex-col items-center gap-0.5 rounded-pub-xl border border-pub-line bg-white/95 px-6 py-3 text-center shadow-pub-md">
              {ownerName && (
                <span dir="auto" className="text-pub-base font-black text-pub-ink [overflow-wrap:anywhere]">
                  {ownerName}
                </span>
              )}
              {ownerTitle && (
                <span dir="auto" className="text-pub-sm font-bold text-pub-accent-strong">
                  {ownerTitle}
                </span>
              )}
            </div>
          )}
        </div>
      );
      return (
        <div className="relative overflow-hidden">
          <div className="pub-section pub-container grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12">
            <div className="flex min-w-0 flex-col items-start gap-5">
              {eyebrow && (
                <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-pub-accent-line bg-pub-accent-bg px-5 py-2 text-pub-sm font-extrabold text-pub-accent-strong">
                  {eyebrow}
                </span>
              )}
              {heading && (
                <h1 className="max-w-[34ch] text-pub-2xl font-black leading-[1.45] text-pub-ink [overflow-wrap:anywhere]">
                  {heading}
                </h1>
              )}
              {/* The owner's title/nickname as the gold line under the name. */}
              {showIdentity && ownerTitle && (
                <p dir="auto" className="-mt-3 text-pub-lg font-extrabold text-pub-accent-strong">
                  {ownerTitle}
                </p>
              )}
              {subtitleHtml && <RichText html={subtitleHtml} className="pub-measure text-pub-base leading-pub-normal text-pub-muted" />}
              {(ctas.length > 0 || (videoLabel && videoId)) && (
                <div className="flex w-full flex-wrap items-center gap-3 max-sm:flex-col max-sm:items-stretch [&>*]:max-sm:w-full">
                  {ctas.map((cta, idx) => {
                    const variant = raw(cta, "variant");
                    const label = str(cta, "label", L);
                    const href = raw(cta, "href");
                    const target = raw(cta, "target");
                    const icon = raw(cta, "icon");
                    // An explicit CMS variant keeps the system button grammar;
                    // otherwise the mockup's blue-primary / quiet-secondary pair.
                    if (variant) {
                      return (
                        <CtaButton key={idx} label={label} href={href} target={target} variant={variant} icon={icon} shape={raw(p, "ctaShape") || "pill"} />
                      );
                    }
                    const primary = idx === 0;
                    return (
                      <SmartLink
                        key={idx}
                        href={href}
                        ariaLabel={label}
                        className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-pub-pill px-8 py-3.5 text-pub-base font-extrabold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong ${
                          primary
                            ? "bg-pub-blue text-white shadow-pub-md hover:-translate-y-0.5 hover:bg-pub-blue-deep"
                            : "border-2 border-pub-line-strong bg-white text-pub-ink hover:-translate-y-0.5 hover:border-pub-blue hover:text-pub-blue"
                        }`}
                      >
                        {icon && <Icon name={icon} size="sm" colorRole="default" className="text-current" />}
                        {label}
                      </SmartLink>
                    );
                  })}
                  {videoLabel && videoId && <VideoCta videoId={videoId} label={videoLabel} />}
                </div>
              )}
              {/* Badges with no visual to float over become quiet pills. */}
              {!visual && badges.length > 0 && (
                <ul className="flex flex-wrap gap-2.5">
                  {badges.map((b, idx) => {
                    const chip = str(b, "title", L) || str(b, "text", L);
                    if (!chip) return null;
                    return (
                      <li key={idx} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-pub-line bg-white px-4 py-1.5 text-pub-xs font-bold text-pub-ink-soft shadow-pub-sm">
                        {raw(b, "icon") && <Icon name={raw(b, "icon")} size="sm" colorRole="default" className="text-pub-accent-strong" />}
                        <span dir="auto">{chip}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {(visual || tagline) && (
              <div className="relative mx-auto w-full max-w-[27rem]">
                {visual}
                {/* Floating chips over the visual (mockup badges). */}
                {visual && visualBadges.length > 0 && (
                  <div className="pointer-events-none absolute inset-0 z-[2]">
                    {visualBadges.map((b, idx) => (
                      <span key={idx} className={`animate-float absolute ${badgeSlots[idx % badgeSlots.length]}`}>
                        <span dir="auto" className="flex max-w-[10rem] items-center gap-2 rounded-2xl border border-white bg-white/85 px-3.5 py-2.5 text-pub-xs font-extrabold text-pub-ink shadow-pub-md backdrop-blur">
                          {raw(b, "icon") ? (
                            <Icon name={raw(b, "icon")} size="sm" colorRole="default" className="shrink-0 text-pub-accent-strong" />
                          ) : (
                            <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pub-success-bg text-pub-xs font-black text-pub-success">✓</span>
                          )}
                          {str(b, "title", L) || str(b, "text", L)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {tagline && !platePhoto && (
                  <p dir="auto" className="mx-auto mt-4 max-w-[24rem] text-center text-pub-md font-bold leading-pub-normal text-pub-ink-soft">
                    {tagline}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
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
      const items = arr(p, "items").filter((i) => str(i, "title", L) || str(i, "text", L));
      if (!items.length) return null;
      const cols = items.length >= 5 ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" : items.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
      // Mockup icon tiles: the CMS color roles land on the brand palette.
      const tileByTint: Record<string, string> = {
        default: "bg-pub-card text-pub-blue",
        brand: "bg-pub-card text-pub-blue",
        accent: "bg-pub-accent-bg text-pub-accent-strong",
        success: "bg-pub-success-bg text-pub-success",
        warning: "bg-pub-warning-bg text-pub-warning",
        error: "bg-pub-danger-bg text-pub-danger",
        muted: "bg-pub-surface text-pub-muted",
      };
      return (
        <div className={`grid w-full gap-6 ${cols}`}>
          {items.map((item, idx) => {
            const tint = tileByTint[raw(item, "tint") ?? ""] ?? tileByTint.default;
            const href = raw(item, "href");
            const cta = str(item, "ctaLabel", L);
            const title = str(item, "title", L);
            const text = str(item, "text", L);
            return (
              <article key={idx} className="group relative flex h-full flex-col items-start rounded-[1.375rem] border border-pub-line bg-white p-6 text-start shadow-pub-card transition duration-200 hover:-translate-y-1.5 hover:border-pub-line-strong hover:shadow-pub-md sm:p-7">
                {raw(item, "icon") && (
                  <span className={`mb-4 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tint}`}>
                    <Icon name={raw(item, "icon")} size="lg" colorRole="default" className="text-current" />
                  </span>
                )}
                {title && <h3 className="text-pub-base font-extrabold leading-pub-normal text-pub-ink [overflow-wrap:anywhere]">{title}</h3>}
                {text && <p className="mt-2 text-pub-sm leading-pub-normal text-pub-muted">{text}</p>}
                {href && (
                  <SmartLink href={href} ariaLabel={cta || title || text} className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-4 text-pub-sm font-extrabold text-pub-blue transition-colors hover:text-pub-navy-2">
                    <span>{cta || title}</span>
                    <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5 rtl:rotate-180">→</span>
                  </SmartLink>
                )}
              </article>
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
      const idn = ctx.identity;
      const name = bool(p, "useIdentity") ? ls(idn.ownerName, L) : str(p, "name", L);
      const title = bool(p, "useIdentity") ? ls(idn.ownerTitle, L) : str(p, "title", L);
      const photoUrl = bool(p, "useIdentity") ? idn.ownerPhoto : (raw(p, "photo") ? ctx.images[raw(p, "photo")] ?? null : null);
      const bio = str(p, "bio", L);
      if (!name && !photoUrl && !bio) return null;
      // `showPhoto: false` keeps the picture for ONE place per page: the homepage
      // hero already frames it, so the about block here stays text-only while the
      // /about page keeps the framed photo. Unset means show (older snapshots).
      const framed = photoUrl && p.showPhoto !== false;
      // Owner-chosen corner portrait for the text-only fallback (Marx for a
      // knowledge/about surface, per the site identity). `none`/unknown id →
      // no portrait at all.
      const wmId = raw(p, "watermark");
      const watermark = wmId && wmId !== "none" ? thinkerById(wmId) : null;
      const tagline = ctx.identity ? ls(ctx.identity.tagline, L) : "";
      const lines = (
        <>
          {name && <h3 className="text-pub-h2 font-bold text-pub-ink">{name}</h3>}
          {title && <p className="text-pub-md font-medium text-pub-ink-soft">{title}</p>}
          {!title && tagline && <p className="text-pub-md font-medium text-pub-ink-soft">{tagline}</p>}
          {bio && <RichText html={bio} className={`${CARD_BODY} pub-measure`} />}
        </>
      );
      if (!framed) {
        return (
          /* Without a picture the block owns its own surface: a white card, with
             the thinker engraving clipped inside it. A portrait that floats
             outside a container reads as a rendering artifact. */
          <div className="relative isolate flex min-h-[8.5rem] overflow-hidden rounded-pub-2xl border border-pub-line bg-white p-5 shadow-pub-md sm:min-h-[9.5rem] sm:p-6">
            {watermark && (
              /* The face sits in the upper third of the crop, which is exactly
                 where the mask keeps it dense: it dissolves downward into the
                 surface instead of being faded to nothing. */
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-0 z-0 block w-24 opacity-[0.4] sm:w-40">
                <ThinkerPortrait thinker={watermark} presentation="engrave" />
              </span>
            )}
            <div className={`relative z-[1] flex min-w-0 flex-col justify-center gap-2 ${watermark ? "sm:pe-[8rem]" : ""}`}>{lines}</div>
          </div>
        );
      }
      // Photo variant: the mockup "about" — floating portrait with a gold title
      // stamp, name and bio beside it. The picture is the owner's own upload,
      // never re-cropped, never filtered, never substituted.
      return (
        <div className="grid items-center gap-10 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="relative mx-auto flex w-full max-w-[20rem] flex-col items-center">
            {photoUrl && (
              <img
                src={photoUrl}
                alt={name}
                loading="lazy"
                decoding="async"
                className="animate-float aspect-square w-full rounded-full border-4 border-white object-cover shadow-pub-lg ring-4 ring-pub-accent"
              />
            )}
            {title && (
              <span dir="auto" className="z-[1] -mt-7 inline-flex max-w-full items-center justify-center gap-2 rounded-full bg-pub-accent px-6 py-2.5 text-center text-pub-base font-extrabold text-white shadow-pub-md">
                <span aria-hidden="true">🏅</span>
                {title}
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-col items-start gap-3 text-start">
            {name && <h2 className="text-pub-xl font-black leading-pub-tight text-pub-ink [overflow-wrap:anywhere]">{name}</h2>}
            {!title && tagline && <p className="text-pub-md font-extrabold text-pub-accent-strong">{tagline}</p>}
            {bio && <RichText html={bio} className="pub-measure text-pub-base leading-pub-normal text-pub-muted" />}
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
      const items = arr(p, "items").filter((i) => raw(i, "url"));
      const asButtons = raw(p, "style") === "buttons";
      // Brand-circle backgrounds for the mockup .scard rows, keyed by the
      // network icon id (the `network` field already stores an icon id).
      const NETWORK_BG: Record<string, string> = {
        whatsapp: "bg-pub-whatsapp",
        facebook: "bg-[#1877F2]",
        youtube: "bg-[#FF0000]",
        instagram: "bg-[#E1306C]",
        tiktok: "bg-[#141414]",
        telegram: "bg-[#229ED9]",
        linkedin: "bg-[#0A66C2]",
        twitter: "bg-[#141414]",
      };
      if (asButtons) {
        // The old centered pill row (kept for pages that set style=buttons).
        if (!items.length) return null;
        return (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {items.map((item, idx) => {
              const network = raw(item, "network");
              const label = str(item, "label", L);
              return (
                <a
                  key={idx}
                  href={raw(item, "url")}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex min-h-11 items-center gap-2 rounded-pub-md border border-pub-line-strong bg-white px-4 py-2.5 text-pub-sm font-medium text-pub-ink-soft transition-colors hover:bg-pub-surface"
                >
                  <Icon name={network} size="sm" colorRole="default" className="text-current" />
                  {label || network}
                </a>
              );
            })}
          </div>
        );
      }
      // Card grid (mockup .scard): optional Subscribe card and the configured
      // external exam platform, kept as cards alongside the CMS channels.
      type Entry = { key: string; label: string; href: string; icon: string; bg: string };
      const entries: Entry[] = [];
      if (bool(p, "showSubscribe")) {
        entries.push({
          key: "subscribe",
          label: str(p, "subscribeLabel", L) || (L === "en" ? "Subscribe now" : "اشترك الآن"),
          href: "/register",
          icon: "sparkles",
          bg: "bg-pub-blue",
        });
      }
      const examUrl = ctx.questionPlatformUrl;
      if (bool(p, "showExam") && examUrl) {
        entries.push({
          key: "exam",
          label: t(L, "questionPlatform.navLabel"),
          href: examUrl,
          icon: "help-circle",
          bg: "bg-[#0E7C86]",
        });
      }
      for (const [idx, item] of items.entries()) {
        const url = raw(item, "url");
        const network = raw(item, "network");
        const label = str(item, "label", L) || network;
        entries.push({
          key: `${idx}-${network}`,
          label,
          href: url,
          icon: network || "link",
          bg: NETWORK_BG[network] ?? "bg-pub-navy",
        });
      }
      if (!entries.length) return null;
      return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {entries.map((entry) => (
            <SmartLink
              key={entry.key}
              href={entry.href}
              ariaLabel={entry.label}
              className="group flex min-h-16 items-center gap-3.5 rounded-[1.375rem] border border-pub-line bg-white p-4 shadow-pub-card transition duration-200 hover:-translate-y-1.5 hover:border-pub-line-strong hover:shadow-pub-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong"
            >
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${entry.bg} text-white transition duration-200 group-hover:scale-110`}>
                <Icon name={entry.icon} size="md" colorRole="default" className="text-current" />
              </span>
              <span dir="auto" className="min-w-0 flex-1 text-pub-sm font-extrabold leading-pub-tight text-pub-ink [overflow-wrap:anywhere]">{entry.label}</span>
            </SmartLink>
          ))}
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
      const rows = ctx.dynamic[block.id] ?? [];
      return <CardGrid rows={rows} ctx={ctx} showPlay />;
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
      const rows = (ctx.dynamic[block.id] ?? []).filter((r) => ls(r.title, L));
      if (!rows.length) return null;
      return (
        <div className="grid w-full gap-6 sm:grid-cols-2">
          {rows.map((row, idx) => {
            // Odd/even color rhythm: blue / cream, exactly the mockup .gcard.
            const cream = idx % 2 === 1;
            const surface = cream ? "bg-pub-accent-bg" : "bg-pub-card";
            const ctaCls = cream
              ? "bg-pub-accent hover:bg-pub-accent-strong text-white"
              : "bg-pub-blue hover:bg-pub-blue-deep text-white";
            const title = ls(row.title, L);
            const badge = row.badge ? ls(row.badge, L) : "";
            const desc = ls(row.desc, L);
            const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
            const ctaLabel = (row.cta && ls(row.cta, L)) || title;
            return (
              <article key={row.id} className={`group relative flex h-full flex-col items-center gap-4 rounded-pub-2xl ${surface} p-8 text-center shadow-pub-card transition duration-200 hover:-translate-y-1.5 hover:shadow-pub-md sm:p-10`}>
                {badge && (
                  <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/80 px-4 py-1.5 text-pub-sm font-extrabold text-pub-accent-strong ring-1 ring-pub-accent-line">
                    <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-pub-accent text-pub-xs font-black text-white">✓</span>
                    {badge}
                  </span>
                )}
                <h3 className="text-pub-xl font-black leading-pub-tight text-pub-ink [overflow-wrap:anywhere]">{title}</h3>
                {desc && <p className="text-pub-base leading-pub-normal text-pub-ink-soft">{desc}</p>}
                {chips.length > 0 && (
                  <ul className="flex flex-wrap items-center justify-center gap-2.5">
                    {chips.map((chip) => (
                      <li key={chip} className="rounded-full bg-white/75 px-4 py-1.5 text-pub-xs font-bold text-pub-ink-soft">
                        {chip}
                      </li>
                    ))}
                  </ul>
                )}
                <SmartLink
                  href={row.href}
                  ariaLabel={`${ctaLabel} — ${title}`}
                  className={`mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-pub-pill px-8 py-3 text-pub-base font-extrabold shadow-pub-md transition-all hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong ${ctaCls}`}
                >
                  {ctaLabel}
                  <span aria-hidden="true" className="rtl:rotate-180">→</span>
                </SmartLink>
              </article>
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
      const headingText = str(p, "heading", L);
      const text = str(p, "text", L);
      const note = str(p, "note", L);
      const ctas = arr(p, "ctas").filter((i) => str(i, "label", L) || raw(i, "href"));
      if (!headingText && !text && !ctas.length) return null;
      return (
        <div className={`${PUB_BAND} relative overflow-hidden rounded-pub-2xl px-6 py-12 text-center sm:px-10 sm:py-16`}>
          {headingText && (
            <h2 className="mx-auto max-w-[26ch] text-pub-2xl font-black leading-[1.5] text-white [overflow-wrap:anywhere]">{headingText}</h2>
          )}
          {text && <p className="pub-measure mx-auto mt-3 text-pub-base leading-pub-normal text-pub-on-dark">{text}</p>}
          {ctas.length > 0 && (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 max-sm:flex-col max-sm:items-stretch">
              {ctas.map((cta, idx) => (
                <CtaButton
                  key={idx}
                  label={str(cta, "label", L)}
                  href={raw(cta, "href")}
                  target={raw(cta, "target")}
                  // On the dark band the system's own variants are used: the first
                  // CTA is the single gold accent, the rest are the dark secondary.
                  // The band is navy, so the variants are resolved FOR a dark
                  // surface: `outline`/`ghost` (built for white) would render an
                  // invisible label. One mapping, at the band that needs it.
                  variant={((): string => {
                    const want = raw(cta, "variant");
                    if (!want) return idx === 0 ? "gold" : "onDark";
                    if (want === "outline" || want === "ghost" || want === "secondary") return "onDark";
                    if (want === "primary") return idx === 0 ? "gold" : "onDark";
                    return want;
                  })()}
                  icon={raw(cta, "icon")}
                  shape={raw(p, "ctaShape") || "pill"}
                  className="max-sm:w-full"
                />
              ))}
            </div>
          )}
          {note && <p className="mx-auto mt-5 text-pub-xs text-pub-on-dark">{note}</p>}
        </div>
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
  "featured_content", "latest_lessons", "video_showcase", "product_cards", "grade_cards",
]);

function blockIsEmpty(block: RenderBlock, ctx: CmsRenderCtx): boolean {
  const type = block.type;
  if (DATA_DRIVEN_BLOCKS.has(type)) return (ctx.dynamic[block.id] ?? []).length === 0;
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
    // The optional subscribe/exam cards count as content too — otherwise a
    // section holding only those would collapse while the block renders.
    if (bool(p, "showSubscribe")) return false;
    if (bool(p, "showExam") && ctx.questionPlatformUrl) return false;
    return !arr(p, "items").some((i) => raw(i, "url"));
  }
  if (type === "teacher_profile") {
    const p = block.props;
    if (bool(p, "useIdentity") && ctx.identity) {
      if (ls(ctx.identity.ownerName, ctx.locale) || ctx.identity.ownerPhoto) return false;
    }
    return !(
      str(p, "name", ctx.locale) ||
      str(p, "bio", ctx.locale) ||
      (raw(p, "photo") && ctx.images[raw(p, "photo")])
    );
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

export function SectionView({ section, ctx, index = 0 }: { section: RenderBlock; ctx: CmsRenderCtx; index?: number }) {
  const p = section.props;
  const L = ctx.locale;
  if (!section.visible) return null;
  const children = (section.children ?? []).filter((c) => c.visible);
  // Section collapse rule (see DATA_DRIVEN_BLOCKS above).
  if (children.length > 0 && children.every((c) => blockIsEmpty(c, ctx))) return null;
  const heading = str(p, "heading", L);
  const subheading = str(p, "subheading", L);
  const bg = raw(p, "bg") || "default";
  // Mockup rhythm: unstyled sections alternate white / transparent over the
  // page canvas; an explicit saved bg (surface/muted/brand/dark/image) wins.
  const bgCls = bg === "default" ? (index % 2 === 1 ? "bg-white" : "bg-transparent") : (SECTION_BG[bg] ?? "bg-pub-bg");
  const bgImageId = bg === "image" ? raw(p, "bgImage") : "";
  const hasBgImage = Boolean(bgImageId && ctx.images[bgImageId]);
  const align = raw(p, "align") || "start";
  const columns = raw(p, "columns") || "1";
  const onDark = bg === "brand" || bg === "dark";
  // ONE figure per surface (owner brief §14–§16): blocks that already carry a
  // thinker (hero, teacher card, subject/course cards) keep their own face, so
  // only the remaining sections get the transparent backdrop philosopher.
  const sectionHasThinker = children.some((c) => THINKER_BLOCK_TYPES.has(c.type));
  // Mockup section heading: a short gold tick above a bold h2, then the
  // subheading. Alignment and dark-band colors keep the editor's settings.
  const headingEl = heading || subheading ? (
    <div className={`mb-10 sm:mb-12 flex flex-col gap-2 ${align === "center" ? "items-center text-center" : align === "end" ? "items-end text-end" : "items-start text-start"}`}>
      <span aria-hidden="true" className="mb-2 block h-1.5 w-14 rounded-full bg-pub-accent" />
      {heading && (
        <h2 className={`text-pub-xl font-black leading-pub-tight tracking-tight ${onDark ? "text-pub-on-navy" : "text-pub-ink"} [overflow-wrap:anywhere]`}>
          {heading}
        </h2>
      )}
      {subheading && (
        <p className={`pub-measure text-pub-sm leading-pub-normal ${onDark ? "text-pub-on-navy-soft" : "text-pub-muted"}`}>{subheading}</p>
      )}
    </div>
  ) : null;

  // Owner-supplied anchor id — strict pattern + length, never arbitrary text.
  const rawAnchor = raw(p, "anchor");
  const anchorId = /^[A-Za-z0-9_-]{1,40}$/.test(rawAnchor) ? rawAnchor : undefined;
  return (
    <section
      id={anchorId}
      className={`cms-section relative isolate scroll-mt-24 overflow-hidden ${bgCls} ${SECTION_PAD[raw(p, "padding") || "md"] ?? SECTION_PAD.md} ${bool(p, "hideMobile") ? "max-md:hidden" : ""}`}
    >
      {(bg === "dark" || bg === "brand") && <SectionDecor variant="band" />}
      {(bg === "default" || bg === "surface") && <span aria-hidden="true" className="decor-wash pointer-events-none absolute inset-0 -z-10 opacity-60" />}
      {/* The transparent philosopher behind every section that carries no
          figure of its own (owner request, 2026-09): bottom-corner anchored and
          masked away from the copy, so headings/cards/CTAs always sit on clean
          surface. Deterministic per section id → SSR and client agree. */}
      {!hasBgImage && !sectionHasThinker && (
        <ThinkerWash seed={`section:${section.id}`} surface={onDark ? "navy" : "light"} />
      )}
      {hasBgImage && (
        <>
          <img src={ctx.images[bgImageId]} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-pub-navy/70" aria-hidden="true" />
        </>
      )}
      <div className={`relative mx-auto w-full px-[var(--pub-pad-x)] ${SECTION_CONTAINER[raw(p, "container") || "normal"] ?? SECTION_CONTAINER.normal}`}>
        {hasBgImage && !SECTION_BG[bg] ? <div className="text-pub-bg">{headingEl}</div> : headingEl}
        {children.length > 0 && (
          <div className={`grid ${SECTION_GRID[columns] ?? SECTION_GRID["1"]} ${SECTION_GAP[raw(p, "gap") || "md"] ?? SECTION_GAP.md} ${align === "center" ? "justify-items-center" : ""} ${columns === "1" && align === "center" ? "[&>*]:mx-auto" : ""}`}>
            {children.map((child) => (
              <div key={child.id} className="w-full min-w-0">
                <BlockBody block={child} ctx={ctx} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
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
    () => ({ anchors: renderedAnchorIds(sections, ctx), questionPlatformUrl: ctx.questionPlatformUrl ?? null }),
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
