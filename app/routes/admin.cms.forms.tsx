import type { Route } from "./+types/admin.cms.forms";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import {
  CmsReferenceError,
  CmsValidationError,
  addFormField,
  canCms,
  createForm,
  deleteFormField,
  fieldsForForm,
  getForm,
  listForms,
  listSubmissions,
  moveFormField,
  updateForm,
  updateFormField,
} from "~server/cms/service.server";
import { cmsLabel, FORM_FIELD_TYPES } from "~/cms/registry";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { formatDateTime, type Locale } from "~/lib/i18n";

/**
 * Configurable forms admin (Phase 3 stage 2). Fields, labels, validation rules,
 * messages and consent are DATA — declarative only; there is no server-side code
 * execution path here (validation is built from whitelisted zod rules).
 */

export async function loader({ context, request }: Route.LoaderArgs) {
  const guarded = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canCms(db, guarded.auth, "cms.manage_forms"))) {
    return { denied: true as const, forms: [], form: null, fields: [], submissions: [] };
  }
  const url = new URL(request.url);
  const formId = url.searchParams.get("form");
  const forms = await listForms(db);
  if (!formId) return { denied: false as const, forms, form: null, fields: [], submissions: [] };
  const form = await getForm(db, formId);
  if (!form) return { denied: false as const, forms, form: null, fields: [], submissions: [] };
  const [fields, submissions] = await Promise.all([
    fieldsForForm(db, formId),
    listSubmissions(db, formId, 50),
  ]);
  return { denied: false as const, forms, form, fields, submissions };
}

function parseJsonField(raw: string | null): { ok: true; value: unknown } | { ok: false } {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: undefined };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}

export async function action({ context, request }: Route.ActionArgs) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  if (!(await canCms(db, guarded.auth, "cms.manage_forms"))) return { error: "denied" as const };
  const actor = { userId: guarded.auth.user.id, role: guarded.auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  try {
    if (intent === "create") {
      const actionType = String(form.get("actionType") ?? "generic");
      const row = await createForm(
        db,
        {
          titleAr: String(form.get("titleAr") ?? ""),
          titleEn: String(form.get("titleEn") ?? ""),
          actionType: actionType === "contact" || actionType === "newsletter" ? actionType : "generic",
        },
        actor
      );
      return { ok: true as const, createdId: row.id };
    }
    const formId = String(form.get("formId") ?? "");
    if (intent === "update-form") {
      await updateForm(db, formId, {
        titleAr: String(form.get("titleAr") ?? ""),
        titleEn: String(form.get("titleEn") ?? ""),
        actionType: String(form.get("actionType") ?? ""),
        status: String(form.get("status") ?? ""),
        successAr: String(form.get("successAr") ?? ""),
        successEn: String(form.get("successEn") ?? ""),
        failureAr: String(form.get("failureAr") ?? ""),
        failureEn: String(form.get("failureEn") ?? ""),
        consentRequired: form.get("consentRequired") === "on",
        consentAr: String(form.get("consentAr") ?? ""),
        consentEn: String(form.get("consentEn") ?? ""),
        storeSubmissions: form.get("storeSubmissions") === "on",
      }, actor);
      return { ok: true as const };
    }
    if (intent === "add-field" || intent === "update-field") {
      const options = parseJsonField(form.get("optionsJson") as string | null);
      const validation = parseJsonField(form.get("validationJson") as string | null);
      if (!options.ok || !validation.ok) return { error: "validation" as const, issues: ["options/validation: invalid JSON"] };
      if (options.value !== undefined && !Array.isArray(options.value)) return { error: "validation" as const, issues: ["options: must be a JSON array"] };
      if (validation.value !== undefined && (typeof validation.value !== "object" || validation.value === null || Array.isArray(validation.value))) {
        return { error: "validation" as const, issues: ["validation: must be a JSON object"] };
      }
      const patch: Record<string, unknown> = {
        labelAr: String(form.get("labelAr") ?? ""),
        labelEn: String(form.get("labelEn") ?? ""),
        placeholderAr: String(form.get("placeholderAr") ?? ""),
        placeholderEn: String(form.get("placeholderEn") ?? ""),
        helpAr: String(form.get("helpAr") ?? ""),
        helpEn: String(form.get("helpEn") ?? ""),
        required: form.get("required") === "on",
        enabled: form.get("enabled") === "on",
        defaultValue: String(form.get("defaultValue") ?? ""),
      };
      if (options.value !== undefined) patch.options = options.value;
      if (validation.value !== undefined) patch.validation = validation.value;
      if (intent === "add-field") {
        await addFormField(db, formId, { ...patch, name: String(form.get("name") ?? ""), type: String(form.get("type") ?? "text") }, actor);
      } else {
        await updateFormField(db, String(form.get("fieldId") ?? ""), patch, actor);
      }
      return { ok: true as const };
    }
    const fieldId = String(form.get("fieldId") ?? "");
    if (intent === "move-field-up") { await moveFormField(db, fieldId, "up", actor); return { ok: true as const }; }
    if (intent === "move-field-down") { await moveFormField(db, fieldId, "down", actor); return { ok: true as const }; }
    if (intent === "delete-field") { await deleteFormField(db, fieldId, actor); return { ok: true as const }; }
    return { error: "generic" as const };
  } catch (err) {
    if (err instanceof CmsValidationError) return { error: "validation" as const, issues: err.issues.map((i) => `${i.path}: ${i.message}`) };
    if (err instanceof CmsReferenceError) return { error: "reference" as const, issues: [err.message] };
    throw err;
  }
}

