import type { Route } from "./+types/layout";
import { Link, Outlet, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { getSettings } from "~server/settings/service.server";
import { BrandMark } from "~/components/BrandMark";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { t, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);
  const { auth } = await resolveAuth(db, env, request);

  // Maintenance mode: admins bypass (FEATURE-SPEC §13)
  const maintenance = settings.platform.maintenance && (auth?.user.rank ?? 0) < 3;

  return {
    maintenance,
    user: auth ? { fullName: auth.user.fullName, rank: auth.user.rank, roleId: auth.user.roleId } : null,
  };
}

interface RootLoaderData {
  locale: Locale;
  platform: { nameAr: string; nameEn: string; maintenance: boolean };
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootLoaderData;
  const locale = root?.locale ?? "ar";
  const appName = locale === "ar" ? root.platform.nameAr : root.platform.nameEn;

  if (loaderData.maintenance) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <BrandMark name={appName} />
        <h1 className="mt-4 text-2xl font-bold">{t(locale, "maintenance.title")}</h1>
        <p className="text-slate-600">{t(locale, "maintenance.body")}</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 pt-safe backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" aria-label={appName}>
            <BrandMark name={appName} />
          </Link>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher locale={locale} />
            {loaderData.user ? (
              <>
                <Link to="/courses" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  {t(locale, "content.catalogTitle")}
                </Link>
                <Link
                  to={loaderData.user.rank >= 3 ? "/admin" : "/dashboard"}
                  className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  {loaderData.user.rank >= 3 ? t(locale, "common.admin") : t(locale, "common.dashboard")}
                </Link>
              </>
            ) : (
              <>
                <Link to="/courses" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  {t(locale, "content.catalogTitle")}
                </Link>
                <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  {t(locale, "common.login")}
                </Link>
                <Link
                  to="/register"
                  className="hidden rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 sm:inline-flex"
                >
                  {t(locale, "common.register")}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white pb-safe">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row">
          <span>
            © {new Date().getFullYear()} {appName} — {t(locale, "footer.rights")}
          </span>
        </div>
      </footer>
    </div>
  );
}
