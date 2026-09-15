import type { Route } from "./+types/root";
import type { MetaDescriptor } from "react-router";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import {
  applyPrivateCacheControl,
  applySecurityHeaders,
  applySensitiveAuthHeaders,
} from "~server/http/headers.server";
import {
  MUTATION_METHODS,
  declaredBodyTooLarge,
  hasSameOriginMutationEvidence,
  streamedBodyTooLarge,
} from "~server/http/csrf.server";
import { applicationOrigin } from "~server/http/origin.server";
import { resolveAuth, SESSION_COOKIE } from "~server/auth/session.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { LOCALE_COOKIE, resolveLocale } from "~server/settings/locale.server";
import { parseCookieHeader } from "~server/auth/cookies.server";
import { isLocale, t, dirOf, type Locale } from "~/lib/i18n";
import { cspNonceContext } from "~server/csp.server";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "any" },
  // admin-controlled design tokens (validated; same-origin → CSP-safe)
  { rel: "stylesheet", href: "/theme.css" },
  // Preload the two Arabic faces that cover body (400) and headings/bold (700)
  // copy. Both are small (~14 KB, woff2, arabic subset) and every route renders
  // Arabic-first copy, so warming them removes the font swap without pulling a
  // family's worth of bytes. `crossorigin` is required for font preloads.
  { rel: "preload", as: "font", type: "font/woff2", href: "/fonts/cairo/cairo-ar-400.woff2", crossOrigin: "anonymous" },
  { rel: "preload", as: "font", type: "font/woff2", href: "/fonts/cairo/cairo-ar-700.woff2", crossOrigin: "anonymous" },
];

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);

  // auth resolved for the header CTA (public pages need it cheaply, once)
  const { auth } = await resolveAuth(db, env, request);

  const cookieLocale = parseCookieHeader(request.headers.get("cookie")).get(LOCALE_COOKIE);
  const locale = resolveLocale({
    cookieValue: isLocale(cookieLocale) ? cookieLocale : null,
    userPref: auth?.user.localePref ?? null,
    acceptLanguage: request.headers.get("accept-language"),
    defaultLocale: settings.locale.default,
    enabled: settings.locale.enabled,
  });

  return {
    locale,
    // Languages the owner offers (Appearance → System). Drives the switcher and
    // the /set-locale guard so `locale.enabled` is an enforced setting, not
    // stored-but-ignored configuration.
    localeOptions: settings.locale.enabled,
    platform: settings.platform,
    user: auth ? { fullName: auth.user.fullName, roleId: auth.user.roleId, rank: auth.user.rank } : null,
  };
}

/**
 * Root meta: the platform name is the DEFAULT document title (owner-editable in
 * Appearance → System). Any route exporting `meta()` overrides it — previously
 * `Layout` hardcoded a `<title>` *and* rendered `<Meta />`, so every page with
 * route meta emitted TWO `<title>` elements (invalid HTML; crawlers and social
 * scrapers may pick the wrong one).
 */
export function meta({ loaderData }: Route.MetaArgs): MetaDescriptor[] {
  const locale = (loaderData?.locale ?? "ar") as Locale;
  const platform = loaderData?.platform;
  const name = locale === "ar" ? (platform?.nameAr ?? "") : (platform?.nameEn ?? "");
  // Fallback (error/404 context, where loader data may be absent) uses the
  // platform's OFFICIAL identity rather than a generic "Learning Platform" —
  // consistent with the settings default and the brand the owner confirmed.
  return [{ title: name || (locale === "ar" ? "د/ مصطفى تيتو" : "Dr mostafa tito") }];
}

const MAX_FORM_BODY_BYTES = 1 * 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES = 52 * 1024 * 1024;

