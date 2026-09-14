import type { Route } from "./+types/robots[.]txt";
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
export async function loader({ request }: Route.LoaderArgs) {
  let origin = "https://dr-mostafa-tito.example"; // unreachable: request.url always has an origin
  try {
    origin = new URL(request.url).origin;
  } catch {
    /* keep placeholder */
  }
  return new Response(robotsTxtBody(`${origin}/sitemap.xml`), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
