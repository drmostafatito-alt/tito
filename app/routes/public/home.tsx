import type { Route } from "./+types/home";
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
 * Homepage = CMS page with slug `home` (Phase 3: the owner composes it in the
 * admin builder; NO hardcoded marketing content lives in code anymore).
 * Empty-first: until a published `home` page exists, visitors see a clean
 * empty state — never demo/placeholder content.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);
  const locale = requestLocale(request, settings);

  const page = await getPageBySlug(db, "home");
  const snapshot = page && page.status === "published" ? asSnapshot(page.publishedSnapshot) : null;
  const platformTitle = { ar: settings.platform.nameAr, en: settings.platform.nameEn };
  if (!snapshot) {
    return { sections: [], ctx: null, seo: null, ogImage: null, title: platformTitle, locale, empty: true as const, url: request.url };
  }

  const rendered = await renderSnapshot(db, snapshot, { settings, locale });
  const seo = parseSeo(snapshot.page.seo ?? page?.seo);
  const ogImage = seo.ogImage
    ? ((await resolvePublicImageUrls(db, [seo.ogImage]))[seo.ogImage] ?? null)
    : null;

  return {
    sections: rendered.sections,
    ctx: rendered.ctx,
    seo,
    ogImage,
    title: { ar: snapshot.page.titleAr || platformTitle.ar, en: snapshot.page.titleEn || platformTitle.en },
    locale,
    empty: false as const,
    url: request.url,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData || loaderData.empty || !loaderData.seo || !loaderData.ctx) {
    const fallback = loaderData ? (loaderData.locale === "ar" ? loaderData.title.ar : loaderData.title.en) : "";
    return [{ title: fallback || "EduCore" }];
  }
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

export default function Home({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const pageTitle = loaderData.locale === "ar" ? loaderData.title.ar : loaderData.title.en;

  if (loaderData.empty || !loaderData.ctx) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="sr-only">{pageTitle || "EduCore"}</h1>
        <EmptyState
          title={t(loaderData.locale, "content.pageEmptyTitle")}
          body={t(loaderData.locale, "content.pageEmptyBody")}
        />
      </div>
    );
  }

  const ctx = actionData?.formResults
    ? { ...loaderData.ctx, formResults: actionData.formResults }
    : loaderData.ctx;

  if (loaderData.sections.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="sr-only">{pageTitle || "EduCore"}</h1>
        <EmptyState
          title={t(ctx.locale, "content.pageEmptyTitle")}
          body={t(ctx.locale, "content.pageEmptyBody")}
        />
      </div>
    );
  }
  return (
    <>
      <h1 className="sr-only">{pageTitle || "EduCore"}</h1>
      <PageView sections={loaderData.sections} ctx={ctx} />
    </>
  );
}