function mutationBodyLimit(pathname: string): number {
  const isBufferedUpload =
    pathname === "/admin/files" ||
    pathname === "/admin/videos" ||
    /^\/assignments\/[^/]+$/.test(pathname) ||
    /^\/orders\/[^/]+$/.test(pathname);
  return isBufferedUpload ? MAX_MULTIPART_BODY_BYTES : MAX_FORM_BODY_BYTES;
}

/** Global middleware: CSRF origin check on mutations + security headers (SECURITY.md §5/§6). */
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    const pathname = new URL(request.url).pathname;
    const isSignedPaymentWebhook = /^\/webhooks\/payments\/[^/]+\/?$/.test(pathname);
    if (MUTATION_METHODS.has(request.method) && !isSignedPaymentWebhook) {
      const expectedOrigin = applicationOrigin(getEnv(context), request);
      if (!expectedOrigin || !hasSameOriginMutationEvidence(request, expectedOrigin)) {
        const blocked = new Response("Forbidden", { status: 403 });
        applySecurityHeaders(
          blocked.headers,
          Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
          readNonce(context)
        );
        return blocked;
      }
    }
    const bodyLimit = mutationBodyLimit(pathname);
    if (
      MUTATION_METHODS.has(request.method) &&
      !isSignedPaymentWebhook &&
      (declaredBodyTooLarge(request, bodyLimit) ||
        (bodyLimit === MAX_FORM_BODY_BYTES &&
          (await streamedBodyTooLarge(request, bodyLimit))))
    ) {
      const blocked = new Response("Payload Too Large", { status: 413 });
      applySecurityHeaders(
        blocked.headers,
        Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
        readNonce(context)
      );
      return blocked;
    }
    const response = await next();
    applySecurityHeaders(
      response.headers,
      Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
      readNonce(context),
    );
    // Authenticated documents, data responses, APIs and redirects are private.
    applyPrivateCacheControl(
      response.headers,
      parseCookieHeader(request.headers.get("cookie")).has(SESSION_COOKIE),
    );
    applySensitiveAuthHeaders(response.headers, pathname);
    return response;
  },
];

/** Read the per-request CSP nonce from the load context (workers/app.ts seeds
 *  it). Missing in direct/Vite contexts → undefined (dev falls back to
 *  'unsafe-inline'; production nonce-less renders would fail hydration loudly
 *  rather than silently serve a broken app). */
function readNonce(context: unknown): string | undefined {
  const provider = context as { get?: (definition: unknown) => string } | undefined;
  if (provider && typeof provider.get === "function") {
    try {
      return provider.get(cspNonceContext);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Document shell MUST live in Layout. React Router 7 only commits `<html lang
 * dir>` from this export; putting it on the default App meant client
 * revalidation could update route content while the live documentElement
 * stayed on the previous locale.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  const data = useLoaderData() as
    | { locale?: Locale; platform?: { nameAr: string; nameEn: string } }
    | undefined;
  const locale = (data?.locale ?? "ar") as Locale;
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = isRouteErrorResponse(error)
    ? error.status === 404
      ? { title: t("ar", "errors.notFoundTitle"), body: t("ar", "errors.notFoundBody") }
      : { title: t("ar", "errors.errorTitle"), body: t("ar", "errors.errorBody") }
    : { title: t("ar", "errors.errorTitle"), body: t("ar", "errors.errorBody") };

  // Never dump route data, request URLs, form bodies, or stack traces: auth
  // credentials may have been involved. Observability gets only a safe class.
  console.error(
    "[error-boundary]",
    isRouteErrorResponse(error) ? `route_status_${error.status}` : error instanceof Error ? error.name : "unknown"
  );

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <p className="text-5xl font-bold text-brand-700">{isRouteErrorResponse(error) ? error.status : "500"}</p>
      <h1 className="text-2xl font-bold">{message.title}</h1>
      <p className="text-slate-600">{message.body}</p>
      <Link
        to="/"
        className="mt-2 rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
      >
        {t("ar", "errors.goHome")}
      </Link>
    </main>
  );
}
