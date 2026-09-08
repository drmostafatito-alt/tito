import { NavLink } from "react-router";
import { t, type Locale } from "~/lib/i18n";
import { ADMIN_NAV_SECTIONS, AdminIcon } from "./nav";

/**
 * Navigation list shared by the desktop sidebar and the mobile drawer so both
 * always stay in sync (same grouped information architecture, same labels).
 * `collapsed` drives the desktop icon-rail presentation only.
 */
export function SidebarContent({
  locale,
  collapsed = false,
  onNavigate,
  sections = ADMIN_NAV_SECTIONS,
}: {
  locale: Locale;
  collapsed?: boolean;
  onNavigate?: () => void;
  /** Override the full admin nav (e.g. a restricted teacher authoring shell). */
  sections?: import("./nav").NavSection[];
}) {
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => {
        if (collapsed) {
          return (
            <div key={section.id} className="flex flex-col items-center gap-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={t(locale, item.labelKey)}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                      isActive
                        ? "bg-brand-500/15 text-brand-200"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`
                  }
                >
                  <AdminIcon name={item.icon} />
                </NavLink>
              ))}
            </div>
          );
        }
        return (
          <nav key={section.id} aria-label={t(locale, section.labelKey)} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {t(locale, section.labelKey)}
            </p>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `group flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand-500/15 text-brand-100"
                      : "text-slate-300 hover:bg-white/5 hover:text-slate-100"
                  }`
                }
              >
                <AdminIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                <span className="truncate">{t(locale, item.labelKey)}</span>
              </NavLink>
            ))}
          </nav>
        );
      })}
    </div>
  );
}

/** Accessible icon button used to collapse/expand the desktop sidebar. */
export function CollapseButton({
  collapsed,
  locale,
  onToggle,
}: {
  collapsed: boolean;
  locale: Locale;
  onToggle: () => void;
}) {
  const expand = collapsed;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={t(locale, expand ? "nav.expand" : "nav.collapse")}
      aria-label={t(locale, expand ? "nav.expand" : "nav.collapse")}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {!collapsed ? <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /> : <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />}
      </svg>
    </button>
  );
}
