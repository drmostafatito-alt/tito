import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router";
import { Icon } from "~/cms/icons";
import { ls, type LStr } from "~/cms/l10n";
import { t } from "~/lib/i18n";
import { socialIconName } from "~/cms/social";
import { SectionDecor, DecorHairline } from "~/components/visuals/PhilosophyDecor";
import type { CardView, CmsRenderCtx, FormView } from "~/cms/render-types";

const VideoPlayer = lazy(() => import("~/components/player/VideoPlayer").then((m) => ({ default: m.VideoPlayer })));

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

/** Internal links → <Link>; external https → <a rel=noopener>; empty → span. */
function SmartLink({ href, className, children, ariaLabel }: { href: string; className?: string; children: React.ReactNode; ariaLabel?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  if (href.startsWith("/")) {
    return <Link to={href} className={className} aria-label={ariaLabel}>{children}</Link>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
}

const BUTTON_VARIANT = {
  primary: "bg-brand-600 text-white shadow-md shadow-brand-600/20 hover:bg-brand-700",
  secondary: "bg-white text-slate-800 border border-slate-200 shadow-sm hover:bg-slate-50",
  outline: "border border-slate-300 text-slate-800 hover:bg-slate-50",
  ghost: "text-brand-700 hover:bg-brand-50",
} as const;

/** Temporary abstract philosophy/psychology visual — CMS image replaces this. */
const FALLBACK_HERO_SRC = "/hero-philosophy.webp";

function CtaButton({ label, href, target, variant, icon, className = "" }: { label: string; href: string; target?: string; variant?: string; icon?: string; className?: string }) {
  if (!label && !href) return null; // nothing configured → render nothing
  const base = `inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-7 py-3 text-base font-semibold transition-colors ${BUTTON_VARIANT[(variant ?? "primary") as keyof typeof BUTTON_VARIANT] ?? BUTTON_VARIANT.primary} ${className}`;
  if (href && href.startsWith("/") && target !== "_blank") {
    return <Link to={href} className={base}>{icon ? <Icon name={icon} size="sm" colorRole="default" className="text-current" /> : null}{label}</Link>;
  }
  if (href) {
    return (
      <a href={href} {...(target === "_blank" ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})} className={base}>
        {icon ? <Icon name={icon} size="sm" colorRole="default" className="text-current" /> : null}
        {label}
      </a>
    );
  }
  return <span className={base}>{icon ? <Icon name={icon} size="sm" colorRole="default" className="text-current" /> : null}{label}</span>;
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
      className={`${aspectClass} w-full ${fit === "contain" ? "object-contain" : "object-cover"} ${rounded ? "rounded-[var(--radius-card)]" : ""} ${className}`}
    />
  );
}

