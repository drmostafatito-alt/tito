import type { Route } from "./+types/checkout.$productSlug";
import { Form, Link, redirect, useActionData, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import {
  CommerceValidationError,
  createOrder,
  getPricePlan,
  publicProductBySlug,
} from "~server/commerce/service.server";
import { checkRateLimit, clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { formatMoney } from "~server/commerce/money";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, type Locale } from "~/lib/i18n";

/**
 * Checkout (Phase 6, PAYMENTS.md §1): the server re-reads product, plan and
 * price — the client NEVER supplies an amount (anything it sends is ignored).
 * Creating the order drops a pending manual payment carrying the admin-
 * configured instructions snapshot; access is granted ONLY after verification
 * (admin approval / signed webhook) via the entitlement resolver.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  const view = await publicProductBySlug(db, String(params.productSlug ?? ""));
  if (!view) throw new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const planId = url.searchParams.get("plan") ?? "";
  const plan = view.plans.find((p) => p.id === planId) ?? view.plans[0] ?? null;
  if (planId && !(await getPricePlan(db, planId))) throw new Response("Not found", { status: 404 });
  return {
    product: {
      slug: view.product.slug,
      nameAr: view.product.nameAr,
      nameEn: view.product.nameEn,
      kind: view.product.kind,
    },
    plans: view.plans.map((p) => ({
      id: p.id,
      labelAr: p.labelAr,
      labelEn: p.labelEn,
      period: p.period,
      kind: p.kind,
      currency: p.currency,
      effectiveMinor: p.effectiveMinor,
      compareAtMinor: p.compareAtMinor,
    })),
    selectedPlanId: plan?.id ?? "",
    canCheckout: view.plans.length > 0,
    roleRank: auth.user.rank,
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  if (intent !== "create_order") return { error: "generic" as const };

  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  const rl = await checkRateLimit(db, "checkout", `${auth.user.id}:${ipHash}`, 10, 3_600_000);
  if (!rl.ok) return { error: "rate_limited" as const };

  const settings = await getSettings(db);
  // NOTE: no amount/price is read from the form — the service re-reads the DB price.
  try {
    const result = await createOrder(db, {
      studentId: auth.user.id,
      productSlug: String(params.productSlug ?? ""),
      pricePlanId: String(form.get("pricePlanId") ?? ""),
      discountCode: String(form.get("discountCode") ?? "") || null,
      paymentsSettings: settings.payments,
      source: "self",
    });
    return redirect(`/orders/${result.order.orderNumber}`);
  } catch (err) {
    if (err instanceof Response) throw err;
    if (err instanceof CommerceValidationError) return { error: err.reason as "product_unavailable" };
    return { error: "generic" as const };
  }
}

export default function CheckoutPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { product, plans, selectedPlanId } = loaderData;
  const name = locale === "ar" ? product.nameAr : product.nameEn;
  const selected = plans.find((p) => p.id === selectedPlanId) ?? plans[0];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t(locale, "commerce.checkoutTitle")}</h1>

      {actionData && "error" in actionData && (
        <div data-testid="checkout-error">
          <Alert kind="error">{et(locale, "commerce", String(actionData.error))}</Alert>
        </div>
      )}

      <Card>
        <CardHeader title={name} />
        <CardBody>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="create_order" />
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">{t(locale, "commerce.choosePlan")}</legend>
              {plans.map((plan) => {
                const label = (locale === "ar" ? plan.labelAr : plan.labelEn) || t(locale, "commerce.planLabel");
                return (
                  <label
                    key={plan.id}
                    className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="pricePlanId"
                        value={plan.id}
                        defaultChecked={plan.id === selected?.id}
                        required
                      />
                      {label}
                      {plan.kind === "recurring" && (
                        <span className="text-xs text-ink-muted">{t(locale, "commerce.recurring")}</span>
                      )}
                    </span>
                    <span className="text-sm font-bold" dir="ltr" data-testid="checkout-price">
                      {formatMoney(plan.effectiveMinor, plan.currency)}
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <label className="grid gap-1 text-sm">
              <span>{t(locale, "commerce.discountCode")}</span>
              <input
                name="discountCode"
                dir="ltr"
                autoComplete="off"
                className="rounded-lg border border-line px-3 py-2"
                placeholder={t(locale, "commerce.discountOptional")}
              />
            </label>

            {selected && (
              <div className="flex items-center justify-between rounded-xl bg-sand-100 p-3 text-sm">
                <span className="font-semibold">{t(locale, "commerce.totalDue")}</span>
                <span className="text-base font-bold text-brand-700" dir="ltr" data-testid="checkout-total">
                  {formatMoney(selected.effectiveMinor, selected.currency)}
                </span>
              </div>
            )}

            <p className="text-xs text-ink-muted">{t(locale, "commerce.checkoutNotice")}</p>
            <div className="flex items-center gap-3">
              <SubmitButton name="_action" value="create_order">
                {t(locale, "commerce.createOrder")}
              </SubmitButton>
              <Link to={`/products/${product.slug}`} className="text-sm text-brand-700 hover:underline">
                {t(locale, "common.back")}
              </Link>
            </div>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
}
