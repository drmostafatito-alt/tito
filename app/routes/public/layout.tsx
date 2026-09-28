import type { Route } from "./+types/layout";
import { useState } from "react";
import { Link, Outlet, useLocation, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { resolveAuth } from "~server/auth/session.server";
import { getSettings } from "~server/settings/service.server";
import { menuItemsFor } from "~server/cms/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { BrandMark } from "~/components/BrandMark";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { Drawer } from "~/components/ui/Drawer";
import { SkipLink } from "~/components/ui/SkipLink";
import { Icon } from "~/cms/icons";
import { siteEntitiesMeta } from "~/cms/seo";
import { resolveSocialLinks, socialsFor, socialIconName } from "~/cms/social";
import { Ordinal } from "~/components/tito/ui";
import { SubjectPlate } from "~/components/tito/subject";
import { t, type Locale } from "~/lib/i18n";

/**
 * PUBLIC CHROME — "الفهرس".
 *
 * The masthead is a RULED INDEX HEAD, not a floating pill bar: a hairline
 * utility strip (tagline · phone · language), then the wordmark and the
 * navigation set as plain text. The current section is marked with the
 * highlighter — the product's single accent gesture — so you always know where
 * you are without a second colour, a pill, or a shadow.
 *
 * Everything in it is DATA-DRIVEN:
 *  - links come from the admin navigation builder (menus: header/footer)
 *  - wordmark / socials / contact / copyright come from identity settings
 *  - auth CTAs stay in code — they are behaviour, not content.
 * Empty menus → minimal functional chrome, never hardcoded marketing links.
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
 * This covers public routes that have no meta of their own.
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

const label = (item: MenuLink, locale: Locale) =>
  locale === "ar" ? item.labelAr || item.labelEn : item.labelEn || item.labelAr;

/** A menu href is "current" for the exact path or any path beneath it. */
function isCurrent(href: string, pathname: string): boolean {
  if (!href.startsWith("/")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, locale, className, onNavigate }: { item: MenuLink; locale: Locale; className?: string; onNavigate?: () => void }) {
  const inner = (
    <>
      {item.icon && <Icon name={item.icon} size="sm" colorRole="default" className="text-current" />}
      <span>{label(item, locale)}</span>
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

/* The one nav grammar: plain type, the highlighter marks where you are. */
const NAV_BASE =
  "relative inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap px-2.5 text-pub-sm font-semibold text-pub-ink-soft transition-colors hover:text-pub-ink";

function MastheadLink({ node, locale, pathname }: { node: MenuNode; locale: Locale; pathname: string }) {
  const current = isCurrent(node.href, pathname) || node.children.some((c) => isCurrent(c.href, pathname));
  if (node.children.length === 0) {
    return (
      <NavLink
        item={node}
        locale={locale}
        className={`${NAV_BASE} ${current ? "text-pub-ink [&>span]:tito-mark" : ""}`}
      />
    );
  }
  return (
    <details className="group relative">
      <summary className={`${NAV_BASE} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${current ? "text-pub-ink" : ""}`}>
        {node.icon && <Icon name={node.icon} size="sm" colorRole="default" className="text-current" />}
        <span className={current ? "tito-mark" : ""}>{label(node, locale)}</span>
        <Icon name="chevron-down" size="sm" colorRole="muted" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute top-full z-50 mt-2 min-w-52 border border-pub-line bg-pub-sheet p-1 shadow-pub-lg ltr:left-0 rtl:right-0">
        {node.children.map((child) => (
          <NavLink
            key={child.id}
            item={child}
            locale={locale}
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-pub-sm text-pub-ink-soft transition-colors hover:bg-pub-surface hover:text-pub-ink"
          />
        ))}
      </div>
    </details>
  );
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as RootLoaderData;
  const locale = root?.locale ?? "ar";
  const localeOptions = root?.localeOptions;
  const appName = locale === "ar" ? loaderData.identity.platformName.ar : loaderData.identity.platformName.en;
  const tagline = locale === "ar" ? loaderData.identity.tagline.ar : loaderData.identity.tagline.en;
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const pathname = location.pathname;
  const isAuth = ["/login", "/register", "/forgot-password", "/reset-password"].includes(pathname);

  if (loaderData.maintenance) {
    return (
      <main className="pub-root flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <BrandMark name={appName} />
        <h1 className="mt-4 font-display text-[length:var(--text-pub-xl)] font-extrabold tracking-[-0.03em]">{t(locale, "maintenance.title")}</h1>
        <p className="max-w-[46ch] text-pub-base leading-pub-normal text-pub-muted">{t(locale, "maintenance.body")}</p>
      </main>
    );
  }

  const idn = loaderData.identity;
  const hasContact = Boolean(idn.contactPhone || idn.contactEmail || idn.contactAddress.ar || idn.contactAddress.en);
  const copyrightText = locale === "ar" ? idn.copyright.ar || idn.copyright.en : idn.copyright.en || idn.copyright.ar;

  return (
    <div className="pub-root flex min-h-dvh flex-col">
      <SkipLink locale={locale} />

      <header data-testid="public-header" className="sticky top-0 z-40 bg-pub-bg/95 pt-safe backdrop-blur-sm">
        {/* ── utility strip: the thin ruled line above an index page ──────── */}
        <div className="hidden border-b border-pub-line md:block">
          <div className="mx-auto flex h-9 w-full max-w-[var(--pub-maxw)] items-center justify-between gap-4 px-[var(--pub-pad-x)]">
            {tagline ? <p className="tito-label truncate">{tagline}</p> : <span />}
            <div className="flex shrink-0 items-center gap-1">
              {idn.contactPhone && (
                <a href={`tel:${idn.contactPhone}`} className="tito-label inline-flex items-center gap-1.5 px-2 py-1 transition-colors hover:text-pub-ink" dir="ltr">
                  <Icon name="phone" size="sm" className="h-3.5 w-3.5 text-current" />
                  {idn.contactPhone}
                </a>
              )}
              {idn.socialsHeader.map((s) => (
                <a
                  key={s.network + s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={locale === "ar" ? s.labelAr || s.network : s.labelEn || s.network}
                  className="inline-flex h-8 w-8 items-center justify-center text-pub-muted transition-colors hover:text-pub-ink"
                >
                  <Icon name={s.network} size="sm" className="h-4 w-4 text-current" />
                </a>
              ))}
              <LanguageSwitcher locale={locale} options={localeOptions} />
            </div>
          </div>
        </div>

        {/* ── masthead ─────────────────────────────────────────────────────
            One row at 320px: wordmark + the two actions that matter. The
            navigation moves into the index drawer until there is real room. */}
        <div className="border-b border-pub-line">
          <div className="mx-auto flex h-14 w-full max-w-[var(--pub-maxw)] min-w-0 items-center gap-2 px-[var(--pub-pad-x)] sm:h-[4.5rem] sm:gap-4">
            <Link to="/" aria-label={appName} className="inline-flex min-h-11 min-w-0 shrink items-center">
              {idn.logoUrl ? (
                <img src={idn.logoUrl} alt={appName} className="h-9 w-auto object-contain" />
              ) : (
                <BrandMark name={appName} />
              )}
            </Link>

            {loaderData.header.length > 0 && (
              <nav aria-label={t(locale, "common.navMain")} className="hidden min-w-0 flex-1 items-center xl:flex">
                {loaderData.header.slice(0, 6).map((node) => (
                  <MastheadLink key={node.id} node={node} locale={locale} pathname={pathname} />
                ))}
                {loaderData.header.length > 6 && (
                  <details className="group relative">
                    <summary className={`${NAV_BASE} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
                      <span>{t(locale, "common.more")}</span>
                      <Icon name="chevron-down" size="sm" colorRole="muted" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="absolute top-full z-50 mt-2 min-w-52 border border-pub-line bg-pub-sheet p-1 shadow-pub-lg ltr:left-0 rtl:right-0">
                      {loaderData.header.slice(6).map((node) => (
                        <NavLink
                          key={node.id}
                          item={node}
                          locale={locale}
                          className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-pub-sm text-pub-ink-soft transition-colors hover:bg-pub-surface hover:text-pub-ink"
                        />
                      ))}
                    </div>
                  </details>
                )}
              </nav>
            )}

            <div className="ms-auto flex shrink-0 items-center gap-1.5">
              <div className="md:hidden">
                <LanguageSwitcher locale={locale} options={localeOptions} compact />
              </div>
              {loaderData.user ? (
                <>
                  <Link
                    to="/study"
                    className="hidden min-h-11 items-center px-3 text-pub-sm font-semibold text-pub-ink-soft transition-colors hover:text-pub-ink md:inline-flex"
                    data-testid="nav-study"
                  >
                    {t(locale, "study.navTitle")}
                  </Link>
                  <Link
                    to={loaderData.user.rank >= 3 ? "/admin" : "/dashboard"}
                    className="inline-flex min-h-11 items-center rounded-pub-md bg-pub-navy px-4 text-pub-sm font-bold text-pub-on-navy transition-colors hover:bg-pub-navy-2"
                  >
                    {loaderData.user.rank >= 3 ? t(locale, "common.admin") : t(locale, "common.dashboard")}
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="inline-flex min-h-11 items-center px-2.5 text-pub-sm font-semibold text-pub-ink transition-colors hover:text-pub-accent-strong sm:px-3"
                  >
                    {t(locale, "common.login")}
                  </Link>
                  <Link
                    to="/register"
                    className="inline-flex min-h-11 items-center rounded-pub-md bg-pub-navy px-4 text-pub-sm font-bold text-pub-on-navy transition-colors hover:bg-pub-navy-2 sm:px-5"
                  >
                    {t(locale, "common.register")}
                  </Link>
                </>
              )}
              {(loaderData.header.length > 0 || !loaderData.user) && (
                <button
                  type="button"
                  className="-me-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-pub-ink transition-colors hover:text-pub-accent-strong xl:hidden"
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
        </div>
      </header>

      {/* ── the index drawer: the site's table of contents, numbered ─────── */}
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} id="mobile-nav" label={t(locale, "common.navMain")}>
        <div className="mb-4 flex items-center justify-between border-b border-pub-line pb-3">
          <p className="tito-label">{t(locale, "common.menu")}</p>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={t(locale, "common.close")}
            className="-me-2 inline-flex h-11 w-11 items-center justify-center text-pub-ink"
          >
            <Icon name="close" size="md" colorRole="default" />
          </button>
        </div>
        <ul className="tito-rows border-t-0">
          {loaderData.header.map((node, i) => {
            const current = isCurrent(node.href, pathname);
            return (
              <li key={node.id} className="grid grid-cols-[1.75rem_1fr] items-baseline border-b border-pub-line">
                <span className="tito-label pt-4 text-ink-300" aria-hidden="true">
                  <Ordinal n={i + 1} />
                </span>
                <div>
                  <NavLink
                    item={node}
                    locale={locale}
                    className={`flex min-h-12 w-full items-center gap-3 py-1 font-display text-pub-base font-bold ${current ? "text-pub-ink [&>span]:tito-mark" : "text-pub-ink-soft"}`}
                    onNavigate={() => setMobileOpen(false)}
                  />
                  {node.children.length > 0 && (
                    <ul className="mb-2 flex flex-col">
                      {node.children.map((child) => (
                        <li key={child.id}>
                          <NavLink
                            item={child}
                            locale={locale}
                            className="flex min-h-11 w-full items-center gap-2 text-pub-sm text-pub-muted transition-colors hover:text-pub-ink"
                            onNavigate={() => setMobileOpen(false)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!loaderData.user && (
          <div className="mt-5 flex flex-col gap-2">
            <Link
              to="/register"
              className="inline-flex min-h-12 items-center justify-center rounded-pub-md bg-pub-navy px-5 text-pub-base font-bold text-pub-on-navy"
              onClick={() => setMobileOpen(false)}
            >
              {t(locale, "common.register")}
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-12 items-center justify-center rounded-pub-md border border-pub-line-strong bg-pub-sheet px-5 text-pub-base font-semibold text-pub-ink"
              onClick={() => setMobileOpen(false)}
            >
              {t(locale, "common.login")}
            </Link>
          </div>
        )}
      </Drawer>

      <main id="main-content" className={isAuth ? "flex flex-1 items-stretch bg-pub-bg" : "flex-1 bg-pub-bg"}>
        <Outlet />
      </main>

      {isAuth ? (
        <footer className="border-t border-pub-line bg-pub-bg pb-safe">
          <div className="mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] py-4 text-center text-pub-xs text-pub-muted">
            {copyrightText || `© ${new Date().getFullYear()} ${appName}`}
          </div>
        </footer>
      ) : (
        /* ── the colophon ───────────────────────────────────────────────────
           The footer is the back of the book: the imprint on the left, the
           index columns beside it, the contact data set as data. Flat ink, one
           decorative plate bled into the corner, no gradients. */
        <footer className="relative isolate overflow-hidden bg-pub-navy pb-safe text-pub-on-navy-soft">
          <div className="pointer-events-none absolute -bottom-10 select-none opacity-[0.07] ltr:-right-16 rtl:-left-16" aria-hidden="true">
            <SubjectPlate kind="logic" className="h-64 w-[26rem] text-pub-on-navy" />
          </div>

          <div className="mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)]">
            <div className="grid gap-10 py-12 md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)] lg:py-16">
              <div className="flex flex-col gap-4">
                <Link to="/" aria-label={appName} className="inline-flex w-fit items-center">
                  {idn.logoUrl ? (
                    <img src={idn.logoUrl} alt={appName} className="h-10 w-auto object-contain" />
                  ) : (
                    <span className="font-display text-[length:var(--text-pub-lg)] font-extrabold tracking-[-0.04em] text-pub-on-navy">
                      {appName}
                      <span className="ms-2 inline-block h-[0.4em] w-[0.4em] bg-pub-accent align-baseline" aria-hidden="true" />
                    </span>
                  )}
                </Link>
                {tagline && <p className="max-w-[34ch] text-pub-sm leading-pub-normal text-pub-on-navy-muted">{tagline}</p>}
                {idn.socialsFooter.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {idn.socialsFooter.map((s) => (
                      <a
                        key={s.network + s.url}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        aria-label={locale === "ar" ? s.labelAr || s.network : s.labelEn || s.network}
                        className="inline-flex h-11 w-11 items-center justify-center border border-pub-on-navy/20 text-pub-on-navy-soft transition-colors hover:border-pub-accent hover:text-pub-accent"
                      >
                        <Icon name={s.network} size="md" className="h-5 w-5 text-current" />
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {loaderData.footer.map((node) => (
                  <nav key={node.id} aria-label={label(node, locale)} className="flex flex-col">
                    <p className="tito-label border-b border-pub-on-navy/15 pb-2 text-pub-on-navy">{label(node, locale)}</p>
                    <ul className="flex flex-col pt-1">
                      {node.children.length === 0 ? (
                        <li>
                          <NavLink item={node} locale={locale} className="inline-flex min-h-10 items-center text-pub-sm text-pub-on-navy-soft transition-colors hover:text-pub-accent" />
                        </li>
                      ) : (
                        node.children.map((child) => (
                          <li key={child.id}>
                            <NavLink item={child} locale={locale} className="inline-flex min-h-10 items-center text-pub-sm text-pub-on-navy-soft transition-colors hover:text-pub-accent" />
                          </li>
                        ))
                      )}
                    </ul>
                  </nav>
                ))}

                {hasContact && (
                  <div className="flex flex-col">
                    <p className="tito-label border-b border-pub-on-navy/15 pb-2 text-pub-on-navy">{t(locale, "footer.contact")}</p>
                    <ul className="flex flex-col pt-1">
                      {idn.contactPhone && (
                        <li>
                          <a href={`tel:${idn.contactPhone}`} className="inline-flex min-h-10 items-center gap-2 text-pub-sm text-pub-on-navy-soft transition-colors hover:text-pub-accent" dir="ltr">
                            <Icon name="phone" size="sm" className="h-4 w-4 text-pub-accent" /> {idn.contactPhone}
                          </a>
                        </li>
                      )}
                      {idn.contactEmail && (
                        <li>
                          <a href={`mailto:${idn.contactEmail}`} className="inline-flex min-h-10 items-center gap-2 text-pub-sm break-all text-pub-on-navy-soft transition-colors hover:text-pub-accent">
                            <Icon name="mail" size="sm" className="h-4 w-4 text-pub-accent" /> {idn.contactEmail}
                          </a>
                        </li>
                      )}
                      {(idn.contactAddress.ar || idn.contactAddress.en) && (
                        <li className="flex items-start gap-2 py-2 text-pub-sm text-pub-on-navy-muted">
                          <Icon name="map-pin" size="sm" className="mt-0.5 h-4 w-4 text-pub-accent" />
                          <span>{locale === "ar" ? idn.contactAddress.ar || idn.contactAddress.en : idn.contactAddress.en || idn.contactAddress.ar}</span>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-start justify-between gap-2 border-t border-pub-on-navy/15 py-5 text-pub-xs text-pub-on-navy-muted sm:flex-row sm:items-center">
              <span>{copyrightText || `© ${new Date().getFullYear()} ${appName} — ${t(locale, "footer.rights")}`}</span>
              <span className="tito-label text-pub-on-navy-muted">{locale === "ar" ? loaderData.identity.platformName.en : loaderData.identity.platformName.ar}</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
