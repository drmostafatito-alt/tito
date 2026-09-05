import { useState } from "react";
import { Icon } from "~/cms/icons";
import { cmsLabel, ICON_IDS, ls, type FieldDef } from "~/cms/registry";

/**
 * Descriptor-driven builder inputs (Phase 3 admin). Input names follow the
 * `f.<path>` convention that app/cms/formdata.ts reads back, so the SAME
 * registry descriptors drive editing, parsing, validation and rendering —
 * there is exactly one schema definition. Values are never trusted: the
 * server re-parses with zod on every save/publish.
 */

export interface PickerOption { id: string; label: string; url?: string }
export interface PickerData {
  images: PickerOption[];
  videos: PickerOption[];
  forms: PickerOption[];
  courses: PickerOption[];
  subjects: PickerOption[];
  programs: PickerOption[];
}

type Loc = "ar" | "en";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500";

function Label({ k, locale }: { k: string; locale: Loc }) {
  return <span className="mb-1 block text-sm font-medium text-slate-700">{cmsLabel(k, locale)}</span>;
}

function datetimeValue(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 16);
}

function PickerSelect({ name, options, value, locale }: { name: string; options: PickerOption[]; value: string; locale: Loc }) {
  const missing = value && !options.some((o) => o.id === value);
  return (
    <select name={name} defaultValue={value ?? ""} className={inputCls}>
      <option value="">—</option>
      {missing && <option value={value}>{value.slice(0, 8)}… ({cmsLabel("cms.ui.emptyPicker", locale)})</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
}

function SingleField({ field, path, value, pickers, locale }: { field: FieldDef; path: string; value: unknown; pickers: PickerData; locale: Loc }) {
  const name = `f.${path}`;
  const sv = typeof value === "string" ? value : "";
  switch (field.kind) {
    case "ltext":
    case "ltextarea":
    case "lrichtext": {
      const ar = ls((value as { ar?: string }) ?? {}, "ar");
      const en = ls((value as { en?: string }) ?? {}, "en");
      const Edit = field.kind === "ltext" ? "input" : "textarea";
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {(["ar", "en"] as const).map((lng) => (
            <div key={lng} className="flex flex-col">
              <Label k={field.labelKey} locale={locale} />
              <span className="mb-1 text-xs text-slate-400">{lng === "ar" ? "عربي" : "English"}</span>
              {Edit === "input" ? (
                <input name={`${name}.${lng}`} defaultValue={lng === "ar" ? ar : en} maxLength={field.max} className={inputCls} dir={lng === "ar" ? "rtl" : "ltr"} />
              ) : (
                <textarea name={`${name}.${lng}`} defaultValue={lng === "ar" ? ar : en} rows={field.kind === "lrichtext" ? 6 : 3} className={inputCls} dir={lng === "ar" ? "rtl" : "ltr"} />
              )}
            </div>
          ))}
          {field.kind === "lrichtext" && <p className="text-xs text-slate-400 sm:col-span-2">{cmsLabel("cms.ui.richtextHint", locale)}</p>}
        </div>
      );
    }
    case "text":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          <input name={name} defaultValue={sv} maxLength={field.max} className={inputCls} />
        </div>
      );
    case "number":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          <input name={name} type="number" defaultValue={typeof value === "number" ? value : (field.min ?? 1)} min={field.min} max={field.max} className={inputCls} />
        </div>
      );
    case "toggle":
      return (
        <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
          <input name={name} type="checkbox" defaultChecked={value === true} className="h-4 w-4" />
          {cmsLabel(field.labelKey, locale)}
        </label>
      );
    case "select":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          <select name={name} defaultValue={sv} className={inputCls}>
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>{cmsLabel(o.labelKey, locale)}</option>
            ))}
          </select>
        </div>
      );
    case "icon":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          <div className="flex items-center gap-2">
            {sv && <Icon name={sv} size="md" colorRole="default" />}
            <select name={name} defaultValue={sv} className={inputCls}>
              <option value="">—</option>
              {ICON_IDS.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
        </div>
      );
    case "image":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          {sv && pickers.images.some((o) => o.id === sv) && (
            <img src={`/files/${sv}`} alt="" className="mb-1.5 h-16 w-16 rounded-lg border border-slate-200 object-cover" />
          )}
          <PickerSelect name={name} options={pickers.images} value={sv} locale={locale} />
        </div>
      );
    case "link":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          <input name={name} defaultValue={sv} className={inputCls} dir="ltr" placeholder="/…" />
          <span className="mt-1 text-xs text-slate-400">{cmsLabel("cms.ui.linkHint", locale)}</span>
        </div>
      );
    case "datetime":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          <input name={name} type="datetime-local" defaultValue={datetimeValue(value)} className={inputCls} />
        </div>
      );
    case "formRef":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          <PickerSelect name={name} options={pickers.forms} value={sv} locale={locale} />
        </div>
      );
    case "videoRef":
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          <PickerSelect name={name} options={pickers.videos} value={sv} locale={locale} />
        </div>
      );
    case "refPicker": {
      const options = field.picker === "course" ? pickers.courses : field.picker === "subject" ? pickers.subjects : pickers.programs;
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <div className="flex flex-col">
          <Label k={field.labelKey} locale={locale} />
          {options.length === 0 ? (
            <p className="text-sm text-slate-400">{cmsLabel("cms.ui.emptyPicker", locale)}</p>
          ) : (
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
              {options.map((o) => (
                <label key={o.id} className="inline-flex min-h-9 items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50">
                  <input type="checkbox" name={`${name}[]`} value={o.id} defaultChecked={selected.has(o.id)} className="h-4 w-4" />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

function RepeaterField({ field, path, value, pickers, locale }: { field: FieldDef; path: string; value: unknown; pickers: PickerData; locale: Loc }) {
  const initial = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const [rows, setRows] = useState<Array<{ key: number; data: Record<string, unknown> }>>(
    initial.map((data, i) => ({ key: i, data }))
  );
  const maxItems = field.maxItems ?? 12;

  return (
    <div className="flex flex-col gap-2">
      <Label k={field.labelKey} locale={locale} />
      {rows.map((row, i) => (
        <fieldset key={row.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-500">
            {field.itemLabelKey ? cmsLabel(field.itemLabelKey, locale) : `#${i + 1}`} — {i + 1}
          </legend>
          <input type="hidden" name={`f.${path}.__idx`} value={i} />
          <div className="flex flex-col gap-3">
            {(field.items ?? []).map((sub) => (
              <SingleField key={sub.name} field={sub} path={`${path}[${i}].${sub.name}`} value={row.data[sub.name]} pickers={pickers} locale={locale} />
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 hover:bg-white disabled:opacity-40"
              disabled={i === 0}
              onClick={() => setRows((rs) => { const n = [...rs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}
            >
              ↑ {cmsLabel("cms.ui.moveUp", locale)}
            </button>
            <button
              type="button"
              className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 hover:bg-white disabled:opacity-40"
              disabled={i === rows.length - 1}
              onClick={() => setRows((rs) => { const n = [...rs]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}
            >
              ↓ {cmsLabel("cms.ui.moveDown", locale)}
            </button>
            <button
              type="button"
              className="inline-flex min-h-9 items-center rounded-lg border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50"
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            >
              {cmsLabel("cms.ui.removeRow", locale)}
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
        disabled={rows.length >= maxItems}
        onClick={() => setRows((rs) => [...rs, { key: Date.now() + Math.random(), data: {} }])}
      >
        + {cmsLabel("cms.ui.addRow", locale)}
      </button>
    </div>
  );
}

export function FieldEditors({ fields, values, pickers, locale }: { fields: FieldDef[]; values: Record<string, unknown>; pickers: PickerData; locale: Loc }) {
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) =>
        field.kind === "repeater" ? (
          <RepeaterField key={field.name} field={field} path={field.name} value={values[field.name]} pickers={pickers} locale={locale} />
        ) : (
          <SingleField key={field.name} field={field} path={field.name} value={values[field.name]} pickers={pickers} locale={locale} />
        )
      )}
    </div>
  );
}
