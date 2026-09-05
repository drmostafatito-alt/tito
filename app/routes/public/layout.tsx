import type { Route } from "./+types/layout";
import { useState } from "react";
import { Link, Outlet, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { getSettings } from "~server/settings/service.server";
import { menuItemsFor } from "~server/cms/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { BrandMark } from "~/components/BrandMark";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";

/**
 * Public chrome (Phase 3): header + footer are DATA-DRIVEN.
 * - links come from the admin navigation builder (menus: header/footer)
 * - logo / socials / contact / copyright come from identity settings
 * - functional auth CTAs (login/register/dashboard/admin) stay in code — they
 *   are behavior, not content. Empty menus → minimal functional chrome, never
 *   hardcoded marketing links.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);
  const { auth } = await resolveAuth(db, env, request);

  // Maintenance mode: admins bypass (FEATURE-SPEC §13)
  const maintenance = settings.platform.maintenance && (auth?.user.rank ?? 0) < 3;

  const [header, footer] = await Promise.all([
    menuItemsFor(db, "header"),
    menuItemsFor(db, "footer"),
  ]);
  const idn = settings.identity;
  const images = await resolvePublicImageUrls(db, [idn.logoFileId].filter(Boolean));

  const toItem = (i: { id: string; parentId: string | null; labelAr: string; labelEn: string; href: string; external: boolean; icon: string | null; visible: boolean }) => ({
    id: i.id, labelAr: i.labelAr, labelEn: i.labelEn, href: i.href, external: i.external, icon: i.icon,
  });

  const tree = (items: ReturnType<typeof toItem>[], all: Awaited<ReturnType<typeof menuItemsFor>>["items"]) =>
    items.map((i) => ({ ...i, children: all.filter((c) => c.parentId === i.id && c.visible).map(toItem) }));

  return {
    maintenance,
    user: auth ? { fullName: auth.user.fullName, rank: auth.user.rank, roleId: auth.user.roleId } : null,
    header: tree(header.topLevel.filter((i) => i.visible).map(toItem), header.items),
    footer: tree(footer.topLevel.filter((i) => i.visible).map(toItem), footer.items),
    identity: {
      platformName: { ar: settings.platform.nameAr, en: settings.platform.nameEn },
      tagline: { ar: settings.platform.taglineAr, en: settings.platform.taglineEn },
      logoUrl: idn.logoFileId ? (images[idn.logoFileId] ?? null) : null,
      contactPhone: idn.contactPhone,
      contactEmail: idn.contactEmail,
      contactAddress: { ar: idn.contactAddressAr, en: idn.contactAddressEn },
      copyright: { ar: idn.copyrightAr, en: idn.copyrightEn },
      socials: (["whatsapp", "telegram", "facebook", "youtube", "instagram", "tiktok", "twitter", "linkedin"] as const)
        .map((network) => {
          const url = network === "whatsapp"
            ? (settings.platform.whatsapp ? `https://wa.me/${settings.platform.whatsapp.replace(/[^\d]/g, "")}` : "")
            : idn[network === "telegram" ? "telegram" : network];
          return { network, url };
        })
        .filter((s) => s.url),
    },
  };
}

interface RootLoaderData {
  locale: Locale;
  platform: { nameAr: string; nameEn: string; maintenance: boolean };
}

type MenuLink = { id: string; labelAr: string; labelEn: string; href: string; external: boolean; icon: string | null };
type MenuNode = MenuLink & { children: MenuLink[] };

function NavLink({ item, locale, className, onNavigate }: { item: MenuLink; locale: Locale; className?: string; onNavigate?: () => void }) {
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
    <Link to={item.href} className={className} onClick={onNavigate}>
      {inner}
    </Link>
  );
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootLoaderData;
  const locale = root?.locale ?? "ar";
  const appName = locale === "ar" ? loaderData.identity.platformName.ar : loaderData.identity.platformName.en;
  const tagline = locale === "ar" ? loaderData.identity.tagline.ar : loaderData.identity.tagline.en;
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loaderData.maintenance) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <BrandMark name={appName} />
        <h1 className="mt-4 text-2xl font-bold">{t(locale, "maintenance.title")}</h1>
        <p className="text-slate-600">{t(locale, "maintenance.body")}</p>
      </main>
    );
  }

  const idn = loaderData.identity;
  const hasContact = Boolean(idn.contactPhone || idn.contactEmail || idn.contactAddress.ar || idn.contactAddress.en);
  const copyrightText = locale === "ar" ? idn.copyright.ar || idn.copyright.en : idn.copyright.en || idn.copyright.ar;
  const navLinkCls = "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 pt-safe backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <Link to="/" aria-label={appName} className="inline-flex min-h-11 items-center">
            {idn.logoUrl ? (
              <img src={idn.logoUrl} alt={appName} className="h-9 w-auto object-contain" />
            ) : (
              <BrandMark name={appName} />
            )}
          </Link>

          {/* Desktop navigation (admin menu builder) */}
          {loaderData.header.length > 0 && (
            <nav aria-label={t(locale, "common.navMain")} className="hidden items-center gap-1 md:flex">
              {loaderData.header.map((node) =>
                node.children.length === 0 ? (
                  <NavLink key={node.id} item={node} locale={locale} className={navLinkCls} />
                ) : (
                  <details key={node.id} className="group relative">
                    <summary className={`${navLinkCls} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                      {node.icon && <Icon name={node.icon} size="sm" colorRole="default" className="text-current" />}
                      <span>{locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}</span>
                      <Icon name="chevron-down" size="sm" colorRole="muted" className="transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="absolute top-full z-50 mt-1 min-w-44 rounded-[var(--radius-card)] border border-slate-200 bg-white p-1.5 shadow-lg ltr:left-0 rtl:right-0">
                      {node.href && (
                        <NavLink item={node} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100" />
                      )}
                      {node.children.map((child) => (
                        <NavLink key={child.id} item={child} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100" />
                      ))}
                    </div>
                  </details>
                )
              )}
            </nav>
          )}

          <div className="flex items-center gap-1.5">
            <LanguageSwitcher locale={locale} />
            {loaderData.user ? (
              <>
                <Link to="/courses" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 md:inline-flex">
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
                <Link to="/courses" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 md:inline-flex">
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
            {loaderData.header.length > 0 && (
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 md:hidden"
                aria-expanded={mobileOpen}
                aria-controls="mobile-nav"
                aria-label={t(locale, "common.menu")}
                onClick={() => setMobileOpen((v) => !v)}
              >
                <Icon name={mobileOpen ? "close" : "menu"} size="md" colorRole="default" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile navigation panel */}
        {mobileOpen && loaderData.header.length > 0 && (
          <nav id="mobile-nav" aria-label={t(locale, "common.navMain")} className="border-t border-slate-200 bg-white px-4 py-2 md:hidden">
            <ul className="flex flex-col">
              {loaderData.header.map((node) => (
                <li key={node.id}>
                  <NavLink
                    item={node}
                    locale={locale}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2.5 text-base font-medium text-slate-800 hover:bg-slate-100"
                    onNavigate={() => setMobileOpen(false)}
                  />
                  {node.children.length > 0 && (
                    <ul className="mb-1 flex flex-col ps-4">
                      {node.children.map((child) => (
                        <li key={child.id}>
                          <NavLink
                            item={child}
                            locale={locale}
                            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-slate-100"
                            onNavigate={() => setMobileOpen(false)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white pb-safe">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="flex flex-col gap-3">
            <Link to="/" aria-label={appName} className="inline-flex items-center">
              {idn.logoUrl ? <img src={idn.logoUrl} alt={appName} className="h-9 w-auto object-contain" /> : <BrandMark name={appName} />}
            </Link>
            {tagline && <p className="text-sm text-slate-500">{tagline}</p>}
            {idn.socials.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {idn.socials.map((s) => (
                  <a
                    key={s.network}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={s.network}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    <Icon name={s.network} size="md" colorRole="default" className="text-current" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Footer menu columns (admin navigation builder) */}
          {loaderData.footer.map((node) => (
            <nav key={node.id} aria-label={locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr} className="flex flex-col gap-1">
              {node.children.length > 0 ? (
                <>
                  <p className="mb-1 text-sm font-semibold text-slate-900">
                    {locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}
                  </p>
                  {node.href && <NavLink item={node} locale={locale} className="inline-flex min-h-9 items-center text-sm text-slate-600 hover:text-slate-900" />}
                  {node.children.map((child) => (
                    <NavLink key={child.id} item={child} locale={locale} className="inline-flex min-h-9 items-center text-sm text-slate-600 hover:text-slate-900" />
                  ))}
                </>
              ) : (
                <NavLink item={node} locale={locale} className="inline-flex min-h-9 w-fit items-center text-sm text-slate-600 hover:text-slate-900" />
              )}
            </nav>
          ))}

          {/* Contact column — only when configured (empty-first) */}
          {hasContact && (
            <div className="flex flex-col gap-2">
              <p className="mb-1 text-sm font-semibold text-slate-900">{t(locale, "footer.contact")}</p>
              {idn.contactPhone && (
                <a href={`tel:${idn.contactPhone}`} className="inline-flex min-h-9 items-center gap-2 text-sm text-slate-600 hover:text-slate-900" dir="ltr">
                  <Icon name="phone" size="sm" colorRole="muted" /> {idn.contactPhone}
                </a>
              )}
              {idn.contactEmail && (
                <a href={`mailto:${idn.contactEmail}`} className="inline-flex min-h-9 items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
                  <Icon name="mail" size="sm" colorRole="muted" /> {idn.contactEmail}
                </a>
              )}
              {(idn.contactAddress.ar || idn.contactAddress.en) && (
                <p className="flex items-start gap-2 text-sm text-slate-600">
                  <Icon name="map-pin" size="sm" colorRole="muted" className="mt-0.5" />
                  <span>{locale === "ar" ? idn.contactAddress.ar || idn.contactAddress.en : idn.contactAddress.en || idn.contactAddress.ar}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-sm text-slate-500 sm:flex-row">
            <span>
              {copyrightText || `© ${new Date().getFullYear()} ${appName} — ${t(locale, "footer.rights")}`}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