function CardGrid({ rows, ctx, ctaFallback, showPlay }: { rows: CardView[]; ctx: CmsRenderCtx; ctaFallback?: LStr | null; showPlay?: boolean }) {
  if (!rows.length) return null; // empty-first: section collapses; polished empty states live on catalog pages
  const L = ctx.locale;
  return (
    <div className="grid w-full gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        // Prefer a direct https thumbnail (provider URL) over the file registry.
        const imgSrc = (row.imageUrl && /^https:\/\//i.test(row.imageUrl) ? row.imageUrl : null) ?? (row.image ? ctx.images[row.image] : null);
        const badge = row.badge ? ls(row.badge, L) : "";
        const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
        const ctaLabel = (row.cta && ls(row.cta, L)) || (ctaFallback ? ls(ctaFallback, L) : "") || ls(row.title, L);
        return (
          <article
            key={row.id}
            className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-navy-100 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-lg"
          >
            {imgSrc && (
              <div className="relative aspect-video overflow-hidden bg-navy-50">
                <img
                  src={imgSrc}
                  alt={ls(row.title, L)}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
                {showPlay && (
                  <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-navy-950/25">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-navy-800 shadow-md ring-1 ring-gold-300">
                      <Icon name="play-circle" size="md" colorRole="default" className="text-current" />
                    </span>
                  </span>
                )}
                {badge && (
                  <span className="absolute bottom-3 start-3 rounded-full bg-gold-500/95 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                    {badge}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-1 flex-col gap-2 p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-bold leading-snug text-navy-900">{ls(row.title, L)}</h3>
                {badge && !imgSrc && (
                  <span className="shrink-0 rounded-full bg-gold-50 px-2.5 py-0.5 text-xs font-semibold text-gold-700 ring-1 ring-gold-200">{badge}</span>
                )}
              </div>
              {ls(row.desc, L) && <p className="line-clamp-2 text-sm leading-relaxed text-slate-600">{ls(row.desc, L)}</p>}
              {row.meta && ls(row.meta, L) && (
                <p className="text-xs font-medium text-navy-500" dir="auto">{ls(row.meta, L)}</p>
              )}
              {chips.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <li key={chip} className="rounded-full bg-navy-50 px-2.5 py-1 text-[11px] font-medium text-navy-700 ring-1 ring-navy-100">
                      {chip}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-auto pt-3">
                <SmartLink
                  href={row.href}
                  ariaLabel={`${ctaLabel} — ${ls(row.title, L)}`}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-700 transition-colors hover:text-gold-700"
                >
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
      {str(props, "heading", L) && <p className="text-lg font-semibold">{str(props, "heading", L)}</p>}
      <div className="flex gap-3" dir="ltr" suppressHydrationWarning>
        {cells.map(([value, label], i) => (
          <div key={i} className="flex min-w-16 flex-col items-center rounded-[var(--radius-card)] bg-slate-900 px-3 py-2 text-white">
            <span className="text-2xl font-bold tabular-nums">{value ?? "--"}</span>
            <span className="text-[11px] text-slate-300">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CmsForm({ form, ctx, compact }: { form: FormView; ctx: CmsRenderCtx; compact?: boolean }) {
  const L = ctx.locale;
  const result = ctx.formResults[form.slug];
  const input = "w-full rounded-[var(--radius-btn)] border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none";
  return (
    <form method="post" className={`flex flex-col gap-4 ${compact ? "" : "mx-auto w-full max-w-xl"}`} noValidate>
      <input type="hidden" name="_cmsForm" value={form.slug} />
      {result && (
        <p role="status" className={`rounded-[var(--radius-btn)] px-4 py-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {result.ok ? ls(form.success, L) : ls(form.failure, L) || t(L, "common.cmsFormFailed")}
        </p>
      )}
      {form.fields.map((f) => {
        const err = result && !result.ok ? result.errors[f.name] : undefined;
        const label = (
          <label htmlFor={`cmsf-${form.slug}-${f.name}`} className="mb-1 block text-sm font-medium text-slate-700">
            {ls(f.label, L)}{f.required && <span className="text-rose-600"> *</span>}
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
                  <label key={o.value} className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name={f.name} value={o.value} className="h-4 w-4" />
                    {ls(o.label, L)}
                  </label>
                ))}
              </div>
            );
            break;
          case "checkbox":
            control = (
              <label className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
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
            {f.type === "radio" && <span id={`cmsf-${form.slug}-${f.name}-legend`} className="mb-1 block text-sm font-medium text-slate-700">{ls(f.label, L)}{f.required && <span className="text-rose-600"> *</span>}</span>}
            {control}
            {ls(f.help, L) && <p className="mt-1 text-xs text-slate-500">{ls(f.help, L)}</p>}
            {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
          </div>
        );
      })}
      {form.consentRequired && (
        <label className="inline-flex min-h-11 items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" name="__consent" value="on" className="mt-1 h-4 w-4" />
          <span>{ls(form.consent, L)}{result && !result.ok && result.errors.__consent && <span className="text-rose-600"> *</span>}</span>
        </label>
      )}
      <button type="submit" className={`inline-flex min-h-11 items-center justify-center rounded-[var(--radius-btn)] bg-brand-600 px-6 py-3 text-base font-semibold text-white hover:bg-brand-700 ${compact ? "shrink-0" : "self-start"}`}>
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

/** Icon chip surface — always white so the icon colour (navy/gold) reads clearly. */
const TINT_CHIP: Record<string, string> = {
  default: "bg-white ring-1 ring-navy-100",
  brand: "bg-white ring-1 ring-navy-100",
  accent: "bg-white ring-1 ring-gold-200",
  success: "bg-white ring-1 ring-navy-100",
  warning: "bg-white ring-1 ring-gold-200",
  error: "bg-white ring-1 ring-slate-200",
  muted: "bg-white ring-1 ring-navy-100",
};

/**
 * Card surfaces use ONLY the approved identity palette — navy, gold, light blue
 * and neutral (owner brief §1: "لا تستخدم ألوان كثيرة"). The registry's tint
 * field stays owner-editable; every tint maps into the same four families.
 */
const CARD_SURFACE: Record<string, string> = {
  default: "bg-navy-50 ring-navy-100",
  brand: "bg-navy-50 ring-navy-100",
  accent: "bg-gold-50 ring-gold-200",
  success: "bg-sky-50 ring-sky-100",
  warning: "bg-gold-50 ring-gold-200",
  error: "bg-slate-50 ring-slate-200",
  muted: "bg-sky-50 ring-sky-100",
};

/** Tint → the icon colour role actually rendered (navy or gold only). */
const TINT_ICON_ROLE: Record<string, string> = {
  default: "brand",
  brand: "brand",
  accent: "accent",
  success: "brand",
  warning: "accent",
  error: "muted",
  muted: "accent",
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
        className="inline-flex min-h-12 items-center gap-3 rounded-full px-1 py-1 text-start text-sm font-semibold text-slate-800 hover:bg-white/70"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-md shadow-brand-600/30">
          <Icon name="play-circle" size="md" colorRole="invert" className="text-white" />
        </span>
        <span className="max-w-[10rem] leading-snug">{label}</span>
      </button>
      {open && (
        <div id={`hero-video-${videoId}`} className="w-full max-w-xl">
          <Suspense fallback={<div className="h-40 rounded-xl bg-slate-100" />}>
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
      const height = { sm: "py-[calc(2rem*var(--density,1))]", md: "py-[calc(4.5rem*var(--density,1))]", lg: "py-[calc(7rem*var(--density,1))]" }[raw(p, "height")] ?? "py-[calc(4.5rem*var(--density,1))]";
      const align = raw(p, "align") || "center";
      const alignCls = align === "center" ? "items-center text-center" : align === "end" ? "items-end text-end" : "items-start text-start";
      const justify = align === "center" ? "justify-center" : align === "end" ? "justify-end" : "justify-start";
      return (
        <div className={`relative isolate -mx-4 overflow-hidden ${hasBg ? "" : "bg-slate-900"} ${height} flex ${alignCls} flex-col gap-4 px-4 sm:mx-0 sm:rounded-[var(--radius-card)] sm:px-10`}>
          {hasBg && (
            <>
              <img src={ctx.images[bgId]} alt="" aria-hidden="true" decoding="async" className="absolute inset-0 -z-10 h-full w-full object-cover" />
              <div className="absolute inset-0 -z-10 bg-slate-900/60" aria-hidden="true" />
            </>
          )}
          {heading && <h1 className="max-w-3xl text-3xl font-extrabold leading-tight text-white sm:text-5xl">{heading}</h1>}
          {subheading && <p className="max-w-2xl whitespace-pre-line text-lg text-slate-200">{subheading}</p>}
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
      const visualSrc = cmsSrc || FALLBACK_HERO_SRC;
      const badges = arr(p, "badges").filter((b) => raw(b, "icon") || str(b, "title", L) || str(b, "text", L));
      if (!eyebrow && !heading && !subtitleHtml && !ctas.length && !videoId && !visualSrc) return null;
      const imageAlt = str(p, "imageAlt", L) || heading;
      const badgeChips = badges.map((b, idx) => (
        <div key={idx} className="flex items-center gap-2.5 rounded-2xl border border-white/80 bg-white p-3 shadow-lg shadow-slate-900/5">
          {raw(b, "icon") && (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Icon name={raw(b, "icon")} size="md" colorRole="brand" />
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            {str(b, "title", L) && <span className="text-sm font-bold text-slate-900">{str(b, "title", L)}</span>}
            {str(b, "text", L) && <span className="text-xs leading-snug text-slate-500">{str(b, "text", L)}</span>}
          </span>
        </div>
      ));
      return (
        <div className="relative isolate overflow-hidden bg-gradient-to-b from-navy-100/70 via-navy-50/40 to-[var(--color-page-bg,#f7f9fc)]">
          <SectionDecor variant="hero" />
          <div className="mx-auto grid w-full max-w-7xl items-center gap-8 px-4 py-[calc(2.5rem*var(--density,1))] sm:gap-10 lg:grid-cols-2 lg:gap-12 lg:py-[calc(4rem*var(--density,1))]">
            <div className="flex flex-col items-start gap-4 sm:gap-5">
              {eyebrow && (
                <span className="inline-flex items-center gap-2 rounded-full border border-navy-200 bg-white/90 px-4 py-1.5 text-sm font-semibold text-navy-700 shadow-sm">
                  <Icon name="sparkles" size="sm" colorRole="accent" />
                  {eyebrow}
                </span>
              )}
              {heading && (
                <h1 className="text-3xl font-extrabold leading-[1.2] tracking-tight text-navy-900 sm:text-5xl xl:text-6xl">
                  {heading}
                  <span aria-hidden="true" className="mt-3 block h-1 w-24 rounded-full bg-gradient-to-r from-gold-400 to-gold-200" />
                </h1>
              )}
              {subtitleHtml && <RichText html={subtitleHtml} className="max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg" />}
              {(ctas.length > 0 || (videoLabel && videoId)) && (
                <div className="mt-1 flex w-full flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
                  {ctas.map((cta, idx) => (
                    <CtaButton key={idx} label={str(cta, "label", L)} href={raw(cta, "href")} target={raw(cta, "target")} variant={raw(cta, "variant") || "primary"} icon={raw(cta, "icon")} className="max-sm:w-full" />
                  ))}
                  {videoLabel && videoId && <VideoCta videoId={videoId} label={videoLabel} />}
                </div>
              )}
            </div>

            <div className="relative mx-auto w-full max-w-md lg:max-w-lg">
              <div aria-hidden="true" className="absolute -end-4 -top-6 h-28 w-28 rounded-full bg-gold-200/70 blur-[2px] lg:h-36 lg:w-36" />
              <div aria-hidden="true" className="absolute -bottom-3 -start-6 h-24 w-24 rounded-full bg-navy-200/60 blur-[1px]" />
              <div aria-hidden="true" className="absolute inset-x-6 -bottom-3 h-px bg-gradient-to-r from-transparent via-gold-400/70 to-transparent" />
              <img
                data-hero-visual="true"
                src={visualSrc}
                // Owner-provided image → real alt (owner alt or the heading).
                // The platform's DEFAULT illustration (no owner image) is
                // decorative: empty alt + aria-hidden so assistive tech and
                // image search never see a generic asset presented as content.
                alt={cmsSrc ? imageAlt : ""}
                aria-hidden={cmsSrc ? undefined : "true"}
                width={900}
                height={1205}
                decoding="async"
                fetchPriority="high"
                className="relative z-10 mx-auto max-h-[19rem] w-full object-contain drop-shadow-sm sm:max-h-[26rem] lg:max-h-[32rem]"
              />
              {badges.length > 0 && (
                <div className="relative z-20 mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:pointer-events-none lg:absolute lg:inset-0 lg:mt-0 lg:block">
                  {badges.map((b, idx) => (
                    <div key={idx} className={`lg:pointer-events-auto lg:absolute ${BADGE_POS[raw(b, "position")] ?? "lg:bottom-6 lg:start-6"}`}>
                      {badgeChips[idx]}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    case "text": {
      const size = { body: "text-base text-slate-600", lead: "text-lg text-slate-600", h3: "text-xl font-bold text-slate-900", h2: "text-2xl font-bold text-slate-900", h1: "text-3xl font-extrabold text-slate-900 sm:text-4xl" }[raw(p, "size")] ?? "text-base text-slate-600";
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
          {heading && <h3 className="text-2xl font-bold text-slate-900">{heading}</h3>}
          {text && <p className="whitespace-pre-line text-slate-600">{text}</p>}
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
            <SmartLink key={idx} href={raw(item, "href")} className="block overflow-hidden rounded-[var(--radius-card)]">
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
          {str(p, "heading", L) && <p className="text-sm font-medium text-slate-500">{str(p, "heading", L)}</p>}
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
          <Suspense fallback={<div className="h-40 rounded-xl bg-slate-100" />}>
            <VideoPlayer videoId={videoId} title={str(p, "caption", L) || undefined} />
          </Suspense>
          {str(p, "caption", L) && <p className="mt-2 text-center text-sm text-slate-500">{str(p, "caption", L)}</p>}
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
          {label && <p className="font-medium text-slate-700">{label}</p>}
        </div>
      );
    }
    case "icon_grid": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || raw(i, "icon"));
      if (!items.length) return null;
      return (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => (
            <SmartLink key={idx} href={raw(item, "href")} className="flex items-start gap-3 rounded-[var(--radius-card)] border border-slate-200 bg-white p-5 hover:border-brand-200">
              {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" colorRole="brand" />}
              <span className="flex flex-col gap-1">
                {str(item, "title", L) && <span className="font-semibold text-slate-900">{str(item, "title", L)}</span>}
                {str(item, "text", L) && <span className="text-sm text-slate-600">{str(item, "text", L)}</span>}
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
      return (
        <div className={`grid gap-4 ${cols}`}>
          {items.map((item, idx) => {
            const tint = raw(item, "tint") || "brand";
            const href = raw(item, "href");
            const cta = str(item, "ctaLabel", L);
            const title = str(item, "title", L);
            return (
              <div
                key={idx}
                className={`group flex flex-col items-start gap-3 rounded-[1.5rem] p-6 ring-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${CARD_SURFACE[tint] ?? CARD_SURFACE.brand}`}
              >
                {raw(item, "icon") && (
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm ${TINT_CHIP[tint] ?? TINT_CHIP.brand}`}>
                    <Icon name={raw(item, "icon")} size="md" colorRole={(TINT_ICON_ROLE[tint] ?? "brand") as never} />
                  </span>
                )}
                {title && <h3 className="text-lg font-bold text-navy-900">{title}</h3>}
                {str(item, "text", L) && <p className="text-sm leading-relaxed text-slate-600">{str(item, "text", L)}</p>}
                {href && (
                  <SmartLink
                    href={href}
                    ariaLabel={cta || title || str(item, "text", L)}
                    className="mt-auto inline-flex min-h-11 items-center gap-2 pt-1 text-sm font-semibold text-navy-700 transition-colors hover:text-gold-700"
                  >
                    <span>{cta || title}</span>
                    <span aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5 rtl:rotate-180">→</span>
                  </SmartLink>
                )}
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
              <div key={idx} className={`flex flex-col gap-4 rounded-[var(--radius-card)] border p-6 ${highlighted ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500" : "border-slate-200 bg-white"}`}>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{str(item, "name", L)}</h3>
                  <p className="mt-2 text-3xl font-extrabold text-slate-900" dir="auto">{raw(item, "price")}</p>
                  {str(item, "period", L) && <p className="text-sm text-slate-500">{str(item, "period", L)}</p>}
                </div>
                {features.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
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
          <div className="relative isolate overflow-hidden rounded-[1.75rem] bg-gradient-to-r from-navy-950 via-navy-900 to-navy-800 px-3 py-4 shadow-lg shadow-navy-900/15 sm:px-4">
            <span aria-hidden="true" className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {items.map((item, idx) => {
                const label = str(item, "label", L);
                const value = str(item, "value", L);
                const icon = raw(item, "icon");
                const href = raw(item, "href");
                const inner = (
                  <span className="flex items-center gap-3">
                    {icon && (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-gold-300 ring-1 ring-white/15">
                        <Icon name={icon} size="md" colorRole="invert" className="text-gold-300" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      {value && <span className="text-base font-extrabold text-white sm:text-lg" dir="auto">{value}</span>}
                      {label && <span className="text-sm text-navy-200">{label}</span>}
                    </span>
                  </span>
                );
                const wrapCls = `flex min-h-16 items-center px-4 py-3 ${idx < items.length - 1 ? "lg:border-e lg:border-white/10" : ""}`;
                return href ? (
                  <SmartLink key={idx} href={href} className={`${wrapCls} rounded-2xl transition-colors hover:bg-white/5`}>
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
            <div key={idx} className="flex flex-col items-center gap-1 rounded-[var(--radius-card)] border border-navy-100 bg-white p-5 text-center shadow-sm">
              {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" colorRole="accent" />}
              <span className="text-2xl font-extrabold text-navy-900" dir="auto">{str(item, "value", L)}</span>
              {str(item, "label", L) && <span className="text-sm text-slate-500">{str(item, "label", L)}</span>}
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
            <figure key={idx} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-slate-200 bg-white p-6">
              <Icon name="quote" size="md" colorRole="brand" />
              <blockquote className="text-sm leading-relaxed text-slate-700">{str(item, "quote", L)}</blockquote>
              <figcaption className="mt-auto flex items-center gap-3">
                {raw(item, "image") && ctx.images[raw(item, "image")] && (
                  <img src={ctx.images[raw(item, "image")]} alt={str(item, "name", L)} loading="lazy" decoding="async" className="h-10 w-10 rounded-full object-cover" />
                )}
                <span className="flex flex-col">
                  {str(item, "name", L) && <span className="text-sm font-semibold text-slate-900">{str(item, "name", L)}</span>}
                  {str(item, "role", L) && <span className="text-xs text-slate-500">{str(item, "role", L)}</span>}
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
            <details key={idx} className="group rounded-[var(--radius-card)] border border-slate-200 bg-white px-5 py-1 open:pb-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                {str(item, "q", L)}
                <Icon name="chevron-down" size="sm" colorRole="muted" className="transition-transform group-open:rotate-180" />
              </summary>
              <p className="whitespace-pre-line pb-2 text-sm leading-relaxed text-slate-600">{str(item, "a", L)}</p>
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
            <details key={idx} className="group rounded-[var(--radius-card)] border border-slate-200 bg-white px-5 py-1 open:pb-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                {str(item, "title", L)}
                <Icon name="chevron-down" size="sm" colorRole="muted" className="transition-transform group-open:rotate-180" />
              </summary>
              <RichText html={str(item, "content", L)} className="pb-2 text-sm leading-relaxed text-slate-600" />
            </details>
          ))}
        </div>
      );
    }
    case "announcement": {
      const text = str(p, "text", L);
      if (!text) return null;
      const tone = { info: "bg-slate-100 text-slate-800", success: "bg-emerald-50 text-emerald-800", warning: "bg-amber-50 text-amber-800", brand: "bg-brand-50 text-brand-800" }[raw(p, "tone")] ?? "bg-slate-100 text-slate-800";
      return (
        <div className={`flex flex-wrap items-center justify-center gap-3 rounded-[var(--radius-card)] px-5 py-3 text-sm font-medium ${tone}`}>
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
        <div className="grid items-center gap-6 overflow-hidden rounded-[var(--radius-card)] bg-slate-900 md:grid-cols-2">
          <div className="flex flex-col items-start gap-3 p-7 text-white sm:p-10">
            {heading && <h3 className="text-2xl font-bold">{heading}</h3>}
            {text && <p className="whitespace-pre-line text-slate-300">{text}</p>}
            {str(p, "ctaLabel", L) && raw(p, "ctaHref") && (
              <CtaButton label={str(p, "ctaLabel", L)} href={raw(p, "ctaHref")} variant="primary" />
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
      return (
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
          {photoUrl && <img src={photoUrl} alt={name} loading="lazy" decoding="async" className="h-40 w-40 shrink-0 rounded-[var(--radius-card)] object-cover md:h-52 md:w-52" />}
          <div className="flex flex-col items-center gap-2 md:items-start">
            {name && <h3 className="text-2xl font-bold text-slate-900">{name}</h3>}
            {title && <p className="font-medium text-brand-700">{title}</p>}
            {bio && <RichText html={bio} className="text-sm leading-relaxed text-slate-600" />}
          </div>
        </div>
      );
    }
    case "login_cta":
    case "register_cta": {
      const href = block.type === "login_cta" ? "/login" : "/register";
      const label = str(p, "label", L) || (block.type === "login_cta" ? (L === "ar" ? "تسجيل الدخول" : "Log in") : L === "ar" ? "إنشاء حساب" : "Create account");
      return (
        <div className="flex flex-col items-center gap-4 rounded-[1.75rem] bg-gradient-to-b from-brand-50 to-white p-10 text-center ring-1 ring-brand-100">
          {str(p, "sublabel", L) && <p className="max-w-md text-lg text-slate-600">{str(p, "sublabel", L)}</p>}
          <CtaButton label={label} href={href} variant="primary" />
        </div>
      );
    }
    case "social_links": {
      const items = arr(p, "items").filter((i) => raw(i, "url"));
      if (!items.length) return null;
      const asButtons = raw(p, "style") === "buttons";
      return (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {items.map((item, idx) => {
            const network = raw(item, "network");
            const label = str(item, "label", L);
            return asButtons ? (
              <a key={idx} href={raw(item, "url")} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-btn)] border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Icon name={network} size="sm" colorRole="default" className="text-current" />
                {label || network}
              </a>
            ) : (
              <a key={idx} href={raw(item, "url")} target="_blank" rel="noopener noreferrer nofollow" aria-label={label || network} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50">
                <Icon name={network} size="md" colorRole="default" className="text-current" />
              </a>
            );
          })}
        </div>
      );
    }
    case "contact_info": {
      const idn = ctx.identity;
      const rows: Array<[string, string]> = [];
      if (bool(p, "showPhone") && idn.contactPhone) rows.push(["phone", idn.contactPhone]);
      if (bool(p, "showEmail") && idn.contactEmail) rows.push(["mail", idn.contactEmail]);
      const address = str(p, "addressOverride", L) || ls(idn.contactAddress, L);
      if (bool(p, "showAddress") && address) rows.push(["map-pin", address]);
      if (!rows.length) return null;
      return (
        <ul className="flex flex-col gap-3">
          {rows.map(([icon, value], idx) => (
            <li key={idx} className="flex items-center gap-3 text-sm text-slate-700">
              <Icon name={icon} size="sm" colorRole="brand" />
              <span dir={icon === "phone" || icon === "mail" ? "ltr" : undefined}>{value}</span>
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
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} className="fixed bottom-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg hover:bg-emerald-600 ltr:right-5 rtl:left-5 max-sm:bottom-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <Icon name="whatsapp" size="lg" colorRole="default" className="text-white" />
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-emerald-500 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-600">
          <Icon name="whatsapp" size="sm" colorRole="default" className="text-white" />
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
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} className="fixed bottom-24 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg hover:bg-sky-600 ltr:right-5 rtl:left-5 max-sm:bottom-[calc(6rem+env(safe-area-inset-bottom))]">
            <Icon name="telegram" size="lg" colorRole="default" className="text-white" />
          </a>
        );
      }
      return (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-sky-500 px-6 py-3 text-base font-semibold text-white hover:bg-sky-600">
          <Icon name="telegram" size="sm" colorRole="default" className="text-white" />
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
          {heading && <h3 className="text-center text-2xl font-bold text-slate-900">{heading}</h3>}
          {text && <p className="text-center text-slate-600">{text}</p>}
          <CmsForm form={form} ctx={ctx} compact={block.type === "newsletter_form"} />
        </div>
      );
    }
    case "course_cards":
    case "subject_cards":
    case "program_cards":
    case "free_content":
    case "featured_content":
    case "latest_lessons": {
      const rows = ctx.dynamic[block.id] ?? [];
      return <CardGrid rows={rows} ctx={ctx} />;
    }
    case "video_showcase": {
      const rows = ctx.dynamic[block.id] ?? [];
      return <CardGrid rows={rows} ctx={ctx} showPlay />;
    }
    case "product_cards": {
      const rows = ctx.dynamic[block.id] ?? [];
      return <CardGrid rows={rows} ctx={ctx} />;
    }
    case "grade_cards": {
      const rows = (ctx.dynamic[block.id] ?? []).filter((r) => ls(r.title, L));
      if (!rows.length) return null;
      return (
        <div className="grid w-full gap-5 sm:grid-cols-2">
          {rows.map((row) => {
            const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
            const ctaLabel = (row.cta && ls(row.cta, L)) || ls(row.title, L);
            return (
              <article
                key={row.id}
                className="group relative isolate flex flex-col gap-3 overflow-hidden rounded-[1.75rem] border border-navy-100 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-lg sm:p-7"
              >
                <SectionDecor variant="page" />
                {row.badge && ls(row.badge, L) && (
                  <span className="w-fit rounded-full bg-navy-50 px-3 py-1 text-xs font-semibold text-navy-700 ring-1 ring-navy-100">
                    {ls(row.badge, L)}
                  </span>
                )}
                <h3 className="text-xl font-extrabold text-navy-900 sm:text-2xl">{ls(row.title, L)}</h3>
                <DecorHairline className="max-w-[8rem] text-gold-500" />
                {chips.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {chips.map((chip) => (
                      <li key={chip} className="rounded-full bg-gold-50 px-3 py-1 text-xs font-medium text-gold-800 ring-1 ring-gold-200">
                        {chip}
                      </li>
                    ))}
                  </ul>
                )}
                <SmartLink
                  href={row.href}
                  ariaLabel={`${ctaLabel} — ${ls(row.title, L)}`}
                  className="mt-auto inline-flex min-h-12 w-fit items-center gap-2 rounded-full bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800"
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
      if (!url) return null; // disabled/unconfigured/unsafe → nothing renders (same gate as the app entry)
      const headingText = str(p, "heading", L);
      const text = str(p, "text", L);
      const cta = str(p, "ctaLabel", L) || t(L, "home.examCta");
      const note = str(p, "note", L);
      return (
        <div className="relative isolate overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 p-6 text-white shadow-lg shadow-navy-900/20 sm:p-10">
          <SectionDecor variant="band" />
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="flex max-w-2xl flex-col gap-2">
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-gold-200 ring-1 ring-white/15">
                <Icon name="external-link" size="sm" colorRole="invert" className="text-gold-200" />
                {t(L, "home.externalTag")}
              </span>
              {headingText && <h2 className="text-2xl font-extrabold text-white sm:text-3xl">{headingText}</h2>}
              {text && <p className="text-sm leading-relaxed text-navy-100 sm:text-base">{text}</p>}
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-h-12 items-center gap-2 rounded-full bg-gold-500 px-6 py-3 text-base font-bold text-navy-950 shadow-md transition-colors hover:bg-gold-400 max-sm:w-full max-sm:justify-center"
              >
                {cta}
                <Icon name="external-link" size="sm" colorRole="default" className="text-navy-900" />
              </a>
              {note && <p className="text-xs text-navy-200 max-sm:w-full">{note}</p>}
            </div>
          </div>
        </div>
      );
    }
    case "journey_steps": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || str(i, "text", L));
      if (!items.length) return null;
      return (
        <ol className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, idx) => {
            const href = raw(item, "href");
            const title = str(item, "title", L);
            const body = (
              <>
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold tabular-nums text-gold-300">
                    {idx + 1}
                  </span>
                  {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" colorRole="accent" />}
                </span>
                {title && <h3 className="text-base font-bold text-navy-900">{title}</h3>}
                {str(item, "text", L) && <p className="text-sm leading-relaxed text-slate-600">{str(item, "text", L)}</p>}
              </>
            );
            const cls = "relative flex h-full flex-col gap-3 rounded-[var(--radius-card)] border border-navy-100 bg-white p-5 shadow-sm";
            return (
              <li key={idx} className="h-full">
                <span aria-hidden="true" className="mb-2 block h-0.5 w-10 rounded-full bg-gold-300" />
                {href ? (
                  <SmartLink href={href} ariaLabel={title} className={`${cls} transition-colors hover:border-gold-300 hover:shadow-md`}>
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
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-600 ring-1 ring-gold-200">
                <Icon name={raw(item, "icon") || "check"} size="sm" colorRole="accent" />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                {str(item, "title", L) && <span className="font-bold text-navy-900">{str(item, "title", L)}</span>}
                {str(item, "text", L) && <span className="text-sm leading-relaxed text-slate-600">{str(item, "text", L)}</span>}
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
        <div className="relative isolate overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 px-6 py-12 text-center text-white shadow-lg shadow-navy-900/20 sm:px-10 sm:py-14">
          <SectionDecor variant="cta" />
          <DecorHairline className="mx-auto mb-6 max-w-xs text-gold-400" />
          {headingText && <h2 className="text-2xl font-extrabold text-white sm:text-4xl">{headingText}</h2>}
          {text && <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-navy-100 sm:text-base">{text}</p>}
          {ctas.length > 0 && (
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3 max-sm:flex-col max-sm:items-stretch">
              {ctas.map((cta, idx) => (
                <CtaButton
                  key={idx}
                  label={str(cta, "label", L)}
                  href={raw(cta, "href")}
                  target={raw(cta, "target")}
                  variant={raw(cta, "variant") || "primary"}
                  icon={raw(cta, "icon")}
                  className={`max-sm:w-full ${idx === 0 ? "!bg-gold-500 !text-navy-950 hover:!bg-gold-400" : "!border-white/30 !bg-white/5 !text-white hover:!bg-white/10"}`}
                />
              ))}
            </div>
          )}
          {note && <p className="mt-5 text-xs text-navy-200">{note}</p>}
        </div>
      );
    }
    case "divider": {
      const variant = raw(p, "variant") || "line";
      if (variant === "dots") return <div className="flex justify-center gap-2 py-2" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-slate-300" />)}</div>;
      if (variant === "gradient") return <hr className="border-0 bg-gradient-to-r from-transparent via-slate-300 to-transparent h-px" aria-hidden="true" />;
      return <hr className="h-px border-0 bg-slate-200" aria-hidden="true" />;
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

const SECTION_BG: Record<string, string> = {
  default: "",
  surface: "bg-[var(--color-surface)]",
  muted: "bg-slate-100",
  brand: "bg-brand-600 text-white",
  dark: "bg-slate-900 text-slate-100",
  image: "",
};
const SECTION_PAD: Record<string, string> = {
  none: "",
  sm: "py-[calc(1rem*var(--density,1))]",
  md: "py-[calc(2.5rem*var(--density,1))]",
  lg: "py-[calc(4rem*var(--density,1))]",
  xl: "py-[calc(6rem*var(--density,1))]",
};
const SECTION_CONTAINER: Record<string, string> = {
  narrow: "max-w-3xl",
  normal: "max-w-6xl",
  wide: "max-w-7xl",
  full: "max-w-none",
};
const SECTION_GRID: Record<string, string> = {
  "1": "grid-cols-1",
  "2": "grid-cols-1 sm:grid-cols-2",
  "3": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  "4": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};
const SECTION_GAP: Record<string, string> = { none: "gap-0", sm: "gap-3", md: "gap-6", lg: "gap-10" };

export interface RenderBlock { id: string; type: string; props: P; visible: boolean; children?: RenderBlock[] }

export function SectionView({ section, ctx }: { section: RenderBlock; ctx: CmsRenderCtx }) {
  const p = section.props;
  const L = ctx.locale;
  if (!section.visible) return null;
  const children = (section.children ?? []).filter((c) => c.visible);
  const heading = str(p, "heading", L);
  const subheading = str(p, "subheading", L);
  const bg = raw(p, "bg") || "default";
  const bgImageId = bg === "image" ? raw(p, "bgImage") : "";
  const hasBgImage = Boolean(bgImageId && ctx.images[bgImageId]);
  const align = raw(p, "align") || "start";
  const columns = raw(p, "columns") || "1";
  const headingEl = heading || subheading ? (
    <div className={`mb-8 flex flex-col gap-2 ${align === "center" ? "items-center text-center" : align === "end" ? "items-end text-end" : "items-start text-start"}`}>
      {heading && <h2 className={`text-2xl font-extrabold tracking-tight sm:text-3xl ${bg === "brand" || bg === "dark" ? "text-white" : "text-navy-900"}`}>{heading}</h2>}
      {subheading && <p className={`max-w-2xl ${bg === "brand" || bg === "dark" ? "text-slate-300" : "text-slate-600"}`}>{subheading}</p>}
    </div>
  ) : null;

  // Owner-supplied anchor id — strict pattern + length, never arbitrary text.
  const rawAnchor = raw(p, "anchor");
  const anchorId = /^[A-Za-z0-9_-]{1,40}$/.test(rawAnchor) ? rawAnchor : undefined;
  return (
    <section
      id={anchorId}
      className={`relative isolate scroll-mt-24 overflow-hidden ${SECTION_BG[bg] ?? ""} ${SECTION_PAD[raw(p, "padding") || "md"] ?? SECTION_PAD.md} ${bool(p, "hideMobile") ? "max-md:hidden" : ""}`}
    >
      {(bg === "dark" || bg === "brand") && <SectionDecor variant="band" />}
      {hasBgImage && (
        <>
          <img src={ctx.images[bgImageId]} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-slate-900/60" aria-hidden="true" />
        </>
      )}
      <div className={`relative mx-auto w-full px-4 ${SECTION_CONTAINER[raw(p, "container") || "normal"] ?? SECTION_CONTAINER.normal}`}>
        {hasBgImage && !SECTION_BG[bg] ? <div className="text-white">{headingEl}</div> : headingEl}
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
  return (
    <Wrapper className="flex flex-col">
      {sections.map((s) => (
        <SectionView key={s.id} section={s} ctx={ctx} />
      ))}
    </Wrapper>
  );
}
