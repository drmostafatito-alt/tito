import type { Route } from "./+types/layout";
import { useState } from "react";
import { Link, Outlet, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { BrandMark } from "~/components/BrandMark";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { cmsLabel } from "~/cms/registry";
import { t, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  await requireRole(context, request, 3); // admin+
  return null;
}

export default function AdminLayout() {
  const root = useRouteLoaderData("root") as { locale: Locale; platform: { nameAr: string; nameEn: string } };
  const locale = root?.locale ?? "ar";
  const appName = locale === "ar" ? root!.platform.nameAr : root!.platform.nameEn;
  const [navOpen, setNavOpen] = useState(false);

  const navLinks = [
    { to: "/admin/cms", label: cmsLabel("cms.ui.pages", locale === "ar" ? "ar" : "en") },
    { to: "/admin/appearance", label: cmsLabel("cms.ui.appearance", locale === "ar" ? "ar" : "en") },
    { to: "/admin/content", label: t(locale, "admin.navContent") },
    { to: "/admin/files", label: t(locale, "admin.navFiles") },
    { to: "/admin/videos", label: t(locale, "admin.navVideos") },
    { to: "/admin/entitlements", label: t(locale, "admin.navEntitlements") },
    { to: "/dashboard", label: t(locale, "common.dashboard") },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900 pt-safe text-white">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4">
          <Link to="/admin" aria-label={appName}>
            <span className="inline-flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 10L12 5 2 10l10 5 10-5z" />
                  <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
                </svg>
              </span>
              <span className="text-lg font-bold">{appName}</span>
              <span className="hidden rounded-md bg-brand-500/20 px-2 py-0.5 text-xs font-semibold text-brand-300 sm:inline-block">
                {t(locale, "admin.title")}
              </span>
            </span>
          </Link>
          <div className="hidden items-center gap-1.5 sm:flex">
            {navLinks.map((l) => (
              <Link key={l.to} to={l.to} className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
                {l.label}
              </Link>
            ))}
            <LanguageSwitcher locale={locale} />
            <form method="post" action="/logout">
              <button type="submit" className="rounded-lg px-3 py-2 text-sm font-medium text-red-400 hover:bg-slate-800">
                {t(locale, "common.logout")}
              </button>
            </form>
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 sm:hidden"
            aria-expanded={navOpen}
            aria-controls="admin-mobile-nav"
            aria-label={t(locale, "common.menu")}
            onClick={() => setNavOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {navOpen ? (
                <>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </>
              ) : (
                <>
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </>
              )}
            </svg>
          </button>
        </div>
        {navOpen && (
          <nav id="admin-mobile-nav" className="border-t border-slate-800 px-4 pb-3 sm:hidden" aria-label={t(locale, "admin.title")}>
            <div className="mx-auto flex max-w-7xl flex-col gap-1 pt-2">
              {navLinks.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setNavOpen(false)}
                  className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  {l.label}
                </Link>
              ))}
              <div className="flex min-h-11 items-center justify-between gap-2 px-3 py-2">
                <LanguageSwitcher locale={locale} />
                <form method="post" action="/logout">
                  <button type="submit" className="rounded-lg px-3 py-2 text-sm font-medium text-red-400 hover:bg-slate-800">
                    {t(locale, "common.logout")}
                  </button>
                </form>
              </div>
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
