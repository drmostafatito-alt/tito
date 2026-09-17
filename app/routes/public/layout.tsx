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
import { siteEntitiesMeta } from "~/cms/seo";
import { resolveSocialLinks, socialsFor, socialIconName } from "~/cms/social";
import { DecorHairline } from "~/components/visuals/PhilosophyDecor";
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
    url: request.url,
    user: auth ? { fullName: auth.user.fullName, rank: auth.user.rank, roleId: auth.user.roleId } : null,
    header: tree(header.topLevel.filter((i) => i.visible).map(toItem), header.items),
    footer: tree(footer.topLevel.filter((i) => i.visible).map(toItem), footer.items),
    socialUrls: socialAll.map((s) => s.url),
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

/**
 * Site-wide structured data fallback: React Router 7 renders only the LEAF
 * route's meta into <head>, and every public route currently includes the
 * Organization + WebSite entities itself (see siteEntitiesMeta in ~/cms/seo).
 * This covers public routes that have no meta of their own (they inherit this
 * copy instead of the root's) — same data, same honesty rules.
 */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData || loaderData.maintenance) return [];
  return siteEntitiesMeta(matches);
}

interface RootLoaderData {
  locale: Locale;
  localeOptions?: Locale[];
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
  const localeOptions = root?.localeOptions;
  const appName = locale === "ar" ? loaderData.identity.platformName.ar : loaderData.identity.platformName.en;
  const tagline = locale === "ar" ? loaderData.identity.tagline.ar : loaderData.identity.tagline.en;
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loaderData.maintenance) {
    return (
      <main className="pub-root flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <BrandMark name={appName} />
        <h1 className="mt-4 text-2xl font-bold">{t(locale, "maintenance.title")}</h1>
        <p className="text-pub-muted">{t(locale, "maintenance.body")}</p>
      </main>
    );
  }

  const idn = loaderData.identity;
  const hasContact = Boolean(idn.contactPhone || idn.contactEmail || idn.contactAddress.ar || idn.contactAddress.en);
  const copyrightText = locale === "ar" ? idn.copyright.ar || idn.copyright.en : idn.copyright.en || idn.copyright.ar;
  // The public chrome reads LAYER A only (see app/app.css): same radius, shadow,
  // type and focus ring as every other public surface, so the header can never
  // look like a different product than the page below it. All targets ≥44px.
  const navLinkCls =
    "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-pub-pill px-3.5 text-pub-sm font-medium text-pub-ink-soft transition-colors hover:bg-pub-surface hover:text-pub-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong";
  const navActiveCls = `${navLinkCls} bg-pub-surface font-bold text-pub-ink shadow-[inset_0_-2px_0_0_var(--color-pub-accent)]`;

  return (
    <div className="pub-root flex min-h-dvh flex-col overflow-x-hidden">
      <header
        data-testid="public-header"
        className="sticky top-0 z-40 border-b border-pub-line bg-pub-bg/92 pt-safe backdrop-blur-md"
      >
        {/* 320px is the design width, not an afterthought: one row, a shrinking
            brand (the wordmark itself hides below sm inside BrandMark), and a
            fixed action cluster. No secondary text competes for that space. */}
        <div className="mx-auto flex h-14 w-full max-w-[var(--pub-maxw)] min-w-0 items-center justify-between gap-2 px-3 sm:h-[4.25rem] sm:gap-3 sm:px-4">
          <Link to="/" aria-label={appName} className="inline-flex min-h-11 min-w-0 shrink items-center">
            {idn.logoUrl ? (
              <img src={idn.logoUrl} alt={appName} className="h-10 w-auto object-contain" />
            ) : (
              <BrandMark name={appName} />
            )}
          </Link>

          {/* Desktop navigation (admin menu builder). It switches on at `xl`,
              not `lg`: with six owner-authored items the 1024px row cannot hold
              brand + nav + login/register + language + menu at 44px each, so the
              drawer carries navigation until there is real room. One nav grammar,
              no clipped header. */}
          {loaderData.header.length > 0 && (
            <nav aria-label={t(locale, "common.navMain")} className="hidden items-center gap-0.5 xl:flex">
              {loaderData.header.map((node) =>
                node.children.length === 0 ? (
                  <NavLink key={node.id} item={node} locale={locale} className={node.href === "/" ? navActiveCls : navLinkCls} />
                ) : (
                  <details key={node.id} className="group relative">
                    <summary className={`${navLinkCls} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                      {node.icon && <Icon name={node.icon} size="sm" colorRole="default" className="text-current" />}
                      <span>{locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}</span>
                      <Icon name="chevron-down" size="sm" colorRole="muted" className="transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="absolute top-full z-50 mt-1 min-w-44 rounded-pub-xl border border-pub-line bg-pub-bg p-1.5 shadow-pub-lg ltr:left-0 rtl:right-0">
                      {node.href && (
                        <NavLink item={node} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-pub-md px-3 py-2 text-pub-sm font-semibold text-pub-ink hover:bg-pub-surface-2" />
                      )}
                      {node.children.map((child) => (
                        <NavLink key={child.id} item={child} locale={locale} className="flex min-h-11 w-full items-center gap-1.5 rounded-pub-md px-3 py-2 text-pub-sm text-pub-ink-soft hover:bg-pub-surface-2" />
                      ))}
                    </div>
                  </details>
                )
              )}
            </nav>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {idn.socialsHeader.length > 0 && (
              <div className="hidden items-center gap-1 sm:flex">
                {idn.socialsHeader.map((s) => (
                  <a
                    key={s.network + s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={locale === "ar" ? s.labelAr || s.network : s.labelEn || s.network}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-pub-muted transition-colors hover:bg-pub-surface hover:text-pub-navy"
                  >
                    <Icon name={s.network} size="sm" colorRole="default" className="text-current" />
                  </a>
                ))}
              </div>
            )}
            <LanguageSwitcher locale={locale} options={localeOptions} compact />
            {loaderData.user ? (
              <>
                {/* Primary student destination: المحتوى التعليمي (year → grade →
                    subject → term → lesson). The legacy /courses catalog stays
                    reachable for SEO but is no longer the student's front door. */}
                <Link to="/study" className="hidden min-h-11 items-center rounded-pub-pill px-3.5 text-pub-sm font-medium text-pub-muted transition-colors hover:bg-pub-surface hover:text-pub-ink md:inline-flex" data-testid="nav-study">
                  {t(locale, "study.navTitle")}
                </Link>
                <Link
                  to={loaderData.user.rank >= 3 ? "/admin" : "/dashboard"}
                  className="inline-flex min-h-11 items-center rounded-pub-pill bg-pub-navy px-4 text-pub-sm font-bold text-pub-bg transition-colors hover:bg-pub-navy-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong"
                >
                  {loaderData.user.rank >= 3 ? t(locale, "common.admin") : t(locale, "common.dashboard")}
                </Link>
              </>
            ) : (
              <>
                {/* Login stays reachable at 320 — the single most important action
                    for a visitor — but its icon and padding give way so the row
                    never clips. Register moves into the menu below `sm`. */}
                <Link
                  to="/login"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-pub-pill border border-pub-line-strong bg-pub-bg px-3 text-pub-sm font-semibold text-pub-ink transition-colors hover:border-pub-line-strong hover:bg-pub-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong sm:px-4"
                >
                  <Icon name="user" size="sm" colorRole="default" className="hidden text-current sm:inline" />
                  {t(locale, "common.login")}
                </Link>
                <Link
                  to="/register"
                  className="hidden min-h-11 items-center gap-1.5 rounded-pub-pill bg-pub-navy px-5 text-pub-sm font-bold text-pub-bg transition-colors hover:bg-pub-navy-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong sm:inline-flex"
                >
                  <Icon name="user" size="sm" colorRole="invert" className="text-pub-bg" />
                  {t(locale, "common.register")}
                </Link>
              </>
            )}
            {(loaderData.header.length > 0 || !loaderData.user) && (
              <button
                type="button"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pub-pill text-pub-ink transition-colors hover:bg-pub-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong xl:hidden"
                aria-expanded={mobileOpen}
                aria-controls="mobile-nav"
                aria-label={t(locale, "common.menu")}
                data-testid="public-menu"
                onClick={() => setMobileOpen((v) => !v)}
              >
                <Icon name={mobileOpen ? "close" : "menu"} size="md" colorRole="default" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile navigation panel */}
        {mobileOpen && (
          <nav id="mobile-nav" aria-label={t(locale, "common.navMain")} className="max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-t border-pub-line bg-pub-bg px-3 py-2 lg:hidden">
            <ul className="flex flex-col">
              {loaderData.header.map((node) => (
                <li key={node.id}>
                  <NavLink
                    item={node}
                    locale={locale}
                    className="flex min-h-12 w-full items-center gap-2 rounded-pub-md px-3 text-pub-base font-medium text-pub-ink transition-colors hover:bg-pub-surface"
                    onNavigate={() => setMobileOpen(false)}
                  />
                  {node.children.length > 0 && (
                    <ul className="mb-1 flex flex-col ps-4">
                      {node.children.map((child) => (
                        <li key={child.id}>
                          <NavLink
                            item={child}
                            locale={locale}
                            className="flex min-h-11 w-full items-center gap-2 rounded-pub-md px-3 text-pub-sm text-pub-ink-soft transition-colors hover:bg-pub-surface"
                            onNavigate={() => setMobileOpen(false)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {!loaderData.user && (
                <li className="mt-2 flex flex-col gap-2 border-t border-pub-line pt-3 sm:hidden">
                  <Link
                    to="/login"
                    className="inline-flex min-h-12 items-center justify-center rounded-pub-md border border-pub-line-strong bg-pub-bg px-5 text-pub-base font-semibold text-pub-ink transition-colors hover:bg-pub-surface"
                    onClick={() => setMobileOpen(false)}
                  >
                    {t(locale, "common.login")}
                  </Link>
                  <Link
                    to="/register"
                    className="inline-flex min-h-12 items-center justify-center rounded-pub-md bg-pub-navy px-5 text-pub-base font-bold text-pub-bg transition-colors hover:bg-pub-navy-2"
                    onClick={() => setMobileOpen(false)}
                  >
                    {t(locale, "common.register")}
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        )}
      </header>

      <main className="flex-1 bg-pub-bg">
        <Outlet />
      </main>

      <footer className="relative border-t border-pub-navy bg-pub-navy pb-safe text-pub-on-navy-soft">
        <DecorHairline className="mx-auto max-w-7xl px-4 text-pub-accent opacity-60" />
        <div className="mx-auto grid w-full max-w-[var(--pub-maxw)] gap-8 px-[var(--pub-pad-x)] py-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="flex flex-col gap-3">
            <Link to="/" aria-label={appName} className="inline-flex items-center">
              {idn.logoUrl ? <img src={idn.logoUrl} alt={appName} className="h-9 w-auto object-contain" /> : <BrandMark name={appName} tone="onDark" />}
            </Link>
            {tagline && <p className="max-w-sm text-pub-sm leading-pub-normal text-pub-on-navy-soft">{tagline}</p>}
            {idn.socialsFooter.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {idn.socialsFooter.map((s) => (
                  <a
                    key={s.network}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={s.network}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-pub-pill border border-pub-on-navy/20 text-pub-on-navy-soft transition-colors hover:border-pub-accent-soft hover:text-pub-accent-soft"
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
                  <p className="mb-1 text-pub-sm font-bold text-pub-on-navy">
                    {locale === "ar" ? node.labelAr || node.labelEn : node.labelEn || node.labelAr}
                  </p>
                  {node.href && <NavLink item={node} locale={locale} className="inline-flex min-h-11 items-center text-pub-sm text-pub-on-navy-soft transition-colors hover:text-pub-accent-soft" />}
                  {node.children.map((child) => (
                    <NavLink key={child.id} item={child} locale={locale} className="inline-flex min-h-11 items-center text-pub-sm text-pub-on-navy-soft transition-colors hover:text-pub-accent-soft" />
                  ))}
                </>
              ) : (
                <NavLink item={node} locale={locale} className="inline-flex min-h-11 w-fit items-center text-pub-sm text-pub-on-navy-soft transition-colors hover:text-pub-accent-soft" />
              )}
            </nav>
          ))}

          {/* Contact column — only when configured (empty-first) */}
          {hasContact && (
            <div className="flex flex-col gap-2">
              <p className="mb-1 text-pub-sm font-bold text-pub-on-navy">{t(locale, "footer.contact")}</p>
              {idn.contactPhone && (
                <a href={`tel:${idn.contactPhone}`} className="inline-flex min-h-11 items-center gap-2 text-pub-sm text-pub-on-navy-soft transition-colors hover:text-pub-accent-soft" dir="ltr">
                  <Icon name="phone" size="sm" colorRole="accent" /> {idn.contactPhone}
                </a>
              )}
              {idn.contactEmail && (
                <a href={`mailto:${idn.contactEmail}`} className="inline-flex min-h-11 items-center gap-2 text-pub-sm text-pub-on-navy-soft transition-colors hover:text-pub-accent-soft">
                  <Icon name="mail" size="sm" colorRole="accent" /> {idn.contactEmail}
                </a>
              )}
              {(idn.contactAddress.ar || idn.contactAddress.en) && (
                <p className="flex items-start gap-2 text-pub-sm text-pub-line-strong">
                  <Icon name="map-pin" size="sm" colorRole="accent" className="mt-0.5" />
                  <span>{locale === "ar" ? idn.contactAddress.ar || idn.contactAddress.en : idn.contactAddress.en || idn.contactAddress.ar}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-pub-on-navy/15">
          <div className="mx-auto mx-auto flex w-full max-w-[var(--pub-maxw)] flex-col items-center justify-between gap-2 px-[var(--pub-pad-x)] py-5 text-pub-sm text-pub-on-navy-muted sm:flex-row">
            <span>
              {copyrightText || `© ${new Date().getFullYear()} ${appName} — ${t(locale, "footer.rights")}`}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
