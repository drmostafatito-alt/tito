import { t, type Locale } from "~/lib/i18n";

/**
 * Entry point to the STANDALONE Questions & Exams Platform.
 *
 * Tito no longer hosts an internal question bank/exam engine. Students reach the
 * external platform exclusively through this clearly-labelled, admin-configured
 * entry (Appearance → System). The `url` prop is validated server-side
 * (https-only — see ~lib/question-platform), every link opens in a new tab with
 * rel="noopener noreferrer", and every label is bilingual.
 *
 * Visual language follows the exam-platform reference's STRUCTURE (generous
 * feature card, medallion icon, eyebrow chip, clear title/description hierarchy,
 * prominent CTA, mobile stacking with a full-width tap target) but uses Tito's
 * existing approved violet/brand tokens and primitives — no new design system.
 */

function PlatformGlyph({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* clipboard / question sheet */}
      <path d="M9 4h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2V5a1 1 0 0 1 1-1z" />
      <path d="M9 3.5h6V7H9z" />
      {/* question lines */}
      <path d="M8.5 12h4.5" />
      <path d="M8.5 15.5h6.5" />
      {/* external / leap arrow */}
      <path d="m14.5 16.5 2-2 2 2" />
      <path d="M16.5 14.5V19" />
    </svg>
  );
}

function ExternalArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </svg>
  );
}

const focusCls = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-navy";

/**
 * Dashboard feature block. Renders nothing when `url` is null (caller may also
 * short-circuit; kept defensive so a missing setting can never render a dead
 * link). The three regions (medallion / copy / action) sit in a wide 3-column
 * grid on desktop and stack vertically on tablet & mobile, where the CTA becomes
 * a full-width, ≥48px tap target — no clipping, no horizontal overflow.
 */
export function QuestionPlatformCard({ url, locale }: { url: string | null; locale: Locale }) {
  if (!url) return null;
  return (
    <section
      data-testid="question-platform-card"
      className="relative isolate overflow-hidden rounded-pub-xl border border-pub-line-strong bg-gradient-to-br from-pub-surface via-white to-white shadow-sm"
    >
      {/* Soft decorative washes — purely ambient, pointer-safe, hidden on small
          screens to keep the mobile card calm and content-first. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 hidden sm:block">
        <div className="absolute -top-20 end-8 h-52 w-52 rounded-full bg-pub-line-strong/30 blur-3xl" />
        <div className="absolute -bottom-24 start-1/4 h-48 w-48 rounded-full bg-pub-warning-bg/40 blur-3xl" />
      </div>

      <div className="relative grid gap-5 p-5 sm:gap-6 sm:p-7 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-8 lg:p-8">
        {/* Icon medallion with a dashed gold ring echo (reference hero motif) */}
        <div className="flex justify-center lg:block">
          <div className="relative h-16 w-16 shrink-0 sm:h-[72px] sm:w-[72px]">
            <span
              aria-hidden="true"
              className="absolute -inset-1.5 hidden rounded-[1.75rem] border-2 border-dashed border-amber-300/70 rotate-6 sm:block"
            />
            <span
              aria-hidden="true"
              className="relative flex h-full w-full items-center justify-center rounded-2xl bg-gradient-to-br from-pub-navy to-pub-ink-soft text-white shadow-lg shadow-pub-navy/25"
            >
              <PlatformGlyph className="h-8 w-8 sm:h-9 sm:w-9" />
            </span>
          </div>
        </div>

        {/* Copy */}
        <div className="min-w-0 text-center lg:text-start">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pub-warning-bg bg-pub-warning-bg px-3 py-1 text-[11px] font-bold text-pub-warning sm:text-xs">
            <ExternalArrow className="h-3 w-3 rtl:-scale-x-100" />
            {t(locale, "questionPlatform.externalTag")}
          </span>
          <h2 className="mt-3 text-xl font-extrabold tracking-tight text-pub-ink sm:text-2xl">
            {t(locale, "questionPlatform.title")}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-pub-muted sm:text-[15px] lg:mx-0">
            {t(locale, "questionPlatform.description")}
          </p>
        </div>

        {/* Action — full-width tap target on phones, auto on tablet/desktop */}
        <div className="flex flex-col items-stretch gap-1.5 sm:items-center lg:items-end">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="question-platform-cta"
            aria-label={t(locale, "questionPlatform.ctaAria")}
            className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-pub-navy px-6 text-sm font-bold text-white shadow-md shadow-pub-navy/25 transition-colors hover:bg-pub-ink-soft sm:w-auto sm:px-7 sm:text-base ${focusCls}`}
          >
            {t(locale, "questionPlatform.cta")}
            <ExternalArrow className="h-4 w-4 shrink-0 rtl:-scale-x-100" />
          </a>
          <span className="flex items-center justify-center gap-1 text-[11px] font-medium text-pub-muted lg:justify-end">
            <ExternalArrow className="h-3 w-3 rtl:-scale-x-100" />
            {t(locale, "questionPlatform.newTabHint")}
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * Compact nav/menu entry (student top navigation on desktop, mobile drawer).
 * Styled as one coherent brand-tinted feature with the dashboard card: a soft
 * pill on desktop, a full-width rounded row in the mobile drawer. ≥44px target.
 */
export function QuestionPlatformNavLink({
  url,
  locale,
  onNavigate,
  testId = "nav-question-platform",
  block = false,
}: {
  url: string | null;
  locale: Locale;
  onNavigate?: () => void;
  testId?: string;
  block?: boolean;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      data-testid={testId}
      aria-label={t(locale, "questionPlatform.navAria")}
      className={[
        "inline-flex min-h-11 shrink-0 items-center gap-2 border border-pub-line-strong bg-pub-surface font-bold text-pub-ink-soft transition-colors hover:bg-pub-surface-2 hover:text-pub-navy",
        block ? "w-full justify-start rounded-xl px-3.5 py-2.5" : "justify-center rounded-full px-3.5 py-2",
        focusCls,
      ].join(" ")}
    >
      <ExternalArrow className="h-4 w-4 shrink-0 rtl:-scale-x-100" />
      <span>{t(locale, "questionPlatform.navLabel")}</span>
    </a>
  );
}
