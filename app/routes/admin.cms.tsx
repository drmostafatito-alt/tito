import type { Route } from "./+types/admin.cms";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import {
  CmsReferenceError,
  CmsValidationError,
  canCms,
  createPage,
  deletePage,
  duplicatePage,
  listPages,
  movePage,
  setPageStatus,
  type CmsPermission,
} from "~server/cms/service.server";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { cmsLabel } from "~/cms/registry";
import { t, formatDateShort, type Locale } from "~/lib/i18n";

/** Admin → CMS pages list (Phase 3 stage 2). Every mutation: permission-checked + audited in the service. */

async function requireCms(context: unknown, request: Request, permission: CmsPermission) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  if (!(await canCms(db, guarded.auth, permission))) {
    return { ...guarded, db, env, allowed: false as const };
  }
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  return {
    ...guarded,
    db,
    env,
    allowed: true as const,
    actor: { userId: guarded.auth.user.id, role: guarded.auth.user.roleId, ipHash },
  };
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { db, allowed } = await requireCms(context, request, "cms.read");
  if (!allowed) return { pages: [], denied: true as const };
  const pages = await listPages(db);
  return { pages, denied: false as const };
}

export async function action({ context, request }: Route.ActionArgs) {
  const intent = String((await request.clone().formData()).get("_action") ?? "");
  const perm: CmsPermission =
    intent === "create" || intent === "duplicate" ? "cms.create"
    : intent === "delete" ? "cms.delete"
    : intent === "unpublish" || intent === "archive" ? "cms.publish"
    : "cms.edit";
  const guard = await requireCms(context, request, perm);
  if (!guard.allowed) return { error: "denied" as const };
  const { db, actor } = guard;
  const form = await request.formData();
  const pageId = String(form.get("pageId") ?? "");

  try {
    if (intent === "create") {
      const row = await createPage(
        db,
        { titleAr: String(form.get("titleAr") ?? ""), titleEn: String(form.get("titleEn") ?? ""), slug: String(form.get("slug") ?? "") || undefined },
        actor
      );
      return { ok: true as const, createdId: row.id };
    }
    if (intent === "duplicate") { await duplicatePage(db, pageId, actor); return { ok: true as const }; }
    if (intent === "unpublish") { await setPageStatus(db, pageId, "draft", actor); return { ok: true as const }; }
    if (intent === "archive") { await setPageStatus(db, pageId, "archived", actor); return { ok: true as const }; }
    if (intent === "unarchive") { await setPageStatus(db, pageId, "draft", actor); return { ok: true as const }; }
    if (intent === "delete") { await deletePage(db, pageId, actor); return { ok: true as const }; }
    if (intent === "move-up") { await movePage(db, pageId, "up", actor); return { ok: true as const }; }
    if (intent === "move-down") { await movePage(db, pageId, "down", actor); return { ok: true as const }; }
    return { error: "generic" as const };
  } catch (err) {
    if (err instanceof CmsValidationError) return { error: "validation" as const, issues: err.issues.map((i) => `${i.path}: ${i.message}`) };
    if (err instanceof CmsReferenceError) return { error: "reference" as const, issues: [err.message] };
    throw err;
  }
}

const STATUS_TONE = { published: "success", draft: "warning", archived: "neutral" } as const;
const STATUS_KEY = { published: "content.statusPublished", draft: "content.statusDraft", archived: "content.statusArchived" } as const;

function RowForm({ action, pageId, children, title }: { action: string; pageId: string; children: React.ReactNode; title?: string }) {
  return (
    <Form method="post" className="inline">
      <input type="hidden" name="_action" value={action} />
      <input type="hidden" name="pageId" value={pageId} />
      <button type="submit" title={title} className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
        {children}
      </button>
    </Form>
  );
}

export default function AdminCmsPages({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = (root?.locale ?? "ar") as "ar" | "en";
  const actionData = useActionData<typeof action>();
  const L = (k: string) => cmsLabel(k, locale);
  const tt = (k: string) => t(locale, k);

  if (loaderData.denied) {
    return <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{L("cms.ui.pages")}</h1>
        <div className="flex gap-2">
          <Link to="/admin/cms/templates" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">{L("cms.ui.templates")}</Link>
          <Link to="/admin/cms/menus" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">{L("cms.ui.menus")}</Link>
          <Link to="/admin/cms/forms" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">{L("cms.ui.forms")}</Link>
          <Link to="/admin/appearance" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">{L("cms.ui.appearance")}</Link>
        </div>
      </div>

      {actionData && "error" in actionData && actionData.error === "denied" && <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>}
      {actionData && "issues" in actionData && actionData.issues && (
        <Alert kind="error">{actionData.issues.join(" — ")}</Alert>
      )}

      <Card>
        <CardHeader title={L("cms.ui.newPage")} />
        <CardBody>
          <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="_action" value="create" />
            <Input label={L("cms.ui.titleAr")} name="titleAr" dir="rtl" required />
            <Input label={L("cms.ui.titleEn")} name="titleEn" dir="ltr" />
            <Input label={L("cms.ui.slug")} name="slug" dir="ltr" hint={L("cms.ui.homeSlugNote")} pattern="[a-z0-9-]*" />
            <SubmitButton>{L("cms.ui.newPage")}</SubmitButton>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          {loaderData.pages.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{L("cms.ui.noPages")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {loaderData.pages.map((page) => {
                const title = locale === "ar" ? page.titleAr || page.titleEn : page.titleEn || page.titleAr;
                return (
                  <li key={page.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <Badge tone={STATUS_TONE[page.status as keyof typeof STATUS_TONE] ?? "neutral"}>{tt(STATUS_KEY[page.status as keyof typeof STATUS_KEY] ?? "content.statusDraft")}</Badge>
                    <Link to={`/admin/cms/pages/${page.id}`} className="text-sm font-semibold text-slate-900 hover:underline">
                      {title}
                    </Link>
                    <span className="text-xs text-slate-500" dir="ltr">/{page.slug === "home" ? "" : `p/${page.slug}`}</span>
                    <span className="ms-auto flex flex-wrap items-center gap-1.5">
                      {page.status === "published" && (
                        <Link to={page.slug === "home" ? "/" : `/p/${page.slug}`} className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                          {L("cms.ui.viewPage")}
                        </Link>
                      )}
                      <RowForm action="move-up" pageId={page.id} title={L("cms.ui.moveUp")}>↑</RowForm>
                      <RowForm action="move-down" pageId={page.id} title={L("cms.ui.moveDown")}>↓</RowForm>
                      <RowForm action="duplicate" pageId={page.id}>{L("cms.ui.duplicate")}</RowForm>
                      {page.status === "published" && <RowForm action="unpublish" pageId={page.id}>{L("cms.ui.unpublish")}</RowForm>}
                      {page.status !== "archived" ? (
                        <RowForm action="archive" pageId={page.id}>{L("cms.ui.archive")}</RowForm>
                      ) : (
                        <RowForm action="unarchive" pageId={page.id}>{L("cms.ui.unarchive")}</RowForm>
                      )}
                      {page.status !== "published" && <RowForm action="delete" pageId={page.id}>{L("cms.ui.delete")}</RowForm>}
                      <span className="hidden text-xs text-slate-500 lg:inline">{formatDateShort(locale, page.updatedAt)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
