import type { Route } from "./+types/layout";
import { Form, Link, NavLink as RRNavLink, Outlet, useRouteLoaderData } from "react-router";
import { useState } from "react";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { menuItemsFor } from "~server/cms/service.server";
import { unreadAnnouncementsCount } from "~server/announcements/service.server";
import { BrandMark } from "~/components/BrandMark";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const studentMenu = await menuItemsFor(db, "student");
  const toItem = (i: { id: string; parentId: string | null; labelAr: string; labelEn: string; href: string; external: boolean; icon: string | null; visible: boolean }) => ({
    id: i.id, labelAr: i.labelAr, labelEn: i.labelEn, href: i.href, external: i.external, icon: i.icon,
  });
  const menu = studentMenu.topLevel.filter((i) => i.visible).map(toItem).map((i) => ({
    ...i,
    children: studentMenu.items.filter((c) => c.parentId === i.id && c.visible).map(toItem),
  }));
  const unreadNotifications = await unreadAnnouncementsCount(db, { id: auth.user.id, roleId: auth.user.roleId });
  return {
    user: { fullName: auth.user.fullName, roleId: auth.user.roleId, rank: auth.user.rank },
    menu,
    unreadNotifications,
  };
}

interface RootLoaderData {
  locale: Locale;
  platform: { nameAr: string; nameEn: string };
}

interface MenuLink {
  id: string;
  labelAr: string;
  labelEn: string;
  href: string;
  external: boolean;
  icon: string | null;
}

function MenuLinkNode({ item, locale, className, onNavigate }: { item: MenuLink; locale: Locale; className: string; onNavigate?: () => void }) {
  const label = locale === "ar" ? item.labelAr || item.labelEn : item.labelEn || item.labelAr;
  const inner = (
    <>
      {item.icon && <Icon name={item.icon} size="sm" colorRole="default" className="text-current" />}
      <span>{label}</span>
    </>
  );
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer nofollow" className={className} onClick={onNavigate}>
        {inner}
      </a>
    );
  }
  return (
    <RRNavLink to={item.href} className={className} onClick={onNavigate}>
      {inner}
    </RRNavLink>
  );
}

export default function StudentLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootLoaderData | undefined;
  const locale = root?.locale ?? "ar";
  const appName = locale === "ar" ? root!.platform.nameAr : root!.platform.nameEn;
  const isAdmin = loaderData.user.rank >= 3;
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = () => setMobileOpen(false);

  const navLinkCls = "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100";
  const activeLinkCls = "inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700";

  const coreLinks: Array<{ to: string; label: string; end?: boolean; badge?: number }> = [
    { to: "/dashboard", label: t(locale, "common.dashboard") },
    { to: "/courses", label: t(locale, "content.catalogTitle") },
    { to: "/programs", label: t(locale, "catalog.programs") },
    { to: "/exams", label: t(locale, "exam.listTitle") },
    { to: "/orders", label: t(locale, "commerce.myOrders") },
    { to: "/notifications", label: t(locale, "notifications.navLabel"), badge: loaderData.unreadNotifications },
    { to: "/profile", label: t(locale, "profile.title") },
    { to: "/profile/security", label: t(locale, "dashboard.securityLink") },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white pt-safe">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-4">
            <Link to="/" aria-label={appName} className="inline-flex min-h-11 items-center">
              <BrandMark name={appName} />
            </Link>
          </div>

          {/* Desktop navigation */}
          <nav className="hidden items-center gap-1 md:flex" aria-label={t(locale, "common.navMain")}>
            {coreLinks.map((l) => (
              <RRNavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? activeLinkCls : navLinkCls)}>
                {l.label}
                {l.badge ? (
                  <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white" dir="ltr" data-testid="nav-unread-badge">{l.badge}</span>
                ) : null}
              </RRNavLink>
            ))}
            {loaderData.menu.map((node) =>
              node.children.length === 0 ? (
                <MenuLinkNode key={node.id} item={node} locale={locale} className={navLinkCls} />
              ) : (
                <details key={node.id} className="group relative">
                  <summary className={`${navLinkCls} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                    {node.icon && <Icon name={node.icon} size="sm" colorRole="default" className="text-current" />}
                    <span>{locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}</span>
                    <Icon name="chevron-down" size="sm" colorRole="muted" className="transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="absolute top-full z-50 mt-1 min-w-44 rounded-[var(--radius-card)] border border-slate-200 bg-white p-1.5 shadow-lg ltr:left-0 rtl:right-0">
                    {node.href && (
                      <MenuLinkNode item={node} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100" />
                    )}
                    {node.children.map((child) => (
                      <MenuLinkNode key={child.id} item={child} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100" />
                    ))}
                  </div>
                </details>
              )
            )}
            {isAdmin && (
              <Link to="/admin" className="rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
                {t(locale, "common.admin")}
              </Link>
            )}
            <LanguageSwitcher locale={locale} />
            <Form method="post" action="/logout">
              <button type="submit" className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                {t(locale, "common.logout")}
              </button>
            </Form>
          </nav>

          {/* Mobile: language + hamburger */}
          <div className="flex items-center gap-1.5 md:hidden">
            <LanguageSwitcher locale={locale} />
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
              aria-expanded={mobileOpen}
              aria-controls="student-mobile-nav"
              aria-label={t(locale, "common.menu")}
              onClick={() => setMobileOpen((v) => !v)}
            >
              <Icon name={mobileOpen ? "close" : "menu"} size="md" colorRole="default" />
            </button>
          </div>
        </div>

        {/* Mobile navigation panel */}
        {mobileOpen && (
          <nav id="student-mobile-nav" aria-label={t(locale, "common.navMain")} className="border-t border-slate-200 bg-white px-4 py-3 md:hidden">
            <div className="flex flex-col gap-1">
              {coreLinks.map((l) => (
                <RRNavLink key={l.to} to={l.to} onClick={close} className={({ isActive }) => (isActive ? activeLinkCls + " w-full" : navLinkCls + " w-full")}>
                  {l.label}
                  {l.badge ? (
                    <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white" dir="ltr">{l.badge}</span>
                  ) : null}
                </RRNavLink>
              ))}
              {loaderData.menu.map((node) => (
                <div key={node.id} className="flex flex-col">
                  {node.href && <MenuLinkNode item={node} locale={locale} className={navLinkCls + " w-full"} onNavigate={close} />}
                  {node.children.map((child) => (
                    <MenuLinkNode key={child.id} item={child} locale={locale} className={navLinkCls + " w-full ltr:pl-7 rtl:pr-7"} onNavigate={close} />
                  ))}
                  {!node.href && node.children.length === 0 && (
                    <span className={`${navLinkCls} w-full text-slate-400`}>
                      {locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}
                    </span>
                  )}
                </div>
              ))}
              {isAdmin && (
                <Link to="/admin" onClick={close} className="rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 min-h-11 inline-flex items-center">
                  {t(locale, "common.admin")}
                </Link>
              )}
              <Form method="post" action="/logout">
                <button type="submit" className="inline-flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                  {t(locale, "common.logout")}
                </button>
              </Form>
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white pb-safe">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 text-sm text-slate-500">
          © {new Date().getFullYear()} {appName}
        </div>
      </footer>
    </div>
  );
}
