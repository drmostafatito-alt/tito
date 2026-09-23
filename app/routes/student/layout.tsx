import type { Route } from "./+types/layout";
import type { MetaDescriptor } from "react-router";
import { Form, Link, NavLink as RRNavLink, Outlet, useRouteLoaderData } from "react-router";
import { useState } from "react";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { menuItemsFor } from "~server/cms/service.server";
import { unreadAnnouncementsCount } from "~server/announcements/service.server";
import { BrandMark } from "~/components/BrandMark";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { QuestionPlatformNavLink } from "~/components/QuestionPlatform";
import { Icon } from "~/cms/icons";
import { Drawer } from "~/components/ui/Drawer";
import { SkipLink } from "~/components/ui/SkipLink";
import { rootMetaFrom } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";
import { resolveQuestionPlatformUrl } from "~/lib/question-platform";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth, settings } = await requireUser(context, request);
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
  // External Questions & Exams Platform entry (admin-configured; null = hidden)
  const questionPlatformUrl = resolveQuestionPlatformUrl(settings.platform);
  return {
    user: { fullName: auth.user.fullName, roleId: auth.user.roleId, rank: auth.user.rank },
    menu,
    unreadNotifications,
    questionPlatformUrl,
  };
}

/**
 * The whole student area is per-user (progress, orders, assignments) — defense
 * in depth: anon visitors are already redirected (requireUser), but a
 * authenticated render must also carry noindex so a logged-in session can never
 * leak personal data into the index.
 */
export function meta({ matches }: Route.MetaArgs): MetaDescriptor[] {
  const root = rootMetaFrom(matches);
  const site = root.siteName?.[root.locale] ?? "";
  const label = root.locale === "ar" ? t("ar", "common.dashboard") : t("en", "common.dashboard");
  return [{ title: `${label}${site ? ` — ${site}` : ""}`, name: "robots", content: "noindex,follow" }];
}

interface RootLoaderData {
  locale: Locale;
  localeOptions?: Locale[];
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
  const localeOptions = root?.localeOptions;
  const appName = locale === "ar" ? root!.platform.nameAr : root!.platform.nameEn;
  const isAdmin = loaderData.user.rank >= 3;
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = () => setMobileOpen(false);

  const navLinkCls = "inline-flex min-h-11 items-center gap-1.5 rounded-pub-pill px-3 py-2 text-pub-sm font-medium text-pub-ink-soft hover:bg-pub-surface hover:text-pub-ink";
  const activeLinkCls = "inline-flex min-h-11 items-center gap-1.5 rounded-pub-pill bg-pub-surface px-3 py-2 text-pub-sm font-bold text-pub-ink shadow-[inset_0_-2px_0_0_var(--color-pub-accent)]";
  const drawerLink = "flex min-h-12 w-full items-center gap-2 rounded-pub-md px-3 text-pub-base font-medium text-pub-ink hover:bg-pub-surface";

  const primary = [
    { to: "/dashboard", label: t(locale, "common.dashboard"), icon: "grid" as const, end: true },
    { to: "/study", label: t(locale, "study.navTitle"), icon: "book-open" as const },
    { to: "/assignments", label: t(locale, "assignment.myAssignments"), icon: "file-text" as const },
    { to: "/notifications", label: t(locale, "notifications.navLabel"), icon: "message-circle" as const, badge: loaderData.unreadNotifications },
  ];
  const more = [
    { to: "/programs", label: t(locale, "catalog.programs") },
    { to: "/orders", label: t(locale, "commerce.myOrders") },
    { to: "/profile", label: t(locale, "profile.title") },
    { to: "/profile/security", label: t(locale, "dashboard.securityLink") },
  ];

