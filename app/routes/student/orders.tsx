import type { Route } from "./+types/orders";
import { Link, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { ordersForStudent, subscriptionsForStudent } from "~server/commerce/service.server";
import { formatMoney } from "~server/commerce/money";
import { Badge } from "~/components/ui/Badge";
import { ArrowGlyph, EmptyNote } from "~/components/tito/ui";
import { WorkHead, WorkSection } from "~/components/tito/page";
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

/**
 * Money and access, stated as a ledger. Subscriptions first (what you HAVE),
 * then the order history (what you PAID). Both are rows on rules — nothing
 * here is an offer, so nothing here is a card.
 */
export default function OrdersPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const { orders, subscriptions, nowMs } = loaderData;
  const DAY = 86_400_000;

  return (
    <div className="flex flex-col gap-10">
      <WorkHead
        eyebrow={t(locale, "commerce.mySubscriptions")}
        title={t(locale, "commerce.myOrders")}
        actions={
          <Link
            to="/activate"
            className="inline-flex min-h-11 items-center gap-2 rounded-pub-md border border-pub-ink px-4 text-pub-sm font-bold text-pub-ink transition-colors hover:bg-pub-ink hover:text-pub-on-navy"
            data-testid="activate-link"
          >
            {t(locale, "commerce.activateTitle")}
          </Link>
        }
      />

      {subscriptions.length > 0 && (
        <WorkSection title={t(locale, "commerce.mySubscriptions")} testId="subscriptions-section">
          <ul className="tito-rows">
            {subscriptions.map((s) => {
              const title = ar ? s.titleAr : s.titleEn;
              const expiringSoon =
                (s.status === "active" || s.status === "cancelled") &&
                s.currentPeriodEnd !== null &&
                s.currentPeriodEnd - nowMs <= 14 * DAY &&
                s.currentPeriodEnd > nowMs;
              return (
                <li key={s.id} className="tito-row grid-cols-[minmax(0,1fr)_auto] px-1">
                  <div className="min-w-0">
                    <p className="font-display text-pub-base font-bold text-pub-ink">{title}</p>
                    <p className="mt-1 text-pub-xs text-pub-muted" data-numeral>
                      {s.currentPeriodEnd !== null
                        ? t(locale, "commerce.accessUntil").replace("{date}", formatDate(locale, s.currentPeriodEnd))
                        : t(locale, "commerce.noEnd")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 self-center">
                    {expiringSoon && <Badge tone="warning">{t(locale, "commerce.expiringSoon")}</Badge>}
                    <Badge tone={SUB_TONE[s.status] ?? "neutral"}>{t(locale, `commerce.sub_${s.status}` as never)}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </WorkSection>
      )}

      <WorkSection title={t(locale, "commerce.ordersHistory")}>
        {orders.length === 0 ? (
          <span data-testid="orders-empty">
            <EmptyNote title={t(locale, "commerce.noOrders")} />
          </span>
        ) : (
          <ul className="tito-rows">
            {orders.map((o) => (
              <li key={o.id} className="tito-row grid-cols-[minmax(0,1fr)_auto] px-1">
                <div className="min-w-0">
                  <Link to={`/orders/${o.orderNumber}`} className="font-display text-pub-base font-bold text-pub-ink after:absolute after:inset-0">
                    {(ar ? o.items[0]?.titleAr : o.items[0]?.titleEn) || o.orderNumber}
                  </Link>
                  <p className="mt-1 text-pub-xs text-pub-muted" dir="ltr" data-numeral>
                    {o.orderNumber} · {formatDate(locale, o.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 self-center">
                  <span className="font-display text-pub-base font-extrabold text-pub-ink" dir="ltr" data-numeral data-testid="order-total">
                    {formatMoney(o.totalMinor, o.currency)}
                  </span>
                  <Badge tone={ORDER_TONE[o.status] ?? "neutral"}>{t(locale, `commerce.order_${o.status}` as never)}</Badge>
                  <ArrowGlyph className="text-pub-ink" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </WorkSection>
    </div>
  );
}
