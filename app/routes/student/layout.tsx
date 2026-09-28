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
import { Ordinal } from "~/components/tito/ui";
import { SubjectPlate } from "~/components/tito/subject";
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
 * in depth: anon visitors are already redirected (requireUser), but an
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
      {item.icon && <Icon name={item.icon} size="sm" className="text-current" />}
      <span className="min-w-0 truncate">{label}</span>
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

/** The unread count. Square, tabular, never a floating red dot. */
function Badge({ n, testId }: { n: number; testId?: string }) {
  if (!n) return null;
  return (
    <span
      data-numeral
      dir="ltr"
      data-testid={testId}
      className="ms-auto inline-flex min-w-5 items-center justify-center rounded-pub-sm bg-pub-accent px-1.5 py-px text-pub-xs font-extrabold text-pub-ink"
    >
      {n}
    </span>
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

  /* THE RAIL ROW — an ordinal in the gutter, the label, then state. The active
     row is inked with the mark on its leading edge; nothing moves or scales. */
  const railRow =
    "group relative flex min-h-11 items-center gap-3 border-s-2 border-transparent ps-4 pe-3 text-pub-sm font-semibold text-pub-on-navy-soft transition-colors hover:text-pub-on-navy";
  const railRowActive =
    "group relative flex min-h-11 items-center gap-3 border-s-2 border-pub-accent bg-white/[0.06] ps-4 pe-3 text-pub-sm font-bold text-pub-on-navy";
  const drawerLink = "flex min-h-12 w-full items-center gap-3 border-b border-pub-line px-1 text-pub-base font-semibold text-pub-ink";
  const drawerLinkActive = `${drawerLink} text-pub-ink [&>span:first-child]:bg-pub-accent`;

  return (
    <div className="pub-root flex min-h-dvh flex-col bg-pub-bg xl:grid xl:min-h-dvh xl:grid-cols-[16rem_minmax(0,1fr)] xl:items-stretch">
      <SkipLink locale={locale} />

      {/* ─── THE RAIL (xl and up) ─────────────────────────────────────────
          The student area is a WORKSPACE, not a marketing page: it gets its
          own ink spine with the whole of the student's world listed on it, so
          "where am I / what else is there" is answered without a menu. */}
      <aside className="relative isolate hidden overflow-hidden bg-pub-navy text-pub-on-navy xl:flex xl:flex-col">
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-16 -z-10 opacity-[0.14] ltr:-right-24 rtl:-left-24">
          <SubjectPlate kind="logic" className="h-80 w-[26rem] text-pub-accent" />
        </span>

        <div className="border-b border-white/10 px-5 py-5">
          <Link to="/" aria-label={appName} className="inline-flex min-h-11 min-w-0 items-center">
            <BrandMark name={appName} tone="onDark" />
          </Link>
        </div>

        <nav aria-label={t(locale, "common.navMain")} className="flex flex-col gap-0.5 py-5">
          {primary.map((l, i) => (
            <RRNavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? railRowActive : railRow)}>
              <span className="tito-label text-pub-on-navy-muted" aria-hidden="true">
                <Ordinal n={i + 1} />
              </span>
              <span className="min-w-0 truncate">{l.label}</span>
              <Badge n={l.badge ?? 0} testId="nav-unread-badge" />
            </RRNavLink>
          ))}
          <QuestionPlatformNavLink url={loaderData.questionPlatformUrl} locale={locale} block testId="nav-question-platform-desktop" />
        </nav>

        <div className="px-5">
          <p className="tito-label border-t border-white/10 pt-4 text-pub-on-navy-muted">{t(locale, "common.more")}</p>
        </div>
        <nav aria-label={t(locale, "nav.profileMenu")} className="mt-1 flex flex-col">
          {more.map((l) => (
            <RRNavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? railRowActive : railRow)}>
              <span className="min-w-0 truncate">{l.label}</span>
            </RRNavLink>
          ))}
          {loaderData.menu.map((node) => (
            <div key={node.id} className="flex flex-col">
              {node.href && <MenuLinkNode item={node} locale={locale} className={railRow} />}
              {node.children.map((child) => (
                <MenuLinkNode key={child.id} item={child} locale={locale} className={`${railRow} ps-9`} />
              ))}
            </div>
          ))}
          {isAdmin && (
            <Link to="/admin" className={railRow}>
              {t(locale, "common.admin")}
            </Link>
          )}
        </nav>

        <div className="mt-auto border-t border-white/10 px-5 py-4">
          <p className="truncate font-display text-pub-sm font-bold text-pub-on-navy">{loaderData.user.fullName}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="inline-flex min-h-11 items-center text-pub-xs font-bold text-pub-on-navy-muted underline decoration-pub-accent decoration-2 underline-offset-4 hover:text-pub-on-navy"
              >
                {t(locale, "common.logout")}
              </button>
            </Form>
            <LanguageSwitcher locale={locale} options={localeOptions} compact />
          </div>
        </div>
      </aside>

      {/* ─── The compact header (below xl) ──────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-pub-line bg-pub-bg/97 pt-safe backdrop-blur-md xl:hidden">
        <div className="flex h-14 w-full items-center justify-between gap-2 px-4 sm:h-16">
          <Link to="/" aria-label={appName} className="inline-flex min-h-11 min-w-0 shrink items-center">
            <BrandMark name={appName} />
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <LanguageSwitcher locale={locale} options={localeOptions} compact />
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-pub-sm text-pub-ink hover:bg-pub-surface"
              aria-expanded={mobileOpen}
              aria-controls="student-mobile-nav"
              aria-label={t(locale, "common.menu")}
              onClick={() => setMobileOpen((v) => !v)}
            >
              <Icon name={mobileOpen ? "close" : "menu"} size="md" className="text-current" />
            </button>
          </div>
        </div>
      </header>

      <Drawer open={mobileOpen} onClose={close} id="student-mobile-nav" label={t(locale, "common.navMain")}>
        <div className="mb-4 flex items-center justify-between border-b-2 border-pub-ink pb-3">
          <p className="truncate font-display text-pub-md font-extrabold text-pub-ink">{loaderData.user.fullName}</p>
          <button
            type="button"
            onClick={close}
            aria-label={t(locale, "common.close")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-pub-sm text-pub-ink hover:bg-pub-surface"
          >
            <Icon name="close" size="md" className="text-current" />
          </button>
        </div>
        <div className="flex flex-col">
          {primary.map((l, i) => (
            <RRNavLink key={l.to} to={l.to} end={l.end} onClick={close} className={({ isActive }) => (isActive ? drawerLinkActive : drawerLink)}>
              <span className="tito-label inline-flex h-6 w-6 items-center justify-center bg-pub-surface-2 text-pub-ink" aria-hidden="true">
                <Ordinal n={i + 1} />
              </span>
              <span className="min-w-0 truncate">{l.label}</span>
              <Badge n={l.badge ?? 0} />
            </RRNavLink>
          ))}
          <QuestionPlatformNavLink url={loaderData.questionPlatformUrl} locale={locale} block tone="onLight" onNavigate={close} testId="nav-question-platform-mobile" />
          {more.map((l) => (
            <RRNavLink key={l.to} to={l.to} onClick={close} className={`${drawerLink} text-pub-ink-soft`}>
              <span className="min-w-0 truncate">{l.label}</span>
            </RRNavLink>
          ))}
          {loaderData.menu.map((node) => (
            <div key={node.id} className="flex flex-col">
              {node.href && <MenuLinkNode item={node} locale={locale} className={drawerLink} onNavigate={close} />}
              {node.children.map((child) => (
                <MenuLinkNode key={child.id} item={child} locale={locale} className={`${drawerLink} ltr:pl-7 rtl:pr-7`} onNavigate={close} />
              ))}
            </div>
          ))}
          {isAdmin && (
            <Link to="/admin" onClick={close} className={drawerLink}>
              {t(locale, "common.admin")}
            </Link>
          )}
          <Form method="post" action="/logout" className="mt-4">
            <button type="submit" className="inline-flex min-h-12 items-center text-pub-sm font-bold text-pub-danger">
              {t(locale, "common.logout")}
            </button>
          </Form>
        </div>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-7 pb-24 sm:px-6 xl:px-10 xl:py-10 xl:pb-10">
          <Outlet />
        </main>

        <footer className="hidden border-t border-pub-line pb-safe xl:block">
          <div className="mx-auto w-full max-w-5xl px-10 py-5 text-pub-xs text-pub-muted">
            © {new Date().getFullYear()} {appName}
          </div>
        </footer>
      </div>

      {/* Bottom tabs below xl — four destinations, square, 48px, safe-area aware. */}
      <nav aria-label={t(locale, "common.tabBar")} className="fixed inset-x-0 bottom-0 z-30 border-t border-pub-line bg-pub-bg/97 pb-safe backdrop-blur-md xl:hidden">
        <div className="grid grid-cols-4">
          {primary.map((l) => (
            <RRNavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `relative flex min-h-13 flex-col items-center justify-center gap-1 border-t-2 px-1 pt-1.5 pb-1 text-pub-xs font-bold ${
                  isActive ? "border-pub-accent text-pub-ink" : "border-transparent text-pub-muted"
                }`
              }
            >
              <Icon name={l.icon} size="sm" className="text-current" />
              <span className="truncate">{l.label}</span>
              {l.badge ? (
                <span data-numeral dir="ltr" className="absolute end-2 top-0.5 min-w-4 bg-pub-accent px-1 text-[10px] font-extrabold leading-4 text-pub-ink">
                  {l.badge}
                </span>
              ) : null}
            </RRNavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
