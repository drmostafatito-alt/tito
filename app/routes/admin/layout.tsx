import type { Route } from "./+types/layout";
import { useEffect, useRef, useState } from "react";
import { Form, Link, Outlet, redirect, useLocation, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { logSecurityEvent } from "~server/security/events.server";
import { canAssessment } from "~server/assessment/service.server";
import { AdminIcon, TEACHER_NAV_SECTIONS } from "~/components/admin/nav";
import { resolveNavItem } from "~/components/admin/nav";
import { CollapseButton, SidebarContent } from "~/components/admin/AdminSidebar";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { t, type Locale } from "~/lib/i18n";

const COLLAPSE_KEY = "admin.sidebar.collapsed.v1";

/**
 * Admin Shell (Phase 1). Professional grouped sidebar (collapsible icon rail on
 * desktop, accessible drawer on mobile), a top header with breadcrumb / page
 * title / primary actions, language switch and an admin profile menu. Pure
 * layout — every admin module keeps its own loader/action/business logic.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  // Admins (rank 3+) see the full panel. A teacher (rank 2) may be admitted
  // into the question-bank authoring area ONLY when they hold assessment.read —
  // the sidebar is then filtered to the assessment hub and every other admin
  // module independently re-checks requireRole(3)/its permission.
  const { auth } = await requireRole(context, request, 2);
  const teacherMode = auth.user.rank < 3;
  if (teacherMode) {
    const db = getDb(getEnv(context));
    const canRead = await canAssessment(db, auth, "assessment.read");
    if (!canRead) {
      const url = new URL(request.url);
      await logSecurityEvent(db, {
        userId: auth.user.id,
        type: "permission_denied",
        metadata: { path: url.pathname, rank: auth.user.rank, required: 3, reason: "teacher_no_authoring" },
      });
      throw redirect("/dashboard?error=forbidden");
    }
    // Teachers always land in the question-bank hub, never the admin dashboard.
    if (urlPathIsHome(request.url)) throw redirect("/admin/assessment");
  }
  return {
    admin: {
      email: auth.user.email,
      fullName: auth.user.fullName,
      roleId: auth.user.roleId,
    },
    teacherMode,
  };
}

function urlPathIsHome(raw: string): boolean {
  const { pathname } = new URL(raw);
  return pathname === "/admin" || pathname === "/admin/";
}

function Brand({ appName, locale }: { appName: string; locale: Locale }) {
  return (
    <Link to="/admin" aria-label={appName} className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white" aria-hidden="true">
        <AdminIcon name="logo" className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold leading-tight text-white">{appName}</span>
        <span className="block text-[11px] font-medium text-brand-300">{t(locale, "nav.adminLabel")}</span>
      </span>
    </Link>
  );
}

function PageCrumbs({ pathname, locale }: { pathname: string; locale: Locale }) {
  const root = t(locale, "nav.dashboard");
  if (pathname === "/admin" || pathname === "/admin/") {
    return <span className="truncate text-sm font-semibold text-ink">{root}</span>;
  }
  const match = resolveNavItem(pathname);
  const label = match ? t(locale, match.item.labelKey) : root;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link to="/admin" className="truncate font-medium text-ink-muted hover:text-ink">
        {root}
      </Link>
      <span aria-hidden="true" className="text-ink-muted">
        /
      </span>
      <span className="truncate font-semibold text-ink">{label}</span>
    </nav>
  );
}

function ProfileMenu({ locale, email, fullName }: { locale: Locale; email: string; fullName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const initial = (fullName || email || "A").trim().charAt(0).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t(locale, "nav.profileMenu")}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-100 transition-colors hover:bg-brand-500/30"
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-12 z-50 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink" dir="auto">
              {fullName || "Admin"}
            </p>
            <p className="truncate text-xs text-ink-muted" dir="ltr">
              {email}
            </p>
          </div>
          <div className="p-1.5">
            <Link
              to="/"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-sand-100"
            >
              {t(locale, "nav.viewSite")}
            </Link>
            <Form method="post" action="/logout">
              <button type="submit" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-error hover:bg-error-soft">
                {t(locale, "common.logout")}
              </button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as {
    locale?: Locale;
    localeOptions?: Locale[];
    platform?: { nameAr: string; nameEn: string };
  };
  const locale = (root?.locale ?? "ar") as Locale;
  const localeOptions = root?.localeOptions;
  const appName = locale === "ar" ? (root?.platform?.nameAr ?? "Admin") : (root?.platform?.nameEn ?? "Admin");
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSE_KEY);
      if (saved === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const { email, fullName } = loaderData.admin;
  const navSections = loaderData.teacherMode ? TEACHER_NAV_SECTIONS : undefined;

  return (
    <div className="flex min-h-dvh bg-sand-100">
      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-white/10 bg-brand-950 pt-safe transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[72px]" : "w-64"
        }`}
        aria-label={t(locale, "nav.menu")}
      >
        <div className={`flex h-16 items-center border-b border-white/10 ${collapsed ? "justify-center px-2" : "justify-between gap-2 px-4"}`}>
          {!collapsed && <Brand appName={appName} locale={locale} />}
          {collapsed && (
            <Link to="/admin" aria-label={appName} className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white">
              <AdminIcon name="logo" className="h-5 w-5" />
            </Link>
          )}
          <CollapseButton collapsed={collapsed} locale={locale} onToggle={() => setCollapsed((v) => !v)} />
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <SidebarContent locale={locale} collapsed={collapsed} sections={navSections} />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 pt-safe backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 lg:px-6">
            {/* Mobile menu toggle (desktop layout hides it visually, kept for ARIA/structural tests) */}
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-sand-100 lg:hidden"
              aria-expanded={mobileOpen}
              aria-controls="admin-mobile-nav"
              aria-label={t(locale, "common.menu")}
              onClick={() => setMobileOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {mobileOpen ? (
                  <>
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </>
                ) : (
                  <>
                    <path d="M4 7h16" />
                    <path d="M4 12h16" />
                    <path d="M4 17h16" />
                  </>
                )}
              </svg>
            </button>

            {/* Desktop brand (shown when sidebar collapsed) + breadcrumbs */}
            <div className="hidden items-center gap-3 lg:flex lg:min-w-0">
              <div className="min-w-0 flex-1">
                <PageCrumbs pathname={location.pathname} locale={locale} />
              </div>
            </div>
            {/* Mobile brand */}
            <div className="min-w-0 flex-1 lg:hidden">
              <Brand appName={appName} locale={locale} />
            </div>

            <div className="ms-auto flex shrink-0 items-center gap-1.5">
              <span className="hidden sm:inline-flex">
                <LanguageSwitcher locale={locale} options={localeOptions} />
              </span>
              <a
                href="/"
                className="hidden min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-ink-muted hover:bg-sand-100 md:inline-flex"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {t(locale, "nav.viewSite")}
              </a>
              <ProfileMenu locale={locale} email={email} fullName={fullName} />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-6 lg:py-8">
          <Outlet />
        </main>

        <footer className="border-t border-line bg-surface px-6 py-4 text-center text-xs text-ink-muted">
          © {new Date().getFullYear()} {appName} · {t(locale, "nav.adminLabel")}
        </footer>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-brand-950/60"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
          <nav
            id="admin-mobile-nav"
            aria-label={t(locale, "nav.menu")}
            className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-e border-white/10 bg-brand-950 p-4 pt-safe"
          >
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <Brand appName={appName} locale={locale} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label={t(locale, "nav.closeMenu")}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-sand-400 hover:bg-surface/5 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <SidebarContent locale={locale} onNavigate={() => setMobileOpen(false)} sections={navSections} />
            <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3 sm:hidden">
              <LanguageSwitcher locale={locale} options={localeOptions} />
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
