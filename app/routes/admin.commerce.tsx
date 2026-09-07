import type { Route } from "./+types/admin.commerce";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  CommerceReferenceError,
  CommerceStateError,
  CommerceValidationError,
  activationBatchSchema,
  approveManualPayment,
  canCommerce,
  cancelSubscription,
  createDiscountCode,
  createProduct,
  discountCreateSchema,
  generateActivationBatch,
  listActivationBatchesAdmin,
  listDiscountCodesAdmin,
  listOrdersAdmin,
  listPaymentsAdmin,
  listProductsAdmin,
  listSubscriptionsAdmin,
  pauseSubscription,
  rejectManualPayment,
  renewSubscription,
  resumeSubscription,
  setActivationCodeStatus,
  setDiscountCodeActive,
  sweepExpiredOrders,
  sweepExpiredSubscriptions,
} from "~server/commerce/service.server";
import { getSettings } from "~server/settings/service.server";
import { courses, subjects } from "~server/db/schema";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { formatMoney } from "~server/commerce/money";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Commerce admin hub — products, orders, payment review queue, subscriptions,
 * activation-code batches and discount codes, inside the existing admin
 * architecture (auth/RBAC/layout/audit). Rank 3 needs commerce.* permission
 * rows; rank 4 bypasses. Every mutation goes through the commerce service
 * (claim-based, audited). Payment approval here is the manual rail's
 * verification step — the ONLY thing (besides signed webhooks) that flips an
 * order to paid and grants entitlements.
 */

const TABS = ["products", "orders", "payments", "subscriptions", "codes", "discounts"] as const;
type Tab = (typeof TABS)[number];

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const selectCls = "h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "products";

  const perms = {
    read: await canCommerce(db, auth, "commerce.read"),
    products: await canCommerce(db, auth, "commerce.products"),
    orders: await canCommerce(db, auth, "commerce.orders"),
    payments: await canCommerce(db, auth, "commerce.payments"),
    refunds: await canCommerce(db, auth, "commerce.refunds"),
    codes: await canCommerce(db, auth, "commerce.codes"),
    discounts: await canCommerce(db, auth, "commerce.discounts"),
  };

  const settings = await getSettings(db);
  // sweep-on-touch: lists always show server-truthful states
  if (perms.read) {
    await sweepExpiredOrders(db, settings.payments.orderTtlMinutes);
    await sweepExpiredSubscriptions(db);
  }

  const base = { tab, perms, products: null, orders: null, paymentsQ: null, subscriptionsQ: null, batches: null, discounts: null, contentOptions: null };
  if (!perms.read) return base;

  if (tab === "products") {
    const { rows } = await listProductsAdmin(db, {
      q: url.searchParams.get("q") || undefined,
      kind: url.searchParams.get("kind") || undefined,
      state: (url.searchParams.get("state") as "all" | undefined) || undefined,
      page: Number(url.searchParams.get("page") ?? 1) || 1,
    });
    const contentOptions = await loadContentOptions(db);
    return {
      ...base,
      products: rows.map((p) => ({
        id: p.id, slug: p.slug, kind: p.kind, nameAr: p.nameAr, nameEn: p.nameEn,
        active: p.active, archived: p.archivedAt !== null, sortOrder: p.sortOrder, updatedAt: p.updatedAt,
      })),
      contentOptions,
    };
  }
  if (tab === "orders") {
    const { rows, page } = await listOrdersAdmin(db, {
      status: url.searchParams.get("status") || undefined,
      q: url.searchParams.get("q") || undefined,
      page: Number(url.searchParams.get("page") ?? 1) || 1,
    });
    return { ...base, orders: { rows, page } };
  }
  if (tab === "payments") {
    const { rows, page } = await listPaymentsAdmin(db, {
      status: url.searchParams.get("status") || "under_review",
      page: Number(url.searchParams.get("page") ?? 1) || 1,
    });
    return {
      ...base,
      paymentsQ: {
        rows: rows.map((r) => ({
          ...r,
          evidence: ((r.metadata ?? {}) as { evidence?: { transferReference?: string; note?: string | null; confirmedAt?: number } }).evidence ?? null,
        })),
        page,
      },
    };
  }
  if (tab === "subscriptions") {
    const { rows, page } = await listSubscriptionsAdmin(db, {
      status: url.searchParams.get("status") || undefined,
      page: Number(url.searchParams.get("page") ?? 1) || 1,
    });
    return {
      ...base,
      subscriptionsQ: {
        rows: rows.map((r) => ({
          ...r,
          snapshot: (r.planSnapshot ?? {}) as { titleAr?: string; titleEn?: string; currency?: string; amountMinor?: number; period?: string | null },
        })),
        page,
      },
    };
  }
  if (tab === "codes") {
    const [batchRows, contentOptions, productRows] = await Promise.all([
      listActivationBatchesAdmin(db),
      loadContentOptions(db),
      listProductsAdmin(db, { state: "all", page: 1 }),
    ]);
    return {
      ...base,
      batches: batchRows.map((b) => ({
        id: b.id, name: b.name, note: b.note, count: b.count, createdAt: b.createdAt,
        stats: { total: Number(b.stats.total ?? 0), used: Number(b.stats.used ?? 0), active: Number(b.stats.active ?? 0) },
      })),
      contentOptions,
      products: productRows.rows.map((p) => ({
        id: p.id, slug: p.slug, kind: p.kind, nameAr: p.nameAr, nameEn: p.nameEn,
        active: p.active, archived: p.archivedAt !== null, sortOrder: p.sortOrder, updatedAt: p.updatedAt,
      })),
    };
  }
  const discountRows = await listDiscountCodesAdmin(db);
  return {
    ...base,
    discounts: discountRows.map((d) => ({
      id: d.id, prefix: d.prefix, type: d.type, value: d.value, maxUses: d.maxUses,
      usedCount: d.usedCount, perUserLimit: d.perUserLimit, minOrderMinor: d.minOrderMinor,
      startsAt: d.startsAt, endsAt: d.endsAt, active: d.active, createdAt: d.createdAt,
    })),
  };
}

