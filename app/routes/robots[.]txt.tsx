import type { Route } from "./+types/robots[.]txt";
import { getEnv } from "~server/cf.server";
import { applicationOrigin } from "~server/http/origin.server";
import { robotsTxtBody } from "~server/seo/inventory.server";

/**
 * robots.txt (SEO Master Phase). Dynamic because the `Sitemap:` line must be
 * an ABSOLUTE URL against the real serving origin (local dev vs production
 * domain) — a static file cannot know its origin.
 *
 * Public educational pages are explicitly allowed; private/student/admin/API
 * surfaces are Disallowed (crawl hygiene — they are auth-gated server-side
 * regardless; robots.txt is never the security boundary).
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  // Production canonical output is pinned to APP_ORIGIN rather than a
  // client-controlled Host header. Explicit test/development still follows the
  // dynamic preview origin through applicationOrigin().
  const origin = applicationOrigin(getEnv(context), request);
  if (!origin) throw new Response("Service unavailable", { status: 503 });
  return new Response(robotsTxtBody(`${origin}/sitemap.xml`), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