  return (
    <div className="pub-root flex min-h-dvh flex-col overflow-x-hidden bg-pub-surface">
      <SkipLink locale={locale} />
      <header className="sticky top-0 z-40 border-b border-pub-line bg-pub-bg/97 pt-safe backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-3 sm:h-16 sm:px-4">
          <Link to="/" aria-label={appName} className="inline-flex min-h-11 min-w-0 shrink items-center">
            <BrandMark name={appName} />
          </Link>

          <nav className="hidden min-w-0 items-center gap-0.5 xl:flex" aria-label={t(locale, "common.navMain")}>
            {primary.map((l) => (
              <RRNavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? activeLinkCls : navLinkCls)}>
                {l.label}
                {l.badge ? (
                  <span className="rounded-full bg-pub-navy px-1.5 text-[11px] font-bold text-pub-bg" dir="ltr" data-testid="nav-unread-badge">{l.badge}</span>
                ) : null}
              </RRNavLink>
            ))}
            <QuestionPlatformNavLink url={loaderData.questionPlatformUrl} locale={locale} testId="nav-question-platform-desktop" />
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
                  <div className="absolute top-full z-50 mt-1 min-w-44 rounded-pub-xl border border-pub-line bg-pub-bg p-1.5 shadow-pub-lg ltr:left-0 rtl:right-0">
                    {node.href && (
                      <MenuLinkNode item={node} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-pub-md px-3 py-2 text-pub-sm font-semibold text-pub-ink hover:bg-pub-surface" />
                    )}
                    {node.children.map((child) => (
                      <MenuLinkNode key={child.id} item={child} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-pub-md px-3 py-2 text-pub-sm text-pub-ink-soft hover:bg-pub-surface" />
                    ))}
                  </div>
                </details>
              )
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            <LanguageSwitcher locale={locale} options={localeOptions} compact />
            <details className="group relative hidden xl:block">
              <summary className={`${navLinkCls} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                <Icon name="user" size="sm" colorRole="default" className="text-current" />
                <span className="max-w-[9rem] truncate">{loaderData.user.fullName}</span>
                <Icon name="chevron-down" size="sm" colorRole="muted" className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute top-full z-50 mt-1 min-w-52 rounded-pub-xl border border-pub-line bg-pub-bg p-1.5 shadow-pub-lg ltr:right-0 rtl:left-0">
                {more.map((l) => (
                  <RRNavLink key={l.to} to={l.to} className="flex min-h-11 w-full items-center rounded-pub-md px-3 py-2 text-pub-sm text-pub-ink-soft hover:bg-pub-surface">
                    {l.label}
                  </RRNavLink>
                ))}
                {isAdmin && (
                  <Link to="/admin" className="flex min-h-11 w-full items-center rounded-pub-md px-3 py-2 text-pub-sm font-medium text-pub-ink-soft hover:bg-pub-surface">
                    {t(locale, "common.admin")}
                  </Link>
                )}
                <Form method="post" action="/logout">
                  <button type="submit" className="flex min-h-11 w-full items-center rounded-pub-md px-3 py-2 text-pub-sm font-medium text-pub-danger hover:bg-pub-danger-bg">
                    {t(locale, "common.logout")}
                  </button>
                </Form>
              </div>
            </details>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-pub-pill text-pub-ink hover:bg-pub-surface xl:hidden"
              aria-expanded={mobileOpen}
              aria-controls="student-mobile-nav"
              aria-label={t(locale, "common.menu")}
              onClick={() => setMobileOpen((v) => !v)}
            >
              <Icon name={mobileOpen ? "close" : "menu"} size="md" colorRole="default" />
            </button>
          </div>
        </div>
      </header>

      <Drawer open={mobileOpen} onClose={close} id="student-mobile-nav" label={t(locale, "common.navMain")}>
        <div className="mb-3 flex items-center justify-between border-b border-pub-line pb-3">
          <p className="truncate text-pub-sm font-bold text-pub-ink">{loaderData.user.fullName}</p>
          <button
            type="button"
            onClick={close}
            aria-label={t(locale, "common.close")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-pub-pill text-pub-ink hover:bg-pub-surface"
          >
            <Icon name="close" size="md" colorRole="default" />
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {primary.map((l) => (
            <RRNavLink key={l.to} to={l.to} end={l.end} onClick={close} className={({ isActive }) => (isActive ? `${activeLinkCls} w-full` : drawerLink)}>
              <Icon name={l.icon} size="sm" colorRole="default" className="text-current" />
              {l.label}
              {l.badge ? (
                <span className="rounded-full bg-pub-navy px-1.5 text-[11px] font-bold text-pub-bg" dir="ltr">{l.badge}</span>
              ) : null}
            </RRNavLink>
          ))}
          <QuestionPlatformNavLink url={loaderData.questionPlatformUrl} locale={locale} block onNavigate={close} testId="nav-question-platform-mobile" />
          {more.map((l) => (
            <RRNavLink key={l.to} to={l.to} onClick={close} className={drawerLink}>
              {l.label}
            </RRNavLink>
          ))}
          {loaderData.menu.map((node) => (
            <div key={node.id} className="flex flex-col">
              {node.href && <MenuLinkNode item={node} locale={locale} className={drawerLink} onNavigate={close} />}
              {node.children.map((child) => (
                <MenuLinkNode key={child.id} item={child} locale={locale} className={`${drawerLink} ltr:pl-7 rtl:pr-7`} onNavigate={close} />
              ))}
              {!node.href && node.children.length === 0 && (
                <span className={`${drawerLink} text-pub-muted`}>
                  {locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}
                </span>
              )}
            </div>
          ))}
          {isAdmin && (
            <Link to="/admin" onClick={close} className={drawerLink}>
              {t(locale, "common.admin")}
            </Link>
          )}
          <Form method="post" action="/logout">
            <button type="submit" className="flex min-h-12 w-full items-center rounded-pub-md px-3 text-pub-base font-medium text-pub-danger hover:bg-pub-danger-bg">
              {t(locale, "common.logout")}
            </button>
          </Form>
        </div>
      </Drawer>

      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 xl:py-8 xl:pb-8">
        <Outlet />
      </main>

      <nav aria-label={t(locale, "common.tabBar")} className="fixed inset-x-0 bottom-0 z-30 border-t border-pub-line bg-pub-bg/97 pb-safe backdrop-blur-md xl:hidden">
        <div className="grid grid-cols-4">
          {primary.map((l) => (
            <RRNavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `relative flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium ${isActive ? "text-pub-navy" : "text-pub-muted"}`
              }
            >
              <Icon name={l.icon} size="sm" colorRole="default" className="text-current" />
              <span className="truncate">{l.label}</span>
              {l.badge ? (
                <span className="absolute end-3 top-1 min-w-4 rounded-full bg-pub-navy px-1 text-[10px] font-bold leading-4 text-pub-bg" dir="ltr">{l.badge}</span>
              ) : null}
            </RRNavLink>
          ))}
        </div>
      </nav>

      <footer className="hidden border-t border-pub-line bg-pub-bg pb-safe xl:block">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 text-sm text-pub-muted">
          © {new Date().getFullYear()} {appName}
        </div>
      </footer>
    </div>
  );
}