async function loadContentOptions(db: ReturnType<typeof getDb>) {
  const [courseRows, subjectRows] = await Promise.all([
    db
      .select({ id: courses.id, titleAr: courses.titleAr, titleEn: courses.titleEn, slug: courses.slug })
      .from(courses)
      .where(and(eq(courses.status, "published"), isNull(courses.deletedAt)))
      .orderBy(asc(courses.titleEn))
      .limit(200),
    db
      .select({ id: subjects.id, titleAr: subjects.titleAr, titleEn: subjects.titleEn, slug: subjects.slug })
      .from(subjects)
      .where(and(eq(subjects.status, "published"), isNull(subjects.deletedAt)))
      .orderBy(asc(subjects.titleEn))
      .limit(200),
  ]);
  return { courses: courseRows, subjects: subjectRows };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const actor = {
    userId: auth.user.id,
    role: auth.user.roleId,
    ipHash: await sha256Hex(clientIpOf(request) ?? "unknown"),
  };
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const num = (k: string) => (str(k) === "" ? null : Number(str(k)));
  const settings = await getSettings(db);

  const need = async (
    perm: "commerce.products" | "commerce.orders" | "commerce.payments" | "commerce.refunds" | "commerce.codes" | "commerce.discounts"
  ) => {
    if (!(await canCommerce(db, auth, perm))) return { error: "denied" as const };
    return null;
  };

  try {
    switch (intent) {
      case "create_product": {
        const denied = await need("commerce.products");
        if (denied) return denied;
        const kind = str("kind") as "course" | "subject" | "bundle" | "subscription_plan";
        const resourceType = kind === "subject" ? "subject" : "course";
        const resourceId = str("resourceId");
        const parsed = await createProduct(
          db,
          {
            kind,
            slug: str("slug") || undefined,
            nameAr: str("nameAr"),
            nameEn: str("nameEn"),
            descriptionAr: str("descriptionAr") || undefined,
            descriptionEn: str("descriptionEn") || undefined,
            items: [{ resourceType: resourceType as "course", resourceId }],
            active: form.get("active") === "on",
          },
          actor
        );
        return { ok: true as const, createdProductId: parsed.id };
      }
      case "approve_payment": {
        const denied = await need("commerce.payments");
        if (denied) return denied;
        const result = await approveManualPayment(db, {
          paymentId: str("paymentId"),
          receivedAmountMinor: Number(str("receivedAmount") || -1),
          actor,
        });
        return { ok: true as const, alreadyProcessed: result.alreadyProcessed, granted: result.grantedCount };
      }
      case "reject_payment": {
        const denied = await need("commerce.payments");
        if (denied) return denied;
        await rejectManualPayment(db, { paymentId: str("paymentId"), reason: str("reason"), actor });
        return { ok: true as const };
      }
      case "renew_subscription": {
        const denied = await need("commerce.orders");
        if (denied) return denied;
        await renewSubscription(db, str("subscriptionId"), actor);
        return { ok: true as const };
      }
      case "pause_subscription": {
        const denied = await need("commerce.orders");
        if (denied) return denied;
        await pauseSubscription(db, str("subscriptionId"), actor);
        return { ok: true as const };
      }
      case "resume_subscription": {
        const denied = await need("commerce.orders");
        if (denied) return denied;
        await resumeSubscription(db, str("subscriptionId"), actor);
        return { ok: true as const };
      }
      case "cancel_subscription": {
        const denied = await need("commerce.orders");
        if (denied) return denied;
        await cancelSubscription(db, str("subscriptionId"), actor);
        return { ok: true as const };
      }
      case "generate_codes": {
        const denied = await need("commerce.codes");
        if (denied) return denied;
        const dt = (k: string) => {
          const v = str(k);
          return v ? new Date(`${v}:00Z`).getTime() : null; // UTC-labeled inputs (ADR-022 §9 convention)
        };
        const expiresAt = dt("expiresAt");
        if (expiresAt !== null && Number.isNaN(expiresAt)) return { error: "validation" as const };
        const input = activationBatchSchema.parse({
          name: str("name"),
          note: str("note") || null,
          count: Number(str("count") || 0),
          productId: str("productId") || null,
          grants: str("resourceId")
            ? [{ resourceType: str("resourceType") === "subject" ? "subject" : "course", resourceId: str("resourceId") }]
            : undefined,
          durationDays: num("durationDays") ?? null,
          fixedExpiresAt: null,
          maxUses: Number(str("maxUses") || 1),
          expiresAt,
        });
        const generated = await generateActivationBatch(db, input, actor);
        // plaintext shown ONCE — it is not stored anywhere, never re-readable
        return { ok: true as const, generatedCodes: generated.codes, generatedBatchId: generated.batchId };
      }
      case "code_status": {
        const denied = await need("commerce.codes");
        if (denied) return denied;
        const status = str("status") as "active" | "disabled" | "revoked";
        await setActivationCodeStatus(db, str("codeId"), status, actor);
        return { ok: true as const };
      }
      case "create_discount": {
        const denied = await need("commerce.discounts");
        if (denied) return denied;
        const dt = (k: string) => {
          const v = str(k);
          return v ? new Date(`${v}:00Z`).getTime() : null;
        };
        const startsAt = dt("startsAt");
        const endsAt = dt("endsAt");
        const input = discountCreateSchema.parse({
          code: str("code"),
          type: str("type"),
          value: Number(str("value") || 0),
          maxUses: num("maxUses") ?? undefined,
          perUserLimit: num("perUserLimit") ?? undefined,
          minOrderMinor: num("minOrderMinor") ?? undefined,
          startsAt: startsAt ?? undefined,
          endsAt: endsAt ?? undefined,
          active: true,
        });
        await createDiscountCode(db, input, actor);
        return { ok: true as const };
      }
      case "discount_active": {
        const denied = await need("commerce.discounts");
        if (denied) return denied;
        await setDiscountCodeActive(db, str("id"), form.get("active") === "1", actor);
        return { ok: true as const };
      }
      default:
        return { error: "generic" as const };
    }
  } catch (err) {
    if (err instanceof CommerceValidationError || err instanceof CommerceStateError) {
      return { error: err.reason as "validation" };
    }
    if (err instanceof CommerceReferenceError) return { error: "not_found" as const };
    if (err instanceof Error && err.name === "ZodError") return { error: "validation" as const };
    return { error: "generic" as const };
  }
}

