import { t, type Locale } from "~/lib/i18n";
import { SubjectPlate } from "~/components/tito/subject";

/**
 * Entry point to the STANDALONE Questions & Exams Platform.
 *
 * Tito does not host an internal question bank/exam engine. Students reach the
 * external platform exclusively through this clearly-labelled, admin-configured
 * entry (Appearance → System). The `url` prop is validated server-side
 * (https-only — see ~lib/question-platform), every link opens in a new tab with
 * rel="noopener noreferrer", and every label is bilingual. When the setting is
 * empty this renders NOTHING — a feature that is not configured does not exist.
 *
 * Visual language: the Index. An ink band with the discipline diagram bleeding
 * out of one corner, the "external" fact stated on a rule rather than in a
 * warning-coloured pill, and one highlighter CTA. No gradients, no blurs, no
 * medallion — those belonged to the old system.
 */

function ExternalArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </svg>
  );
}

/**
 * The workspace block. Renders nothing when `url` is null (callers may also
 * short-circuit; kept defensive so a missing setting can never render a dead
 * link). Stacks to a single column with a full-width ≥48px CTA on phones.
 */
export function QuestionPlatformCard({ url, locale }: { url: string | null; locale: Locale }) {
  if (!url) return null;
  return (
    <section
      data-testid="question-platform-card"
      className="relative isolate overflow-hidden rounded-pub-lg bg-pub-navy text-pub-on-navy"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-12 -z-10 opacity-20 ltr:-right-10 rtl:-left-10">
        <SubjectPlate kind="logic" className="h-64 w-96 text-pub-accent" />
      </span>

      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="flex items-center gap-2 border-b border-white/15 pb-3">
            <ExternalArrow className="h-3.5 w-3.5 rtl:-scale-x-100" />
            <span className="tito-label text-pub-accent">{t(locale, "questionPlatform.externalTag")}</span>
          </p>
          <h2 className="mt-4 font-display text-[length:var(--text-pub-h3)] font-extrabold leading-pub-tight tracking-[-0.03em] text-pub-on-navy">
            {t(locale, "questionPlatform.title")}
          </h2>
          <p className="mt-3 max-w-[52ch] text-pub-sm leading-pub-normal text-pub-on-navy-soft">
            {t(locale, "questionPlatform.description")}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 lg:items-end">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="question-platform-cta"
            aria-label={t(locale, "questionPlatform.ctaAria")}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pub-md bg-pub-accent px-6 text-pub-base font-bold text-pub-ink transition-colors hover:bg-pub-accent-soft sm:w-auto"
          >
            {t(locale, "questionPlatform.cta")}
            <ExternalArrow className="h-4 w-4 shrink-0 rtl:-scale-x-100" />
          </a>
          <span className="text-pub-xs font-semibold text-pub-on-navy-muted lg:text-end">
            {t(locale, "questionPlatform.newTabHint")}
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * Compact nav entry (student rail on desktop, drawer on mobile). `tone` exists
 * because the same link sits on the ink rail and on the paper drawer.
 */
export function QuestionPlatformNavLink({
  url,
  locale,
  onNavigate,
  testId = "nav-question-platform",
  block = false,
  tone = "onDark",
}: {
  url: string | null;
  locale: Locale;
  onNavigate?: () => void;
  testId?: string;
  block?: boolean;
  tone?: "onDark" | "onLight";
}) {
  if (!url) return null;
  const skin =
    tone === "onDark"
      ? "border-s-2 border-transparent text-pub-on-navy-soft hover:text-pub-accent"
      : "border-b border-pub-line text-pub-ink-soft hover:text-pub-ink";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      data-testid={testId}
      aria-label={t(locale, "questionPlatform.navAria")}
      className={[
        "flex min-h-11 shrink-0 items-center gap-3 text-pub-sm font-semibold transition-colors",
        tone === "onDark" ? "ps-4 pe-3" : "px-1",
        block ? "w-full justify-start" : "justify-center",
        skin,
      ].join(" ")}
    >
      <ExternalArrow className="h-4 w-4 shrink-0 rtl:-scale-x-100" />
      <span className="min-w-0 truncate">{t(locale, "questionPlatform.navLabel")}</span>
    </a>
  );
}
