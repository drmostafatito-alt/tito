import { Form, useLocation } from "react-router";
import { t, type Locale } from "~/lib/i18n";

/**
 * POST /set-locale then a FULL document reload (`reloadDocument`).
 *
 * Client-side SPA navigation is not enough: `<html lang/dir>` and the CMS
 * snapshot are server-rendered from the locale cookie. A fetch-based action
 * redirect can set the cookie while leaving the current document's lang/dir
 * and already-rendered Arabic/English copy on screen. A real browser
 * navigation re-runs every loader against the new cookie.
 */
export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const location = useLocation();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <Form method="post" action="/set-locale" reloadDocument replace data-locale-switch="">
      <input type="hidden" name="lang" value={next} />
      <input type="hidden" name="next" value={location.pathname + location.search} />
      <button
        type="submit"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm font-medium text-slate-600 hover:bg-slate-100"
        aria-label={next === "ar" ? t("ar", "common.arabic") : t("en", "common.english")}
        data-locale-next={next}
      >
        {next === "ar" ? t("ar", "common.arabic") : t("en", "common.english")}
      </button>
    </Form>
  );
}
