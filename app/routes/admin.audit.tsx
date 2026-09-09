import type { Route } from "./+types/admin.audit";
import { Form, Link, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import { auditEntityTypes, listAuditLogs } from "~server/audit/query.server";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, formatDate, type Locale } from "~/lib/i18n";

const inputCls = "rounded-lg border border-line px-3 py-2 text-sm";
const selectCls = "h-[42px] rounded-lg border border-line bg-white px-3 text-sm";

/** Read-only audit viewer (P7 §13) — no mutation path exists for audit rows. */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "audit.read"))) throw new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const entityType = url.searchParams.get("entityType") ?? "";
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const [result, types] = await Promise.all([listAuditLogs(db, { q, entityType: entityType || null, page }), auditEntityTypes(db)]);
  return { audit: result, types, q, entityType };
}

export default function AdminAudit({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { audit } = loaderData;
  const totalPages = Math.max(1, Math.ceil(audit.total / audit.pageSize));
  const withPage = (p: number) => {
    const sp = new URLSearchParams();
    if (loaderData.q) sp.set("q", loaderData.q);
    if (loaderData.entityType) sp.set("entityType", loaderData.entityType);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `?${s}` : ".";
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">{t(locale, "auditAdmin.title")}</h1>
      <Alert kind="info">{t(locale, "auditAdmin.immutableNote")}</Alert>

      <Card>
        <CardBody className="space-y-3">
          <Form method="get" className="flex flex-wrap items-center gap-2">
            <input name="q" className={inputCls} defaultValue={loaderData.q} placeholder={t(locale, "auditAdmin.searchPh")} dir="ltr" data-testid="audit-search" />
            <select name="entityType" className={selectCls} defaultValue={loaderData.entityType} aria-label={t(locale, "auditAdmin.filterByEntity")} data-testid="audit-entity-filter">
              <option value="">{t(locale, "auditAdmin.allEntities")}</option>
              {loaderData.types.map((et2) => (
                <option key={et2} value={et2}>{et2}</option>
              ))}
            </select>
            <SubmitButton variant="secondary">{t(locale, "auditAdmin.filter")}</SubmitButton>
          </Form>

          <p className="text-xs text-ink-muted" data-testid="audit-total">{t(locale, "auditAdmin.totalCount", { n: audit.total })}</p>

          {audit.rows.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "auditAdmin.empty")}</p>}

          {audit.rows.map((a) => (
            <div key={a.id} className="border-b border-line py-2.5 text-sm last:border-0" data-testid="audit-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-ink" dir="ltr">{a.action}</span>
                <span className="text-xs text-ink-muted">{formatDate(locale, a.createdAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span dir="ltr">{a.actorEmail ?? a.actorUserId?.slice(0, 8) ?? t(locale, "auditAdmin.system")}</span>
                {a.actorRole && <span className="font-mono" dir="ltr">[{a.actorRole}]</span>}
                <span className="font-mono" dir="ltr">{a.entityType}{a.entityId ? `#${a.entityId.slice(0, 8)}` : ""}</span>
                {(a.before || a.after) && (
                  <details className="w-full" data-testid={`audit-details-${a.id}`}>
                    <summary className="cursor-pointer text-ink hover:underline">{t(locale, "auditAdmin.colDetails")}</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-ink-muted" dir="ltr">
{a.before ? `before: ${JSON.stringify(a.before, null, 1)}\n` : ""}{a.after ? `after: ${JSON.stringify(a.after, null, 1)}` : ""}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm">
              {audit.page > 1 ? (
                <Link className="text-ink hover:underline" to={withPage(audit.page - 1)} data-testid="audit-prev">{t(locale, "auditAdmin.prevPage")}</Link>
              ) : <span />}
              <span className="text-xs text-ink-muted">{t(locale, "auditAdmin.pageOf", { page: audit.page, total: totalPages })}</span>
              {audit.page < totalPages ? (
                <Link className="text-ink hover:underline" to={withPage(audit.page + 1)} data-testid="audit-next">{t(locale, "auditAdmin.nextPage")}</Link>
              ) : <span />}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
