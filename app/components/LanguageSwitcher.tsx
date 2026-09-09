import { Form, useLocation } from "react-router";
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
export function LanguageSwitcher({ locale, options }: { locale: Locale; options?: Locale[] }) {
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
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-btn)] px-3 text-sm font-semibold text-ink ring-1 ring-inset ring-line hover:bg-slate-100"
        aria-label={next === "ar" ? t("ar", "common.arabic") : t("en", "common.english")}
        data-locale-next={next}
      >
        {next === "ar" ? t("ar", "common.arabic") : t("en", "common.english")}
      </button>
    </Form>
  );
}
