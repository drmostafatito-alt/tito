import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Icon } from "~/cms/icons";
import { ls, type LStr } from "~/cms/l10n";
import { t } from "~/lib/i18n";
import { ANCHOR_ID_RE, fragmentId, resolveCmsHref, type CmsHrefContext } from "~/cms/links";
import { ThinkerPortrait } from "~/components/visuals/ThinkerPortrait";
import { thinkerById } from "~/lib/thinkers";
import { SUBJECT_PANEL_CLASS, SubjectPanelBody, SubjectPlate, subjectKindOf } from "~/components/tito/subject";
import { ArrowGlyph, Ordinal } from "~/components/tito/ui";
import {
  CARD_ARROW,
  CARD_BODY,
  CARD_LINK,
  CARD_META,
  CARD_TITLE,
  CHIP,
  PUB_BAND,
  PUB_CARD,
  pubBtn,
} from "~/lib/publicStyles";
import type { CardView, CmsRenderCtx, FormView } from "~/cms/render-types";

const VideoPlayer = lazy(() => import("~/components/player/VideoPlayer").then((m) => ({ default: m.VideoPlayer })));

/**
 * CMS BLOCK RENDERERS — design system "الفهرس" (The Index).
 *
 * STRUCTURE ONLY. Every visible string, image, link and layout choice comes
 * from validated block props or resolved view data (owner brief: "Components
 * contain structure and behaviour. The CMS contains the editable content").
 * No hard-coded marketing copy, no placeholder assets: missing optional data
 * renders NOTHING (empty-first).
 *
 * The visual grammar this file implements:
 *   • RULED ROWS are the default way to present a list. Cards are reserved for
 *     content that genuinely has a picture (videos, gallery, products).
 *   • Every section is an INDEX ENTRY: an ordinal, a hairline, a display
 *     heading. Numbering comes from the section's position on the page.
 *   • ONE accent — the highlighter — appears at most a couple of times per
 *     screen: the primary CTA, the active state, one marked word.
 *   • Discipline is carried by FORM: orthogonal geometry for philosophy/logic,
 *     curved node networks for psychology (see ~/components/tito/subject).
 *
 * Constraints honoured here:
 *  - no inline style attributes (production CSP `style-src 'self'`)
 *  - responsive PRESETS only (no arbitrary CSS); mobile-first grids
 *  - touch targets ≥ 44px; no fixed-position traps except the opt-in floating
 *    WhatsApp/Telegram CTAs (bottom-safe-area aware)
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
 * resolved external Questions Platform URL). Provided once by `PageView` and
 * read by every link renderer, so a stored destination can be resolved without
 * threading the render context through ~15 call sites.
 */
const CmsNavContext = createContext<CmsHrefContext>({});

/**
 * Internal links → <Link>; in-page fragments → same-document <a href="#…">;
 * external https → <a target=_blank rel=noopener>; unresolved/empty → <span>.
 *
 * Resolution is what keeps destinations honest: an in-page fragment whose
 * target section will not render, and the `exam:external` token with no URL
 * configured, both resolve to "" — the block still renders, but never as a dead
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
 * Buttons are composed in ~/lib/publicStyles.ts — the same module /study, the
 * curriculum pages and the auth routes read, so a CTA can never grow a second
 * personality.
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
  const nav = useContext(CmsNavContext);
  if (!label && !href) return null; // nothing configured → render nothing
  const resolved = resolveCmsHref(href, nav);
  // Shape REPLACES the system radius rather than being appended beside it:
  // two radius utilities on one element resolve by stylesheet order, which is
  // how a "pill" CTA used to come out square next to a square one that came out
  // pill. `pubBtn` owns that composition for every public surface.
  const base = `${pubBtn(variant ?? "primary", shape)} ${className}`.trim();
  const iconEl = icon ? <Icon name={icon} size="sm" colorRole="default" className="text-current" /> : null;
  if (fragmentId(resolved)) {
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

/**
 * THE display heading. The last word carries the highlighter — the single
 * accent gesture of the identity, applied typographically so the owner never
 * has to author markup to get it. Short headings (one or two words) are left
 * plain: a marked heading that is entirely marked is just a coloured box.
 */
