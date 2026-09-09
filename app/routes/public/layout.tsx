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
import { resolveSocialLinks, socialsFor, socialIconName } from "~/cms/social";
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
  const waUrl = settings.platform.whatsapp ? `https://wa.me/${settings.platform.whatsapp.replace(/[^\d]/g, "")}` : "";
  const socialAll = resolveSocialLinks(idn, waUrl);

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
      socialsHeader: socialsFor(socialAll, "header").map((s) => ({ network: socialIconName(s.network), url: s.url, labelAr: s.labelAr, labelEn: s.labelEn })),
      socialsFooter: socialsFor(socialAll, "footer").map((s) => ({ network: socialIconName(s.network), url: s.url, labelAr: s.labelAr, labelEn: s.labelEn })),
    },
  };
}

interface RootLoaderData {
  locale: Locale;
  localeOptions?: Locale[];
  platform: { nameAr: string; nameEn: string; maintenance: boolean };
}

type MenuLink = { id: string; labelAr: string; labelEn: string; href: string; external: boolean; icon: string | null };
type MenuNode = MenuLink & { children: MenuLink[] };

function NavLink({ item, locale, className, onNavigate, idx, drawer }: { item: MenuLink; locale: Locale; className?: string; onNavigate?: () => void; idx?: number; drawer?: boolean }) {
  const label = locale === "ar" ? item.labelAr || item.labelEn : item.labelEn || item.labelAr;
  const inner = (
    <>
      {idx !== undefined && (
        <span className={`font-bold tabular-nums ${drawer ? "text-sm text-accent-600" : "text-xs text-slate-400 group-hover/nav:text-accent-600"}`} aria-hidden="true">
          {String(idx + 1).padStart(2, "0")}
        </span>
      )}
      {item.icon && <Icon name={item.icon} size="sm" colorRole="default" className="text-current" />}
      <span className={idx !== undefined && !drawer ? "sig-u" : drawer ? "sig-display text-xl text-ink" : undefined}>{label}</span>
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
  const localeOptions = root?.localeOptions;
  const appName = locale === "ar" ? loaderData.identity.platformName.ar : loaderData.identity.platformName.en;
  const tagline = locale === "ar" ? loaderData.identity.tagline.ar : loaderData.identity.tagline.en;
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loaderData.maintenance) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <BrandMark name={appName} />
        <h1 className="mt-4 text-2xl font-bold">{t(locale, "maintenance.title")}</h1>
        <p className="text-ink-muted">{t(locale, "maintenance.body")}</p>
      </main>
    );
  }

  const idn = loaderData.identity;
  const hasContact = Boolean(idn.contactPhone || idn.contactEmail || idn.contactAddress.ar || idn.contactAddress.en);
  const copyrightText = locale === "ar" ? idn.copyright.ar || idn.copyright.en : idn.copyright.en || idn.copyright.ar;
  // Masthead nav: index numeral + sliding ink underline; the home entry gets the signal underline.
  // NOTE: blackBtn carries NO display class — Tailwind v4 sorts .inline-flex
  // AFTER .hidden, so composing both breaks `hidden sm:inline-flex` toggles.
  const navLinkCls = "group/nav inline-flex min-h-11 items-baseline gap-1.5 whitespace-nowrap px-2.5 py-2 text-sm font-semibold text-ink transition-colors hover:text-accent-700";
  const navActiveCls = "group/nav inline-flex min-h-11 items-baseline gap-1.5 whitespace-nowrap px-2.5 py-2 text-sm font-semibold text-ink";
  const navIndexCls = "text-xs font-bold tabular-nums text-slate-400 group-hover/nav:text-accent-600";
  const navLabelCls = "sig-u";
  const blackBtn = "min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-btn)] bg-brand-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800";

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b-2 border-brand-800 bg-white/95 pt-safe backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4">
          <Link to="/" aria-label={appName} className="inline-flex min-h-11 shrink-0 items-center">
            {idn.logoUrl ? (
              <img src={idn.logoUrl} alt={appName} className="h-10 w-auto object-contain" />
            ) : (
              <BrandMark name={appName} />
            )}
          </Link>

          {/* Desktop navigation (admin menu builder) */}
          {loaderData.header.length > 0 && (
            <nav aria-label={t(locale, "common.navMain")} className="hidden items-center gap-0.5 lg:flex">
              {loaderData.header.map((node, i) =>
                node.children.length === 0 ? (
                  <NavLink key={node.id} item={node} locale={locale} className={node.href === "/" ? navActiveCls : navLinkCls} idx={i} />
                ) : (
                  <details key={node.id} className="group relative">
                    <summary className={`${navLinkCls} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                      <span className={navIndexCls}>{String(i + 1).padStart(2, "0")}</span>
                      <span className={navLabelCls}>{locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}</span>
                      <Icon name="chevron-down" size="sm" colorRole="muted" className="self-center transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="absolute top-full z-50 mt-2 min-w-52 rounded-[var(--radius-card)] border-2 border-brand-800 bg-white p-1.5 shadow-[4px_4px_0_0_var(--color-brand-800)] ltr:left-0 rtl:right-0">
                      {node.href && (
                        <NavLink item={node} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-[var(--radius-base)] px-3 py-2 text-sm font-bold text-ink hover:bg-slate-100" />
                      )}
                      {node.children.map((child) => (
                        <NavLink key={child.id} item={child} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-[var(--radius-base)] px-3 py-2 text-sm font-medium text-ink hover:bg-slate-100" />
                      ))}
                    </div>
                  </details>
                )
              )}
            </nav>
          )}

          <div className="flex items-center gap-1.5">
            {idn.socialsHeader.length > 0 && (
              <div className="hidden items-center gap-1 xl:flex">
                {idn.socialsHeader.map((s) => (
                  <a
                    key={s.network + s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={locale === "ar" ? s.labelAr || s.network : s.labelEn || s.network}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] text-ink-muted hover:bg-slate-100 hover:text-ink"
                  >
                    <Icon name={s.network} size="sm" colorRole="default" className="text-current" />
                  </a>
                ))}
              </div>
            )}
            <LanguageSwitcher locale={locale} options={localeOptions} />
            {loaderData.user ? (
              <>
                <Link to="/courses" className="hidden min-h-11 items-center px-3 py-2 text-sm font-semibold text-ink-muted hover:text-ink md:inline-flex">
                  <span className="sig-u">{t(locale, "content.catalogTitle")}</span>
                </Link>
                <Link to={loaderData.user.rank >= 3 ? "/admin" : "/dashboard"} className={`inline-flex ${blackBtn}`}>
                  {loaderData.user.rank >= 3 ? t(locale, "common.admin") : t(locale, "common.dashboard")}
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-btn)] px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-100"
                >
                  <Icon name="user" size="sm" colorRole="default" className="text-current" />
                  <span className="hidden sm:inline">{t(locale, "common.login")}</span>
                </Link>
                <Link to="/register" className={`hidden ${blackBtn} sm:inline-flex`}>
                  <Icon name="user" size="sm" colorRole="invert" className="text-white" />
                  {t(locale, "common.register")}
                </Link>
              </>
            )}
            {(loaderData.header.length > 0 || !loaderData.user) && (
              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] text-ink hover:bg-slate-100 lg:hidden"
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

        {/* Mobile navigation drawer */}
        {mobileOpen && (
          <div className="absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-t-2 border-brand-800 bg-white shadow-xl lg:hidden">
            <nav id="mobile-nav" aria-label={t(locale, "common.navMain")} className="mx-auto w-full max-w-7xl px-4 py-4">
              <ul className="flex flex-col divide-y divide-line">
                {loaderData.header.map((node, i) => (
                  <li key={node.id} className="py-1">
                    <NavLink
                      item={node}
                      locale={locale}
                      className="flex min-h-12 w-full items-baseline gap-3 rounded-[var(--radius-base)] px-2 py-3 hover:bg-slate-50"
                      onNavigate={() => setMobileOpen(false)}
                      idx={i}
                      drawer
                    />
                    {node.children.length > 0 && (
                      <ul className="mb-1 flex flex-col border-s-2 border-line ps-4 ms-2">
                        {node.children.map((child) => (
                          <li key={child.id}>
                            <NavLink
                              item={child}
                              locale={locale}
                              className="flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-base)] px-2 py-2 text-[15px] font-medium text-ink-muted hover:bg-slate-50 hover:text-ink"
                              onNavigate={() => setMobileOpen(false)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
                {!loaderData.user && (
                  <li className="flex flex-col gap-2 py-4 sm:hidden">
                    <Link
                      to="/register"
                      className={`inline-flex min-h-12 justify-center rounded-[var(--radius-btn)] bg-brand-700 px-5 py-2 text-base font-semibold text-white transition-colors hover:bg-brand-800`}
                      onClick={() => setMobileOpen(false)}
                    >
                      {t(locale, "common.register")}
                    </Link>
                  </li>
                )}
              </ul>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-brand-800 pb-safe text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="flex flex-col gap-4">
            <Link to="/" aria-label={appName} className="inline-flex items-center">
              {idn.logoUrl ? <img src={idn.logoUrl} alt={appName} className="h-9 w-auto object-contain brightness-0 invert" /> : <BrandMark name={appName} onDark />}
            </Link>
            {tagline && <p className="max-w-xs text-sm leading-7 text-white/70">{tagline}</p>}
            {idn.socialsFooter.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {idn.socialsFooter.map((s) => (
                  <a
                    key={s.network}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={s.network}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] bg-white/10 text-white transition-colors hover:bg-accent-600"
                  >
                    <Icon name={s.network} size="md" colorRole="invert" className="text-current" />
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
                  <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
                    <span className="inline-block h-3.5 w-1 bg-accent-500" aria-hidden="true" />
                    {locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}
                  </p>
                  {node.href && <NavLink item={node} locale={locale} className="inline-flex min-h-9 items-center text-sm text-white/70 transition-colors hover:text-white" />}
                  {node.children.map((child) => (
                    <NavLink key={child.id} item={child} locale={locale} className="inline-flex min-h-9 items-center text-sm text-white/70 transition-colors hover:text-white" />
                  ))}
                </>
              ) : (
                <NavLink item={node} locale={locale} className="inline-flex min-h-9 w-fit items-center text-sm text-white/70 transition-colors hover:text-white" />
              )}
            </nav>
          ))}

          {/* Contact column — only when configured (empty-first) */}
          {hasContact && (
            <div className="flex flex-col gap-2">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold text-white">
                <span className="inline-block h-3.5 w-1 bg-accent-500" aria-hidden="true" />
                {t(locale, "footer.contact")}
              </p>
              {idn.contactPhone && (
                <a href={`tel:${idn.contactPhone}`} className="inline-flex min-h-9 items-center gap-2 text-sm text-white/70 hover:text-white" dir="ltr">
                  <Icon name="phone" size="sm" colorRole="invert" className="opacity-60" /> {idn.contactPhone}
                </a>
              )}
              {idn.contactEmail && (
                <a href={`mailto:${idn.contactEmail}`} className="inline-flex min-h-9 items-center gap-2 text-sm text-white/70 hover:text-white">
                  <Icon name="mail" size="sm" colorRole="invert" className="opacity-60" /> {idn.contactEmail}
                </a>
              )}
              {(idn.contactAddress.ar || idn.contactAddress.en) && (
                <p className="flex items-start gap-2 text-sm leading-6 text-white/70">
                  <Icon name="map-pin" size="sm" colorRole="invert" className="mt-0.5 opacity-60" />
                  <span>{locale === "ar" ? idn.contactAddress.ar || idn.contactAddress.en : idn.contactAddress.en || idn.contactAddress.ar}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-white/15">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-sm text-white/60 sm:flex-row">
            <span>
              {copyrightText || `© ${new Date().getFullYear()} ${appName} — ${t(locale, "footer.rights")}`}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
