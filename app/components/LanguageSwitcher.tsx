import { useLocation } from "react-router";
import { t, type Locale } from "~/lib/i18n";

/** POSTs to /set-locale — works without JS (SameSite=Lax form post, our middleware allows same-origin). */
export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const location = useLocation();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <form method="post" action="/set-locale">
      <input type="hidden" name="lang" value={next} />
      <input type="hidden" name="next" value={location.pathname + location.search} />
      <button
        type="submit"
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
      >
        {next === "ar" ? t("ar", "common.arabic") : t("en", "common.english")}
      </button>
    </form>
  );
}
