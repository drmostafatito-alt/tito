import type { Route } from "./+types/admin.commerce.products.$id";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  CommerceReferenceError,
  CommerceStateError,
  CommerceValidationError,
  archiveProduct,
  canCommerce,
  createPricePlan,
  getProduct,
  pricePlansForProduct,
  productItemsOf,
  unarchiveProduct,
  updatePricePlan,
  updateProduct,
} from "~server/commerce/service.server";
import { courses, files, subjects } from "~server/db/schema";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { formatMoney } from "~server/commerce/money";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Product editor (Phase 6) — details, content items (what the product conveys)
 * and price plans. Non-destructive lifecycle: deactivate hides from checkout,
 * archive retires; order history is never touched (frozen entitlement specs).
 * Money inputs are INTEGER MINOR UNITS — the admin sees the convention label.
 */

const inputCls = "rounded-lg border border-line px-3 py-2 text-sm";
const selectCls = "h-[42px] rounded-lg border border-line bg-surface px-3 text-sm";

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const id = String(params.id ?? "");
  const perms = {
    read: await canCommerce(db, auth, "commerce.read"),
    edit: await canCommerce(db, auth, "commerce.products"),
  };
  if (!perms.read) throw new Response("Forbidden", { status: 403 });
  const product = await getProduct(db, id);
  if (!product) throw new Response("Not found", { status: 404 });
  const [itemRows, planRows] = await Promise.all([
    productItemsOf(db, id),
    pricePlansForProduct(db, id),
  ]);
  const [courseRows, subjectRows, imageRows] = await Promise.all([
    db.select({ id: courses.id, titleAr: courses.titleAr, titleEn: courses.titleEn, slug: courses.slug })
      .from(courses).where(and(eq(courses.status, "published"), isNull(courses.deletedAt))).orderBy(asc(courses.titleEn)).limit(200),
    db.select({ id: subjects.id, titleAr: subjects.titleAr, titleEn: subjects.titleEn, slug: subjects.slug })
      .from(subjects).where(and(eq(subjects.status, "published"), isNull(subjects.deletedAt))).orderBy(asc(subjects.titleEn)).limit(200),
    db.select({ id: files.id, name: files.originalFilename })
      .from(files).where(and(eq(files.visibility, "public"), eq(files.kind, "image"))).orderBy(desc(files.createdAt)).limit(100),
  ]);
  // resolve item titles for display
  const itemViews = [];
  for (const it of itemRows) {
    const row = it.resourceType === "course"
      ? courseRows.find((c) => c.id === it.resourceId)
      : subjectRows.find((s) => s.id === it.resourceId);
    itemViews.push({
      id: it.id,
      resourceType: it.resourceType,
      resourceId: it.resourceId,
      titleAr: row?.titleAr ?? it.resourceId,
      titleEn: row?.titleEn ?? it.resourceId,
    });
  }
  return {
    perms,
    product: {
      id: product.id, slug: product.slug, kind: product.kind,
      nameAr: product.nameAr, nameEn: product.nameEn,
      descriptionAr: product.descriptionAr, descriptionEn: product.descriptionEn,
      thumbnailFileId: product.thumbnailFileId, active: product.active,
      archived: product.archivedAt !== null, sortOrder: product.sortOrder,
      createdAt: product.createdAt,
    },
    items: itemViews,
    plans: planRows.map((p) => ({
      id: p.id, currency: p.currency, amountMinor: p.amountMinor, kind: p.kind,
      period: p.period, periodDays: p.periodDays, fixedEndsAt: p.fixedEndsAt,
      labelAr: p.labelAr, labelEn: p.labelEn, compareAtMinor: p.compareAtMinor,
      promoPriceMinor: p.promoPriceMinor, promoStartsAt: p.promoStartsAt, promoEndsAt: p.promoEndsAt,
      active: p.active, sortOrder: p.sortOrder, createdAt: p.createdAt,
    })),
    images: imageRows.map((r) => ({ id: r.id, label: r.name })),
    courseOptions: courseRows,
    subjectOptions: subjectRows,
    publicUrl: new URL(request.url).origin,
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const id = String(params.id ?? "");
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const actor = { userId: auth.user.id, role: auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") };
  if (!(await canCommerce(db, auth, "commerce.products"))) return { error: "denied" as const };
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const numOrNull = (k: string) => (str(k) === "" ? null : Number(str(k)));
  const dtUtc = (k: string) => {
    const v = str(k);
    if (!v) return null;
    const ms = new Date(`${v}:00Z`).getTime();
    return Number.isNaN(ms) ? null : ms;
  };

  try {
    switch (intent) {
      case "update_product": {
        await updateProduct(db, id, {
          nameAr: str("nameAr"),
          nameEn: str("nameEn"),
          descriptionAr: str("descriptionAr"),
          descriptionEn: str("descriptionEn"),
          thumbnailFileId: str("thumbnailFileId") || null,
          active: form.get("active") === "on",
          sortOrder: Number(str("sortOrder") || 0),
        }, actor);
        return { ok: true as const };
      }
      case "archive":
        await archiveProduct(db, id, actor);
        return { ok: true as const };
      case "unarchive":
        await unarchiveProduct(db, id, actor);
        return { ok: true as const };
      case "add_item": {
        const product = await getProduct(db, id);
        if (!product) throw new CommerceReferenceError("productId", id);
        const existing = await productItemsOf(db, id);
        const resourceType = str("itemResourceType") === "subject" ? "subject" : "course";
        const resourceId = str("itemResourceId");
        const nextItems = [...existing.map((i) => ({ resourceType: i.resourceType, resourceId: i.resourceId })), { resourceType: resourceType as "course", resourceId }];
        await updateProduct(db, id, { items: nextItems }, actor);
        return { ok: true as const };
      }
      case "remove_item": {
        const existing = await productItemsOf(db, id);
        const removeId = str("itemId");
        const nextItems = existing
          .filter((i) => i.id !== removeId)
          .map((i) => ({ resourceType: i.resourceType, resourceId: i.resourceId }));
        if (nextItems.length === 0) return { error: "last_item" as const };
        await updateProduct(db, id, { items: nextItems }, actor);
        return { ok: true as const };
      }
      case "create_plan": {
        await createPricePlan(db, id, {
          currency: str("currency") || "EGP",
          amountMinor: Number(str("amountMinor") || -1),
          kind: str("planKind") === "recurring" ? "recurring" : "one_time",
          period: str("period") ? (str("period") as "monthly") : null,
          periodDays: numOrNull("periodDays"),
          fixedEndsAt: dtUtc("fixedEndsAt"),
          labelAr: str("labelAr") || null,
          labelEn: str("labelEn") || null,
          compareAtMinor: numOrNull("compareAtMinor"),
          promoPriceMinor: numOrNull("promoPriceMinor"),
          promoStartsAt: dtUtc("promoStartsAt"),
          promoEndsAt: dtUtc("promoEndsAt"),
          active: form.get("planActive") === "on",
        }, actor);
        return { ok: true as const };
      }
      case "update_plan": {
        await updatePricePlan(db, str("planId"), {
          amountMinor: Number(str("amountMinor") || -1),
          labelAr: str("labelAr") || null,
          labelEn: str("labelEn") || null,
          compareAtMinor: numOrNull("compareAtMinor"),
          promoPriceMinor: numOrNull("promoPriceMinor"),
          promoStartsAt: dtUtc("promoStartsAt"),
          promoEndsAt: dtUtc("promoEndsAt"),
          periodDays: numOrNull("periodDays"),
        }, actor);
        return { ok: true as const };
      }
      case "plan_active": {
        await updatePricePlan(db, str("planId"), { active: str("active") === "1" }, actor);
        return { ok: true as const };
      }
      default:
        return { error: "generic" as const };
    }
  } catch (err) {
    if (err instanceof CommerceValidationError || err instanceof CommerceStateError) return { error: err.reason as "validation" };
    if (err instanceof CommerceReferenceError) return { error: "not_found" as const };
    if (err instanceof Error && (err.name === "ZodError" || err.message.includes("invalid"))) return { error: "validation" as const };
    return { error: "generic" as const };
  }
}

const toLocalInput = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 16) : "");

