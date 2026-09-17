import { Form, useLocation } from "react-router";
import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";

const ALL: Locale[] = ["ar", "en"];

/**
 * POST /set-locale then a FULL document reload (`reloadDocument`).
 *
 * Client-side SPA navigation is not enough: `<html lang/dir>` and the CMS
 * snapshot are server-rendered from the locale cookie. A fetch-based action
 * redirect can set the cookie while leaving the current document's lang/dir
 * and already-rendered Arabic/English copy on screen. A real browser
 * navigation re-runs every loader against the new cookie.
 */
export function LanguageSwitcher({
  locale,
  options,
  compact = false,
}: {
  locale: Locale;
  options?: Locale[];
  /**
   * Phone header mode: the control keeps a 44px target but shows the globe only
   * (name announced via aria-label), so the 320px header row never has to clip
   * the brand, the login CTA or this button to fit.
   */
  compact?: boolean;
}) {
  const location = useLocation();
  // Owner-controlled (Appearance → System). With a single offered language there
  // is nothing to switch to, so the control is omitted rather than rendered as a
  // button that silently does nothing.
  const offered = (options && options.length > 0 ? options : ALL).filter((l) => l === "ar" || l === "en");
  const next = offered.find((l) => l !== locale);
  if (!next) return null;
  return (
    <Form method="post" action="/set-locale" reloadDocument replace data-locale-switch="">
      <input type="hidden" name="lang" value={next} />
      <input type="hidden" name="next" value={location.pathname + location.search} />
      <button
        type="submit"
        className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-pub-pill px-2.5 text-pub-sm font-medium text-pub-muted transition-colors hover:bg-pub-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong ${compact ? "" : "sm:px-3"}`}
        aria-label={next === "ar" ? t("ar", "common.arabic") : t("en", "common.english")}
        data-locale-next={next}
      >
        <Icon name="globe" size="sm" colorRole="default" className="text-current" />
        {compact ? null : (
          <span className={compact ? "hidden sm:inline" : undefined}>
            {next === "ar" ? t("ar", "common.arabic") : t("en", "common.english")}
          </span>
        )}
      </button>
    </Form>
  );
}
