import { t, type Locale } from "~/lib/i18n";
import { Card, CardBody } from "~/components/ui/Card";

/**
 * Entry point to the STANDALONE Questions & Exams Platform.
 *
 * Tito no longer hosts an internal question bank/exam engine. Students reach the
 * external platform exclusively through this clearly-labelled, admin-configured
 * link (Appearance → System). The `url` prop is already validated server-side
 * (https-only — see ~lib/question-platform), opens in a new tab with
 * rel=noopener, and every label is bilingual; the external-link glyph is
 * decorative — text alone conveys the destination and action.
 */

function PlatformGlyph({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 4h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2V5a1 1 0 0 1 1-1z" />
      <path d="M9 3.5h6V7H9z" />
      <path d="M8 12h5" />
      <path d="M8 15.5h7" />
      <path d="m14.5 16.5 2-2 2 2" />
      <path d="M16.5 14.5V19" />
    </svg>
  );
}

function ExternalArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </svg>
  );
}

const focusCls = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

/**
 * Dashboard card. Renders nothing when `url` is null (caller may also short
 * circuit; kept defensive so a missing setting can never render a dead link).
 */
export function QuestionPlatformCard({ url, locale }: { url: string | null; locale: Locale }) {
  if (!url) return null;
  return (
    <Card data-testid="question-platform-card" className="border-brand-200 bg-gradient-to-br from-brand-50/70 to-white">
      <CardBody className="flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white" aria-hidden="true">
          <PlatformGlyph />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{t(locale, "questionPlatform.title")}</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              <ExternalArrow className="h-3 w-3" />
              {t(locale, "questionPlatform.externalTag")}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{t(locale, "questionPlatform.description")}</p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="question-platform-cta"
          aria-label={t(locale, "questionPlatform.ctaAria")}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 ${focusCls}`}
        >
          {t(locale, "questionPlatform.cta")}
          <ExternalArrow />
        </a>
      </CardBody>
    </Card>
  );
}

/** Compact nav/menu link (header navigation + mobile drawer). */
export function QuestionPlatformNavLink({
  url,
  locale,
  className,
  onNavigate,
  testId = "nav-question-platform",
}: {
  url: string | null;
  locale: Locale;
  className?: string;
  onNavigate?: () => void;
  testId?: string;
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
      className={className}
    >
      <ExternalArrow className="h-4 w-4 shrink-0 rtl:-scale-x-100" />
      <span>{t(locale, "questionPlatform.navLabel")}</span>
    </a>
  );
}
