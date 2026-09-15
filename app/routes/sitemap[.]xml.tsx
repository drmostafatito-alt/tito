import type { Route } from "./+types/sitemap[.]xml";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { applicationOrigin } from "~server/http/origin.server";
import { indexablePublicUrls, sitemapXml } from "~server/seo/inventory.server";

/**
 * Dynamic sitemap.xml (SEO Master Phase) — generated from live, PUBLISHED
 * content state on every request (the inventory is the same source the Admin
 * → SEO dashboard audits):
 *
 *   - homepage, program/grade/subject/course pages with visible content
 *   - active storefront products, published CMS pages, /about (identity set)
 *
 * Draft/archived/deleted content, private student/admin/learn surfaces, query
 * variants and unit/lesson id-URLs are NEVER listed. When the owner archives a
 * course, its URL disappears on the next fetch — no manual upkeep, no stale
 * URLs.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const origin = applicationOrigin(env, request);
  if (!origin) throw new Response("Service unavailable", { status: 503 });
  const urls = await indexablePublicUrls(getDb(env));
  return new Response(sitemapXml(urls, origin), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
