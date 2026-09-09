import type { Route } from "./+types/admin.cms.templates";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { canCms } from "~server/cms/service.server";
import { deleteTemplate, listTemplates } from "~server/cms/templates.server";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { cmsLabel } from "~/cms/registry";
import type { Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  if (!(await canCms(db, guarded.auth, "cms.read"))) return { denied: true as const, templates: [] };
  return { denied: false as const, templates: await listTemplates(db) };
}

export async function action({ context, request }: Route.ActionArgs) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  if (!(await canCms(db, guarded.auth, "cms.delete"))) return { error: "denied" as const };
  const form = await request.formData();
  if (String(form.get("_action")) !== "delete") return { error: "generic" as const };
  const actor = { userId: guarded.auth.user.id, role: guarded.auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") };
  try {
    await deleteTemplate(db, String(form.get("templateId") ?? ""), actor);
    return { ok: true as const };
  } catch (err) {
    return { error: "validation" as const, issues: [err instanceof Error ? err.message : "failed"] };
  }
}

export default function AdminCmsTemplates({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = (root?.locale ?? "ar") as "ar" | "en";
  const L = (k: string) => cmsLabel(k, locale);
  const actionData = useActionData<typeof action>();
  if (loaderData.denied) return <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/cms" className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">
          <span aria-hidden="true" className="inline-block rtl:rotate-180">←</span> {L("cms.ui.backToPages")}
        </Link>
        <h1 className="text-2xl font-bold text-ink">{L("cms.ui.templates")}</h1>
      </div>
      {actionData && "error" in actionData && actionData.error === "denied" && <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>}
      {actionData && "issues" in actionData && actionData.issues && <Alert kind="error">{actionData.issues.join(" — ")}</Alert>}
      <Card>
        <CardHeader title={L("cms.ui.templates")} description={L("cms.ui.confirmReplace")} />
        <CardBody>
          {loaderData.templates.length === 0 ? (
            <p className="text-sm text-ink-muted">{L("cms.ui.noTemplates")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {loaderData.templates.map((tpl) => {
                const title = locale === "ar" ? tpl.titleAr || tpl.titleEn : tpl.titleEn || tpl.titleAr;
                const desc = locale === "ar" ? tpl.descriptionAr : tpl.descriptionEn;
                return (
                  <li key={tpl.id} className="flex flex-wrap items-center gap-2 py-3">
                    <span className="font-semibold text-ink">{title}</span>
                    {tpl.builtin && <Badge tone="brand">{L("cms.ui.builtin")}</Badge>}
                    {desc && <span className="w-full text-sm text-ink-muted">{desc}</span>}
                    <span className="ms-auto text-xs text-ink-muted" dir="ltr">{tpl.slug}</span>
                    {!tpl.builtin && (
                      <Form method="post">
                        <input type="hidden" name="_action" value="delete" />
                        <input type="hidden" name="templateId" value={tpl.id} />
                        <button type="submit" className="inline-flex min-h-9 items-center rounded-lg border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50">
                          {L("cms.ui.delete")}
                        </button>
                      </Form>
                    )}
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
