import type { Route } from "./+types/layout";
import { Link, Outlet, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { BrandMark } from "~/components/BrandMark";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { t, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  await requireRole(context, request, 3); // admin+
  return null;
}

export default function AdminLayout() {
  const root = useRouteLoaderData("root") as { locale: Locale; platform: { nameAr: string; nameEn: string } };
  const locale = root?.locale ?? "ar";
  const appName = locale === "ar" ? root!.platform.nameAr : root!.platform.nameEn;

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
              <span className="rounded-md bg-brand-500/20 px-2 py-0.5 text-xs font-semibold text-brand-300">
                {t(locale, "admin.title")}
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5">
            <Link to="/admin/content" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
              {t(locale, "admin.navContent")}
            </Link>
            <Link to="/admin/files" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
              {t(locale, "admin.navFiles")}
            </Link>
            <Link to="/admin/videos" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
              {t(locale, "admin.navVideos")}
            </Link>
            <Link to="/admin/entitlements" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
              {t(locale, "admin.navEntitlements")}
            </Link>
            <Link to="/dashboard" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
              {t(locale, "common.dashboard")}
            </Link>
            <LanguageSwitcher locale={locale} />
            <form method="post" action="/logout">
              <button type="submit" className="rounded-lg px-3 py-2 text-sm font-medium text-red-400 hover:bg-slate-800">
                {t(locale, "common.logout")}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
