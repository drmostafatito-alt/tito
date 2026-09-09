import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router";
import { Icon } from "~/cms/icons";
import { ls, type LStr } from "~/cms/l10n";
import { t } from "~/lib/i18n";
import { socialIconName } from "~/cms/social";
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
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  secondary: "bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 hover:ring-slate-400",
  outline: "border border-slate-400 text-slate-900 hover:border-brand-800 hover:bg-slate-50",
  ghost: "text-slate-900 hover:bg-slate-100",
  light: "bg-white text-brand-800 hover:bg-slate-100",
} as const;

/** Temporary abstract philosophy/psychology visual — CMS image replaces this. */
const FALLBACK_HERO_SRC = "/hero-philosophy.webp";

function CtaButton({ label, href, target, variant, icon, className = "" }: { label: string; href: string; target?: string; variant?: string; icon?: string; className?: string }) {
  if (!label && !href) return null; // nothing configured → render nothing
  const base = `inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-btn)] px-6 py-3 text-base font-semibold transition-colors ${BUTTON_VARIANT[(variant ?? "primary") as keyof typeof BUTTON_VARIANT] ?? BUTTON_VARIANT.primary} ${className}`;
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

function CardGrid({ rows, ctx, ctaFallback }: { rows: CardView[]; ctx: CmsRenderCtx; ctaFallback?: LStr | null }) {
  if (!rows.length) return null; // empty-first: section collapses; polished empty states live on catalog pages
  const L = ctx.locale;
  return (
    <div className="grid w-full gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <div key={row.id} className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white transition-all hover:border-brand-800 hover:shadow-[6px_6px_0_0_var(--color-brand-800)]">
          {row.image && ctx.images[row.image] && (
            <CmsImage fileId={row.image} alt={ls(row.title, L)} ctx={ctx} aspect="16:9" />
          )}
          <div className="flex flex-1 flex-col gap-2 p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-ink">{ls(row.title, L)}</h3>
              {row.badge && ls(row.badge, L) && (
                <span className="shrink-0 rounded-md bg-brand-800 px-2.5 py-0.5 text-xs font-semibold text-white">{ls(row.badge, L)}</span>
              )}
            </div>
            {ls(row.desc, L) && <p className="line-clamp-2 text-sm leading-relaxed text-ink-muted">{ls(row.desc, L)}</p>}
            {row.meta && ls(row.meta, L) && <p className="text-xs text-slate-500">{ls(row.meta, L)}</p>}
            <div className="mt-auto pt-2">
              <SmartLink href={row.href} className="inline-flex min-h-11 items-center text-sm font-bold text-ink">
                <span className="sig-u">{(row.cta && ls(row.cta, L)) || (ctaFallback ? ls(ctaFallback, L) : "") || ls(row.title, L)}</span>
                <span aria-hidden="true" className="ms-1 text-accent-600 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5">→</span>
              </SmartLink>
            </div>
          </div>
        </div>
      ))}
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
      {str(props, "heading", L) && <p className="sig-display text-xl text-ink">{str(props, "heading", L)}</p>}
      <div className="flex gap-3" dir="ltr" suppressHydrationWarning>
        {cells.map(([value, label], i) => (
          <div key={i} className="flex min-w-16 flex-col items-center rounded-[var(--radius-btn)] bg-brand-800 px-3 py-2 text-white">
            <span className="sig-display text-2xl tabular-nums">{value ?? "--"}</span>
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
  const input = "w-full rounded-[var(--radius-btn)] border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/30";
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
          <label htmlFor={`cmsf-${form.slug}-${f.name}`} className="mb-1 block text-sm font-semibold text-ink">
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
      <button type="submit" className={`inline-flex min-h-11 items-center justify-center rounded-[var(--radius-btn)] bg-brand-700 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-800 ${compact ? "shrink-0" : "self-start"}`}>
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

/** Solid icon-chip surface per owner tint (feature_cards): the tint survives as
 * the chip color on an otherwise monochrome card. */
const TINT_CHIP: Record<string, string> = {
  default: "bg-brand-800 text-white",
  brand: "bg-brand-800 text-white",
  accent: "bg-accent-600 text-white",
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-white",
  error: "bg-rose-600 text-white",
  muted: "bg-slate-500 text-white",
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
        className="inline-flex min-h-12 items-center gap-3 rounded-[var(--radius-btn)] px-1 py-1 text-start text-sm font-semibold text-ink hover:bg-slate-100"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-brand-800 text-white">
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
        <div className={`sig-grid relative isolate -mx-4 overflow-hidden border-y-2 border-brand-800 bg-white ${height} flex ${alignCls} flex-col gap-5 px-4 sm:mx-0 sm:rounded-[var(--radius-card)] sm:border-2 sm:px-10`}>
          {hasBg && (
            <>
              <img src={ctx.images[bgId]} alt="" aria-hidden="true" decoding="async" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-20 grayscale" />
            </>
          )}
          <span aria-hidden="true" className="h-2 w-16 bg-accent-500" />
          {heading && <h1 className="sig-display max-w-3xl text-4xl leading-[1.15] text-ink sm:text-5xl">{heading}</h1>}
          {subheading && <p className="max-w-2xl whitespace-pre-line text-lg leading-relaxed text-ink-muted">{subheading}</p>}
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
        <div key={idx} className="flex items-center gap-2.5 rounded-[var(--radius-btn)] border-2 border-brand-800 bg-white p-3 shadow-[4px_4px_0_0_var(--color-brand-800)]">
          {raw(b, "icon") && (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-base)] bg-brand-800 text-white">
              <Icon name={raw(b, "icon")} size="md" colorRole="invert" />
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            {str(b, "title", L) && <span className="text-sm font-bold text-ink">{str(b, "title", L)}</span>}
            {str(b, "text", L) && <span className="text-xs leading-snug text-ink-muted">{str(b, "text", L)}</span>}
          </span>
        </div>
      ));
      return (
        <div className="sig-grid relative isolate overflow-hidden border-b-2 border-brand-800 bg-white">
          <div className="mx-auto w-full max-w-7xl px-4 py-[calc(2.5rem*var(--density,1))] lg:py-[calc(4rem*var(--density,1))]">
            {eyebrow && (
              <div className="mb-6 flex items-center gap-4">
                <span className="inline-flex shrink-0 items-center gap-2.5 text-sm font-bold text-ink">
                  <span aria-hidden="true" className="inline-block h-3.5 w-3.5 bg-accent-500" />
                  {eyebrow}
                </span>
                <span aria-hidden="true" className="h-px flex-1 bg-brand-800/25" />
              </div>
            )}
            {heading && <h1 className="sig-display max-w-5xl text-5xl leading-[1.1] text-ink sm:text-6xl xl:text-7xl">{heading}</h1>}
            <div className="mt-8 grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
              <div className="flex flex-col items-start gap-6 lg:col-span-6">
                {subtitleHtml && <RichText html={subtitleHtml} className="max-w-xl text-lg leading-loose text-ink-muted" />}
                {(ctas.length > 0 || (videoLabel && videoId)) && (
                  <div className="flex w-full flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
                    {ctas.map((cta, idx) => (
                      <CtaButton key={idx} label={str(cta, "label", L)} href={raw(cta, "href")} target={raw(cta, "target")} variant={raw(cta, "variant") || "primary"} icon={raw(cta, "icon")} className="max-sm:w-full" />
                    ))}
                    {videoLabel && videoId && <VideoCta videoId={videoId} label={videoLabel} />}
                  </div>
                )}
              </div>
              <div className="relative mx-auto w-full max-w-md lg:col-span-6 lg:max-w-none">
                <div className="relative overflow-hidden rounded-[var(--radius-card)] border-2 border-brand-800 bg-white shadow-[8px_8px_0_0_var(--color-brand-800)]">
                  <img
                    data-hero-visual="true"
                    src={visualSrc}
                    alt={imageAlt}
                    width={900}
                    height={1205}
                    decoding="async"
                    fetchPriority="high"
                    className="relative z-10 mx-auto max-h-[26rem] w-full object-contain lg:max-h-[30rem]"
                  />
                </div>
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
        </div>
      );
    }
    case "text": {
      const size = { body: "text-base leading-relaxed text-ink-muted", lead: "text-lg leading-relaxed text-ink-muted", h3: "text-xl font-bold text-ink", h2: "sig-display text-2xl text-ink", h1: "sig-display text-3xl text-ink sm:text-4xl" }[raw(p, "size")] ?? "text-base leading-relaxed text-ink-muted";
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
          {heading && <h3 className="sig-display text-2xl text-ink sm:text-3xl">{heading}</h3>}
          {text && <p className="whitespace-pre-line leading-relaxed text-ink-muted">{text}</p>}
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
          {str(p, "heading", L) && <p className="text-sm font-semibold text-ink-muted">{str(p, "heading", L)}</p>}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-6">
              {items.map((item, idx) => (
                <img key={idx} src={ctx.images[raw(item, "fileId")]} alt={str(item, "label", L)} loading="lazy" decoding="async" className="h-10 w-auto object-contain opacity-70 grayscale" />
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
            <SmartLink key={idx} href={raw(item, "href")} className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5 transition-all hover:border-brand-800 hover:shadow-[4px_4px_0_0_var(--color-brand-800)]">
              {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" colorRole="brand" />}
              <span className="flex flex-col gap-1">
                {str(item, "title", L) && <span className="font-bold text-ink">{str(item, "title", L)}</span>}
                {str(item, "text", L) && <span className="text-sm leading-relaxed text-ink-muted">{str(item, "text", L)}</span>}
              </span>
            </SmartLink>
          ))}
        </div>
      );
    }
    case "feature_cards": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || str(i, "text", L));
      if (!items.length) return null;
      const cols = items.length >= 5 ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-3";
      return (
        <div className={`grid gap-4 ${cols}`}>
          {items.map((item, idx) => {
            const tint = raw(item, "tint") || "brand";
            const href = raw(item, "href");
            const cta = str(item, "ctaLabel", L);
            return (
              <div key={idx} className="group flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-line bg-white p-6 transition-all hover:border-brand-800 hover:shadow-[6px_6px_0_0_var(--color-brand-800)]">
                <div className="flex w-full items-start justify-between gap-3">
                  {raw(item, "icon") ? (
                    <span className={`flex h-12 w-12 items-center justify-center rounded-[var(--radius-btn)] ${TINT_CHIP[tint] ?? TINT_CHIP.brand}`}>
                      <Icon name={raw(item, "icon")} size="md" colorRole="invert" className="text-current" />
                    </span>
                  ) : <span />}
                  <span aria-hidden="true" className="sig-display text-2xl tabular-nums text-slate-300 transition-colors group-hover:text-accent-600">{String(idx + 1).padStart(2, "0")}</span>
                </div>
                {str(item, "title", L) && <h3 className="text-lg font-bold text-ink">{str(item, "title", L)}</h3>}
                {str(item, "text", L) && <p className="text-sm leading-relaxed text-ink-muted">{str(item, "text", L)}</p>}
                {href && (
                  <SmartLink
                    href={href}
                    ariaLabel={cta || str(item, "title", L) || str(item, "text", L)}
                    className="mt-auto inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] bg-brand-800 text-white transition-colors hover:bg-accent-600"
                  >
                    <span aria-hidden="true" className="rtl:rotate-180">→</span>
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
              <div key={idx} className={`flex flex-col gap-4 rounded-[var(--radius-card)] border-2 p-6 ${highlighted ? "border-brand-800 bg-brand-800 text-white shadow-[6px_6px_0_0_var(--color-accent-600)]" : "border-line bg-white"}`}>
                <div>
                  <h3 className={`text-lg font-bold ${highlighted ? "text-white" : "text-ink"}`}>{str(item, "name", L)}</h3>
                  <p className={`sig-display mt-2 text-3xl ${highlighted ? "text-white" : "text-ink"}`} dir="auto">{raw(item, "price")}</p>
                  {str(item, "period", L) && <p className={`text-sm ${highlighted ? "text-white/70" : "text-ink-muted"}`}>{str(item, "period", L)}</p>}
                </div>
                {features.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {features.map((f, i) => (
                      <li key={i} className={`flex items-start gap-2 text-sm ${highlighted ? "text-white/85" : "text-ink-muted"}`}>
                        <Icon name="check" size="sm" colorRole={highlighted ? "invert" : "success"} className="mt-0.5" />
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
          <div className="rounded-[var(--radius-card)] bg-brand-800 px-3 py-4 text-white sm:px-4">
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {items.map((item, idx) => {
                const label = str(item, "label", L);
                const value = str(item, "value", L);
                const icon = raw(item, "icon");
                const href = raw(item, "href");
                const inner = (
                  <span className="flex items-center gap-3">
                    {icon && (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-white/10 text-white">
                        <Icon name={icon} size="md" colorRole="invert" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      {value && <span className="sig-display text-base text-white sm:text-lg" dir="auto">{value}</span>}
                      {label && <span className="text-sm text-white/70">{label}</span>}
                    </span>
                  </span>
                );
                const wrapCls = `flex min-h-16 items-center px-4 py-3 ${idx < items.length - 1 ? "lg:border-e lg:border-white/15" : ""}`;
                return href ? (
                  <SmartLink key={idx} href={href} className={`${wrapCls} rounded-[var(--radius-btn)] transition-colors hover:bg-white/5`}>
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
            <div key={idx} className="flex flex-col items-center gap-1 rounded-[var(--radius-card)] border border-line bg-white p-5 text-center">
              {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" colorRole="accent" />}
              <span className="sig-display text-2xl text-ink" dir="auto">{str(item, "value", L)}</span>
              {str(item, "label", L) && <span className="text-sm text-ink-muted">{str(item, "label", L)}</span>}
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
            <figure key={idx} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-6">
              <Icon name="quote" size="md" colorRole="accent" />
              <blockquote className="text-[15px] leading-relaxed text-ink">{str(item, "quote", L)}</blockquote>
              <figcaption className="mt-auto flex items-center gap-3">
                {raw(item, "image") && ctx.images[raw(item, "image")] && (
                  <img src={ctx.images[raw(item, "image")]} alt={str(item, "name", L)} loading="lazy" decoding="async" className="h-10 w-10 rounded-full object-cover" />
                )}
                <span className="flex flex-col">
                  {str(item, "name", L) && <span className="text-sm font-bold text-ink">{str(item, "name", L)}</span>}
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
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          {items.map((item, idx) => (
            <details key={idx} className="group border-b-2 border-line py-1 first:border-t-2 open:pb-4">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-4 text-base font-bold text-ink [&::-webkit-details-marker]:hidden">
                {str(item, "q", L)}
                <Icon name="chevron-down" size="sm" colorRole="muted" className="shrink-0 transition-transform group-open:rotate-180 group-open:text-accent-600" />
              </summary>
              <p className="whitespace-pre-line max-w-2xl pb-3 text-[15px] leading-relaxed text-ink-muted">{str(item, "a", L)}</p>
            </details>
          ))}
        </div>
      );
    }
    case "accordion": {
      const items = arr(p, "items").filter((i) => str(i, "title", L));
      if (!items.length) return null;
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          {items.map((item, idx) => (
            <details key={idx} className="group border-b-2 border-line py-1 first:border-t-2 open:pb-4">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-4 text-base font-bold text-ink [&::-webkit-details-marker]:hidden">
                {str(item, "title", L)}
                <Icon name="chevron-down" size="sm" colorRole="muted" className="shrink-0 transition-transform group-open:rotate-180 group-open:text-accent-600" />
              </summary>
              <RichText html={str(item, "content", L)} className="max-w-2xl pb-3 text-[15px] leading-relaxed text-ink-muted" />
            </details>
          ))}
        </div>
      );
    }
    case "announcement": {
      const text = str(p, "text", L);
      if (!text) return null;
      const tone = { info: "bg-slate-100 text-slate-800", success: "bg-emerald-50 text-emerald-800", warning: "bg-amber-50 text-amber-800", brand: "bg-brand-800 text-white" }[raw(p, "tone")] ?? "bg-slate-100 text-slate-800";
      return (
        <div className={`flex flex-wrap items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-brand-800 px-5 py-3 text-sm font-medium ${tone}`}>
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
        <div className="grid items-center gap-6 overflow-hidden rounded-[var(--radius-card)] bg-brand-800 text-white md:grid-cols-2">
          <div className="flex flex-col items-start gap-4 p-7 sm:p-10">
            {heading && <h3 className="sig-display text-2xl sm:text-3xl">{heading}</h3>}
            {text && <p className="whitespace-pre-line leading-relaxed text-white/75">{text}</p>}
            {str(p, "ctaLabel", L) && raw(p, "ctaHref") && (
              <CtaButton label={str(p, "ctaLabel", L)} href={raw(p, "ctaHref")} variant="light" />
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
            {name && <h3 className="sig-display text-2xl text-ink sm:text-3xl">{name}</h3>}
            {title && <p className="flex items-center gap-2 font-semibold text-ink"><span aria-hidden="true" className="inline-block h-3 w-3 bg-accent-500" />{title}</p>}
            {bio && <RichText html={bio} className="max-w-2xl text-[15px] leading-relaxed text-ink-muted" />}
          </div>
        </div>
      );
    }
    case "login_cta":
    case "register_cta": {
      const href = block.type === "login_cta" ? "/login" : "/register";
      const label = str(p, "label", L) || (block.type === "login_cta" ? (L === "ar" ? "تسجيل الدخول" : "Log in") : L === "ar" ? "إنشاء حساب" : "Create account");
      return (
        <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] bg-brand-800 p-10 text-center text-white sm:p-14">
          {str(p, "sublabel", L) && <p className="max-w-md text-lg leading-relaxed text-white/75">{str(p, "sublabel", L)}</p>}
          <CtaButton label={label} href={href} variant="light" />
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
              <a key={idx} href={raw(item, "url")} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-btn)] border border-slate-300 px-4 py-2.5 text-sm font-semibold text-ink hover:border-brand-800 hover:bg-slate-50">
                <Icon name={network} size="sm" colorRole="default" className="text-current" />
                {label || network}
              </a>
            ) : (
              <a key={idx} href={raw(item, "url")} target="_blank" rel="noopener noreferrer nofollow" aria-label={label || network} className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] border border-line text-slate-600 transition-colors hover:border-brand-800 hover:text-ink">
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
          {heading && <h3 className="sig-display text-center text-2xl text-ink">{heading}</h3>}
          {text && <p className="text-center leading-relaxed text-ink-muted">{text}</p>}
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
    case "divider": {
      const variant = raw(p, "variant") || "line";
      if (variant === "dots") return <div className="flex justify-center gap-2 py-2" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 bg-brand-800" />)}</div>;
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
  brand: "bg-brand-800 text-white",
  dark: "bg-brand-950 text-white",
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

export function SectionView({ section, ctx, index }: { section: RenderBlock; ctx: CmsRenderCtx; index?: number }) {
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
  const onDark = bg === "brand" || bg === "dark" || hasBgImage;
  const headingEl = heading || subheading ? (
    <div className={`mb-8 flex flex-col gap-2 ${align === "center" ? "items-center text-center" : align === "end" ? "items-end text-end" : "items-start text-start"}`}>
      {heading && (
        <h2 className={`sig-display flex items-baseline gap-3 text-2xl sm:text-3xl ${onDark ? "text-white" : "text-ink"}`}>
          {index !== undefined && (
            <span aria-hidden="true" className="text-base font-bold tabular-nums text-accent-400">{String(index + 1).padStart(2, "0")}</span>
          )}
          {heading}
        </h2>
      )}
      {subheading && <p className={`max-w-2xl leading-relaxed ${onDark ? "text-white/75" : "text-ink-muted"}`}>{subheading}</p>}
    </div>
  ) : null;

  return (
    <section className={`relative overflow-hidden ${SECTION_BG[bg] ?? ""} ${SECTION_PAD[raw(p, "padding") || "md"] ?? SECTION_PAD.md} ${bool(p, "hideMobile") ? "max-md:hidden" : ""}`}>
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
      {sections.map((s, i) => (
        <SectionView key={s.id} section={s} ctx={ctx} index={i} />
      ))}
    </Wrapper>
  );
}
