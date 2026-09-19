import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Icon } from "~/cms/icons";
import { ls, type LStr } from "~/cms/l10n";
import { t } from "~/lib/i18n";
import { socialIconName } from "~/cms/social";
import { ANCHOR_ID_RE, fragmentId, resolveCmsHref, type CmsHrefContext } from "~/cms/links";
import { SectionDecor, DecorHairline } from "~/components/visuals/PhilosophyDecor";
import { ThinkerPortrait, ThinkerWash } from "~/components/visuals/ThinkerPortrait";
import {
  BTN_SHAPE,
  BTN_VARIANT,
  CARD_ARROW,
  CARD_BODY,
  CARD_LINK,
  CARD_META,
  CARD_TITLE,
  CHIP,
  PUB_BAND,
  PUB_BTN,
  PUB_CARD,
  CARD_SURFACE,
  TINT_CHIP,
} from "~/lib/publicStyles";
import { heroFrameThinkers, thinkerAlternate, thinkerById, thinkerFor } from "~/lib/thinkers";
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
    <div className="grid w-full gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
        return (
          <article key={row.id} className={PUB_CARD}>
            {imgSrc && (
              <div className="relative aspect-video overflow-hidden bg-pub-surface">
                <img
                  src={imgSrc}
                  alt={ls(row.title, L)}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
                {showPlay && (
                  <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-pub-navy/25">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pub-bg/95 text-pub-navy-2 shadow-pub-card ring-1 ring-pub-accent-soft">
                      <Icon name="play-circle" size="md" colorRole="default" className="text-current" />
                    </span>
                  </span>
                )}
                {badge && (
                  <span className="absolute bottom-3 start-3 rounded-full bg-pub-accent/95 px-3 py-1 text-pub-xs font-semibold text-pub-navy shadow-pub-card">
                    {badge}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-1 flex-col gap-2 p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className={CARD_TITLE}>{ls(row.title, L)}</h3>
                {badge && !imgSrc && (
                  <span className="shrink-0 rounded-full bg-pub-accent-bg px-2.5 py-0.5 text-pub-xs font-semibold text-pub-accent-strong ring-1 ring-pub-accent-line">{badge}</span>
                )}
              </div>
              {ls(row.desc, L) && <p className={`line-clamp-2 ${CARD_BODY}`}>{ls(row.desc, L)}</p>}
              {row.meta && ls(row.meta, L) && (
                <p className={CARD_META} dir="auto">{ls(row.meta, L)}</p>
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
                <SmartLink href={row.href} ariaLabel={`${ctaLabel} — ${title}`} className={CARD_LINK}>
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
      // photo the plate still shows the name (or nothing at all), never a
      // stand-in, and never the old abstract illustration fallback.
      const idn = ctx.identity;
      const ownerName = idn ? ls(idn.ownerName, L) : "";
      const ownerTitle = idn ? ls(idn.ownerTitle, L) : "";
      const ownerPhoto = idn?.ownerPhoto ?? null;
      const showIdentity = p.useIdentity !== false && Boolean(ownerName || ownerPhoto);
      // When the owner published their own photo, that photo IS the plate: this
      // platform's identity is the teacher, not an illustration. It stays exactly
      // as uploaded (R2 via /files/:id) — never replaced, never a stand-in, and
      // never used when the block's identity display is switched off.
      const platePhoto = showIdentity ? ownerPhoto : null;
      const tagline = idn ? ls(idn.tagline, L) : "";
      // The two transparent philosophers that frame the identity panel from its
      // bottom corners — AROUND the owner photo slot, never inside it (owner
      // request, 2026-09). Neither is Aristotle, whom the philosophy subject
      // card owns, so one screen never repeats a face.
      const [heroFrameStart, heroFrameEnd] = heroFrameThinkers();
      if (!eyebrow && !heading && !subtitleHtml && !ctas.length && !videoId && !cmsSrc && !showIdentity) return null;
      const imageAlt = str(p, "imageAlt", L) || heading;
      return (
        <div className="bg-pub-bg">
          <div className="pub-section pub-container grid items-center gap-[calc(var(--pub-gap)*2)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-[calc(var(--pub-gap)*3)]">
            <div className="flex min-w-0 flex-col items-start gap-4">
              {eyebrow && (
                <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-pub-line bg-pub-surface px-3.5 text-pub-xs font-bold text-pub-ink-soft">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-pub-accent" />
                  {eyebrow}
                </span>
              )}
              {heading && (
                <h1 className="max-w-[34ch] text-pub-2xl font-extrabold leading-pub-tight tracking-tight text-pub-ink [overflow-wrap:anywhere]">
                  {heading}
                </h1>
              )}
              {subtitleHtml && <RichText html={subtitleHtml} className="pub-measure text-pub-base leading-pub-normal text-pub-muted" />}
              {(ctas.length > 0 || (videoLabel && videoId)) && (
                <div className="flex w-full flex-wrap items-center gap-3 max-sm:flex-col max-sm:items-stretch [&>*]:max-sm:w-full">
                  {ctas.map((cta, idx) => (
                    <CtaButton
                      key={idx}
                      label={str(cta, "label", L)}
                      href={raw(cta, "href")}
                      target={raw(cta, "target")}
                      variant={raw(cta, "variant") || "primary"}
                      icon={raw(cta, "icon")}
                      shape={raw(p, "ctaShape")}
                    />
                  ))}
                  {videoLabel && videoId && <VideoCta videoId={videoId} label={videoLabel} />}
                </div>
              )}
              {/* Trust badges are real chips in the reading flow — they used to be
                  absolutely positioned over the visual, which stacked ornaments and
                  broke first on small screens. */}
              {badges.length > 0 && (
                <ul className="pub-grid w-full grid-cols-1 sm:grid-cols-2">
                  {badges.map((b, idx) => (
                    <li key={idx} className="flex min-w-0 items-start gap-2.5 rounded-pub-lg border border-pub-line bg-pub-bg p-3 shadow-pub-sm">
                      {raw(b, "icon") && (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pub-md bg-pub-tint text-pub-ink-soft">
                          <Icon name={raw(b, "icon")} size="md" colorRole="default" className="text-current" />
                        </span>
                      )}
                      <span className="flex min-w-0 flex-col">
                        {str(b, "title", L) && <span className="text-pub-sm font-bold text-pub-ink">{str(b, "title", L)}</span>}
                        {str(b, "text", L) && <span className="text-pub-xs leading-pub-snug text-pub-muted">{str(b, "text", L)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Visual column — exactly one figure, restrained, behind/next to the
                copy: the owner's own image when published, otherwise the platform
                plate (CSS wash + masked engraving + identity). */}
            <div className="relative mx-auto w-full max-w-[34rem]">
              {cmsSrc ? (
                <div className="overflow-hidden rounded-pub-2xl border border-pub-line bg-pub-surface shadow-pub-md">
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
              ) : platePhoto ? (
                /*
                 * The teacher's own picture is the hero. It already carries its own
                 * art, so the panel only FRAMES it — light surface, one gold hairline,
                 * one soft shadow, a caption. Never a filter, never a crop that cuts
                 * the identity, never a second ornament over the first (owner brief
                 * §15/§20): allowed treatments are container, background, border,
                 * shadow and crop container, and that is all this does.
                 */
                <div className="relative isolate overflow-hidden rounded-pub-2xl border border-pub-line bg-pub-surface shadow-pub-md">
                  {/* Transparent philosophers AROUND the teacher's own picture
                      (owner request): one figure hugging each bottom corner,
                      masked inward, behind the photo (z-0 vs z-[1]) and never
                      over the caption. */}
                  {heroFrameStart && (
                    <ThinkerPortrait
                      thinker={heroFrameStart}
                      presentation="wash"
                      className="thinker-wash--light thinker-wash--frame thinker-wash--start"
                    />
                  )}
                  {heroFrameEnd && (
                    <ThinkerPortrait
                      thinker={heroFrameEnd}
                      presentation="wash"
                      className="thinker-wash--light thinker-wash--frame thinker-wash--end"
                    />
                  )}
                  <img
                    src={platePhoto}
                    alt={ownerName || ""}
                    width={1191}
                    height={1321}
                    data-hero-visual="true"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    className="relative z-[1] mx-auto block max-h-[15rem] w-full px-3 pt-4 object-contain object-bottom sm:max-h-[21rem] sm:px-6"
                  />
                  {(ownerName || ownerTitle || tagline) && (
                    <div className="relative z-[1] mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-pub-line bg-pub-bg px-4 py-3 ltr:border-s-4 ltr:border-s-pub-accent rtl:border-e-4 rtl:border-e-pub-accent">
                      {ownerName && (
                        <span dir="auto" className="min-w-0 text-pub-md font-extrabold text-pub-navy [overflow-wrap:anywhere]">{ownerName}</span>
                      )}
                      {ownerTitle && <span dir="auto" className={`${CARD_META} min-w-0 flex-1 sm:text-end`}>{ownerTitle}</span>}
                      {tagline && <p dir="auto" className="w-full text-pub-sm leading-pub-normal text-pub-muted">{tagline}</p>}
                    </div>
                  )}
                </div>
              ) : (
                /* No photo published yet — and NOTHING stands in for the teacher.
                   The slot stays an honest, empty identity card until the owner
                   uploads their own picture (Admin → Appearance → Identity); the
                   transparent philosophers frame it from the corners and the
                   centre carries only the REAL identity text from Settings.
                   The start figure is the page's single eager hero visual, so
                   React preloads exactly one above-the-fold image either way. */
                <div className="relative isolate flex min-h-[15rem] flex-col justify-end overflow-hidden rounded-pub-2xl border border-pub-line bg-pub-surface shadow-pub-md sm:min-h-[19rem]">
                  {heroFrameStart && (
                    <ThinkerPortrait
                      thinker={heroFrameStart}
                      presentation="wash"
                      eager
                      heroVisual
                      className="thinker-wash--light thinker-wash--frame thinker-wash--start"
                    />
                  )}
                  {heroFrameEnd && (
                    <ThinkerPortrait
                      thinker={heroFrameEnd}
                      presentation="wash"
                      className="thinker-wash--light thinker-wash--frame thinker-wash--end"
                    />
                  )}
                  <div className="relative z-[1] flex flex-col items-center gap-2 px-6 py-8 text-center sm:px-10">
                    {showIdentity && ownerName ? (
                      <span dir="auto" className="text-pub-lg font-extrabold text-pub-navy [overflow-wrap:anywhere]">
                        {ownerName}
                      </span>
                    ) : null}
                    {showIdentity && ownerTitle ? <span dir="auto" className={CARD_META}>{ownerTitle}</span> : null}
                    {tagline ? (
                      <p dir="auto" className="pub-measure text-pub-sm leading-pub-normal text-pub-muted">
                        {tagline}
                      </p>
                    ) : null}
                    <DecorHairline className="mt-1 w-28 text-pub-accent" />
                  </div>
                </div>
              )}
            </div>
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
                className={`${PUB_CARD} items-start gap-3 p-5 ring-1 sm:p-6 ${CARD_SURFACE[tint] ?? CARD_SURFACE.default}`}
              >
                {raw(item, "icon") && (
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-pub-md ${TINT_CHIP[tint] ?? TINT_CHIP.default}`}>
                    <Icon name={raw(item, "icon")} size="md" colorRole="default" className="text-current" />
                  </span>
                )}
                {title && <h3 className={CARD_TITLE}>{title}</h3>}
                {str(item, "text", L) && <p className={CARD_BODY}>{str(item, "text", L)}</p>}
                {href && (
                  <SmartLink href={href} ariaLabel={cta || title || str(item, "text", L)} className={`mt-auto ${CARD_LINK}`}>
                    <span>{cta || title}</span>
                    <span aria-hidden="true" className={CARD_ARROW}>→</span>
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
      // Owner-chosen corner portrait (Marx for a knowledge/about surface, per the
      // site identity). `none`/unknown id → no portrait at all: the block never
      // picks a face by itself, and a legacy snapshot can point at a missing file.
      const wmId = raw(p, "watermark");
      const watermark = wmId && wmId !== "none" ? thinkerById(wmId) : null;
      const tagline = ctx.identity ? ls(ctx.identity.tagline, L) : "";
      const lines = (
        <>
          {name && <h3 className="text-pub-h2 font-bold text-pub-ink">{name}</h3>}
          {title && <p className="text-pub-md font-medium text-pub-ink-soft">{title}</p>}
          {/* The platform line from Settings → Identity (not a claim invented
              here): with no bio written yet the block still says what the
              teacher teaches, which is what this section exists for. */}
          {!title && tagline && <p className="text-pub-md font-medium text-pub-ink-soft">{tagline}</p>}
          {bio && <RichText html={bio} className={`${CARD_BODY} pub-measure`} />}
        </>
      );
      return (
        <div className={`grid items-start gap-[calc(var(--pub-gap)*1.5)] ${framed ? "md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]" : ""}`}>
          {framed && (
            /* Same frame as the hero panel — one container, one gold hairline, one
               shadow. The picture itself is never re-styled or re-cropped. */
            <div className="relative isolate overflow-hidden rounded-pub-2xl border border-pub-line bg-pub-surface shadow-pub-md">
              <span aria-hidden="true" className="pointer-events-none absolute -end-10 -top-12 h-32 w-32 rounded-full bg-pub-tint" />
              <img
                src={photoUrl}
                alt={name}
                loading="lazy"
                decoding="async"
                className="relative z-[1] mx-auto block max-h-[19rem] w-full px-4 py-4 object-contain object-bottom"
              />
            </div>
          )}
          {framed ? (
            <div className="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-start">{lines}</div>
          ) : (
            /* Without a picture the block owns its own surface: the SAME light frame
               as the hero, with the thinker engraving clipped inside it. A portrait
               that floats outside a container reads as a rendering artifact, and a
               text-only card must not grow a second style. */
            <div className="relative isolate flex min-h-[8.5rem] overflow-hidden rounded-pub-2xl border border-pub-line bg-pub-surface p-5 shadow-pub-md sm:min-h-[9.5rem] sm:p-6">
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
          )}
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
      if (!items.length) return null;
      const asButtons = raw(p, "style") === "buttons";
      return (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {items.map((item, idx) => {
            const network = raw(item, "network");
            const label = str(item, "label", L);
            return asButtons ? (
              <a key={idx} href={raw(item, "url")} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-2 rounded-pub-md border border-pub-line-strong px-4 py-2.5 text-pub-sm font-medium text-pub-ink-soft hover:bg-pub-surface">
                <Icon name={network} size="sm" colorRole="default" className="text-current" />
                {label || network}
              </a>
            ) : (
              <a key={idx} href={raw(item, "url")} target="_blank" rel="noopener noreferrer nofollow" aria-label={label || network} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-pub-line text-pub-muted hover:bg-pub-surface">
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
            <li key={idx} className="flex items-center gap-3 text-pub-sm text-pub-ink-soft">
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
    /**
     * The ONE subject-discovery experience on a page (owner brief §12/§13) —
     * the surface that replaced the hardcoded homepage band. Rows come from
     * `studyHub` via the render resolver, so a card exists only when a subject
     * has a published term container: nothing to show → nothing renders and the
     * whole section collapses.
     *
     * These are the most important cards on the site, so they get the plainest
     * possible treatment: white surface, hairline border, one soft shadow, navy
     * type, the subject's thinker engraving behind the text (decorative, low
     * opacity, cropped), and the whole card is a single 44px+ touch target.
     */
    case "study_subjects": {
      const rows = ctx.dynamic[block.id] ?? [];
      if (!rows.length) return null;
      const cols = {
        "1": "grid-cols-1",
        "2": "grid-cols-1 lg:grid-cols-2",
        "3": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      }[raw(p, "columns")] ?? "grid-cols-1 lg:grid-cols-2";
      const showJourney = p.showJourney !== false;
      const allLabel = str(p, "allLabel", L);
      const allHref = raw(p, "allHref");
      return (
        <div className="flex w-full flex-col gap-[calc(var(--pub-gap)*1.4)]">
          <ul className={`pub-grid ${cols}`}>
            {rows.map((row, idx) => {
              const titleAr = ls(row.title, "ar");
              const titleEn = ls(row.title, "en");
              const title = L === "ar" ? titleAr || titleEn : titleEn || titleAr;
              const meta = showJourney ? ls(row.meta, L) : "";
              const desc = ls(row.desc, L);
              const cta = ls(row.cta, L) || title;
              const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
              // One figure per card, chosen from the subject itself (philosophy →
              // classical thinkers, psychology → Freud/Jung), alternating so two
              // cards of the same family never share a face.
              const primary = thinkerFor({ slot: "subject-card", slug: row.id, titleAr, titleEn });
              const thinker = idx > 0 ? thinkerAlternate(primary, row.id) : primary;
              return (
                <li key={row.id} className="h-full min-w-0">
                  <SmartLink href={row.href} ariaLabel={`${cta} — ${title}`} className={`${PUB_CARD} min-h-[13rem] gap-3 p-5 pt-[7rem] sm:p-6 sm:pt-6`}>
                    {/* The subject's own thinker, INSIDE the card: a top band on a
                        phone and a cropped column from sm up. Masked toward the
                        reading side (see .thinker-figure) so the title, description
                        and CTA never sit on top of a face. */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-24 overflow-hidden sm:inset-x-auto sm:inset-y-0 sm:end-0 sm:h-auto sm:w-[44%] sm:max-w-[13rem]"
                    >
                      <ThinkerPortrait thinker={thinker} presentation="figure" className="h-full w-full" />
                    </span>
                    <span className="relative z-10 flex min-w-0 flex-1 flex-col gap-2 sm:pe-[46%]">
                      <h3 className={`${CARD_TITLE} min-w-0 text-pub-lg [overflow-wrap:anywhere]`}>{title}</h3>
                      {meta && <p className={CARD_META}>{meta}</p>}
                      {desc && <p className={`line-clamp-2 ${CARD_BODY}`}>{desc}</p>}
                      {chips.length > 0 && (
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {chips.map((chip) => (
                            <li key={chip} className={CHIP}>{chip}</li>
                          ))}
                        </ul>
                      )}
                      <span className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-2 text-pub-sm font-bold text-pub-ink-soft">
                        {cta}
                        <span aria-hidden="true" className={CARD_ARROW}>→</span>
                      </span>
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
        <div className="grid w-full gap-[var(--pub-gap)] sm:grid-cols-2">
          {rows.map((row) => {
            const title = ls(row.title, L);
            const desc = ls(row.desc, L);
            const badge = row.badge ? ls(row.badge, L) : "";
            const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
            const ctaLabel = (row.cta && ls(row.cta, L)) || title;
            return (
              <SmartLink
                key={row.id}
                href={row.href}
                ariaLabel={`${ctaLabel} — ${title}`}
                className={`${PUB_CARD} min-h-[11.5rem] gap-2.5 p-5 sm:p-6`}
              >
                {badge && (
                  <span className="inline-flex w-fit items-center rounded-pub-pill bg-pub-surface-2 px-2.5 py-1 text-pub-xs font-bold text-pub-ink-soft">
                    {badge}
                  </span>
                )}
                <h3 className={`${CARD_TITLE} text-pub-lg [overflow-wrap:anywhere]`}>{title}</h3>
                {desc && <p className={CARD_BODY}>{desc}</p>}
                {chips.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {chips.map((chip) => (
                      <li key={chip} className={CHIP}>
                        {chip}
                      </li>
                    ))}
                  </ul>
                )}
                <span className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-2 text-pub-sm font-bold text-pub-ink-soft">
                  {ctaLabel}
                  <span aria-hidden="true" className={CARD_ARROW}>
                    →
                  </span>
                </span>
              </SmartLink>
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
        <div className={`${PUB_BAND} p-5 sm:p-8`}>
          <SectionDecor variant="band" />
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="flex max-w-2xl flex-col gap-2">
              <span className="inline-flex min-h-8 w-fit items-center gap-2 rounded-full bg-pub-on-navy/10 px-3 py-1 text-pub-xs font-semibold text-pub-accent-line">
                <Icon name="external-link" size="sm" colorRole="invert" className="text-pub-accent-line" />
                {t(L, "home.externalTag")}
              </span>
              {headingText && <h2 className="text-pub-lg font-extrabold leading-pub-tight text-pub-on-navy">{headingText}</h2>}
              {text && <p className="text-pub-sm leading-pub-normal text-pub-on-navy-soft">{text}</p>}
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pub-pill bg-pub-accent px-6 py-3 text-pub-base font-bold text-pub-navy transition-colors hover:bg-pub-accent-strong hover:text-pub-bg max-sm:w-full"
              >
                {cta}
                <Icon name="external-link" size="sm" colorRole="default" className="text-pub-navy" />
              </a>
              {note && <p className="text-pub-xs text-pub-on-navy-muted max-sm:w-full">{note}</p>}
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
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pub-navy text-pub-sm font-bold tabular-nums text-pub-on-navy">
                    {idx + 1}
                  </span>
                  {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" colorRole="accent" />}
                </span>
                {title && <h3 className={CARD_TITLE}>{title}</h3>}
                {str(item, "text", L) && <p className={CARD_BODY}>{str(item, "text", L)}</p>}
              </>
            );
            const cls = `${PUB_CARD} h-full p-5`;
            return (
              <li key={idx} className="h-full">
                <span aria-hidden="true" className="block h-0.5 w-10 rounded-full bg-pub-accent" />
                {href ? (
                  <SmartLink href={href} ariaLabel={title} className={`${cls} transition-colors hover:border-pub-accent-soft hover:shadow-pub-card`}>
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
        <div className={`${PUB_BAND} px-5 py-10 text-center sm:px-10 sm:py-12`}>
          <SectionDecor variant="cta" />
          {headingText && <h2 className="text-pub-xl font-extrabold leading-pub-tight text-pub-on-navy">{headingText}</h2>}
          {text && <p className="pub-measure mx-auto mt-3 text-pub-sm leading-pub-normal text-pub-on-navy-soft">{text}</p>}
          {ctas.length > 0 && (
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3 max-sm:flex-col max-sm:items-stretch">
              {ctas.map((cta, idx) => (
                <CtaButton
                  key={idx}
                  label={str(cta, "label", L)}
                  href={raw(cta, "href")}
                  target={raw(cta, "target")}
                  // On the dark band the system's own variants are used: the first
                  // CTA is the single gold accent, the rest are the dark secondary.
                  // This replaces `!bg-gold-500 !text-navy-950`, which overrode the
                  // button grammar with !important — the exact "third button system"
                  // symptom the rebuild removes.
                  // The band is navy, so the variants are resolved FOR a dark
                  // surface: `outline`/`ghost` (built for white) would render an
                  // invisible label, exactly the "blank button" bug that made the
                  // old UI look broken. One mapping, at the band that needs it.
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
          {note && <p className="mt-5 text-pub-xs text-pub-on-navy-muted">{note}</p>}
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
    return !arr(block.props, "items").some((i) => raw(i, "url"));
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

export function SectionView({ section, ctx }: { section: RenderBlock; ctx: CmsRenderCtx }) {
  const p = section.props;
  const L = ctx.locale;
  if (!section.visible) return null;
  const children = (section.children ?? []).filter((c) => c.visible);
  // Section collapse rule (see DATA_DRIVEN_BLOCKS above).
  if (children.length > 0 && children.every((c) => blockIsEmpty(c, ctx))) return null;
  const heading = str(p, "heading", L);
  const subheading = str(p, "subheading", L);
  const bg = raw(p, "bg") || "default";
  const bgImageId = bg === "image" ? raw(p, "bgImage") : "";
  const hasBgImage = Boolean(bgImageId && ctx.images[bgImageId]);
  const align = raw(p, "align") || "start";
  const columns = raw(p, "columns") || "1";
  const onDark = bg === "brand" || bg === "dark";
  // ONE figure per surface (owner brief §14–§16): blocks that already carry a
  // thinker (hero, teacher card, subject/course cards) keep their own face, so
  // only the remaining sections get the transparent backdrop philosopher.
  const sectionHasThinker = children.some((c) => THINKER_BLOCK_TYPES.has(c.type));
  const headingEl = heading || subheading ? (
    <div className={`mb-[calc(var(--pub-gap)*1.8)] flex flex-col gap-2 ${align === "center" ? "items-center text-center" : align === "end" ? "items-end text-end" : "items-start text-start"}`}>
      {heading && (
        <h2 className={`text-pub-xl font-extrabold leading-pub-tight tracking-tight ${onDark ? "text-pub-on-navy" : "text-pub-ink"}`}>
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
      className={`relative isolate scroll-mt-24 overflow-hidden ${SECTION_BG[bg] ?? "bg-pub-bg"} ${SECTION_PAD[raw(p, "padding") || "md"] ?? SECTION_PAD.md} ${bool(p, "hideMobile") ? "max-md:hidden" : ""}`}
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
    <Wrapper className="flex flex-col">
      <CmsNavContext.Provider value={nav}>
        {sections.map((s) => (
          <SectionView key={s.id} section={s} ctx={ctx} />
        ))}
      </CmsNavContext.Provider>
    </Wrapper>
  );
}
