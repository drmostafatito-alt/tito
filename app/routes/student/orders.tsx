import type { Route } from "./+types/orders";
import { Link, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { ordersForStudent, subscriptionsForStudent } from "~server/commerce/service.server";
import { formatMoney } from "~server/commerce/money";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { t, formatDate, type Locale } from "~/lib/i18n";

/**
 * My orders + subscriptions (FEATURE-SPEC §7 student views). The loader sweeps
 * expired orders/subscriptions first (sweep-on-touch, like exam attempts), so
 * every state rendered here is the server-truthful one. Expiring-soon (≤14d)
 * subscriptions carry a visible warning.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const settings = await getSettings(db);
  const nowMs = Date.now();
  const [orderViews, subs] = await Promise.all([
    ordersForStudent(db, auth.user.id, settings.payments.orderTtlMinutes),
    subscriptionsForStudent(db, auth.user.id),
  ]);
  return {
    nowMs,
    orders: orderViews.map((v) => ({
      id: v.order.id,
      orderNumber: v.order.orderNumber,
      status: v.order.status,
      currency: v.order.currency,
      totalMinor: v.order.totalMinor,
      createdAt: v.order.createdAt,
      items: v.items.map((i) => ({ titleAr: i.titleSnapshotAr, titleEn: i.titleSnapshotEn })),
      latestPaymentStatus: v.payments[0]?.status ?? null,
    })),
    subscriptions: subs.map((s) => {
      const snap = (s.planSnapshot ?? {}) as { titleAr?: string; titleEn?: string; currency?: string; amountMinor?: number };
      return {
        id: s.id,
        titleAr: snap.titleAr ?? "",
        titleEn: snap.titleEn ?? "",
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelledAt: s.cancelledAt,
        currency: snap.currency ?? "EGP",
        amountMinor: snap.amountMinor ?? 0,
      };
    }),
  };
}

const ORDER_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "brand"> = {
  pending: "warning",
  awaiting_payment: "warning",
  paid: "success",
  cancelled: "neutral",
  expired: "neutral",
  failed: "danger",
  refunded: "danger",
  partially_refunded: "danger",
};

const SUB_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  pending: "warning",
  paused: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

export default function OrdersPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { orders, subscriptions, nowMs } = loaderData;
  const DAY = 86_400_000;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-ink">{t(locale, "commerce.myOrders")}</h1>
        <Link
          to="/activate"
          className="inline-flex min-h-11 items-center rounded-lg border border-brand-300 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          data-testid="activate-link"
        >
          {t(locale, "commerce.activateTitle")}
        </Link>
      </div>

      {subscriptions.length > 0 && (
        <section className="space-y-3" aria-labelledby="subs-heading" data-testid="subscriptions-section">
          <h2 id="subs-heading" className="text-sm font-semibold text-ink-muted">
            {t(locale, "commerce.mySubscriptions")}
          </h2>
          {subscriptions.map((s) => {
            const title = locale === "ar" ? s.titleAr : s.titleEn;
            const expiringSoon =
              (s.status === "active" || s.status === "cancelled") &&
              s.currentPeriodEnd !== null &&
              s.currentPeriodEnd - nowMs <= 14 * DAY &&
              s.currentPeriodEnd > nowMs;
            return (
              <Card key={s.id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <p className="font-semibold">{title}</p>
                    <p className="text-xs text-ink-muted">
                      {s.currentPeriodEnd !== null
                        ? t(locale, "commerce.accessUntil").replace("{date}", formatDate(locale, s.currentPeriodEnd))
                        : t(locale, "commerce.noEnd")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {expiringSoon && <Badge tone="warning">{t(locale, "commerce.expiringSoon")}</Badge>}
                    <Badge tone={SUB_TONE[s.status] ?? "neutral"}>{t(locale, `commerce.sub_${s.status}` as never)}</Badge>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </section>
      )}

      <section className="space-y-3" aria-labelledby="orders-heading">
        <h2 id="orders-heading" className="text-sm font-semibold text-ink-muted">
          {t(locale, "commerce.ordersHistory")}
        </h2>
        {orders.length === 0 && (
          <Card>
            <CardBody className="text-sm text-ink-muted" data-testid="orders-empty">
              {t(locale, "commerce.noOrders")}
            </CardBody>
          </Card>
        )}
        {orders.map((o) => (
          <Link key={o.id} to={`/orders/${o.orderNumber}`} className="block">
            <Card className="transition hover:border-brand-300">
              <CardBody className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <p className="font-semibold">
                    {(locale === "ar" ? o.items[0]?.titleAr : o.items[0]?.titleEn) || o.orderNumber}
                  </p>
                  <p className="text-xs text-ink-muted" dir="ltr">
                    {o.orderNumber} · {formatDate(locale, o.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold" dir="ltr" data-testid="order-total">
                    {formatMoney(o.totalMinor, o.currency)}
                  </span>
                  <Badge tone={ORDER_TONE[o.status] ?? "neutral"}>
                    {t(locale, `commerce.order_${o.status}` as never)}
                  </Badge>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
