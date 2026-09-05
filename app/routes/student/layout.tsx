import type { Route } from "./+types/layout";
import { Form, Link, Outlet, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { BrandMark } from "~/components/BrandMark";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { t, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  return { user: { fullName: auth.user.fullName, roleId: auth.user.roleId, rank: auth.user.rank } };
}

interface RootLoaderData {
  locale: Locale;
  platform: { nameAr: string; nameEn: string };
}

export default function StudentLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const locale = root?.locale ?? "ar";
  const appName = locale === "ar" ? root!.platform.nameAr : root!.platform.nameEn;
  const isAdmin = loaderData.user.rank >= 3;

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white pt-safe">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-4">
            <Link to="/" aria-label={appName}>
              <BrandMark name={appName} />
            </Link>
          </div>
          <nav className="flex items-center gap-1" aria-label={t(locale, "dashboard.title")}>
            <Link
              to="/dashboard"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {t(locale, "common.dashboard")}
            </Link>
            <Link
              to="/profile/security"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {t(locale, "dashboard.securityLink")}
            </Link>
            {isAdmin && (
              <Link to="/admin" className="rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
                {t(locale, "common.admin")}
              </Link>
            )}
            <LanguageSwitcher locale={locale} />
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                {t(locale, "common.logout")}
              </button>
            </Form>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white pb-safe">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 text-sm text-slate-400">
          © {new Date().getFullYear()} {appName}
        </div>
      </footer>
    </div>
  );
}
