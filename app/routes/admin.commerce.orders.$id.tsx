import type { Route } from "./+types/admin.commerce.orders.$id";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  CommerceReferenceError,
  CommerceStateError,
  CommerceValidationError,
  approveManualPayment,
  canCommerce,
  orderDetailForAdmin,
  refundPayment,
  rejectManualPayment,
} from "~server/commerce/service.server";
import { getSettings } from "~server/settings/service.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { formatMoney } from "~server/commerce/money";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Order detail (admin) — the full purchase record: items with their FROZEN
 * entitlement specs, every payment attempt (1:N per PAYMENTS.md §1), evidence,
 * and the verification actions. Approve = the manual rail's verification step:
 * amount must equal the server-computed total, fulfillment is claim-based
 * (idempotent — double approval never double-grants), everything audited.
 * Refund never deletes history: state transitions + entitlement revocation.
 */

const inputCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  pending: "warning", awaiting_payment: "warning", under_review: "warning", paid: "success",
  cancelled: "neutral", expired: "neutral", failed: "danger", refunded: "danger", partially_refunded: "danger",
};

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const id = String(params.id ?? "");
  const perms = {
    read: await canCommerce(db, auth, "commerce.read"),
    payments: await canCommerce(db, auth, "commerce.payments"),
    refunds: await canCommerce(db, auth, "commerce.refunds"),
  };
  if (!perms.read) throw new Response("Forbidden", { status: 403 });
  const view = await orderDetailForAdmin(db, id);
  if (!view) throw new Response("Not found", { status: 404 });
  const settings = await getSettings(db);
  return {
    perms,
    refundWindowDays: settings.payments.refundWindowDays,
    order: {
      id: view.order.id,
      orderNumber: view.order.orderNumber,
      status: view.order.status,
      currency: view.order.currency,
      subtotalMinor: view.order.subtotalMinor,
      discountMinor: view.order.discountMinor,
      totalMinor: view.order.totalMinor,
      source: view.order.source,
      studentEmail: view.studentEmail ?? view.order.studentId,
      createdAt: view.order.createdAt,
      updatedAt: view.order.updatedAt,
    },
    items: view.items.map((i) => ({
      id: i.id,
      titleAr: i.titleSnapshotAr,
      titleEn: i.titleSnapshotEn,
      unitPriceMinor: i.unitPriceMinor,
      spec: {
        grants: i.spec.grants,
        durationDays: i.spec.durationDays ?? null,
        fixedExpiresAt: i.spec.fixedExpiresAt ?? null,
        recurring: i.spec.recurring ?? false,
      },
    })),
    payments: view.payments.map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
      reference: p.reference,
      createdAt: p.createdAt,
      reviewedAt: p.reviewedAt,
      paidAt: p.paidAt,
      evidence: ((p.metadata ?? {}) as { evidence?: { transferReference?: string; note?: string | null; confirmedAt?: number } }).evidence ?? null,
      rejection: ((p.metadata ?? {}) as { rejection?: { reason?: string; at?: number } }).rejection ?? null,
      refund: ((p.metadata ?? {}) as { refund?: { reason?: string; at?: number; by?: string } }).refund ?? null,
      fulfilledVia: ((p.metadata ?? {}) as { fulfilledVia?: string }).fulfilledVia ?? null,
    })),
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const actor = { userId: auth.user.id, role: auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") };
  const str = (k: string) => String(form.get(k) ?? "").trim();

  try {
    if (intent === "approve") {
      if (!(await canCommerce(db, auth, "commerce.payments"))) return { error: "denied" as const };
      const result = await approveManualPayment(db, {
        paymentId: str("paymentId"),
        receivedAmountMinor: Number(str("receivedAmount") || -1),
        actor,
      });
      return { ok: true as const, alreadyProcessed: result.alreadyProcessed, granted: result.grantedCount };
    }
    if (intent === "reject") {
      if (!(await canCommerce(db, auth, "commerce.payments"))) return { error: "denied" as const };
      await rejectManualPayment(db, { paymentId: str("paymentId"), reason: str("reason"), actor });
      return { ok: true as const };
    }
    if (intent === "refund") {
      if (!(await canCommerce(db, auth, "commerce.refunds"))) return { error: "denied" as const };
      const settings = await getSettings(db);
      await refundPayment(db, {
        paymentId: str("paymentId"),
        reason: str("reason"),
        actor,
        refundWindowDays: settings.payments.refundWindowDays,
      });
      return { ok: true as const, refunded: true };
    }
    return { error: "generic" as const };
  } catch (err) {
    if (err instanceof CommerceValidationError || err instanceof CommerceStateError) return { error: err.reason as "validation" };
    if (err instanceof CommerceReferenceError) return { error: "not_found" as const };
    return { error: "generic" as const };
  }
}

