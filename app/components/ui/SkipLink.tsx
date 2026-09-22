import { t, type Locale } from "~/lib/i18n";

/** First-focus skip link. Visually hidden until Tab; jumps to `#main-content`. */
export function SkipLink({ locale }: { locale: Locale }) {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-pub-md focus:bg-pub-navy focus:px-4 focus:py-2.5 focus:text-sm focus:font-bold focus:text-pub-bg"
    >
      {t(locale, "common.skipToContent")}
    </a>
  );
}
