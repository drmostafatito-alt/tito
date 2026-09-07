import type { Route } from "./+types/admin.commerce.batches.$id";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  CommerceReferenceError,
  CommerceStateError,
  activationBatchDetail,
  canCommerce,
  setActivationCodeStatus,
} from "~server/commerce/service.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Activation-code batch detail: every code's prefix/status/usage (plaintext is
 * shown once at generation and never stored — this is by design), plus
 * disable/enable/revoke per code and the redemption history (who, when, which
 * entitlement). Redemption itself is atomic in the service layer.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const perms = {
    read: await canCommerce(db, auth, "commerce.read"),
    codes: await canCommerce(db, auth, "commerce.codes"),
  };
  if (!perms.read) throw new Response("Forbidden", { status: 403 });
  const detail = await activationBatchDetail(db, String(params.id ?? ""));
  return {
    perms,
    batch: {
      id: detail.batch.id,
      name: detail.batch.name,
      note: detail.batch.note,
      count: detail.batch.count,
      createdAt: detail.batch.createdAt,
      spec: detail.batch.spec as { grants?: { resourceType: string; resourceId: string }[]; durationDays?: number | null },
    },
    codes: detail.codes,
    redemptions: detail.redemptions,
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  if (intent !== "code_status") return { error: "generic" as const };
  if (!(await canCommerce(db, auth, "commerce.codes"))) return { error: "denied" as const };
  const actor = { userId: auth.user.id, role: auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") };
  try {
    await setActivationCodeStatus(
      db,
      String(form.get("codeId") ?? ""),
      String(form.get("status") ?? "") as "active" | "disabled" | "revoked",
      actor
    );
    return { ok: true as const };
  } catch (err) {
    if (err instanceof CommerceStateError) return { error: err.reason as "validation" };
    if (err instanceof CommerceReferenceError) return { error: "not_found" as const };
    return { error: "generic" as const };
  }
}

const CODE_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  disabled: "warning",
  revoked: "danger",
  exhausted: "neutral",
};

export default function AdminBatchPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { batch, codes, redemptions, perms } = loaderData;

  return (
    <div className="space-y-4" key={`batch-${batch?.id}`}>
      <nav className="text-xs text-slate-500">
        <Link to="/admin/commerce?tab=codes" className="hover:text-brand-600">{t(locale, "commerceAdmin.title")}</Link>
        <span aria-hidden="true"> › </span>
        <span>{batch.name}</span>
      </nav>
      <h1 className="text-xl font-bold">{batch.name}</h1>

      {actionData && "error" in actionData && (
        <Alert kind="error">{et(locale, "commerceAdmin", String(actionData.error))}</Alert>
      )}
      {actionData && "ok" in actionData && <Alert kind="success">{t(locale, "commerceAdmin.saved")}</Alert>}

      <Card>
        <CardHeader title={t(locale, "commerceAdmin.batchInfo")} />
        <CardBody className="space-y-1 text-sm">
          <p className="text-xs text-slate-500">
            {formatDate(locale, batch.createdAt)} · {t(locale, "commerceAdmin.count")}: {batch.count}
            {batch.note ? ` · ${batch.note}` : ""}
          </p>
          <p className="text-xs text-slate-500" data-testid="batch-spec">
            {t(locale, "commerceAdmin.frozenSpec")}:{" "}
            {(batch.spec.grants ?? []).map((g) => `${g.resourceType}:${g.resourceId.slice(0, 8)}`).join(", ")}
            {batch.spec.durationDays ? ` · ${batch.spec.durationDays}d` : ` · ${t(locale, "commerceAdmin.permanent")}`}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "commerceAdmin.codesList")} />
        <CardBody>
          <p className="mb-2 text-xs text-slate-400">{t(locale, "commerceAdmin.codesHashedNote")}</p>
          <div className="space-y-2">
            {codes.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0" data-testid="code-row">
                <div>
                  <span className="font-mono font-semibold" dir="ltr">{c.prefix}••••</span>
                  <span className="ms-2 text-xs text-slate-500" dir="ltr">
                    {c.useCount}/{c.maxUses}
                    {c.expiresAt ? ` · ${t(locale, "commerceAdmin.until")} ${formatDate(locale, c.expiresAt)}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={CODE_TONE[c.status] ?? "neutral"}>{t(locale, `commerceAdmin.code_${c.status}` as never)}</Badge>
                  {perms.codes && c.status !== "revoked" && (
                    <>
                      {c.status === "active" && (
                        <Form method="post" className="inline">
                          <input type="hidden" name="_action" value="code_status" />
                          <input type="hidden" name="codeId" value={c.id} />
                          <input type="hidden" name="status" value="disabled" />
                          <SubmitButton variant="secondary" name="_action" value="code_status">{t(locale, "commerceAdmin.disable")}</SubmitButton>
                        </Form>
                      )}
                      {c.status === "disabled" && (
                        <Form method="post" className="inline">
                          <input type="hidden" name="_action" value="code_status" />
                          <input type="hidden" name="codeId" value={c.id} />
                          <input type="hidden" name="status" value="active" />
                          <SubmitButton variant="secondary" name="_action" value="code_status">{t(locale, "commerceAdmin.enable")}</SubmitButton>
                        </Form>
                      )}
                      {(c.status === "active" || c.status === "disabled") && (
                        <Form method="post" className="inline">
                          <input type="hidden" name="_action" value="code_status" />
                          <input type="hidden" name="codeId" value={c.id} />
                          <input type="hidden" name="status" value="revoked" />
                          <SubmitButton variant="secondary" name="_action" value="code_status">{t(locale, "commerceAdmin.revoke")}</SubmitButton>
                        </Form>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "commerceAdmin.redemptions")} />
        <CardBody className="space-y-2">
          {redemptions.length === 0 && <p className="text-sm text-slate-500">{t(locale, "commerceAdmin.noRedemptions")}</p>}
          {redemptions.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0" data-testid="redemption-row">
              <span dir="ltr" className="text-xs text-slate-600">{r.studentEmail ?? r.id.slice(0, 8)}</span>
              <span className="text-xs text-slate-400">{formatDate(locale, r.createdAt)}</span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
