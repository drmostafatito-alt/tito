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
import { buildReceiptMessage, visiblePaymentMethods, whatsAppReceiptHref } from "~server/commerce/payment-methods";
import { orderScopeView, scopeLinePairs } from "~server/commerce/order-scope.server";
import {
  buildR2Key,
  deleteFile,
  detectKind,
  insertFile,
  normalizeUploadMime,
  requestBodyTooLarge,
  sha256HexOf,
  signFileUrl,
  sizeCapFor,
  uploadBytesMatchMime,
} from "~server/files/storage.server";
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

  // Manual payment rails the owner actually configured (disabled or unconfigured
  // methods never reach this page — see server/commerce/payment-methods.ts).
  const settings = await getSettings(db);
  const methods = visiblePaymentMethods(settings.payments.methods);

  // WhatsApp receipt hand-off: a click-to-chat link built server-side from REAL
  // request data. The platform does not send or receive anything by itself; the
  // student attaches the receipt inside WhatsApp.
  const firstItem = items[0] ?? null;
  const scope = firstItem
    ? await orderScopeView(db, {
        entitlementSpec: firstItem.spec,
        titleSnapshotAr: firstItem.titleSnapshotAr,
        titleSnapshotEn: firstItem.titleSnapshotEn,
      })
    : null;
  const scopeLinesFor = (loc: "ar" | "en"): string[] => {
    const out: string[] = [];
    for (const pair of scope ? scopeLinePairs(scope) : []) {
      const labelKey =
        pair.key === "year" ? "commerce.scopeYear"
        : pair.key === "grade" ? "commerce.scopeGrade"
        : pair.key === "subject" ? "commerce.scopeSubject"
        : "commerce.scopeTerm";
      out.push(`${t(loc, labelKey)}: ${loc === "ar" ? pair.title.ar : pair.title.en}`);
    }
    return out;
  };
  const receiptHrefFor = (loc: "ar" | "en"): string | null => {
    if (!settings.payments.receiptWhatsappEnabled || !settings.platform.whatsapp) return null;
    const first = methods[0] ?? null;
    const message = buildReceiptMessage({
      locale: loc,
      studentName: auth.user.fullName || auth.user.email,
      studentEmail: auth.user.email,
      orderNumber: order.orderNumber,
      amount: formatMoney(order.totalMinor, order.currency),
      currency: order.currency,
      scopeLines: scopeLinesFor(loc),
      planLabel: scope?.planLabel ? (loc === "ar" ? scope.planLabel.ar : scope.planLabel.en) : null,
      // the message names the rails that are actually configured; the student
      // picks one in the form and the row records the exact choice
      methodLabel: first ? (loc === "ar" ? first.labelAr : first.labelEn) : "",
      note: loc === "ar" ? settings.payments.receiptNoteAr : settings.payments.receiptNoteEn,
    });
    return whatsAppReceiptHref(settings.platform.whatsapp, message);
  };

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
    scope: scope
      ? {
          years: scope.years,
          grades: scope.grades,
          subjects: scope.subjects,
          terms: scope.terms,
          scopeKind: scope.scopeKind,
          planLabel: scope.planLabel,
        }
      : null,
    methods,
    whatsappHrefAr: receiptHrefFor("ar"),
    whatsappHrefEn: receiptHrefFor("en"),
    payments: await Promise.all(payments.map(async (p) => {
      const evidence = ((p.metadata ?? {}) as {
        evidence?: { transferReference?: string; note?: string | null; proofFileId?: string | null; senderName?: string | null; transferDateMs?: number | null; transferAmountMinor?: number | null; confirmedAt?: number };
      }).evidence ?? null;
      // Student sees their OWN proof image (owner-only signed URL). This page is
      // already scoped to the owner via orderDetailForStudent (IDOR-shaped), and
      // proofFileId is only ever set server-side to a file the owner submitted —
      // so minting a short-lived URL here cannot leak another user's file.
      let proofPreview: { url: string } | null = null;
      if (evidence?.proofFileId) {
        proofPreview = { url: (await signFileUrl(getEnv(context), evidence.proofFileId, "view", 600)).path };
      }
      return {
        id: p.id,
        provider: p.provider,
        status: p.status,
        amountMinor: p.amountMinor,
        currency: p.currency,
        createdAt: p.createdAt,
        reviewedAt: p.reviewedAt,
        paidAt: p.paidAt,
        instructions: (p.instructions ?? null) as { reference?: string; instructionsAr?: string; instructionsEn?: string } | null,
        evidence,
        rejection: ((p.metadata ?? {}) as { rejection?: { reason?: string; at?: number } }).rejection ?? null,
        proofPreview,
      };
    })),
    viewerRoleRank: auth.user.rank,
    requestUrl: request.url,
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  if (requestBodyTooLarge(request)) return { error: "proof_too_large" as const };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const settings = await getSettings(db);

  const view = await orderDetailForStudent(db, String(params.orderNumber ?? ""), auth.user.id);
  if (!view) throw new Response("Not found", { status: 404 });

  if (intent === "confirm_payment") {
    const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER);
    const rl = await checkRateLimit(db, "payment_confirm", `${auth.user.id}:${ipHash}`, 10, 3_600_000);
    if (!rl.ok) return { error: "rate_limited" as const };
    // Optional proof screenshot (private image owned by this student). Uploaded
    // only when present; rolled back if the confirm below fails so no orphan file.
    const proofFile = form.get("proofFile");
    let proofFileId: string | null = null;
    if (proofFile instanceof File && proofFile.size > 0) {
      const mime = normalizeUploadMime(proofFile.type || "application/octet-stream");
      const kind = detectKind(mime);
      if (kind !== "image") return { error: "invalid_proof_file" as const };
      if (proofFile.size > sizeCapFor("image")) return { error: "proof_too_large" as const };
      const buf = await proofFile.arrayBuffer();
      if (!uploadBytesMatchMime(buf, mime)) return { error: "invalid_proof_file" as const };
      const checksum = await sha256HexOf(buf);
      const r2Key = buildR2Key("image", proofFile.name, "private");
      await env.PRIVATE_FILES.put(r2Key, buf, { httpMetadata: { contentType: mime } });
      proofFileId = await insertFile(db, {
        r2Key, bucket: "PRIVATE_FILES", kind: "image", originalFilename: proofFile.name.slice(0, 200),
        mime, byteSize: proofFile.size, checksumSha256: checksum, visibility: "private", createdBy: auth.user.id,
      });
    }
    const transferDateRaw = String(form.get("transferDate") ?? "");
    const transferDateMs = transferDateRaw ? new Date(`${transferDateRaw}:00Z`).getTime() : null;
    const amountRaw = String(form.get("transferAmount") ?? "").trim();
    const parsedAmount = Number(amountRaw);
    const transferAmountMinor = amountRaw && Number.isFinite(parsedAmount) ? Math.round(parsedAmount * 100) : null;
    const senderName = String(form.get("senderName") ?? "").trim() || null;
    try {
      await confirmManualPayment(db, {
        studentId: auth.user.id,
        orderId: view.order.id,
        transferReference: String(form.get("transferReference") ?? ""),
        note: String(form.get("note") ?? "") || null,
        proofFileId,
        senderName,
        transferDateMs: Number.isFinite(transferDateMs) ? transferDateMs : null,
        transferAmountMinor,
        // the rail the student picked — re-validated server-side against the
        // enabled + configured methods (a disabled rail is rejected)
        methodId: String(form.get("methodId") ?? "") || null,
        paymentsSettings: settings.payments,
      });
      return { ok: true as const };
    } catch (err) {
      if (proofFileId) await deleteFile(db, env, proofFileId).catch(() => {});
      if (err instanceof CommerceStateError) return { error: err.reason as "order_not_pending" };
      if (err instanceof CommerceValidationError) return { error: err.reason as "amount_mismatch" };
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
  const { order, items, payments, scope, methods } = loaderData;
  const latest = payments[0] ?? null;
  const canConfirm = order.status === "pending" && latest !== null && (latest.status === "pending" || latest.status === "failed");
  const whatsappHref = locale === "ar" ? loaderData.whatsappHrefAr : loaderData.whatsappHrefEn;
  const scopeEntries: Array<{ label: string; titles: { ar: string; en: string }[] }> = [
    { label: t(locale, "commerce.scopeYear"), titles: scope?.years ?? [] },
    { label: t(locale, "commerce.scopeGrade"), titles: scope?.grades ?? [] },
    { label: t(locale, "commerce.scopeSubject"), titles: scope?.subjects ?? [] },
    { label: t(locale, "commerce.scopeTerm"), titles: scope?.terms ?? [] },
  ].filter((e) => e.titles.length > 0);

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

      {/* What is actually being subscribed to: السنة · الصف · المادة · الترم */}
      {scopeEntries.length > 0 && (
        <Card>
          <CardHeader title={t(locale, "commerce.subscriptionScope")} />
          <CardBody>
            <dl className="space-y-1.5 text-sm" data-testid="order-scope">
              {scopeEntries.map((e) => (
                <div key={e.label} className="flex flex-wrap justify-between gap-2">
                  <dt className="text-slate-500">{e.label}</dt>
                  <dd className="font-medium text-slate-800">
                    {e.titles.map((x) => (locale === "ar" ? x.ar : x.en)).join("، ")}
                  </dd>
                </div>
              ))}
              {scope?.planLabel && (
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-slate-500">{t(locale, "commerce.scopePlan")}</dt>
                  <dd className="font-medium text-slate-800">
                    {locale === "ar" ? scope.planLabel.ar : scope.planLabel.en}
                    {scope.scopeKind === "full_year" ? ` · ${t(locale, "commerce.scopeFullYear")}` : ""}
                  </dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>
      )}

      {/* Request state — the student always knows where their request stands.
          Access is granted ONLY after the admin approves the payment. */}
      {order.status === "pending" && latest?.status === "under_review" && (
        <Alert kind="info">
          <span className="font-semibold">{t(locale, "commerce.requestPendingTitle")}</span>{" "}
          {t(locale, "commerce.requestPendingBody")}
        </Alert>
      )}

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

            {latest.evidence && (latest.status === "under_review" || latest.status === "paid" || latest.status === "failed") && (
              <dl className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="submitted-evidence">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">{t(locale, "commerce.transferReference")}</dt>
                  <dd dir="ltr">{latest.evidence.transferReference || "—"}</dd>
                </div>
                {latest.evidence.senderName ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t(locale, "commerce.senderName")}</dt>
                    <dd>{latest.evidence.senderName}</dd>
                  </div>
                ) : null}
                {latest.evidence.transferAmountMinor != null ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t(locale, "commerce.transferAmount")}</dt>
                    <dd dir="ltr">{formatMoney(latest.evidence.transferAmountMinor, order.currency)}</dd>
                  </div>
                ) : null}
                {latest.evidence.transferDateMs ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">{t(locale, "commerce.transferDate")}</dt>
                    <dd>{formatDate(locale, latest.evidence.transferDateMs)}</dd>
                  </div>
                ) : null}
                {latest.proofPreview ? (
                  <div className="flex flex-col gap-2 pt-1">
                    <dt className="text-slate-500">{t(locale, "commerce.proofImage")}</dt>
                    <img src={latest.proofPreview.url} alt={t(locale, "commerce.proofImageAlt")} className="max-h-48 w-full rounded-lg border border-slate-200 bg-white object-contain" data-testid="proof-preview-img" />
                  </div>
                ) : null}
              </dl>
            )}

            {canConfirm && (
              <Form method="post" encType="multipart/form-data" className="space-y-3 pt-1">
                <input type="hidden" name="_action" value="confirm_payment" />
                {/* Manual rails only (InstaPay / Vodafone Cash / Etisalat Cash / …).
                    Rendered from admin settings; a disabled or unconfigured rail
                    is never listed. No destination is hardcoded anywhere. */}
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-semibold text-slate-700">
                    {t(locale, "commerce.paymentMethodChoose")}
                  </legend>
                  {methods.length === 0 ? (
                    <p className="text-sm text-slate-500" data-testid="no-payment-methods">
                      {t(locale, "commerce.paymentMethodNone")}
                    </p>
                  ) : (
                    methods.map((m, i) => (
                      <label
                        key={m.id}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                        data-testid={`payment-method-${m.key}`}
                      >
                        <input type="radio" name="methodId" value={m.id} required defaultChecked={i === 0} className="mt-1" />
                        <span className="min-w-0 text-sm">
                          <span className="block font-semibold text-slate-800">{locale === "ar" ? m.labelAr : m.labelEn}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{t(locale, "commerce.paymentMethodDestination")}</span>
                          <span className="block font-mono text-sm text-slate-900" dir="ltr">{m.destination}</span>
                          {(locale === "ar" ? m.accountNameAr : m.accountNameEn) && (
                            <span className="mt-0.5 block text-xs text-slate-600">
                              {t(locale, "commerce.paymentMethodAccountName")}: {locale === "ar" ? m.accountNameAr : m.accountNameEn}
                            </span>
                          )}
                          {(locale === "ar" ? m.instructionsAr : m.instructionsEn) && (
                            <span className="mt-1 block whitespace-pre-line text-xs text-slate-600">
                              {locale === "ar" ? m.instructionsAr : m.instructionsEn}
                            </span>
                          )}
                        </span>
                      </label>
                    ))
                  )}
                </fieldset>
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
                  <span>{t(locale, "commerce.senderName")} <span className="text-xs text-slate-400">({t(locale, "commerce.optional")})</span></span>
                  <input name="senderName" dir="auto" maxLength={200} className="rounded-lg border border-slate-300 px-3 py-2" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span>{t(locale, "commerce.transferAmount")} <span className="text-xs text-slate-400">({t(locale, "commerce.mustEqualTotal")})</span></span>
                    <input name="transferAmount" type="number" inputMode="decimal" step="0.01" min="0" dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2" placeholder={formatMoney(order.totalMinor, order.currency).replace(/[^\d.,\s]/g, "").trim()} />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>{t(locale, "commerce.transferDate")} <span className="text-xs text-slate-400">({t(locale, "commerce.optional")})</span></span>
                    <input type="datetime-local" name="transferDate" className="rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                </div>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "commerce.proofFile")} <span className="text-xs text-slate-400">({t(locale, "commerce.optional")})</span></span>
                  <input type="file" name="proofFile" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "commerce.noteOptional")}</span>
                  <input name="note" dir="auto" maxLength={500} className="rounded-lg border border-slate-300 px-3 py-2" />
                </label>
                <p className="text-xs text-slate-500">{t(locale, "commerce.proofPrivacy")}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <SubmitButton name="_action" value="confirm_payment">{t(locale, "commerce.confirmPayment")}</SubmitButton>
                  <SubmitButton variant="secondary" name="_action" value="cancel_order">{t(locale, "commerce.cancelOrder")}</SubmitButton>
                </div>
                <p className="text-xs text-slate-500">{t(locale, "commerce.confirmDisclaimer")}</p>
                {/* WhatsApp hand-off: click-to-chat with the request details
                    pre-filled. The student attaches the receipt image themselves —
                    the platform has no WhatsApp API and claims no automatic
                    delivery. Hidden entirely when no number is configured. */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-700">{t(locale, "commerce.sendReceiptWhatsapp")}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{t(locale, "commerce.sendReceiptHint")}</p>
                  {whatsappHref ? (
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1ebe5b]"
                      data-testid="whatsapp-receipt-link"
                    >
                      {t(locale, "commerce.sendReceiptWhatsapp")}
                    </a>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500" data-testid="whatsapp-not-configured">
                      {t(locale, "commerce.receiptNotConfigured")}
                    </p>
                  )}
                </div>
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
