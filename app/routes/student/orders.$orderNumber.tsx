import type { Route } from "./+types/orders.$orderNumber";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import {
  CommerceStateError,
  CommerceValidationError,
  cancelOrder,
  confirmManualPayment,
  orderDetailForStudent,
} from "~server/commerce/service.server";
import { checkRateLimit, clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { formatMoney } from "~server/commerce/money";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Order detail = the student's receipt + manual-rail payment desk. Shows the
 * frozen instructions snapshot (reference = order number), the confirmation
 * form (transfer reference + note), and the full state timeline. Ownership is
 * enforced server-side: another student's order number is 404-shaped (IDOR).
 * Paying here grants NOTHING — access only flips after admin verification.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const view = await orderDetailForStudent(db, String(params.orderNumber ?? ""), auth.user.id);
  if (!view) throw new Response("Not found", { status: 404 });
  const { order, items, payments } = view;
  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      totalMinor: order.totalMinor,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
    items: items.map((i) => ({
      titleAr: i.titleSnapshotAr,
      titleEn: i.titleSnapshotEn,
      unitPriceMinor: i.unitPriceMinor,
      grantsCount: i.spec.grants.length,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      provider: p.provider,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
      createdAt: p.createdAt,
      reviewedAt: p.reviewedAt,
      paidAt: p.paidAt,
      instructions: (p.instructions ?? null) as { reference?: string; instructionsAr?: string; instructionsEn?: string } | null,
      evidence: ((p.metadata ?? {}) as { evidence?: { transferReference?: string; note?: string | null; confirmedAt?: number } }).evidence ?? null,
      rejection: ((p.metadata ?? {}) as { rejection?: { reason?: string; at?: number } }).rejection ?? null,
    })),
    viewerRoleRank: auth.user.rank,
    requestUrl: request.url,
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const settings = await getSettings(db);

  const view = await orderDetailForStudent(db, String(params.orderNumber ?? ""), auth.user.id);
  if (!view) throw new Response("Not found", { status: 404 });

  if (intent === "confirm_payment") {
    const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
    const rl = await checkRateLimit(db, "payment_confirm", `${auth.user.id}:${ipHash}`, 10, 3_600_000);
    if (!rl.ok) return { error: "rate_limited" as const };
    try {
      await confirmManualPayment(db, {
        studentId: auth.user.id,
        orderId: view.order.id,
        transferReference: String(form.get("transferReference") ?? ""),
        note: String(form.get("note") ?? "") || null,
        paymentsSettings: settings.payments,
      });
      return { ok: true as const };
    } catch (err) {
      if (err instanceof CommerceStateError) return { error: err.reason as "order_not_pending" };
      if (err instanceof CommerceValidationError) return { error: err.reason as "transfer_reference_required" };
      return { error: "generic" as const };
    }
  }
  if (intent === "cancel_order") {
    try {
      await cancelOrder(db, { studentId: auth.user.id, orderId: view.order.id });
      return { ok: true as const };
    } catch (err) {
      if (err instanceof CommerceStateError) return { error: err.reason as "order_not_pending" };
      return { error: "generic" as const };
    }
  }
  return { error: "generic" as const };
}

const PAY_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  pending: "warning",
  under_review: "warning",
  paid: "success",
  failed: "danger",
  cancelled: "neutral",
  expired: "neutral",
  refunded: "danger",
  partially_refunded: "danger",
};

