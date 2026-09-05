import type { Route } from "./+types/p.$slug";
import { useActionData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { getPageBySlug } from "~server/cms/service.server";
import { renderSnapshot, resolvePublicImageUrls } from "~server/cms/render.server";
import { handleCmsFormAction, requestLocale } from "~server/cms/page-render.server";
import { asSnapshot, parseSeo, seoMeta } from "~/cms/seo";
import { PageView } from "~/components/cms/blocks";
import { EmptyState } from "~/components/ui/EmptyState";
import { t } from "~/lib/i18n";

/**
 * Public CMS page (`/p/:slug`). Renders ONLY the frozen published snapshot —
 * drafts are never exposed here (preview is a separate admin-gated path).
 * Form blocks post to this route's action; results come back through
 * actionData (no redirect) so success/failure messages render in place.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);
  const page = await getPageBySlug(db, params.slug);
  const snapshot = page && page.status === "published" ? asSnapshot(page.publishedSnapshot) : null;
  if (!page || !snapshot) throw new Response("Not Found", { status: 404 });

  const locale = requestLocale(request, settings);
  const rendered = await renderSnapshot(db, snapshot, { settings, locale });
  const seo = parseSeo(snapshot.page.seo ?? page.seo);
  const ogImage = seo.ogImage
    ? ((await resolvePublicImageUrls(db, [seo.ogImage]))[seo.ogImage] ?? null)
    : null;

  return {
    sections: rendered.sections,
    ctx: rendered.ctx,
    seo,
    ogImage,
    title: { ar: snapshot.page.titleAr, en: snapshot.page.titleEn },
    url: request.url,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const ogAbsolute = loaderData.ogImage ? new URL(loaderData.ogImage, loaderData.url).href : null;
  return seoMeta(loaderData.seo, loaderData.title, loaderData.ctx.locale, loaderData.url, ogAbsolute);
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const result = await handleCmsFormAction(db, env, request);
  if (!result) throw new Response("Not Found", { status: 404 });
  if ("status" in result) throw new Response("Bad Request", { status: result.status });
  return result;
}

export default function CmsPage({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const ctx = actionData?.formResults
    ? { ...loaderData.ctx, formResults: actionData.formResults }
    : loaderData.ctx;

  if (loaderData.sections.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <EmptyState
          title={t(ctx.locale, "content.pageEmptyTitle")}
          body={t(ctx.locale, "content.pageEmptyBody")}
        />
      </div>
    );
  }
  return <PageView sections={loaderData.sections} ctx={ctx} />;
}