export default function AdminOrderPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { order, items, payments, perms } = loaderData;

  return (
    <div className="space-y-4">
      <nav className="text-xs text-slate-500">
        <Link to="/admin/commerce?tab=orders" className="hover:text-brand-600">{t(locale, "commerceAdmin.title")}</Link>
        <span aria-hidden="true"> › </span>
        <span dir="ltr">{order.orderNumber}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-lg font-bold" dir="ltr">{order.orderNumber}</h1>
        <Badge tone={TONE[order.status] ?? "neutral"}>{t(locale, `commerce.order_${order.status}` as never)}</Badge>
      </div>

      {actionData && "error" in actionData && (
        <Alert kind="error">{et(locale, "commerceAdmin", String(actionData.error))}</Alert>
      )}
      {actionData && "ok" in actionData && (
        <Alert kind="success">
          {"refunded" in actionData && actionData.refunded
            ? t(locale, "commerceAdmin.refundDone")
            : "alreadyProcessed" in actionData && actionData.alreadyProcessed
              ? t(locale, "commerceAdmin.alreadyFulfilled")
              : t(locale, "commerceAdmin.approveDone").replace("{n}", String("granted" in actionData ? actionData.granted : 0))}
        </Alert>
      )}

      <Card>
        <CardHeader title={t(locale, "commerceAdmin.orderSummary")} />
        <CardBody className="space-y-2 text-sm">
          <p>
            <span className="text-slate-500">{t(locale, "commerceAdmin.student")}: </span>
            <span dir="ltr" data-testid="order-student">{order.studentEmail}</span>
          </p>
          {items.map((i) => (
            <div key={i.id} className="border-b border-slate-100 pb-2 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{locale === "ar" ? i.titleAr : i.titleEn}</span>
                <span dir="ltr">{formatMoney(i.unitPriceMinor, order.currency)}</span>
              </div>
              <p className="text-xs text-slate-400" data-testid="frozen-spec">
                {t(locale, "commerceAdmin.frozenSpec")}: {i.spec.grants.map((g) => `${g.resourceType}:${g.resourceId.slice(0, 8)}`).join(", ")}
                {i.spec.recurring ? ` · ${t(locale, "commerce.recurring")}` : ""}
                {i.spec.durationDays ? ` · ${i.spec.durationDays}d` : ""}
              </p>
            </div>
          ))}
          {order.discountMinor > 0 && (
            <div className="flex justify-between text-xs text-emerald-700">
              <span>{t(locale, "commerce.discount")}</span>
              <span dir="ltr">−{formatMoney(order.discountMinor, order.currency)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold">
            <span>{t(locale, "commerce.totalDue")}</span>
            <span dir="ltr" data-testid="order-due">{formatMoney(order.totalMinor, order.currency)}</span>
          </div>
          <p className="text-xs text-slate-400">
            {t(locale, "commerceAdmin.source")}: {order.source} · {formatDate(locale, order.createdAt)}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "commerceAdmin.paymentsTrail")} />
        <CardBody className="space-y-4">
          {payments.map((p) => (
            <div key={p.id} className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid="admin-payment-card">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-xs text-slate-500" dir="ltr">
                  {p.provider} · {formatDate(locale, p.createdAt)}
                  {p.paidAt ? ` · paid ${formatDate(locale, p.paidAt)}` : ""}
                </span>
                <span className="flex items-center gap-2">
                  <span dir="ltr" className="font-bold">{formatMoney(p.amountMinor, p.currency)}</span>
                  <Badge tone={TONE[p.status] ?? "neutral"}>{t(locale, `commerce.pay_${p.status}` as never)}</Badge>
                </span>
              </div>
              {p.evidence && (
                <p className="text-xs text-slate-600" dir="ltr" data-testid="admin-evidence">
                  {t(locale, "commerceAdmin.evidence")}: {p.evidence.transferReference}
                  {p.evidence.note ? ` — ${p.evidence.note}` : ""}
                </p>
              )}
              {p.rejection && (
                <p className="text-xs text-red-600">{t(locale, "commerceAdmin.rejectedNote")}: {p.rejection.reason}</p>
              )}
              {p.refund && (
                <p className="text-xs text-red-600">{t(locale, "commerceAdmin.refundNote")}: {p.refund.reason}</p>
              )}
              {p.status === "under_review" && perms.payments && (
                <div className="flex flex-wrap items-end gap-3 bg-slate-50 p-3">
                  <Form method="post" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="_action" value="approve" />
                    <input type="hidden" name="paymentId" value={p.id} />
                    <label className="grid gap-1 text-xs">
                      <span>{t(locale, "commerceAdmin.receivedAmount")}</span>
                      <input name="receivedAmount" type="number" min={0} step={1} defaultValue={p.amountMinor} required className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" dir="ltr" />
                    </label>
                    <SubmitButton name="_action" value="approve">{t(locale, "commerceAdmin.approve")}</SubmitButton>
                  </Form>
                  <Form method="post" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="_action" value="reject" />
                    <input type="hidden" name="paymentId" value={p.id} />
                    <label className="grid gap-1 text-xs">
                      <span>{t(locale, "commerceAdmin.rejectReason")}</span>
                      <input name="reason" required maxLength={500} className="w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                    </label>
                    <SubmitButton variant="secondary" name="_action" value="reject">{t(locale, "commerceAdmin.reject")}</SubmitButton>
                  </Form>
                </div>
              )}
              {p.status === "paid" && perms.refunds && (
                <Form method="post" className="flex flex-wrap items-end gap-2 bg-red-50 p-3">
                  <input type="hidden" name="_action" value="refund" />
                  <input type="hidden" name="paymentId" value={p.id} />
                  <label className="grid gap-1 text-xs">
                    <span>{t(locale, "commerceAdmin.refundReason")}</span>
                    <input name="reason" required maxLength={500} className={inputCls} />
                  </label>
                  <SubmitButton variant="secondary" name="_action" value="refund">{t(locale, "commerceAdmin.refundFull")}</SubmitButton>
                  <span className="w-full text-xs text-slate-400">{t(locale, "commerceAdmin.refundEffect")}</span>
                </Form>
              )}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