export default function OrderDetailPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { order, items, payments } = loaderData;
  const latest = payments[0] ?? null;
  const canConfirm = order.status === "pending" && latest !== null && (latest.status === "pending" || latest.status === "failed");

  return (
    <div className="space-y-4">
      <nav className="text-xs text-slate-500">
        <Link to="/orders" className="hover:text-brand-600">{t(locale, "commerce.myOrders")}</Link>
        <span aria-hidden="true"> › </span>
        <span dir="ltr">{order.orderNumber}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t(locale, "commerce.orderTitle")}</h1>
        <Badge
          tone={
            order.status === "paid" ? "success" : order.status === "pending" ? "warning" :
            order.status === "refunded" || order.status === "failed" ? "danger" : "neutral"
          }
        >
          {t(locale, `commerce.order_${order.status}` as never)}
        </Badge>
      </div>

      {actionData && "error" in actionData && (
        <Alert kind="error">{et(locale, "commerce", String(actionData.error))}</Alert>
      )}
      {actionData && "ok" in actionData && (
        <Alert kind="success">{t(locale, "commerce.actionSaved")}</Alert>
      )}

      <Card>
        <CardHeader title={t(locale, "commerce.items")} />
        <CardBody className="space-y-2 text-sm">
          {items.map((i, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2">
              <span>{locale === "ar" ? i.titleAr : i.titleEn}</span>
              <span dir="ltr">{formatMoney(i.unitPriceMinor, order.currency)}</span>
            </div>
          ))}
          <div className="border-t border-slate-100 pt-2">
            {order.discountMinor > 0 && (
              <div className="flex items-center justify-between text-xs text-emerald-700">
                <span>{t(locale, "commerce.discount")}</span>
                <span dir="ltr">−{formatMoney(order.discountMinor, order.currency)}</span>
              </div>
            )}
            <div className="flex items-center justify-between font-bold" data-testid="order-total-row">
              <span>{t(locale, "commerce.totalDue")}</span>
              <span dir="ltr">{formatMoney(order.totalMinor, order.currency)}</span>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {t(locale, "common.createdAt")}: {formatDate(locale, order.createdAt)}
          </p>
        </CardBody>
      </Card>

      {latest && latest.instructions && order.status === "pending" && (
        <Card>
          <CardHeader title={t(locale, "commerce.paymentInstructions")} />
          <CardBody className="space-y-3 text-sm">
            <p className="text-slate-600">
              {t(locale, "commerce.referenceLabel")}:{" "}
              <strong dir="ltr" data-testid="payment-reference">{latest.instructions.reference ?? order.orderNumber}</strong>
            </p>
            {(locale === "ar" ? latest.instructions.instructionsAr : latest.instructions.instructionsEn) ? (
              <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-slate-700" data-testid="instructions-text">
                {locale === "ar" ? latest.instructions.instructionsAr : latest.instructions.instructionsEn}
              </p>
            ) : (
              <p className="text-xs text-slate-500">{t(locale, "commerce.instructionsNotConfigured")}</p>
            )}

            {latest.status === "under_review" ? (
              <Alert kind="info">{t(locale, "commerce.underReviewNote")}</Alert>
            ) : latest.status === "failed" && latest.rejection ? (
              <Alert kind="error">
                {t(locale, "commerce.rejectedNote")}
                {latest.rejection.reason ? ` — ${latest.rejection.reason}` : ""}
              </Alert>
            ) : null}

            {canConfirm && (
              <Form method="post" className="space-y-3 pt-1">
                <input type="hidden" name="_action" value="confirm_payment" />
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "commerce.transferReference")}</span>
                  <input
                    name="transferReference"
                    required
                    dir="ltr"
                    maxLength={200}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder={t(locale, "commerce.transferReferenceHint")}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "commerce.noteOptional")}</span>
                  <input name="note" dir="auto" maxLength={500} className="rounded-lg border border-slate-300 px-3 py-2" />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <SubmitButton name="_action" value="confirm_payment">{t(locale, "commerce.confirmPayment")}</SubmitButton>
                  <SubmitButton variant="secondary" name="_action" value="cancel_order">{t(locale, "commerce.cancelOrder")}</SubmitButton>
                </div>
                <p className="text-xs text-slate-500">{t(locale, "commerce.confirmDisclaimer")}</p>
              </Form>
            )}
          </CardBody>
        </Card>
      )}

      {order.status === "paid" && (
        <Alert kind="success">{t(locale, "commerce.paidNote")}</Alert>
      )}

      <Card>
        <CardHeader title={t(locale, "commerce.paymentTimeline")} />
        <CardBody className="space-y-2 text-sm">
          {payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="payment-row">
              <span className="text-xs text-slate-500" dir="ltr">
                {p.provider} · {formatDate(locale, p.createdAt)}
              </span>
              <span className="flex items-center gap-2">
                <span dir="ltr" className="text-xs">{formatMoney(p.amountMinor, p.currency)}</span>
                <Badge tone={PAY_TONE[p.status] ?? "neutral"}>{t(locale, `commerce.pay_${p.status}` as never)}</Badge>
              </span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