function MarkedHeading({
  text,
  className = "",
  as: As = "h2",
  id,
  mark = true,
}: {
  text: string;
  className?: string;
  as?: "h1" | "h2" | "h3";
  id?: string;
  mark?: boolean;
}) {
  const words = text.trim().split(/\s+/);
  if (!mark || words.length < 3) {
    return (
      <As id={id} className={className}>
        {text}
      </As>
    );
  }
  const head = words.slice(0, -1).join(" ");
  const tail = words[words.length - 1];
  return (
    <As id={id} className={className}>
      {head} <span className="tito-mark">{tail}</span>
    </As>
  );
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
      className={`${aspectClass} w-full ${fit === "contain" ? "object-contain" : "object-cover"} ${rounded ? "rounded-pub-lg" : ""} ${className}`}
    />
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * The two ways a resolved list is presented.
 *
 * `IndexRows` is the DEFAULT: an ordinal, a title, its meta, a hairline. It is
 * how a reader scans a syllabus, and it does not pretend every row owns a
 * picture it does not have.
 *
 * `MediaCards` is the exception: rows that really do have a thumbnail (videos,
 * products with cover art). A sheet with a 16:9 image earns its box.
 * ─────────────────────────────────────────────────────────────────────────── */

function rowFields(row: CardView, L: "ar" | "en") {
  const title = ls(row.title, L);
  const desc = ls(row.desc, L);
  const meta = row.meta ? ls(row.meta, L) : "";
  const badge = row.badge ? ls(row.badge, L) : "";
  const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
  const rawCta = row.cta ? ls(row.cta, L) : "";
  // A CTA that repeats the row's own title reads as a bug.
  const cta = rawCta && rawCta !== title ? rawCta : "";
  return { title, desc, meta, badge, chips, cta };
}

function IndexRows({ rows, ctx, ctaFallback }: { rows: CardView[]; ctx: CmsRenderCtx; ctaFallback?: LStr | null }) {
  if (!rows.length) return null; // empty-first: the section collapses
  const L = ctx.locale;
  return (
    <ul className="tito-rows w-full">
      {rows.map((row, idx) => {
        const f = rowFields(row, L);
        const cta = f.cta || (ctaFallback ? ls(ctaFallback, L) : "") || t(L, "study.openLesson");
        return (
          <li key={row.id} className="tito-row grid-cols-[2.25rem_minmax(0,1fr)_auto] px-1 py-4 sm:px-2 sm:py-5">
            <span className="tito-label pt-1 text-ink-300" aria-hidden="true">
              <Ordinal n={idx + 1} />
            </span>
            <div className="min-w-0">
              <SmartLink href={row.href} ariaLabel={`${cta} — ${f.title}`} className="after:absolute after:inset-0">
                <span className="font-display text-pub-md font-bold leading-pub-snug tracking-[-0.015em] text-pub-ink">{f.title}</span>
              </SmartLink>
              {f.desc && <p className="mt-1.5 line-clamp-2 max-w-[62ch] text-pub-sm leading-pub-snug text-pub-muted">{f.desc}</p>}
              {(f.meta || f.chips.length > 0 || f.badge) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  {f.badge && <span className="inline-flex items-center bg-pub-accent px-1.5 py-0.5 text-pub-xs font-bold text-pub-ink">{f.badge}</span>}
                  {f.meta && <span className={CARD_META} dir="auto">{f.meta}</span>}
                  {f.chips.map((chip) => (
                    <span key={chip} className={CHIP}>{chip}</span>
                  ))}
                </div>
              )}
            </div>
            <span className="relative z-10 flex items-center self-center text-pub-ink" aria-hidden="true">
              <ArrowGlyph />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MediaCards({ rows, ctx, showPlay }: { rows: CardView[]; ctx: CmsRenderCtx; showPlay?: boolean }) {
  if (!rows.length) return null;
  const L = ctx.locale;
  return (
    <div className="grid w-full gap-[var(--pub-gap)] sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        // Prefer a direct https thumbnail (provider URL) over the file registry.
        const imgSrc = (row.imageUrl && /^https:\/\//i.test(row.imageUrl) ? row.imageUrl : null) ?? (row.image ? ctx.images[row.image] : null);
        const f = rowFields(row, L);
        const cta = f.cta || t(L, "study.openLesson");
        return (
          <article key={row.id} className={`${PUB_CARD} group`}>
            {imgSrc ? (
              <div className="relative aspect-video overflow-hidden border-b border-pub-line bg-pub-surface">
                <img src={imgSrc} alt={f.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                {showPlay && (
                  <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-pub-navy/20 transition-colors group-hover:bg-pub-navy/35">
                    <span className="flex h-12 w-12 items-center justify-center rounded-pub-pill bg-pub-accent text-pub-ink">
                      <Icon name="play-circle" size="md" className="text-current" />
                    </span>
                  </span>
                )}
              </div>
            ) : null}
            <div className="flex flex-1 flex-col gap-2 p-5">
              {f.badge && <span className="w-fit bg-pub-accent px-1.5 py-0.5 text-pub-xs font-bold text-pub-ink">{f.badge}</span>}
              <h3 className={CARD_TITLE}>{f.title}</h3>
              {f.desc && <p className={`line-clamp-2 ${CARD_BODY}`}>{f.desc}</p>}
              {f.meta && <p className={CARD_META} dir="auto">{f.meta}</p>}
              {f.chips.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {f.chips.map((chip) => (
                    <li key={chip} className={CHIP}>{chip}</li>
                  ))}
                </ul>
              )}
              <div className="mt-auto pt-3">
                <SmartLink href={row.href} ariaLabel={`${cta} — ${f.title}`} className={`${CARD_LINK} after:absolute after:inset-0`}>
                  {cta}
                  <ArrowGlyph />
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
  if (remaining !== null && remaining <= 0) return null; // expired → disappears (no fake urgency)
  const L = ctx.locale;
  const secs = remaining === null ? null : Math.floor(remaining / 1000);
  const cells: Array<[string | null, string]> = [
    [secs === null ? null : String(Math.floor(secs / 86400)), str(props, "labelDays", L)],
    [secs === null ? null : String(Math.floor((secs % 86400) / 3600)), str(props, "labelHours", L)],
    [secs === null ? null : String(Math.floor((secs % 3600) / 60)), str(props, "labelMinutes", L)],
    [secs === null ? null : String(secs % 60), str(props, "labelSeconds", L)],
  ];
  return (
    <div className="flex flex-col gap-4">
      {str(props, "heading", L) && <p className="tito-label">{str(props, "heading", L)}</p>}
      <div className="flex gap-6 border-t border-pub-line pt-4" dir="ltr" suppressHydrationWarning>
        {cells.map(([value, label], i) => (
          <div key={i} className="flex min-w-14 flex-col">
            <span data-numeral className="text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink">
              {value ?? "—"}
            </span>
            <span className="tito-label mt-2">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CmsForm({ form, ctx, compact }: { form: FormView; ctx: CmsRenderCtx; compact?: boolean }) {
  const L = ctx.locale;
  const result = ctx.formResults[form.slug];
  const input =
    "w-full rounded-pub-md border border-pub-line-strong bg-pub-sheet px-3 py-2.5 text-pub-sm text-pub-ink placeholder:text-pub-muted/70 focus:border-pub-ink focus:outline-none";
  return (
    <form method="post" className={`flex flex-col gap-4 ${compact ? "" : "w-full max-w-xl"}`} noValidate>
      <input type="hidden" name="_cmsForm" value={form.slug} />
      {result && (
        <p role="status" className={`border-s-2 px-4 py-3 text-pub-sm ${result.ok ? "border-pub-ok bg-pub-success-bg text-pub-ok" : "border-pub-danger bg-pub-danger-bg text-pub-danger"}`}>
          {result.ok ? ls(form.success, L) : ls(form.failure, L) || t(L, "common.cmsFormFailed")}
        </p>
      )}
      {form.fields.map((f) => {
        const err = result && !result.ok ? result.errors[f.name] : undefined;
        const label = (
          <label htmlFor={`cmsf-${form.slug}-${f.name}`} className="mb-1.5 block text-pub-sm font-semibold text-pub-ink">
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
                    <input type="radio" name={f.name} value={o.value} className="h-4 w-4 accent-pub-ink" />
                    {ls(o.label, L)}
                  </label>
                ))}
              </div>
            );
            break;
          case "checkbox":
            control = (
              <label className="inline-flex min-h-11 items-center gap-2 text-pub-sm text-pub-ink-soft">
                <input type="checkbox" id={`cmsf-${form.slug}-${f.name}`} name={f.name} value="on" className="h-4 w-4 accent-pub-ink" />
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
            {f.type === "radio" && <span id={`cmsf-${form.slug}-${f.name}-legend`} className="mb-1.5 block text-pub-sm font-semibold text-pub-ink">{ls(f.label, L)}{f.required && <span className="text-pub-danger"> *</span>}</span>}
            {control}
            {ls(f.help, L) && <p className="mt-1 text-pub-xs text-pub-muted">{ls(f.help, L)}</p>}
            {err && <p className="mt-1 text-pub-xs text-pub-danger">{err}</p>}
          </div>
        );
      })}
      {form.consentRequired && (
        <label className="inline-flex min-h-11 items-start gap-2 text-pub-sm text-pub-muted">
          <input type="checkbox" name="__consent" value="on" className="mt-1 h-4 w-4 accent-pub-ink" />
          <span>{ls(form.consent, L)}{result && !result.ok && result.errors.__consent && <span className="text-pub-danger"> *</span>}</span>
        </label>
      )}
      <button
        type="submit"
        className={`inline-flex min-h-12 items-center justify-center rounded-pub-md bg-pub-navy px-6 py-3 text-pub-base font-bold text-pub-on-navy transition-colors hover:bg-pub-navy-2 ${compact ? "shrink-0" : "self-start"}`}
      >
        {t(L, "common.cmsFormSubmit")}
      </button>
    </form>
  );
}

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
        className="group inline-flex min-h-12 items-center gap-3 text-start text-pub-sm font-bold text-pub-ink"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pub-pill border border-pub-ink text-pub-ink transition-colors group-hover:bg-pub-accent">
          <Icon name="play-circle" size="md" className="text-current" />
        </span>
        <span className="max-w-[12rem] leading-snug underline decoration-pub-accent decoration-2 underline-offset-4">{label}</span>
      </button>
      {open && (
        <div id={`hero-video-${videoId}`} className="w-full max-w-xl">
          <Suspense fallback={<div className="h-40 bg-pub-surface-2" />}>
            <VideoPlayer videoId={videoId} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

/**
 * THE PORTRAIT PLATE — the owner's real photograph, presented as an editorial
 * portrait: the picture sits on paper inside a hairline frame that is offset by
 * a solid highlighter block. Nothing is cropped, filtered or re-styled.
 *
 * With no published photo NOTHING stands in: no illustration, no philosopher,
 * no silhouette. The column falls back to the discipline diagram (inline SVG,
 * zero bytes) plus the owner's name set as type — which is honest, and which
 * also means the page ships no raster LCP candidate at all.
 */
function PortraitPlate({
  photoUrl,
  name,
  title,
  alt,
  kind,
}: {
  photoUrl: string | null;
  name: string;
  title: string;
  alt: string;
  kind: "logic" | "psych" | "none";
}) {
  return (
    <div className="relative mx-auto w-full max-w-[30rem]">
      {/* the offset highlighter block — the identity's one flat accent shape */}
      <span aria-hidden="true" className="absolute bottom-6 -z-10 h-full w-full bg-pub-accent ltr:left-5 rtl:right-5" />
      <div className="relative overflow-hidden border border-pub-ink bg-pub-sheet">
        {photoUrl ? (
          <img
            data-hero-visual="true"
            src={photoUrl}
            alt={alt || name}
            width={1191}
            height={1321}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="aspect-[4/5] w-full object-cover object-top"
          />
        ) : (
          /* Reserved, and honestly empty. The diagram is decoration, not a
             stand-in for a person. */
          <div className="relative flex aspect-[4/5] w-full items-end overflow-hidden bg-pub-surface p-6">
            <SubjectPlate kind={kind === "none" ? "logic" : kind} className="absolute inset-0 h-full w-full opacity-60" />
          </div>
        )}
        {(name || title) && (
          <div className="relative flex flex-col gap-0.5 border-t border-pub-ink bg-pub-navy px-4 py-3">
            {name && <span dir="auto" className="font-display text-pub-base font-extrabold tracking-[-0.02em] text-pub-on-navy">{name}</span>}
            {title && <span dir="auto" className="text-pub-xs text-pub-on-navy-muted">{title}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual block renderers
// ---------------------------------------------------------------------------

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
        md: "py-[calc(var(--pub-pad-y)*1.3)]",
        lg: "py-[calc(var(--pub-pad-y)*1.9)]",
      }[raw(p, "height")] ?? "py-[calc(var(--pub-pad-y)*1.3)]";
      const align = raw(p, "align") || "start";
      const alignCls = align === "center" ? "items-center text-center" : align === "end" ? "items-end text-end" : "items-start text-start";
      const justify = align === "center" ? "justify-center" : align === "end" ? "justify-end" : "justify-start";
      return (
        <div className={`relative isolate flex flex-col gap-5 overflow-hidden bg-pub-navy px-6 sm:px-10 ${height} ${alignCls}`}>
          {hasBg && (
            <>
              <img src={ctx.images[bgId]} alt="" aria-hidden="true" decoding="async" className="absolute inset-0 -z-10 h-full w-full object-cover" />
              <div className="absolute inset-0 -z-10 bg-pub-navy/75" aria-hidden="true" />
            </>
          )}
          {heading && (
            <MarkedHeading
              as="h1"
              text={heading}
              mark={false}
              className="max-w-[20ch] font-display text-[length:var(--text-pub-h1)] font-extrabold leading-pub-tight tracking-[-0.035em] text-pub-on-navy"
            />
          )}
          {subheading && <p className="pub-measure whitespace-pre-line text-pub-md leading-pub-normal text-pub-on-navy-soft">{subheading}</p>}
          {ctas.length > 0 && (
            <div className={`mt-2 flex w-full flex-wrap gap-3 ${justify} max-sm:flex-col max-sm:items-stretch`}>
              {ctas.map((cta, idx) => (
                <CtaButton
                  key={idx}
                  label={str(cta, "label", L)}
                  href={raw(cta, "href")}
                  target={raw(cta, "target")}
                  variant={raw(cta, "variant") || (idx === 0 ? "gold" : "onDark")}
                  icon={raw(cta, "icon")}
                  className="max-sm:w-full"
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    /**
     * THE OPENING SPREAD. Not a marketing hero: the first page of the book.
     * A ruled masthead line, an oversized Arabic display statement, the lede,
     * the actions, then the owner's real portrait plate beside it. The only
     * decoration is the discipline diagram bleeding off the start edge.
     */
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
      // image. Nothing here invents or substitutes a picture.
      const idn = ctx.identity;
      const ownerName = idn ? ls(idn.ownerName, L) : "";
      const ownerTitle = idn ? ls(idn.ownerTitle, L) : "";
      const ownerPhoto = idn?.ownerPhoto ?? null;
      const showIdentity = p.useIdentity !== false && Boolean(ownerName || ownerPhoto);
      const platePhoto = showIdentity ? ownerPhoto : null;
      const tagline = idn ? ls(idn.tagline, L) : "";
      if (!eyebrow && !heading && !subtitleHtml && !ctas.length && !videoId && !cmsSrc && !showIdentity) return null;
      const imageAlt = str(p, "imageAlt", L) || heading;
      // The discipline of the opening is the platform's own: both families are
      // taught, so the plate uses the reasoning geometry and the psychology
      // network appears on its own section further down the page.
      return (
        <div className="relative isolate overflow-hidden bg-pub-bg">
          <div className="pub-section pub-container grid items-center gap-[calc(var(--pub-gap)*2)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-[calc(var(--pub-gap)*3)]">
            <div className="flex min-w-0 flex-col items-start">
              <div className="flex w-full items-center gap-3 border-t border-pub-ink pt-3">
                {eyebrow ? <span className="tito-label text-pub-ink">{eyebrow}</span> : null}
                {tagline ? <span className="tito-label ms-auto hidden truncate sm:block">{tagline}</span> : null}
              </div>

              {heading && (
                <MarkedHeading
                  as="h1"
                  text={heading}
                  className="mt-6 max-w-[15ch] font-display text-[length:var(--text-pub-display)] font-extrabold leading-[1.16] tracking-[-0.04em] text-pub-ink [overflow-wrap:anywhere]"
                />
              )}
              {subtitleHtml && <RichText html={subtitleHtml} className="mt-6 max-w-[48ch] text-pub-md leading-pub-normal text-pub-ink-soft" />}

              {(ctas.length > 0 || (videoLabel && videoId)) && (
                <div className="mt-8 flex w-full flex-wrap items-center gap-4 max-sm:flex-col max-sm:items-stretch [&>*]:max-sm:w-full">
                  {ctas.map((cta, idx) => (
                    <CtaButton
                      key={idx}
                      label={str(cta, "label", L)}
                      href={raw(cta, "href")}
                      target={raw(cta, "target")}
                      variant={raw(cta, "variant") || (idx === 0 ? "primary" : "secondary")}
                      icon={raw(cta, "icon")}
                      shape={raw(p, "ctaShape")}
                    />
                  ))}
                  {videoLabel && videoId && <VideoCta videoId={videoId} label={videoLabel} />}
                </div>
              )}

              {/* Trust badges as a ruled data strip — facts in a row, not four
                  more boxes competing with the statement above them. */}
              {badges.length > 0 && (
                <ul className="mt-10 grid w-full grid-cols-1 border-t border-pub-line sm:grid-cols-2">
                  {badges.map((b, idx) => (
                    <li key={idx} className="flex min-w-0 items-start gap-3 border-b border-pub-line py-4 pe-4">
                      {raw(b, "icon") && (
                        <Icon name={raw(b, "icon")} size="md" className="mt-0.5 h-5 w-5 shrink-0 text-pub-accent-strong" />
                      )}
                      <span className="flex min-w-0 flex-col">
                        {str(b, "title", L) && <span className="text-pub-sm font-bold text-pub-ink">{str(b, "title", L)}</span>}
                        {str(b, "text", L) && <span className="mt-0.5 text-pub-xs leading-pub-snug text-pub-muted">{str(b, "text", L)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Visual column: a CMS-chosen image wins (the owner explicitly set
                one for this block); otherwise the identity portrait plate. */}
            {cmsSrc ? (
              <div className="relative mx-auto w-full max-w-[30rem]">
                <span aria-hidden="true" className="absolute bottom-6 -z-10 h-full w-full bg-pub-accent ltr:left-5 rtl:right-5" />
                <img
                  data-hero-visual="true"
                  src={cmsSrc}
                  alt={imageAlt}
                  width={900}
                  height={675}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  className="relative aspect-[4/3] w-full border border-pub-ink object-cover"
                />
              </div>
            ) : (
              <PortraitPlate
                photoUrl={platePhoto}
                name={showIdentity ? ownerName : ""}
                title={showIdentity ? ownerTitle : ""}
                alt={ownerName}
                kind="logic"
              />
            )}
          </div>
        </div>
      );
    }

    case "text": {
      const size = {
        body: "text-pub-base text-pub-ink-soft",
        lead: "text-pub-md text-pub-ink-soft",
        h3: "font-display text-[length:var(--text-pub-h3)] font-bold tracking-[-0.02em] text-pub-ink",
        h2: "font-display text-[length:var(--text-pub-h2)] font-extrabold tracking-[-0.03em] text-pub-ink",
        h1: "font-display text-[length:var(--text-pub-h1)] font-extrabold tracking-[-0.035em] text-pub-ink",
      }[raw(p, "size")] ?? "text-pub-base text-pub-ink-soft";
      const text = str(p, "content", L);
      if (!text) return null;
      const align = raw(p, "align") || "start";
      return (
        <p className={`max-w-[68ch] leading-pub-normal whitespace-pre-line ${size} ${align === "center" ? "mx-auto text-center" : align === "end" ? "text-end" : "text-start"}`}>
          {text}
        </p>
      );
    }
    case "rich_text":
      return <RichText html={str(p, "html", L)} className="max-w-[68ch] text-pub-base leading-pub-normal text-pub-ink-soft" />;
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
      const imgEl = hasImage ? (
        <div className="border border-pub-line">
          <CmsImage fileId={raw(p, "fileId")} alt={str(p, "alt", L)} ctx={ctx} aspect="4:3" />
        </div>
      ) : null;
      const textEl = (
        <div className="flex flex-col items-start gap-4">
          {heading && <MarkedHeading as="h3" text={heading} className="font-display text-[length:var(--text-pub-h3)] font-extrabold tracking-[-0.025em] text-pub-ink" />}
          {text && <p className="max-w-[54ch] whitespace-pre-line text-pub-base leading-pub-normal text-pub-ink-soft">{text}</p>}
          {str(p, "ctaLabel", L) && raw(p, "href") && <CtaButton label={str(p, "ctaLabel", L)} href={raw(p, "href")} variant="primary" />}
        </div>
      );
      return <div className="grid items-center gap-[calc(var(--pub-gap)*1.5)] md:grid-cols-2">{imageFirst ? <>{imgEl}{textEl}</> : <>{textEl}{imgEl}</>}</div>;
    }
    case "gallery": {
      const items = arr(p, "items").filter((i) => raw(i, "fileId") && ctx.images[raw(i, "fileId")]);
      if (!items.length) return null;
      return (
        <div className="grid grid-cols-2 gap-[var(--pub-gap)] sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, idx) => (
            <SmartLink key={idx} href={raw(item, "href")} className="block overflow-hidden border border-pub-line">
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
        <div className="flex flex-col gap-5">
          {str(p, "heading", L) && <p className="tito-label">{str(p, "heading", L)}</p>}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-8 border-t border-pub-line pt-6">
              {items.map((item, idx) => (
                <img key={idx} src={ctx.images[raw(item, "fileId")]} alt={str(item, "label", L)} loading="lazy" decoding="async" className="h-9 w-auto object-contain opacity-70 grayscale" />
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
        <figure className="w-full max-w-3xl">
          <div className="overflow-hidden border border-pub-ink">
            <Suspense fallback={<div className="aspect-video bg-pub-surface-2" />}>
              <VideoPlayer videoId={videoId} title={str(p, "caption", L) || undefined} />
            </Suspense>
          </div>
          {str(p, "caption", L) && <figcaption className="mt-3 text-pub-sm text-pub-muted">{str(p, "caption", L)}</figcaption>}
        </figure>
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
      const align = raw(p, "align") || "start";
      return (
        <div className={`flex flex-col gap-3 ${ALIGN[align as keyof typeof ALIGN] ?? ALIGN.start}`}>
          {icon && <Icon name={icon} size={raw(p, "size") || "lg"} className="text-pub-ink" />}
          {label && <p className="text-pub-base font-semibold text-pub-ink">{label}</p>}
        </div>
      );
    }
    case "icon_grid": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || raw(i, "icon"));
      if (!items.length) return null;
      return (
        <ul className="tito-rows w-full sm:grid sm:grid-cols-2 sm:gap-x-10">
          {items.map((item, idx) => (
            <li key={idx} className="tito-row grid-cols-[auto_1fr] items-center px-1">
              {raw(item, "icon") && <Icon name={raw(item, "icon")} size="md" className="text-pub-ink" />}
              <SmartLink href={raw(item, "href")} className="min-w-0 after:absolute after:inset-0">
                <span className="block font-display text-pub-base font-bold text-pub-ink">{str(item, "title", L)}</span>
                {str(item, "text", L) && <span className="mt-1 block text-pub-sm text-pub-muted">{str(item, "text", L)}</span>}
              </SmartLink>
            </li>
          ))}
        </ul>
      );
    }

    /**
     * Feature cards → a NUMBERED PROPOSITION LIST. Four claims about the
     * platform read far better as an ordered index than as four identical
     * boxes; the ordinal gives the eye its entry point and the hairline does
     * the separating that a border used to do.
     */
    case "feature_cards": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || str(i, "text", L));
      if (!items.length) return null;
      return (
        <ol className="grid w-full grid-cols-1 gap-x-12 border-t border-pub-line md:grid-cols-2">
          {items.map((item, idx) => {
            const href = raw(item, "href");
            const title = str(item, "title", L);
            const cta = str(item, "ctaLabel", L);
            const inner = (
              <>
                <div className="flex items-baseline gap-3">
                  <span data-numeral className="text-pub-sm font-bold text-ink-300">
                    <Ordinal n={idx + 1} />
                  </span>
                  {raw(item, "icon") && <Icon name={raw(item, "icon")} size="sm" className="h-4 w-4 self-center text-pub-accent-strong" />}
                  {title && <h3 className="font-display text-pub-md font-bold tracking-[-0.015em] text-pub-ink">{title}</h3>}
                </div>
                {str(item, "text", L) && <p className="mt-2 max-w-[46ch] ps-[2.1rem] text-pub-sm leading-pub-normal text-pub-muted">{str(item, "text", L)}</p>}
                {href && (
                  <span className={`mt-3 ps-[2.1rem] ${CARD_LINK}`}>
                    {cta || title}
                    <span aria-hidden="true" className={CARD_ARROW}>→</span>
                  </span>
                )}
              </>
            );
            return (
              <li key={idx} className="relative border-b border-pub-line py-6">
                {href ? (
                  <SmartLink href={href} ariaLabel={cta || title} className="block after:absolute after:inset-0">
                    {inner}
                  </SmartLink>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ol>
      );
    }

    case "pricing_cards": {
      const items = arr(p, "items").filter((i) => str(i, "name", L));
      if (!items.length) return null;
      return (
        <div className="grid w-full items-stretch gap-[var(--pub-gap)] md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => {
            const features = str(item, "features", L).split("\n").map((s) => s.trim()).filter(Boolean);
            const highlighted = bool(item, "highlighted");
            return (
              <div key={idx} className={`flex flex-col gap-5 border p-6 ${highlighted ? "border-pub-ink bg-pub-sheet" : "border-pub-line bg-pub-sheet"}`}>
                {highlighted && <span className="w-fit bg-pub-accent px-2 py-0.5 text-pub-xs font-bold text-pub-ink">{str(item, "period", L) || ""}</span>}
                <div>
                  <h3 className="tito-label">{str(item, "name", L)}</h3>
                  <p data-numeral className="mt-3 text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink" dir="auto">
                    {raw(item, "price")}
                  </p>
                  {!highlighted && str(item, "period", L) && <p className="mt-2 text-pub-sm text-pub-muted">{str(item, "period", L)}</p>}
                </div>
                {features.length > 0 && (
                  <ul className="flex flex-col gap-2 border-t border-pub-line pt-4">
                    {features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-pub-sm text-pub-ink-soft">
                        <Icon name="check" size="sm" className="mt-0.5 h-4 w-4 text-pub-accent-strong" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {str(item, "ctaLabel", L) && (
                  <CtaButton label={str(item, "ctaLabel", L)} href={raw(item, "ctaHref")} variant={highlighted ? "gold" : "secondary"} className="mt-auto w-full" />
                )}
              </div>
            );
          })}
        </div>
      );
    }

    /** Statistics are FIGURES: big tabular numerals on rules, never in boxes. */
    case "statistics": {
      const items = arr(p, "items").filter((i) => str(i, "value", L) || str(i, "label", L));
      if (!items.length) return null;
      const onBand = raw(p, "style") === "bar";
      const body = (
        <dl className={`grid w-full grid-cols-2 gap-x-8 lg:grid-cols-4 ${onBand ? "" : "border-t border-pub-line"}`}>
          {items.map((item, idx) => {
            const value = str(item, "value", L);
            const label = str(item, "label", L);
            const href = raw(item, "href");
            const inner = (
              <>
                <dt className="sr-only">{label}</dt>
                <dd>
                  <span data-numeral dir="auto" className={`block text-[length:var(--text-pub-xl)] font-extrabold leading-none tracking-[-0.04em] ${onBand ? "text-pub-on-navy" : "text-pub-ink"}`}>
                    {value}
                  </span>
                  {label && <span className={`tito-label mt-2.5 block ${onBand ? "text-pub-on-navy-muted" : ""}`}>{label}</span>}
                </dd>
              </>
            );
            return (
              <div key={idx} className={`relative py-6 ${onBand ? "border-b border-pub-on-navy/15" : "border-b border-pub-line"}`}>
                {href ? (
                  <SmartLink href={href} className="block after:absolute after:inset-0">{inner}</SmartLink>
                ) : (
                  inner
                )}
              </div>
            );
          })}
        </dl>
      );
      return onBand ? <div className={`${PUB_BAND} px-6 py-4 sm:px-8`}>{body}</div> : body;
    }

    case "testimonials": {
      const items = arr(p, "items").filter((i) => str(i, "quote", L));
      if (!items.length) return null;
      return (
        <div className="grid w-full gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => (
            <figure key={idx} className="flex flex-col gap-4 border-s-2 border-pub-accent ps-5">
              <blockquote className="text-pub-base leading-pub-normal text-pub-ink">{str(item, "quote", L)}</blockquote>
              <figcaption className="mt-auto flex items-center gap-3">
                {raw(item, "image") && ctx.images[raw(item, "image")] && (
                  <img src={ctx.images[raw(item, "image")]} alt={str(item, "name", L)} loading="lazy" decoding="async" className="h-10 w-10 rounded-pub-pill object-cover" />
                )}
                <span className="flex flex-col">
                  {str(item, "name", L) && <span className="text-pub-sm font-bold text-pub-ink">{str(item, "name", L)}</span>}
                  {str(item, "role", L) && <span className="text-pub-xs text-pub-muted">{str(item, "role", L)}</span>}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      );
    }

    case "faq":
    case "accordion": {
      const isFaq = block.type === "faq";
      const items = arr(p, "items").filter((i) => str(i, isFaq ? "q" : "title", L));
      if (!items.length) return null;
      return (
        <div className="w-full max-w-3xl border-t border-pub-line">
          {items.map((item, idx) => (
            <details key={idx} className="group border-b border-pub-line">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 py-4 [&::-webkit-details-marker]:hidden">
                <span className="tito-label shrink-0 text-ink-300" aria-hidden="true">
                  <Ordinal n={idx + 1} />
                </span>
                <span className="flex-1 font-display text-pub-base font-bold text-pub-ink">{str(item, isFaq ? "q" : "title", L)}</span>
                <Icon name="chevron-down" size="sm" className="shrink-0 text-pub-muted transition-transform group-open:rotate-180" />
              </summary>
              {isFaq ? (
                <p className="max-w-[62ch] ps-[2.75rem] pb-5 text-pub-sm leading-pub-normal whitespace-pre-line text-pub-muted">{str(item, "a", L)}</p>
              ) : (
                <RichText html={str(item, "content", L)} className="max-w-[62ch] ps-[2.75rem] pb-5 text-pub-sm leading-pub-normal text-pub-muted" />
              )}
            </details>
          ))}
        </div>
      );
    }

    case "announcement": {
      const text = str(p, "text", L);
      if (!text) return null;
      const tone = {
        info: "border-pub-ink bg-pub-surface text-pub-ink",
        success: "border-pub-ok bg-pub-success-bg text-pub-ok",
        warning: "border-pub-warning bg-pub-warning-bg text-pub-warning",
        brand: "border-pub-accent bg-pub-accent-bg text-pub-ink",
      }[raw(p, "tone")] ?? "border-pub-ink bg-pub-surface text-pub-ink";
      return (
        <div className={`flex w-full flex-wrap items-center gap-3 border-s-2 px-5 py-3.5 text-pub-sm font-semibold ${tone}`}>
          {raw(p, "icon") && <Icon name={raw(p, "icon")} size="sm" className="text-current" />}
          <span>{text}</span>
          {str(p, "ctaLabel", L) && raw(p, "href") && (
            <SmartLink href={raw(p, "href")} className="inline-flex min-h-9 items-center font-bold underline decoration-2 underline-offset-4">
              {str(p, "ctaLabel", L)}
            </SmartLink>
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
        <div className="grid w-full items-stretch gap-0 overflow-hidden bg-pub-navy md:grid-cols-2">
          <div className="flex flex-col items-start justify-center gap-4 p-6 sm:p-10">
            {heading && <MarkedHeading as="h3" text={heading} mark={false} className="max-w-[18ch] font-display text-[length:var(--text-pub-lg)] font-extrabold leading-pub-tight tracking-[-0.03em] text-pub-on-navy" />}
            {text && <p className="max-w-[46ch] whitespace-pre-line text-pub-sm leading-pub-normal text-pub-on-navy-soft">{text}</p>}
            {str(p, "ctaLabel", L) && raw(p, "ctaHref") && <CtaButton label={str(p, "ctaLabel", L)} href={raw(p, "ctaHref")} variant="gold" />}
          </div>
          {raw(p, "image") && ctx.images[raw(p, "image")] && (
            <CmsImage fileId={raw(p, "image")} alt={heading} ctx={ctx} aspect="4:3" className="h-full" />
          )}
        </div>
      );
    }

    case "countdown":
      return <Countdown props={p} ctx={ctx} />;

    /**
     * The teacher, presented as an editorial spread: the real photograph in the
     * portrait plate, the name as a display heading, the bio as running copy at
     * a readable measure. `showPhoto: false` keeps the picture to ONE place per
     * page (the homepage hero already frames it).
     */
    case "teacher_profile": {
      const idn = ctx.identity;
      const name = bool(p, "useIdentity") ? ls(idn.ownerName, L) : str(p, "name", L);
      const title = bool(p, "useIdentity") ? ls(idn.ownerTitle, L) : str(p, "title", L);
      const photoUrl = bool(p, "useIdentity") ? idn.ownerPhoto : (raw(p, "photo") ? ctx.images[raw(p, "photo")] ?? null : null);
      const bio = str(p, "bio", L);
      if (!name && !photoUrl && !bio) return null;
      const framed = photoUrl && p.showPhoto !== false;
      const tagline = ctx.identity ? ls(ctx.identity.tagline, L) : "";
      // Owner-chosen corner portrait from the illustration catalog. `none` or an
      // unknown id → no portrait at all: the block never picks a face by itself.
      const wmId = raw(p, "watermark");
      const watermark = !framed && wmId && wmId !== "none" ? thinkerById(wmId) : null;
      const lines = (
        <>
          <p className="tito-label">{title || tagline}</p>
          {name && <h3 className="mt-3 font-display text-[length:var(--text-pub-h2)] font-extrabold leading-pub-tight tracking-[-0.035em] text-pub-ink">{name}</h3>}
          {bio && <RichText html={bio} className="mt-5 max-w-[56ch] text-pub-base leading-pub-normal text-pub-ink-soft" />}
        </>
      );
      if (framed) {
        return (
          <div className="grid w-full items-center gap-[calc(var(--pub-gap)*2)] md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <div className="relative w-full max-w-[20rem]">
              <span aria-hidden="true" className="absolute bottom-4 -z-10 h-full w-full bg-pub-accent ltr:left-4 rtl:right-4" />
              <img src={photoUrl} alt={name} loading="lazy" decoding="async" className="relative aspect-[4/5] w-full border border-pub-ink object-cover object-top" />
            </div>
            <div className="min-w-0">{lines}</div>
          </div>
        );
      }
      return (
        <div className="relative isolate w-full overflow-hidden border-t border-pub-ink pt-6">
          {watermark && (
            <span aria-hidden="true" className="pointer-events-none absolute -top-4 bottom-0 z-0 hidden w-40 opacity-25 sm:block ltr:right-0 rtl:left-0">
              <ThinkerPortrait thinker={watermark} presentation="engrave" />
            </span>
          )}
          <div className={`relative z-[1] min-w-0 ${watermark ? "sm:pe-48" : ""}`}>{lines}</div>
        </div>
      );
    }

    case "login_cta":
    case "register_cta": {
      const href = block.type === "login_cta" ? "/login" : "/register";
      const label = str(p, "label", L) || t(L, block.type === "login_cta" ? "common.login" : "common.register");
      return (
        <div className="flex w-full flex-col items-start gap-4 border-t border-pub-ink pt-6">
          {str(p, "sublabel", L) && <p className="max-w-[48ch] text-pub-md leading-pub-normal text-pub-ink-soft">{str(p, "sublabel", L)}</p>}
          <CtaButton label={label} href={href} variant="primary" />
        </div>
      );
    }

    case "social_links": {
      const items = arr(p, "items").filter((i) => raw(i, "url"));
      if (!items.length) return null;
      const asButtons = raw(p, "style") === "buttons";
      return (
        <div className="flex flex-wrap items-center gap-2">
          {items.map((item, idx) => {
            const network = raw(item, "network");
            const label = str(item, "label", L);
            return asButtons ? (
              <a key={idx} href={raw(item, "url")} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center gap-2 rounded-pub-md border border-pub-line-strong bg-pub-sheet px-4 text-pub-sm font-semibold text-pub-ink transition-colors hover:border-pub-ink">
                <Icon name={network} size="sm" className="text-current" />
                {label || network}
              </a>
            ) : (
              <a key={idx} href={raw(item, "url")} target="_blank" rel="noopener noreferrer nofollow" aria-label={label || network} className="inline-flex h-11 w-11 items-center justify-center border border-pub-line text-pub-ink-soft transition-colors hover:border-pub-ink hover:text-pub-ink">
                <Icon name={network} size="md" className="h-5 w-5 text-current" />
              </a>
            );
          })}
        </div>
      );
    }

    /** Contact details are DATA: a labelled definition list on hairlines. */
    case "contact_info": {
      const idn = ctx.identity;
      const rows: Array<{ icon: string; value: string; href?: string; ltr?: boolean }> = [];
      if (bool(p, "showPhone") && idn.contactPhone) rows.push({ icon: "phone", value: idn.contactPhone, href: `tel:${idn.contactPhone}`, ltr: true });
      if (bool(p, "showEmail") && idn.contactEmail) rows.push({ icon: "mail", value: idn.contactEmail, href: `mailto:${idn.contactEmail}`, ltr: true });
      const address = str(p, "addressOverride", L) || ls(idn.contactAddress, L);
      if (bool(p, "showAddress") && address) rows.push({ icon: "map-pin", value: address });
      if (!rows.length) return null;
      return (
        <ul className="w-full border-t border-pub-line">
          {rows.map((row, idx) => (
            <li key={idx} className="border-b border-pub-line">
              {row.href ? (
                <a href={row.href} className="flex min-h-14 items-center gap-3 text-pub-base text-pub-ink transition-colors hover:text-pub-accent-strong">
                  <Icon name={row.icon} size="sm" className="h-4 w-4 shrink-0 text-pub-muted" />
                  <span dir={row.ltr ? "ltr" : undefined} className="break-all">{row.value}</span>
                </a>
              ) : (
                <p className="flex min-h-14 items-center gap-3 py-3 text-pub-base text-pub-ink-soft">
                  <Icon name={row.icon} size="sm" className="h-4 w-4 shrink-0 text-pub-muted" />
                  <span>{row.value}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      );
    }

    case "whatsapp_cta": {
      const phone = (raw(p, "phone") || ctx.identity.whatsapp).replace(/[^\d]/g, "");
      if (!phone) return null; // not configured → nothing renders
      const label = str(p, "label", L) || t(L, "home.whatsappCta");
      const href = `https://wa.me/${phone}`;
      if (raw(p, "style") === "floating") {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} className="fixed bottom-[var(--pub-fab-inset)] end-[var(--pub-fab-inset)] z-40 inline-flex h-[var(--pub-fab-size)] w-[var(--pub-fab-size)] items-center justify-center rounded-pub-pill bg-pub-whatsapp text-white shadow-pub-lg transition-colors hover:bg-pub-whatsapp-strong">
            <Icon name="whatsapp" size="lg" className="text-current" />
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pub-md bg-pub-navy px-6 text-pub-base font-bold text-pub-on-navy transition-colors hover:bg-pub-navy-2">
          <Icon name="whatsapp" size="sm" className="text-current" />
          {label}
        </a>
      );
    }
    case "telegram_cta": {
      const url = raw(p, "url") || ctx.identity.telegram;
      if (!url) return null;
      const label = str(p, "label", L) || t(L, "home.telegramCta");
      if (raw(p, "style") === "floating") {
        return (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} className="fixed bottom-[calc(var(--pub-fab-inset)+var(--pub-fab-clear))] end-[var(--pub-fab-inset)] z-40 inline-flex h-[var(--pub-fab-size)] w-[var(--pub-fab-size)] items-center justify-center rounded-pub-pill bg-pub-navy text-pub-on-navy shadow-pub-lg transition-colors hover:bg-pub-navy-2">
            <Icon name="telegram" size="lg" className="text-current" />
          </a>
        );
      }
      return (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-pub-md border border-pub-line-strong bg-pub-sheet px-6 text-pub-base font-bold text-pub-ink transition-colors hover:border-pub-ink">
          <Icon name="telegram" size="sm" className="text-current" />
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
        <div className="flex w-full flex-col gap-5">
          {heading && <MarkedHeading as="h3" text={heading} mark={false} className="font-display text-[length:var(--text-pub-h3)] font-extrabold tracking-[-0.025em] text-pub-ink" />}
          {text && <p className="max-w-[52ch] text-pub-base leading-pub-normal text-pub-ink-soft">{text}</p>}
          <CmsForm form={form} ctx={ctx} compact={block.type === "newsletter_form"} />
        </div>
      );
    }

    /* Resolved content lists. Rows by default; media cards only where the rows
       genuinely carry cover art. */
    case "course_cards":
    case "subject_cards":
    case "program_cards":
    case "free_content":
    case "featured_content":
    case "latest_lessons":
      return <IndexRows rows={ctx.dynamic[block.id] ?? []} ctx={ctx} />;
    case "video_showcase":
      return <MediaCards rows={ctx.dynamic[block.id] ?? []} ctx={ctx} showPlay />;
    case "product_cards": {
      const rows = ctx.dynamic[block.id] ?? [];
      const anyArt = rows.some((r) => r.imageUrl || r.image);
      return anyArt ? <MediaCards rows={rows} ctx={ctx} /> : <IndexRows rows={rows} ctx={ctx} />;
    }

    /**
     * THE SUBJECT SPREAD — the most important surface on the site.
     *
     * Each published subject gets a full panel carrying its own discipline:
     * the signature mark and a coloured spine (orthogonal for philosophy and
     * logic, a node network for psychology), the title at display size, the
     * journey line (year → stage → grade) as ruled data, and the counts as
     * figures. Rows come from `studyHub`, so a panel exists only when a subject
     * really has a published term container.
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
        <div className="flex w-full flex-col gap-[calc(var(--pub-gap)*1.6)]">
          <ul className={`grid gap-[var(--pub-gap)] ${cols}`}>
            {rows.map((row) => {
              const titleAr = ls(row.title, "ar");
              const titleEn = ls(row.title, "en");
              const title = L === "ar" ? titleAr || titleEn : titleEn || titleAr;
              const meta = showJourney ? ls(row.meta, L) : "";
              const desc = ls(row.desc, L);
              const cta = ls(row.cta, L) || title;
              const chips = (row.chips ?? []).map((c) => ls(c, L)).filter(Boolean);
              const kind = subjectKindOf(row.id, titleEn, titleAr);
              return (
                <li key={row.id} data-subject={kind} className="min-w-0">
                  <SmartLink href={row.href} ariaLabel={`${cta} — ${title}`} className={SUBJECT_PANEL_CLASS}>
                    <SubjectPanelBody kind={kind} meta={meta} title={title} desc={desc} facts={chips} cta={cta} />
                  </SmartLink>
                </li>
              );
            })}
          </ul>
          {allLabel && allHref && <CtaButton label={allLabel} href={allHref} variant="secondary" />}
        </div>
      );
    }

    /** Grades are a ruled roster, not eight identical boxes. */
    case "grade_cards": {
      const rows = (ctx.dynamic[block.id] ?? []).filter((r) => ls(r.title, L));
      if (!rows.length) return null;
      return (
        <ul className="grid w-full grid-cols-1 gap-x-12 border-t border-pub-line md:grid-cols-2">
          {rows.map((row, idx) => {
            const f = rowFields(row, L);
            const ctaLabel = f.cta || f.title;
            return (
              <li key={row.id} className="tito-row grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center px-1">
                <span className="tito-label text-ink-300" aria-hidden="true">
                  <Ordinal n={idx + 1} />
                </span>
                <div className="min-w-0">
                  <SmartLink href={row.href} ariaLabel={`${ctaLabel} — ${f.title}`} className="after:absolute after:inset-0">
                    <span className="font-display text-pub-base font-bold tracking-[-0.015em] text-pub-ink [overflow-wrap:anywhere]">{f.title}</span>
                  </SmartLink>
                  {(f.badge || f.chips.length > 0) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      {f.badge && <span className="tito-label">{f.badge}</span>}
                      {f.chips.map((chip) => (
                        <span key={chip} className="text-pub-xs text-pub-muted">{chip}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="relative z-10 text-pub-ink" aria-hidden="true">
                  <ArrowGlyph />
                </span>
              </li>
            );
          })}
        </ul>
      );
    }

    /** The external exams platform — clearly marked as leaving the site. */
    case "exam_platform": {
      const url = ctx.questionPlatformUrl;
      if (!url) return null; // disabled/unconfigured/unsafe → nothing renders
      const headingText = str(p, "heading", L);
      const text = str(p, "text", L);
      const cta = str(p, "ctaLabel", L) || t(L, "home.examCta");
      const note = str(p, "note", L);
      return (
        <div className={`${PUB_BAND} w-full p-6 sm:p-10`}>
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-10 opacity-[0.10] ltr:-right-10 rtl:-left-10">
            <SubjectPlate kind="psych" className="h-56 w-80 text-pub-on-navy" />
          </span>
          <div className="relative flex flex-col items-start gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <div className="flex max-w-2xl flex-col">
              <span className="tito-label inline-flex items-center gap-2 text-pub-accent">
                <Icon name="external-link" size="sm" className="h-3.5 w-3.5 text-current" />
                {t(L, "home.externalTag")}
              </span>
              {headingText && (
                <MarkedHeading as="h3" text={headingText} mark={false} className="mt-4 max-w-[18ch] font-display text-[length:var(--text-pub-lg)] font-extrabold leading-pub-tight tracking-[-0.03em] text-pub-on-navy" />
              )}
              {text && <p className="mt-4 max-w-[52ch] text-pub-sm leading-pub-normal text-pub-on-navy-soft">{text}</p>}
            </div>
            <div className="flex w-full flex-col items-start gap-2 lg:w-auto lg:items-end">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pub-md bg-pub-accent px-6 text-pub-base font-bold text-pub-ink transition-colors hover:bg-pub-accent-soft lg:w-auto"
              >
                {cta}
                <Icon name="external-link" size="sm" className="text-current" />
              </a>
              {note && <p className="text-pub-xs text-pub-on-navy-muted">{note}</p>}
            </div>
          </div>
        </div>
      );
    }

    /**
     * The journey — an ORTHOGONAL sequence. Steps sit on one rule with the
     * ordinal above the title and a right-angle connector between them, which
     * is the philosophy/logic geometry doing real work instead of ornament.
     */
    case "journey_steps": {
      const items = arr(p, "items").filter((i) => str(i, "title", L) || str(i, "text", L));
      if (!items.length) return null;
      return (
        <ol className="grid w-full gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, idx) => {
            const href = raw(item, "href");
            const title = str(item, "title", L);
            const body = (
              <>
                <span className="flex items-center gap-3">
                  <span data-numeral className="text-[length:var(--text-pub-lg)] font-extrabold leading-none tracking-[-0.04em] text-pub-ink">
                    <Ordinal n={idx + 1} />
                  </span>
                  {raw(item, "icon") && <Icon name={raw(item, "icon")} size="sm" className="h-4 w-4 text-pub-accent-strong" />}
                </span>
                {title && <h3 className="mt-4 font-display text-pub-base font-bold tracking-[-0.015em] text-pub-ink">{title}</h3>}
                {str(item, "text", L) && <p className="mt-2 max-w-[34ch] text-pub-sm leading-pub-normal text-pub-muted">{str(item, "text", L)}</p>}
              </>
            );
            return (
              <li key={idx} className="relative border-t-2 border-pub-ink pt-5">
                {/* the right-angle connector to the next step (desktop only) */}
                {idx < items.length - 1 && (
                  <span aria-hidden="true" className="absolute -top-px hidden h-0.5 w-6 bg-pub-accent lg:block ltr:left-full rtl:right-full" />
                )}
                {href ? (
                  <SmartLink href={href} ariaLabel={title} className="block after:absolute after:inset-0">
                    {body}
                  </SmartLink>
                ) : (
                  body
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
        <ul className="grid w-full gap-x-12 border-t border-pub-line sm:grid-cols-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-3 border-b border-pub-line py-5">
              <Icon name={raw(item, "icon") || "check"} size="sm" className="mt-0.5 h-4 w-4 shrink-0 text-pub-accent-strong" />
              <span className="flex min-w-0 flex-col gap-1">
                {str(item, "title", L) && <span className="text-pub-base font-bold text-pub-ink">{str(item, "title", L)}</span>}
                {str(item, "text", L) && <span className="max-w-[44ch] text-pub-sm leading-pub-normal text-pub-muted">{str(item, "text", L)}</span>}
              </span>
            </li>
          ))}
        </ul>
      );
    }

    /** The closing statement. Ink band, display type, one highlighter action. */
    case "cta_banner": {
      const headingText = str(p, "heading", L);
      const text = str(p, "text", L);
      const note = str(p, "note", L);
      const ctas = arr(p, "ctas").filter((i) => str(i, "label", L) || raw(i, "href"));
      if (!headingText && !text && !ctas.length) return null;
      return (
        <div className={`${PUB_BAND} w-full px-6 py-12 sm:px-12 sm:py-16`}>
          <span aria-hidden="true" className="pointer-events-none absolute -top-16 opacity-[0.10] ltr:-left-12 rtl:-right-12">
            <SubjectPlate kind="logic" className="h-72 w-[26rem] text-pub-on-navy" />
          </span>
          <div className="relative flex flex-col items-start gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
            <div className="max-w-2xl">
              {headingText && (
                <MarkedHeading
                  as="h2"
                  text={headingText}
                  mark={false}
                  className="max-w-[16ch] font-display text-[length:var(--text-pub-h2)] font-extrabold leading-pub-tight tracking-[-0.04em] text-pub-on-navy"
                />
              )}
              {text && <p className="mt-5 max-w-[52ch] text-pub-md leading-pub-normal text-pub-on-navy-soft">{text}</p>}
            </div>
            {ctas.length > 0 && (
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                {ctas.map((cta, idx) => (
                  <CtaButton
                    key={idx}
                    label={str(cta, "label", L)}
                    href={raw(cta, "href")}
                    target={raw(cta, "target")}
                    // The band is ink, so the variants are resolved FOR a dark
                    // surface: the first CTA is the single highlighter action,
                    // the rest are the outlined on-dark grammar. `outline` /
                    // `ghost` / `secondary` were built for paper and would
                    // render an invisible label here.
                    variant={((): string => {
                      const want = raw(cta, "variant");
                      if (!want) return idx === 0 ? "gold" : "onDark";
                      if (want === "outline" || want === "ghost" || want === "secondary") return "onDark";
                      if (want === "primary") return idx === 0 ? "gold" : "onDark";
                      return want;
                    })()}
                    icon={raw(cta, "icon")}
                    shape={raw(p, "ctaShape")}
                  />
                ))}
              </div>
            )}
          </div>
          {note && <p className="relative mt-8 text-pub-xs text-pub-on-navy-muted">{note}</p>}
        </div>
      );
    }

    case "divider": {
      const variant = raw(p, "variant") || "line";
      if (variant === "dots") {
        return (
          <div className="flex gap-1.5 py-2" aria-hidden="true">
            {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 bg-pub-line-strong" />)}
          </div>
        );
      }
      if (variant === "gradient") return <hr className="h-0.5 w-full border-0 bg-pub-ink" aria-hidden="true" />;
      return <hr className="h-px w-full border-0 bg-pub-line" aria-hidden="true" />;
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
 * Section chrome, expressed in LAYER A only. `brand`/`dark` both become the
 * same flat ink band; `default`, `surface` and `muted` are the paper steps that
 * carry most of the page.
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
  sm: "py-[calc(var(--pub-pad-y)*0.5)]",
  md: "py-[var(--pub-pad-y)]",
  lg: "py-[calc(var(--pub-pad-y)*1.3)]",
  xl: "py-[calc(var(--pub-pad-y)*1.65)]",
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

/**
 * Blocks that ARE the whole surface: they bring their own band, their own
 * padding and their own container, so the section must not wrap them in a
 * second one. Without this a full-bleed opening ends up inset inside a
 * container inside another container.
 */
const FULL_BLEED_BLOCKS = new Set(["hero_showcase"]);

export interface RenderBlock { id: string; type: string; props: P; visible: boolean; children?: RenderBlock[] }

/**
 * Block types whose content is resolved from the database at render time (or
 * from a platform setting). When such a block has nothing to show it renders
 * NOTHING — and a section whose only visible children are all empty like this
 * collapses completely (no orphan heading, no empty padded band).
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
   * Identity/settings-driven blocks read the owner's OWN fields — an unset
   * field means there is nothing to show, so the section collapses with it.
   * Without this rule a fresh install would render a padded "contact" band with
   * no contact details in it.
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
 * Anchor ids of the sections that will ACTUALLY render, using the same
 * predicate `SectionView` uses to decide whether to emit its `id` at all.
 *
 * This is what keeps fragment links truthful: a collapsed section emits no
 * `id`, so a link to it would be a dead anchor. Keeping the predicate in one
 * place and consuming it in `resolveCmsHref` means the link layer can never
 * disagree with the section layer.
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

/**
 * A section renders as an INDEX ENTRY: an ordinal and a hairline, then the
 * display heading, then the content. `index` is the section's position on the
 * page (1-based) and is supplied by `PageView`; standalone callers may omit it
 * and simply get no numeral.
 */
export function SectionView({ section, ctx, index }: { section: RenderBlock; ctx: CmsRenderCtx; index?: number }) {
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
  const onDark = bg === "brand" || bg === "dark" || hasBgImage;

  // Owner-supplied anchor id — strict pattern + length, never arbitrary text.
  const rawAnchor = raw(p, "anchor");
  const anchorId = /^[A-Za-z0-9_-]{1,40}$/.test(rawAnchor) ? rawAnchor : undefined;

  // A full-bleed opening owns the whole section: no container, no padding, no
  // section heading chrome competing with its own.
  const fullBleed = children.length > 0 && children.every((c) => FULL_BLEED_BLOCKS.has(c.type)) && !heading && !subheading;
  if (fullBleed) {
    return (
      <section id={anchorId} className={`cms-section scroll-mt-24 ${bool(p, "hideMobile") ? "max-md:hidden" : ""}`}>
        {children.map((child) => (
          <BlockBody key={child.id} block={child} ctx={ctx} />
        ))}
      </section>
    );
  }

  const headingEl =
    heading || subheading ? (
      <header className={`mb-[calc(var(--pub-gap)*2)] ${align === "center" ? "mx-auto max-w-3xl text-center" : align === "end" ? "text-end" : ""}`}>
        <div className={`flex items-center gap-3 border-t pt-3.5 ${onDark ? "border-pub-on-navy/25" : "border-pub-ink"}`}>
          {index != null && (
            <span className={`tito-label ${onDark ? "text-pub-on-navy" : "text-pub-ink"}`} aria-hidden="true">
              <Ordinal n={index} />
            </span>
          )}
          <span className={`h-px flex-1 ${onDark ? "bg-pub-on-navy/20" : "bg-pub-line"}`} aria-hidden="true" />
        </div>
        {heading && (
          <MarkedHeading
            text={heading}
            className={`mt-5 max-w-[20ch] font-display text-[length:var(--text-pub-h2)] font-extrabold leading-pub-tight tracking-[-0.035em] ${
              onDark ? "text-pub-on-navy" : "text-pub-ink"
            } ${align === "center" ? "mx-auto" : ""}`}
          />
        )}
        {subheading && (
          <p className={`mt-4 max-w-[54ch] text-pub-md leading-pub-normal ${onDark ? "text-pub-on-navy-soft" : "text-pub-ink-soft"} ${align === "center" ? "mx-auto" : ""}`}>
            {subheading}
          </p>
        )}
      </header>
    ) : null;

  return (
    <section
      id={anchorId}
      className={`cms-section relative isolate scroll-mt-24 ${SECTION_BG[bg] ?? "bg-pub-bg"} ${SECTION_PAD[raw(p, "padding") || "md"] ?? SECTION_PAD.md} ${bool(p, "hideMobile") ? "max-md:hidden" : ""}`}
    >
      {hasBgImage && (
        <>
          <img src={ctx.images[bgImageId]} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 -z-10 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-pub-navy/80" aria-hidden="true" />
        </>
      )}
      <div className={`relative mx-auto w-full px-[var(--pub-pad-x)] ${SECTION_CONTAINER[raw(p, "container") || "normal"] ?? SECTION_CONTAINER.normal}`}>
        {headingEl}
        {children.length > 0 && (
          <div
            className={`grid ${SECTION_GRID[columns] ?? SECTION_GRID["1"]} ${SECTION_GAP[raw(p, "gap") || "md"] ?? SECTION_GAP.md} ${
              align === "center" ? "justify-items-center" : ""
            }`}
          >
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
  // `main` is false when the page is already wrapped in a <main> landmark by
  // its layout — nesting a second <main> would violate the "one main landmark"
  // rule (axe: landmark-no-duplicate-main / landmark-unique).
  const Wrapper = main ? "main" : "div";
  // Resolve link destinations once per page. The provider renders no DOM
  // element, so the emitted markup (and therefore the layout) is unchanged.
  const nav = useMemo<CmsHrefContext>(
    () => ({ anchors: renderedAnchorIds(sections, ctx), questionPlatformUrl: ctx.questionPlatformUrl ?? null }),
    [sections, ctx],
  );
  /**
   * Section numbering is the page's own index. Only sections that carry a
   * heading are numbered, and the counter advances with them — a full-bleed
   * opening or a bare CTA band does not consume an entry, so the numerals a
   * reader sees are 01, 02, 03… with no gaps.
   */
  let counter = 0;
  return (
    <Wrapper className="flex flex-col">
      <CmsNavContext.Provider value={nav}>
        {sections.map((s) => {
          const numbered = Boolean(str(s.props, "heading", ctx.locale));
          if (numbered) counter += 1;
          return <SectionView key={s.id} section={s} ctx={ctx} index={numbered ? counter : undefined} />;
        })}
      </CmsNavContext.Provider>
    </Wrapper>
  );
}