const ORDER_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  pending: "warning", awaiting_payment: "warning", paid: "success", cancelled: "neutral",
  expired: "neutral", failed: "danger", refunded: "danger", partially_refunded: "danger",
};
const PAY_TONE = ORDER_TONE;
const SUB_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success", pending: "warning", paused: "warning", cancelled: "neutral", expired: "neutral",
};

export default function AdminCommercePage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const generatedCodes = actionData && "generatedCodes" in actionData ? actionData.generatedCodes : null;
  const { tab, perms } = loaderData;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t(locale, "commerceAdmin.title")}</h1>

      {!perms.read && <Alert kind="error">{t(locale, "commerceAdmin.denied")}</Alert>}

      {actionData && "error" in actionData && (
        <Alert kind="error">{et(locale, "commerceAdmin", String(actionData.error))}</Alert>
      )}
      {actionData && "ok" in actionData && !("generatedCodes" in actionData) && (
        <Alert kind="success">
          {t(locale, "commerceAdmin.saved")}
          {"alreadyProcessed" in actionData && actionData.alreadyProcessed
            ? ` (${t(locale, "commerceAdmin.alreadyFulfilled")})`
            : ""}
        </Alert>
      )}
      {generatedCodes && (
        <div data-testid="generated-codes">
          <Alert kind="success">
            <div className="space-y-2">
              <p>{t(locale, "commerceAdmin.codesGeneratedOnce")}</p>
              <textarea
                readOnly
                rows={Math.min(10, generatedCodes.length)}
                className="w-full rounded-lg border border-emerald-300 bg-white p-2 font-mono text-xs"
                dir="ltr"
                defaultValue={generatedCodes.join("\n")}
              />
            </div>
          </Alert>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b">
        {TABS.map((tb) => (
          <Link
            key={tb}
            to={`/admin/commerce?tab=${tb}`}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${
              tab === tb ? "border border-b-0 bg-white text-brand-700" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t(locale, `commerceAdmin.tab_${tb}` as never)}
          </Link>
        ))}
      </div>

      {/* ---------------- PRODUCTS ---------------- */}
      {tab === "products" && perms.read && loaderData.products && (
        <div className="space-y-4">
          {perms.products && loaderData.contentOptions && (
            <Card>
              <CardHeader title={t(locale, "commerceAdmin.newProduct")} />
              <CardBody>
                <Form method="post" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input type="hidden" name="_action" value="create_product" />
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.kind")}</span>
                    <select name="kind" className={selectCls} defaultValue="course">
                      <option value="course">{t(locale, "commerce.kind_course")}</option>
                      <option value="subject">{t(locale, "commerce.kind_subject")}</option>
                      <option value="bundle">{t(locale, "commerce.kind_bundle")}</option>
                      <option value="subscription_plan">{t(locale, "commerce.kind_subscription_plan")}</option>
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.nameAr")}</span>
                    <input name="nameAr" required className={inputCls} dir="rtl" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.nameEn")}</span>
                    <input name="nameEn" required className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.slugOptional")}</span>
                    <input name="slug" className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.contentRef")}</span>
                    <select name="resourceId" className={selectCls} required defaultValue="">
                      <option value="" disabled>{t(locale, "commerceAdmin.choose")}</option>
                      <optgroup label={t(locale, "commerceAdmin.coursesGroup")}>
                        {loaderData.contentOptions.courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {locale === "ar" ? c.titleAr : c.titleEn} ({c.slug})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={t(locale, "commerceAdmin.subjectsGroup")}>
                        {loaderData.contentOptions.subjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {locale === "ar" ? s.titleAr : s.titleEn} ({s.slug})
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name="active" />
                    {t(locale, "commerceAdmin.activeImmediately")}
                  </label>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <SubmitButton name="_action" value="create_product">{t(locale, "commerceAdmin.createProduct")}</SubmitButton>
                  </div>
                </Form>
                <p className="mt-2 text-xs text-slate-500">{t(locale, "commerceAdmin.productCreateHint")}</p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody className="space-y-2">
              {loaderData.products.length === 0 && <p className="text-sm text-slate-500">{t(locale, "commerceAdmin.noProducts")}</p>}
              {loaderData.products.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0" data-testid="product-row">
                  <div className="text-sm">
                    <Link to={`/admin/commerce/products/${p.id}`} className="font-semibold text-blue-700 hover:underline">
                      {locale === "ar" ? p.nameAr : p.nameEn}
                    </Link>
                    <span className="ms-2 text-xs text-slate-500" dir="ltr">{p.slug}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{t(locale, `commerce.kind_${p.kind}` as never)}</Badge>
                    {p.archived ? (
                      <Badge tone="danger">{t(locale, "commerceAdmin.archived")}</Badge>
                    ) : p.active ? (
                      <Badge tone="success">{t(locale, "commerceAdmin.active")}</Badge>
                    ) : (
                      <Badge tone="neutral">{t(locale, "commerceAdmin.inactive")}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ---------------- ORDERS ---------------- */}
      {tab === "orders" && perms.read && loaderData.orders && (
        <Card>
          <CardBody className="space-y-2">
            <Form method="get" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tab" value="orders" />
              <input name="q" className={inputCls} placeholder={t(locale, "commerceAdmin.searchOrders")} dir="ltr" />
              <select name="status" className={selectCls} defaultValue="">
                <option value="">{t(locale, "commerceAdmin.allStatuses")}</option>
                {["pending", "paid", "cancelled", "expired", "refunded"].map((s) => (
                  <option key={s} value={s}>{t(locale, `commerce.order_${s}` as never)}</option>
                ))}
              </select>
              <SubmitButton variant="secondary">{t(locale, "commerceAdmin.filter")}</SubmitButton>
            </Form>
            {loaderData.orders.rows.length === 0 && <p className="text-sm text-slate-500">{t(locale, "commerceAdmin.noOrders")}</p>}
            {loaderData.orders.rows.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0" data-testid="admin-order-row">
                <Link to={`/admin/commerce/orders/${o.id}`} className="font-mono text-xs text-blue-700 hover:underline" dir="ltr">
                  {o.orderNumber}
                </Link>
                <span className="text-xs text-slate-500" dir="ltr">{o.studentEmail ?? o.studentId.slice(0, 8)}</span>
                <span dir="ltr" className="text-xs font-semibold">{formatMoney(o.totalMinor, o.currency)}</span>
                <Badge tone={ORDER_TONE[o.status] ?? "neutral"}>{t(locale, `commerce.order_${o.status}` as never)}</Badge>
                <span className="text-xs text-slate-500">{formatDate(locale, o.createdAt)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* ---------------- PAYMENTS ---------------- */}
      {tab === "payments" && perms.read && loaderData.paymentsQ && (
        <Card>
          <CardBody className="space-y-2">
            <Form method="get" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tab" value="payments" />
              <select name="status" className={selectCls} defaultValue="under_review">
                {["under_review", "pending", "paid", "failed", "expired", "refunded", "all"].map((s) => (
                  <option key={s} value={s}>{s === "all" ? t(locale, "commerceAdmin.allStatuses") : t(locale, `commerce.pay_${s}` as never)}</option>
                ))}
              </select>
              <SubmitButton variant="secondary">{t(locale, "commerceAdmin.filter")}</SubmitButton>
            </Form>
            {loaderData.paymentsQ.rows.length === 0 && <p className="text-sm text-slate-500">{t(locale, "commerceAdmin.noPayments")}</p>}
            {loaderData.paymentsQ.rows.map((p) => (
              <div key={p.id} className="space-y-2 border-b border-slate-100 py-3 last:border-0" data-testid="payment-review-row">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <Link to={`/admin/commerce/orders/${p.orderId}`} className="font-mono text-xs text-blue-700 hover:underline" dir="ltr">
                      {p.orderNumber}
                    </Link>
                    <span className="ms-2 text-xs text-slate-500" dir="ltr">{p.studentEmail ?? ""}</span>
                    {p.evidence?.transferReference && (
                      <p className="text-xs text-slate-600" data-testid="evidence-ref" dir="ltr">
                        {t(locale, "commerceAdmin.evidence")}: {p.evidence.transferReference}
                        {p.evidence.note ? ` — ${p.evidence.note}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{p.provider}</span>
                    <span dir="ltr" className="text-sm font-bold" data-testid="payment-due">{formatMoney(p.amountMinor, p.currency)}</span>
                    <Badge tone={PAY_TONE[p.status] ?? "neutral"}>{t(locale, `commerce.pay_${p.status}` as never)}</Badge>
                  </div>
                </div>
                {p.status === "under_review" && perms.payments && (
                  <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
                    <Form method="post" className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="_action" value="approve_payment" />
                      <input type="hidden" name="paymentId" value={p.id} />
                      <label className="grid min-w-0 gap-1 text-xs">
                        <span>{t(locale, "commerceAdmin.receivedAmount")}</span>
                        <input
                          name="receivedAmount"
                          type="number"
                          min={0}
                          step={1}
                          required
                          defaultValue={p.amountMinor}
                          className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                          dir="ltr"
                        />
                      </label>
                      <SubmitButton name="_action" value="approve_payment">{t(locale, "commerceAdmin.approve")}</SubmitButton>
                    </Form>
                    <Form method="post" className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="_action" value="reject_payment" />
                      <input type="hidden" name="paymentId" value={p.id} />
                      <label className="grid min-w-0 gap-1 text-xs">
                        <span>{t(locale, "commerceAdmin.rejectReason")}</span>
                        <input name="reason" required maxLength={500} className="w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                      </label>
                      <SubmitButton variant="secondary" name="_action" value="reject_payment">{t(locale, "commerceAdmin.reject")}</SubmitButton>
                    </Form>
                    <p className="w-full text-xs text-slate-500">{t(locale, "commerceAdmin.amountsAreMinorUnits")}</p>
                  </div>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* ---------------- SUBSCRIPTIONS ---------------- */}
      {tab === "subscriptions" && perms.read && loaderData.subscriptionsQ && (
        <Card>
          <CardBody className="space-y-2">
            {loaderData.subscriptionsQ.rows.length === 0 && <p className="text-sm text-slate-500">{t(locale, "commerceAdmin.noSubscriptions")}</p>}
            {loaderData.subscriptionsQ.rows.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0" data-testid="subscription-row">
                <div>
                  <p className="font-semibold">{locale === "ar" ? s.snapshot.titleAr : s.snapshot.titleEn}</p>
                  <p className="text-xs text-slate-500" dir="ltr">
                    {s.studentEmail ?? s.studentId.slice(0, 8)}
                    {s.currentPeriodEnd ? ` · ${t(locale, "commerce.accessUntil").replace("{date}", formatDate(locale, s.currentPeriodEnd))}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SUB_TONE[s.status] ?? "neutral"}>{t(locale, `commerce.sub_${s.status}` as never)}</Badge>
                  {perms.orders && (
                    <>
                      {["active", "cancelled", "expired", "paused"].includes(s.status) && (
                        <Form method="post">
                          <input type="hidden" name="_action" value="renew_subscription" />
                          <input type="hidden" name="subscriptionId" value={s.id} />
                          <SubmitButton variant="secondary" name="_action" value="renew_subscription">{t(locale, "commerceAdmin.renew")}</SubmitButton>
                        </Form>
                      )}
                      {s.status === "active" && (
                        <>
                          <Form method="post">
                            <input type="hidden" name="_action" value="pause_subscription" />
                            <input type="hidden" name="subscriptionId" value={s.id} />
                            <SubmitButton variant="secondary" name="_action" value="pause_subscription">{t(locale, "commerceAdmin.pause")}</SubmitButton>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="_action" value="cancel_subscription" />
                            <input type="hidden" name="subscriptionId" value={s.id} />
                            <SubmitButton variant="secondary" name="_action" value="cancel_subscription">{t(locale, "commerceAdmin.cancel")}</SubmitButton>
                          </Form>
                        </>
                      )}
                      {s.status === "paused" && (
                        <>
                          <Form method="post">
                            <input type="hidden" name="_action" value="resume_subscription" />
                            <input type="hidden" name="subscriptionId" value={s.id} />
                            <SubmitButton variant="secondary" name="_action" value="resume_subscription">{t(locale, "commerceAdmin.resume")}</SubmitButton>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="_action" value="cancel_subscription" />
                            <input type="hidden" name="subscriptionId" value={s.id} />
                            <SubmitButton variant="secondary" name="_action" value="cancel_subscription">{t(locale, "commerceAdmin.cancel")}</SubmitButton>
                          </Form>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* ---------------- ACTIVATION CODES ---------------- */}
      {tab === "codes" && perms.read && loaderData.batches && (
        <div className="space-y-4">
          {perms.codes && loaderData.contentOptions && (
            <Card>
              <CardHeader title={t(locale, "commerceAdmin.generateBatch")} />
              <CardBody>
                <Form method="post" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <input type="hidden" name="_action" value="generate_codes" />
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.batchName")}</span>
                    <input name="name" required className={inputCls} />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.count")}</span>
                    <input name="count" type="number" min={1} max={500} defaultValue={5} required className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.maxUses")}</span>
                    <input name="maxUses" type="number" min={1} max={1000} defaultValue={1} required className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.bindProduct")}</span>
                    <select name="productId" className={selectCls} defaultValue="">
                      <option value="">{t(locale, "commerceAdmin.noProductDirectGrant")}</option>
                      {(loaderData.products ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {locale === "ar" ? p.nameAr : p.nameEn}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.orDirectResource")}</span>
                    <select name="resourceId" className={selectCls} defaultValue="">
                      <option value="">{t(locale, "commerceAdmin.none")}</option>
                      <optgroup label={t(locale, "commerceAdmin.coursesGroup")}>
                        {loaderData.contentOptions.courses.map((c) => (
                          <option key={c.id} value={c.id}>{locale === "ar" ? c.titleAr : c.titleEn}</option>
                        ))}
                      </optgroup>
                      <optgroup label={t(locale, "commerceAdmin.subjectsGroup")}>
                        {loaderData.contentOptions.subjects.map((s) => (
                          <option key={s.id} value={s.id}>{locale === "ar" ? s.titleAr : s.titleEn}</option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.durationDays")}</span>
                    <input name="durationDays" type="number" min={1} max={3650} className={inputCls} dir="ltr" placeholder={t(locale, "commerceAdmin.permanentIfEmpty")} />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.redeemByUtc")}</span>
                    <input name="expiresAt" type="datetime-local" className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid gap-1 text-sm sm:col-span-2">
                    <span>{t(locale, "commerceAdmin.batchNote")}</span>
                    <input name="note" maxLength={500} className={inputCls} />
                  </label>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <SubmitButton name="_action" value="generate_codes">{t(locale, "commerceAdmin.generate")}</SubmitButton>
                  </div>
                </Form>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody className="space-y-2">
              {loaderData.batches.length === 0 && <p className="text-sm text-slate-500">{t(locale, "commerceAdmin.noBatches")}</p>}
              {loaderData.batches.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0" data-testid="batch-row">
                  <div>
                    <Link to={`/admin/commerce/batches/${b.id}`} className="font-semibold text-blue-700 hover:underline">
                      {b.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {formatDate(locale, b.createdAt)} · {t(locale, "commerceAdmin.codesUsed")
                        .replace("{used}", String(b.stats.used))
                        .replace("{total}", String(b.stats.total))}
                    </p>
                  </div>
                  <Badge tone={b.stats.active > 0 ? "success" : "neutral"}>
                    {t(locale, "commerceAdmin.codesActive").replace("{n}", String(b.stats.active))}
                  </Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ---------------- DISCOUNTS ---------------- */}
      {tab === "discounts" && perms.read && loaderData.discounts && (
        <div className="space-y-4">
          {perms.discounts && (
            <Card>
              <CardHeader title={t(locale, "commerceAdmin.newDiscount")} />
              <CardBody>
                <Form method="post" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="_action" value="create_discount" />
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.discountCode")}</span>
                    <input name="code" required minLength={4} maxLength={40} className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.discountType")}</span>
                    <select name="type" className={selectCls} defaultValue="percent">
                      <option value="percent">{t(locale, "commerceAdmin.percent")}</option>
                      <option value="fixed">{t(locale, "commerceAdmin.fixedMinor")}</option>
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.discountValue")}</span>
                    <input name="value" type="number" min={1} required className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.maxUses")}</span>
                    <input name="maxUses" type="number" min={1} className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.perUserLimit")}</span>
                    <input name="perUserLimit" type="number" min={1} className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.minOrderMinor")}</span>
                    <input name="minOrderMinor" type="number" min={0} className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.startsAtUtc")}</span>
                    <input name="startsAt" type="datetime-local" className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid min-w-0 gap-1 text-sm">
                    <span>{t(locale, "commerceAdmin.endsAtUtc")}</span>
                    <input name="endsAt" type="datetime-local" className={inputCls} dir="ltr" />
                  </label>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <SubmitButton name="_action" value="create_discount">{t(locale, "commerceAdmin.createDiscount")}</SubmitButton>
                  </div>
                </Form>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardBody className="space-y-2">
              {loaderData.discounts.length === 0 && <p className="text-sm text-slate-500">{t(locale, "commerceAdmin.noDiscounts")}</p>}
              {loaderData.discounts.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0" data-testid="discount-row">
                  <div>
                    <span className="font-mono font-semibold" dir="ltr">{d.prefix}…</span>
                    <span className="ms-2 text-xs text-slate-500">
                      {d.type === "percent" ? `${d.value}%` : formatMoney(d.value, "EGP")}
                      {d.maxUses !== null ? ` · ${d.usedCount}/${d.maxUses}` : ` · ${t(locale, "commerceAdmin.unlimited")}`}
                      {d.endsAt ? ` · ${t(locale, "commerceAdmin.until")} ${formatDate(locale, d.endsAt)}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={d.active ? "success" : "neutral"}>
                      {d.active ? t(locale, "commerceAdmin.active") : t(locale, "commerceAdmin.inactive")}
                    </Badge>
                    {perms.discounts && (
                      <Form method="post">
                        <input type="hidden" name="_action" value="discount_active" />
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="active" value={d.active ? "0" : "1"} />
                        <SubmitButton variant="secondary" name="_action" value="discount_active">
                          {d.active ? t(locale, "commerceAdmin.deactivate") : t(locale, "commerceAdmin.activate")}
                        </SubmitButton>
                      </Form>
                    )}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