export default function AdminProductPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { product, items, plans, perms } = loaderData;

  return (
    <div className="space-y-4" key={`prod-${product?.id}`}>
      <nav className="text-xs text-ink-muted">
        <Link to="/admin/commerce?tab=products" className="hover:text-brand-700">{t(locale, "commerceAdmin.title")}</Link>
        <span aria-hidden="true"> › </span>
        <span dir="ltr">{product.slug}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{locale === "ar" ? product.nameAr : product.nameEn}</h1>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{t(locale, `commerce.kind_${product.kind}` as never)}</Badge>
          {product.archived ? (
            <Badge tone="danger">{t(locale, "commerceAdmin.archived")}</Badge>
          ) : product.active ? (
            <Badge tone="success">{t(locale, "commerceAdmin.active")}</Badge>
          ) : (
            <Badge tone="neutral">{t(locale, "commerceAdmin.inactive")}</Badge>
          )}
        </div>
      </div>

      {actionData && "error" in actionData && (
        <Alert kind="error">{et(locale, "commerceAdmin", String(actionData.error))}</Alert>
      )}
      {actionData && "ok" in actionData && <Alert kind="success">{t(locale, "commerceAdmin.saved")}</Alert>}

      <Card>
        <CardHeader title={t(locale, "commerceAdmin.productDetails")} />
        <CardBody>
          <Form method="post" className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="_action" value="update_product" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "commerceAdmin.nameAr")}</span>
              <input name="nameAr" defaultValue={product.nameAr} required className={inputCls} dir="rtl" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "commerceAdmin.nameEn")}</span>
              <input name="nameEn" defaultValue={product.nameEn} required className={inputCls} dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "commerceAdmin.descAr")}</span>
              <textarea name="descriptionAr" defaultValue={product.descriptionAr} rows={3} className={inputCls} dir="rtl" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "commerceAdmin.descEn")}</span>
              <textarea name="descriptionEn" defaultValue={product.descriptionEn} rows={3} className={inputCls} dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "commerceAdmin.thumbnail")}</span>
              <select name="thumbnailFileId" className={selectCls} defaultValue={product.thumbnailFileId ?? ""}>
                <option value="">{t(locale, "commerceAdmin.none")}</option>
                {loaderData.images.map((img) => (
                  <option key={img.id} value={img.id}>{img.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "commerceAdmin.sortOrder")}</span>
              <input name="sortOrder" type="number" min={0} defaultValue={product.sortOrder} className={inputCls} dir="ltr" />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={product.active} disabled={product.archived} />
              {t(locale, "commerceAdmin.activeForSale")}
            </label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              {perms.edit && !product.archived && (
                <>
                  <SubmitButton name="_action" value="update_product">{t(locale, "common.save")}</SubmitButton>
                  <SubmitButton variant="secondary" name="_action" value="archive">{t(locale, "commerceAdmin.archive")}</SubmitButton>
                </>
              )}
              {perms.edit && product.archived && (
                <SubmitButton variant="secondary" name="_action" value="unarchive">{t(locale, "commerceAdmin.unarchive")}</SubmitButton>
              )}
              <a
                href={`${loaderData.publicUrl}/products/${product.slug}`}
                className="text-sm text-brand-700 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {t(locale, "commerceAdmin.viewProductPage")}
              </a>
            </div>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "commerceAdmin.conveyedItems")} />
        <CardBody className="space-y-3">
          {items.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "commerceAdmin.noItems")}</p>}
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-2 border-b border-line pb-2 text-sm last:border-0">
              <span>
                <Badge tone={it.resourceType === "course" ? "brand" : "neutral"}>{it.resourceType}</Badge>{" "}
                {locale === "ar" ? it.titleAr : it.titleEn}
              </span>
              {perms.edit && !product.archived && (
                <Form method="post">
                  <input type="hidden" name="_action" value="remove_item" />
                  <input type="hidden" name="itemId" value={it.id} />
                  <SubmitButton variant="secondary" name="_action" value="remove_item">{t(locale, "common.remove")}</SubmitButton>
                </Form>
              )}
            </div>
          ))}
          {perms.edit && !product.archived && (product.kind === "bundle" || product.kind === "subscription_plan") && (
            <Form method="post" className="flex flex-wrap items-end gap-2 pt-1">
              <input type="hidden" name="_action" value="add_item" />
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.resourceType")}</span>
                <select name="itemResourceType" className={selectCls} defaultValue="course">
                  <option value="course">{t(locale, "commerceAdmin.coursesGroup")}</option>
                  <option value="subject">{t(locale, "commerceAdmin.subjectsGroup")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.resource")}</span>
                <select name="itemResourceId" className={selectCls} required defaultValue="">
                  <option value="" disabled>{t(locale, "commerceAdmin.choose")}</option>
                  {loaderData.courseOptions.map((c) => (
                    <option key={c.id} value={c.id}>{locale === "ar" ? c.titleAr : c.titleEn}</option>
                  ))}
                  {loaderData.subjectOptions.map((s) => (
                    <option key={s.id} value={s.id}>{locale === "ar" ? s.titleAr : s.titleEn}</option>
                  ))}
                </select>
              </label>
              <SubmitButton variant="secondary" name="_action" value="add_item">{t(locale, "commerceAdmin.addItem")}</SubmitButton>
            </Form>
          )}
          <p className="text-xs text-ink-muted">{t(locale, "commerceAdmin.itemsFrozenNote")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "commerceAdmin.pricePlans")} />
        <CardBody className="space-y-4">
          {plans.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "commerceAdmin.noPlans")}</p>}
          {plans.map((p) => (
            <div key={p.id} className="flex flex-wrap items-start justify-between gap-2">
              <details className="min-w-0 flex-1 rounded-xl border border-line p-3" data-testid="plan-editor">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">
                    {(locale === "ar" ? p.labelAr : p.labelEn) || t(locale, "commerceAdmin.plan")} ·{" "}
                    <span dir="ltr">{formatMoney(p.amountMinor, p.currency)}</span>
                    {p.period ? ` · ${p.period}${p.periodDays ? ` (${p.periodDays}d)` : ""}` : ""}
                  </span>
                  <Badge tone={p.active ? "success" : "neutral"}>
                    {p.active ? t(locale, "commerceAdmin.active") : t(locale, "commerceAdmin.inactive")}
                  </Badge>
                </summary>
              {perms.edit && !product.archived && (
                <Form method="post" className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="_action" value="update_plan" />
                  <input type="hidden" name="planId" value={p.id} />
                  <label className="grid gap-1 text-xs">
                    <span>{t(locale, "commerceAdmin.amountMinor")}</span>
                    <input name="amountMinor" type="number" min={0} step={1} defaultValue={p.amountMinor} required className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span>{t(locale, "commerceAdmin.labelAr")}</span>
                    <input name="labelAr" defaultValue={p.labelAr ?? ""} className={inputCls} dir="rtl" />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span>{t(locale, "commerceAdmin.labelEn")}</span>
                    <input name="labelEn" defaultValue={p.labelEn ?? ""} className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span>{t(locale, "commerceAdmin.compareAtMinor")}</span>
                    <input name="compareAtMinor" type="number" min={0} step={1} defaultValue={p.compareAtMinor ?? ""} className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span>{t(locale, "commerceAdmin.promoPriceMinor")}</span>
                    <input name="promoPriceMinor" type="number" min={0} step={1} defaultValue={p.promoPriceMinor ?? ""} className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span>{t(locale, "commerceAdmin.promoStartsUtc")}</span>
                    <input name="promoStartsAt" type="datetime-local" defaultValue={toLocalInput(p.promoStartsAt)} className={inputCls} dir="ltr" />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span>{t(locale, "commerceAdmin.promoEndsUtc")}</span>
                    <input name="promoEndsAt" type="datetime-local" defaultValue={toLocalInput(p.promoEndsAt)} className={inputCls} dir="ltr" />
                  </label>
                  {(p.period === "custom" || p.period === "term") && (
                    <label className="grid gap-1 text-xs">
                      <span>{t(locale, "commerceAdmin.periodDays")}</span>
                      <input name="periodDays" type="number" min={1} max={3650} defaultValue={p.periodDays ?? ""} className={inputCls} dir="ltr" />
                    </label>
                  )}
                  <div className="sm:col-span-2 lg:col-span-4">
                    <SubmitButton name="_action" value="update_plan">{t(locale, "commerceAdmin.savePlan")}</SubmitButton>
                  </div>
                </Form>
              )}
              <p className="mt-2 text-xs text-ink-muted">{t(locale, "commerceAdmin.planCreated").replace("{date}", formatDate(locale, p.createdAt))}</p>
              </details>
              {perms.edit && !product.archived && (
                <Form method="post" className="inline">
                  <input type="hidden" name="_action" value="plan_active" />
                  <input type="hidden" name="planId" value={p.id} />
                  <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                  <SubmitButton variant="secondary" name="_action" value="plan_active">
                    {p.active ? t(locale, "commerceAdmin.deactivate") : t(locale, "commerceAdmin.activate")}
                  </SubmitButton>
                </Form>
              )}
            </div>
          ))}

          {perms.edit && !product.archived && (
            <Form method="post" className="grid gap-3 rounded-xl bg-sand-100 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="_action" value="create_plan" />
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.amountMinor")}</span>
                <input name="amountMinor" type="number" min={0} step={1} required className={inputCls} dir="ltr" />
              </label>
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.currency")}</span>
                <input name="currency" defaultValue="EGP" maxLength={3} className={inputCls} dir="ltr" />
              </label>
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.planKind")}</span>
                <select name="planKind" className={selectCls} defaultValue="one_time">
                  <option value="one_time">{t(locale, "commerce.oneTime")}</option>
                  <option value="recurring" disabled={product.kind !== "subscription_plan"}>{t(locale, "commerce.recurring")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.period")}</span>
                <select name="period" className={selectCls} defaultValue="">
                  <option value="">{t(locale, "commerceAdmin.none")}</option>
                  <option value="monthly">{t(locale, "commerce.periodMonthly")}</option>
                  <option value="term">{t(locale, "commerce.periodTerm")}</option>
                  <option value="annual">{t(locale, "commerce.periodAnnual")}</option>
                  <option value="custom">{t(locale, "commerce.periodCustom")}</option>
                  <option value="fixed_date">{t(locale, "commerce.periodFixed")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.periodDays")}</span>
                <input name="periodDays" type="number" min={1} max={3650} className={inputCls} dir="ltr" />
              </label>
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.fixedEndsUtc")}</span>
                <input name="fixedEndsAt" type="datetime-local" className={inputCls} dir="ltr" />
              </label>
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.labelAr")}</span>
                <input name="labelAr" className={inputCls} dir="rtl" />
              </label>
              <label className="grid gap-1 text-xs">
                <span>{t(locale, "commerceAdmin.labelEn")}</span>
                <input name="labelEn" className={inputCls} dir="ltr" />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="planActive" />
                {t(locale, "commerceAdmin.activeImmediately")}
              </label>
              <div className="sm:col-span-2 lg:col-span-4">
                <SubmitButton name="_action" value="create_plan">{t(locale, "commerceAdmin.createPlan")}</SubmitButton>
              </div>
            </Form>
          )}
          <p className="text-xs text-ink-muted">{t(locale, "commerceAdmin.minorUnitsNote")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
