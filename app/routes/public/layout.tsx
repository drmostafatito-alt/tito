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
import { resolveQuestionPlatformUrl } from "~/lib/question-platform";
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
  const fileIds = [idn.logoFileId, idn.ownerPhotoFileId].filter((x): x is string => Boolean(x));
  const images = await resolvePublicImageUrls(db, fileIds);
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
    questionPlatformUrl: resolveQuestionPlatformUrl(settings.platform),
    header: tree(header.topLevel.filter((i) => i.visible).map(toItem), header.items),
    footer: tree(footer.topLevel.filter((i) => i.visible).map(toItem), footer.items),
    socialUrls: socialAll.map((s) => s.url),
    identity: {
      platformName: { ar: settings.platform.nameAr, en: settings.platform.nameEn },
      tagline: { ar: settings.platform.taglineAr, en: settings.platform.taglineEn },
      logoUrl: idn.logoFileId ? (images[idn.logoFileId] ?? null) : null,
      ownerPhotoUrl: idn.ownerPhotoFileId ? (images[idn.ownerPhotoFileId] ?? null) : null,
      contactPhone: idn.contactPhone,
      contactEmail: idn.contactEmail,
      contactAddress: { ar: idn.contactAddressAr, en: idn.contactAddressEn },
      copyright: { ar: idn.copyrightAr, en: idn.copyrightEn },
      footerAbout: { ar: settings.platform.footerAboutAr, en: settings.platform.footerAboutEn },
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

/** Mockup .mnav item: icon over a small bold label, styled by .mk CSS. */
function MnavLink({ to, icon, label, active }: { to: string; icon: string; label: string; active: boolean }) {
  return (
    <Link to={to} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
      <Icon name={icon} size="md" colorRole="default" className="ic" />
      {label}
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
  const location = useLocation();
  const isAuth = ["/login", "/register", "/forgot-password", "/reset-password"].includes(location.pathname);

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
  const footerAbout = locale === "ar" ? idn.footerAbout.ar || idn.footerAbout.en : idn.footerAbout.en || idn.footerAbout.ar;
  // The public chrome reads LAYER A only (see app/app.css): same radius, shadow,
  // type and focus ring as every other public surface, so the header can never
  // look like a different product than the page below it. All targets ≥44px.
  const navLinkCls =
    "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-pub-pill px-3.5 text-pub-sm font-medium text-pub-ink-soft transition-colors hover:bg-pub-surface hover:text-pub-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pub-accent-strong";
  const navActiveCls = `${navLinkCls} bg-pub-surface font-bold text-pub-ink shadow-[inset_0_-2px_0_0_var(--color-pub-accent)]`;

  return (
    // Bottom padding that clears the fixed mobile bar lives in app.css next to
    // `.mnav` itself — one breakpoint (≤960px) for both, instead of a Tailwind
    // `md:` (768px) that disagreed with it.
    <div className="pub-root pub-shell flex min-h-dvh flex-col overflow-x-hidden">
      <SkipLink locale={locale} />
      <div className="mk">
      <header data-testid="public-header" className="topbar" id="topbar">
        <div className="container topbar-in">
          <Link to="/" aria-label={appName} className="brand">
            {idn.ownerPhotoUrl ? (
              <img src={idn.ownerPhotoUrl} alt={appName} className="ava" />
            ) : idn.logoUrl ? (
              <img src={idn.logoUrl} alt={appName} className="ava" />
            ) : (
              <span className="ava ava-fallback" aria-hidden="true">
                {appName.charAt(0)}
              </span>
            )}
            <div>
              <b>{appName}</b>
              {tagline && <small>{tagline}</small>}
            </div>
          </Link>
          {/* Desktop nav only. The burger opens the overlay Drawer below — it
              used to toggle this panel open at the same time, so two menus
              (and two identically-labelled nav landmarks) were open at once,
              with this one stranded behind the drawer's scrim. */}
          {loaderData.header.length > 0 && (
            <nav aria-label={t(locale, "common.navMain")} className="nav" id="nav">
              {loaderData.header.map((node) => (
                <NavLink
                  key={node.id}
                  item={node}
                  locale={locale}
                  className={node.href === "/" || location.pathname === node.href ? "active" : undefined}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </nav>
          )}
          <div className="topbar-actions">
            {idn.socialsHeader.length > 0 && (
              <div className="socials">
                {idn.socialsHeader.map((s) => (
                  <a
                    key={s.network + s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={locale === "ar" ? s.labelAr || s.network : s.labelEn || s.network}
                  >
                    <Icon name={s.network} size="sm" colorRole="default" className="ic" />
                  </a>
                ))}
              </div>
            )}
            {/* Mockup shows the anonymous topbar (no login button). Signed-in
                users still need their dashboard/admin entry — the mockup does
                not cover the signed-in state. */}
            {loaderData.user ? (
              <Link
                to={loaderData.user.rank >= 3 ? "/admin" : "/dashboard"}
                className="btn btn-blue btn-sm"
              >
                {loaderData.user.rank >= 3 ? t(locale, "common.admin") : t(locale, "common.dashboard")}
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-blue btn-sm">
                  {t(locale, "common.login")}
                </Link>
                <Link to="/register" className="btn btn-gold btn-sm">
                  {t(locale, "common.register")}
                </Link>
              </>
            )}
            <button
              type="button"
              className="burger"
              id="burger"
              data-testid="public-menu"
              aria-label={t(locale, "common.menu")}
              aria-expanded={mobileOpen}
              // Only point at the drawer while it exists: the Drawer unmounts
              // when closed, and aria-controls must resolve to a real element.
              aria-controls={mobileOpen ? "mobile-nav" : undefined}
              aria-haspopup="menu"
              onClick={() => setMobileOpen((v) => !v)}
            >
              ☰
            </button>
          </div>
        </div>
      </header>
      </div>

      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} id="mobile-nav" label={t(locale, "common.navMain")}>
        <div className="mb-3 flex items-center justify-between border-b border-pub-line pb-3">
          <p className="text-pub-sm font-bold text-pub-ink">{t(locale, "common.menu")}</p>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={t(locale, "common.close")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-pub-pill text-pub-ink hover:bg-pub-surface"
          >
            <Icon name="close" size="md" colorRole="default" />
          </button>
        </div>
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
                <li className="mt-2 flex flex-col gap-2 border-t border-pub-line pt-3">
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
      </Drawer>

      <main id="main-content" className={isAuth ? "flex flex-1 items-start bg-pub-bg sm:items-center" : "flex-1 bg-pub-bg"}>
        <Outlet />
      </main>

      {isAuth ? (
      <footer className="border-t border-pub-line bg-pub-bg pb-safe">
        <div className="mx-auto w-full max-w-[var(--pub-maxw)] px-[var(--pub-pad-x)] py-4 text-center text-pub-xs text-pub-muted">
          {copyrightText || `© ${new Date().getFullYear()} ${appName}`}
        </div>
      </footer>
      ) : (
      <div className="mk">
      <footer>
        <div aria-hidden="true" className="giant">🏛️</div>
        <div className="container fgrid">
          <div>
            <div className="fbrand">
              {idn.ownerPhotoUrl ? (
                <img src={idn.ownerPhotoUrl} alt={appName} className="fava" />
              ) : idn.logoUrl ? (
                <img src={idn.logoUrl} alt={appName} className="fava" />
              ) : null}
              <div>
                <b>{appName}</b>
                {tagline && <small>{tagline}</small>}
              </div>
            </div>
            {footerAbout && <p dir="auto" className="fabout">{footerAbout}</p>}
            {idn.socialsFooter.length > 0 && (
              <div className="fsoc">
                {idn.socialsFooter.map((s) => (
                  <a
                    key={s.network + s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={locale === "ar" ? s.labelAr || s.network : s.labelEn || s.network}
                  >
                    <Icon name={s.network} size="sm" colorRole="default" />
                  </a>
                ))}
              </div>
            )}
          </div>
          {loaderData.footer.length > 0 && (
            <div className="flinks">
              <h4>{t(locale, "footer.quickLinks")}</h4>
              {loaderData.footer.map((node) => (
                <NavLink key={node.id} item={node} locale={locale} />
              ))}
            </div>
          )}
        </div>
        <div className="copy">
          {copyrightText || `\u00a9 ${new Date().getFullYear()} ${appName}`}
        </div>
      </footer>
      </div>
      )}
      {/* Mobile bottom nav — mockup .mnav: 4 items, question-platform entry only
          when configured (loader resolves it to null otherwise). Styled by the
          .mk layer in app.css (visible ≤960px). */}
      <div className="mk">
        <nav aria-label={t(locale, "common.navMain")} className="mnav">
          <div className="mnav-in">
            <MnavLink to="/" icon="compass" label={locale === "ar" ? "الرئيسية" : "Home"} active={location.pathname === "/"} />
            <MnavLink to="/#vids" icon="play-circle" label={locale === "ar" ? "الدروس" : "Lessons"} active={false} />
            <MnavLink to="/register" icon="sparkles" label={locale === "ar" ? "اشترك الآن" : "Subscribe"} active={location.pathname === "/register"} />
            {loaderData.questionPlatformUrl ? (
              <a href={loaderData.questionPlatformUrl} target="_blank" rel="noopener noreferrer" aria-label={t(locale, "questionPlatform.navAria")}>
                <Icon name="help-circle" size="md" colorRole="default" className="ic" />
                {t(locale, "questionPlatform.navLabel")}
              </a>
            ) : (
              <MnavLink to="/login" icon="user" label={locale === "ar" ? "دخول" : "Log in"} active={location.pathname === "/login"} />
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
