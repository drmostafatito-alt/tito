import { Link } from "react-router";
import { t, type Locale } from "~/lib/i18n";

/**
 * Date-window switcher for admin analytics surfaces (P7 §4 — server-side
 * windows). Pure presentational: each option is a GET link with ?range=…;
 * the server re-aggregates. The range keys come in as props (routes import
 * them from the pure server module — components must not import ~server/*).
 */
export function RangeSwitcher({ range, locale, base, ranges }: { range: string; locale: Locale; base: string; ranges: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="range-switcher">
      {ranges.map((r) => (
        <Link
          key={r}
          to={`${base}?range=${r}`}
          data-testid={`range-${r}`}
          className={`inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${r === range ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
        >
          {t(locale, `admin.range_${r}`)}
        </Link>
      ))}
    </div>
  );
}