type Loc = "ar" | "en";

function MiniForm({ children }: { children: React.ReactNode }) {
  return <Form method="post" className="inline">{children}</Form>;
}

function ToolButton({ label, danger = false }: { label: string; danger?: boolean }) {
  return (
    <button type="submit" className={`inline-flex min-h-9 items-center rounded-lg border px-2.5 text-xs font-medium ${danger ? "border-red-200 text-red-600 hover:bg-red-50" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
      {label}
    </button>
  );
}

const inputCls = "h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none";

export default function AdminCmsForms({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = (root?.locale ?? "ar") as Loc;
  const L = (k: string) => cmsLabel(k, locale);
  const actionData = useActionData<typeof action>();

  if (loaderData.denied) return <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>;
  const label = (ar: string | null, en: string | null) => (locale === "ar" ? ar || en || "" : en || ar || "");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/cms" className="inline-flex min-h-11 items-center text-sm text-slate-600 hover:text-slate-900"><span aria-hidden="true" className="inline-block rtl:rotate-180">←</span> {L("cms.ui.backToPages")}</Link>
        <h1 className="text-2xl font-bold text-slate-900">{L("cms.ui.forms")}</h1>
      </div>

      {actionData && "error" in actionData && actionData.error === "denied" && <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>}
      {actionData && "issues" in actionData && actionData.issues && <Alert kind="error">{actionData.issues.join(" — ")}</Alert>}

      {!loaderData.form && (
        <>
          <Card>
            <CardHeader title={L("cms.ui.newForm")} />
            <CardBody>
              <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <input type="hidden" name="_action" value="create" />
                <Input label={L("cms.ui.titleAr")} name="titleAr" dir="rtl" required />
                <Input label={L("cms.ui.titleEn")} name="titleEn" dir="ltr" />
                <div className="flex flex-col">
                  <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.ui.actionType")}</span>
                  <select name="actionType" defaultValue="generic" className={inputCls}>
                    <option value="generic">generic</option>
                    <option value="contact">contact</option>
                    <option value="newsletter">newsletter</option>
                  </select>
                </div>
                <SubmitButton>{L("cms.ui.newForm")}</SubmitButton>
              </Form>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              {loaderData.forms.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">{L("cms.ui.noPages")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-slate-100">
                  {(loaderData.forms as unknown as Array<Record<string, unknown>>).map((f) => (
                    <li key={String(f.id)} className="flex flex-wrap items-center gap-2 py-2.5">
                      <Badge tone={f.status === "active" ? "success" : "neutral"}>{String(f.status)}</Badge>
                      <Link to={`/admin/cms/forms?form=${String(f.id)}`} className="text-sm font-semibold text-slate-900 hover:underline">
                        {label(f.titleAr as string, f.titleEn as string)}
                      </Link>
                      <span className="text-xs text-slate-500" dir="ltr">{String(f.slug)} · {String(f.actionType)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {loaderData.form && (() => {
        const f = loaderData.form as unknown as Record<string, unknown>;
        const formId = String(f.id);
        const fields = loaderData.fields as unknown as Array<Record<string, unknown>>;
        const submissions = loaderData.submissions as unknown as Array<Record<string, unknown>>;
        return (
          <>
            <Card>
              <CardHeader title={L("cms.ui.formSettings")} description={String(f.slug)} />
              <CardBody>
                <Form method="post" className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="_action" value="update-form" />
                  <input type="hidden" name="formId" value={formId} />
                  <Input label={L("cms.ui.titleAr")} name="titleAr" defaultValue={String(f.titleAr ?? "")} dir="rtl" />
                  <Input label={L("cms.ui.titleEn")} name="titleEn" defaultValue={String(f.titleEn ?? "")} dir="ltr" />
                  <div className="flex flex-col">
                    <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.ui.actionType")}</span>
                    <select name="actionType" defaultValue={String(f.actionType)} className={inputCls}>
                      <option value="generic">generic</option>
                      <option value="contact">contact</option>
                      <option value="newsletter">newsletter</option>
                    </select>
                  </div>
                  <div className="flex flex-col">
                    <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.ui.formStatus")}</span>
                    <select name="status" defaultValue={String(f.status)} className={inputCls}>
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </div>
                  <Input label={`${L("cms.ui.successMsg")} (عربي)`} name="successAr" defaultValue={String(f.successAr ?? "")} dir="rtl" />
                  <Input label={`${L("cms.ui.successMsg")} (English)`} name="successEn" defaultValue={String(f.successEn ?? "")} dir="ltr" />
                  <Input label={`${L("cms.ui.failureMsg")} (عربي)`} name="failureAr" defaultValue={String(f.failureAr ?? "")} dir="rtl" />
                  <Input label={`${L("cms.ui.failureMsg")} (English)`} name="failureEn" defaultValue={String(f.failureEn ?? "")} dir="ltr" />
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" name="consentRequired" defaultChecked={f.consentRequired === true} className="h-4 w-4" />
                    {L("cms.ui.consentRequired")}
                  </label>
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" name="storeSubmissions" defaultChecked={f.storeSubmissions === true} className="h-4 w-4" />
                    {L("cms.ui.storeSubmissions")}
                  </label>
                  <Input label={`${L("cms.ui.consentText")} (عربي)`} name="consentAr" defaultValue={String(f.consentAr ?? "")} dir="rtl" />
                  <Input label={`${L("cms.ui.consentText")} (English)`} name="consentEn" defaultValue={String(f.consentEn ?? "")} dir="ltr" />
                  <SubmitButton variant="secondary" className="w-fit">{L("cms.ui.save")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={L("cms.ui.fields")} />
              <CardBody>
                {fields.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">{L("cms.ui.noFields")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {fields.map((fd) => (
                      <li key={String(fd.id)} className={`rounded-lg border border-slate-200 px-3 py-2 ${fd.enabled ? "bg-white" : "bg-slate-50 opacity-60"}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="neutral">{String(fd.type)}</Badge>
                          <span className="text-sm font-medium text-slate-800">{label(fd.labelAr as string, fd.labelEn as string) || String(fd.name)}</span>
                          <span className="text-xs text-slate-500" dir="ltr">{String(fd.name)}</span>
                          {fd.required === true && <Badge tone="warning">{L("cms.ui.required")}</Badge>}
                          <span className="ms-auto flex items-center gap-1.5">
                            <MiniForm>
                              <input type="hidden" name="_action" value="move-field-up" />
                              <input type="hidden" name="fieldId" value={String(fd.id)} />
                              <ToolButton label="↑" />
                            </MiniForm>
                            <MiniForm>
                              <input type="hidden" name="_action" value="move-field-down" />
                              <input type="hidden" name="fieldId" value={String(fd.id)} />
                              <ToolButton label="↓" />
                            </MiniForm>
                            <MiniForm>
                              <input type="hidden" name="_action" value="delete-field" />
                              <input type="hidden" name="fieldId" value={String(fd.id)} />
                              <ToolButton label={L("cms.ui.delete")} danger />
                            </MiniForm>
                          </span>
                        </div>
                        <details className="mt-1">
                          <summary className="min-h-9 cursor-pointer text-xs font-medium text-brand-700">{L("cms.ui.edit")}</summary>
                          <Form method="post" className="mt-2 grid gap-3 sm:grid-cols-2">
                            <input type="hidden" name="_action" value="update-field" />
                            <input type="hidden" name="formId" value={formId} />
                            <input type="hidden" name="fieldId" value={String(fd.id)} />
                            <Input label={`${L("cms.ui.label")} (عربي)`} name="labelAr" defaultValue={String(fd.labelAr ?? "")} dir="rtl" />
                            <Input label={`${L("cms.ui.label")} (English)`} name="labelEn" defaultValue={String(fd.labelEn ?? "")} dir="ltr" />
                            <Input label={`${L("cms.ui.placeholder")} (عربي)`} name="placeholderAr" defaultValue={String(fd.placeholderAr ?? "")} dir="rtl" />
                            <Input label={`${L("cms.ui.placeholder")} (English)`} name="placeholderEn" defaultValue={String(fd.placeholderEn ?? "")} dir="ltr" />
                            <Input label={`${L("cms.ui.helpText")} (عربي)`} name="helpAr" defaultValue={String(fd.helpAr ?? "")} dir="rtl" />
                            <Input label={`${L("cms.ui.helpText")} (English)`} name="helpEn" defaultValue={String(fd.helpEn ?? "")} dir="ltr" />
                            <Input label={L("cms.ui.defaultValue")} name="defaultValue" defaultValue={String(fd.defaultValue ?? "")} dir="ltr" />
                            <div className="flex flex-col">
                              <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.ui.optionsJson")}</span>
                              <textarea name="optionsJson" rows={3} dir="ltr" defaultValue={fd.options ? JSON.stringify(fd.options) : ""} placeholder={L("cms.ui.optionsHint")} className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none" />
                            </div>
                            <div className="flex flex-col">
                              <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.ui.validationJson")}</span>
                              <textarea name="validationJson" rows={3} dir="ltr" defaultValue={fd.validation ? JSON.stringify(fd.validation) : ""} placeholder={L("cms.ui.validationHint")} className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none" />
                            </div>
                            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
                              <input type="checkbox" name="required" defaultChecked={fd.required === true} className="h-4 w-4" />
                              {L("cms.ui.required")}
                            </label>
                            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
                              <input type="checkbox" name="enabled" defaultChecked={fd.enabled !== false} className="h-4 w-4" />
                              {L("cms.ui.enabled")}
                            </label>
                            <SubmitButton variant="secondary" className="w-fit">{L("cms.ui.save")}</SubmitButton>
                          </Form>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={L("cms.ui.addField")} />
              <CardBody>
                <Form method="post" className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="_action" value="add-field" />
                  <input type="hidden" name="formId" value={formId} />
                  <Input label={L("cms.ui.fieldName")} name="name" dir="ltr" required pattern="[a-z][a-z0-9_]*" placeholder="full_name" />
                  <div className="flex flex-col">
                    <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.ui.fieldType")}</span>
                    <select name="type" defaultValue="text" className={inputCls}>
                      {FORM_FIELD_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
                    </select>
                  </div>
                  <Input label={`${L("cms.ui.label")} (عربي)`} name="labelAr" dir="rtl" />
                  <Input label={`${L("cms.ui.label")} (English)`} name="labelEn" dir="ltr" />
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" name="required" className="h-4 w-4" />
                    {L("cms.ui.required")}
                  </label>
                  <SubmitButton className="w-fit">{L("cms.ui.addField")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={L("cms.ui.submissions")} />
              <CardBody>
                {submissions.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">{L("cms.ui.noSubmissions")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {submissions.map((sub) => (
                      <li key={String(sub.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                        <span className="text-slate-500">{formatDateTime(locale, Number(sub.createdAt))}</span>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-slate-700" dir="auto">{JSON.stringify(sub.data, null, 1)}</pre>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </>
        );
      })()}
    </div>
  );
}
