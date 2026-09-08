import type { Route } from "./+types/admin.cms.preview.$pageId";
import { Link, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { CmsValidationError, canCms, getPage, previewSnapshot } from "~server/cms/service.server";
import { renderSnapshot } from "~server/cms/render.server";
import { requestLocale } from "~server/cms/page-render.server";
import { PageView } from "~/components/cms/blocks";
import { Alert } from "~/components/ui/Alert";
import { cmsLabel } from "~/cms/registry";
import type { Locale } from "~/lib/i18n";

/**
 * Draft preview (Phase 3 stage 8): renders the CURRENT DRAFT tree exactly like
 * publish would — admin-gated, never linked from public pages, no drafts leak
 * to public routes. Validation issues surface here before publishing.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  if (!(await canCms(db, guarded.auth, "cms.read"))) {
    return { denied: true as const, issues: [], rendered: null, page: null };
  }
  const page = await getPage(db, params.pageId);
  if (!page) throw new Response("Not Found", { status: 404 });
  const settings = await getSettings(db);
  const locale = requestLocale(request, settings);
  try {
    const snapshot = await previewSnapshot(db, page.id);
    const rendered = await renderSnapshot(db, snapshot, { settings, locale });
    return { denied: false as const, issues: [], rendered, page: { id: page.id, slug: page.slug, titleAr: page.titleAr, titleEn: page.titleEn, status: page.status } };
  } catch (err) {
    if (err instanceof CmsValidationError) {
      return {
        denied: false as const,
        issues: err.issues.map((i) => `${i.type ?? "block"} ${i.path}: ${i.message}`.trim()),
        rendered: null,
        page: { id: page.id, slug: page.slug, titleAr: page.titleAr, titleEn: page.titleEn, status: page.status },
      };
    }
    throw err;
  }
}

export default function AdminCmsPreview({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = (root?.locale ?? "ar") as "ar" | "en";
  const L = (k: string) => cmsLabel(k, locale);

  if (loaderData.denied || !loaderData.page) return <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>;
  const title = locale === "ar" ? loaderData.page.titleAr : loaderData.page.titleEn;

  return (
    <div className="-mx-4 -my-8 flex flex-col bg-white">
      <div className="sticky top-16 z-30 flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <strong>{L("cms.ui.preview")}</strong>
        <span dir="ltr">/{loaderData.page.slug === "home" ? "" : `p/${loaderData.page.slug}`}</span>
        <Link to={`/admin/cms/pages/${loaderData.page.id}`} className="ms-auto font-medium underline underline-offset-4">{L("cms.ui.builder")}</Link>
        <Link to="/admin/cms" className="font-medium underline underline-offset-4">{L("cms.ui.backToPages")}</Link>
      </div>
      {loaderData.issues.length > 0 && (
        <div className="px-4 pt-4">
          <Alert kind="warning">
            {L("cms.ui.validationFailed")}
            <ul className="mt-1 list-disc ps-5 text-xs">
              {loaderData.issues.map((issue, i) => <li key={i}>{issue}</li>)}
            </ul>
          </Alert>
        </div>
      )}
      {loaderData.rendered ? (
        <PageView sections={loaderData.rendered.sections} ctx={loaderData.rendered.ctx} />
      ) : (
        <p className="px-4 py-8 text-center text-sm text-slate-500">{title ? `${title} — ${L("cms.ui.noSections")}` : L("cms.ui.noSections")}</p>
      )}
    </div>
  );
}
