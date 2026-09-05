import type { FieldDef } from "./registry";

/**
 * Descriptor-driven FormData → props reconstruction.
 *
 * The admin builder renders inputs named `f.<path>` (e.g. `f.heading.ar`,
 * `f.items[2].label.en`, `f.items[2].href`). This walks the SAME field
 * descriptors that drive validation and rendering, so there is exactly one
 * schema definition. Values are coerced per kind; zod validation happens
 * afterwards (server-side) — this function never trusts the client.
 */

function numOf(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function datetimeOf(v: string | null): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function readScalar(formData: FormData, path: string): string {
  const v = formData.get(`f.${path}`);
  return typeof v === "string" ? v : "";
}

/** Repeater item indices present in the form data (checkbox-driven removal keeps indices dense). */
function repeaterIndices(formData: FormData, path: string): number[] {
  const raw = formData.getAll(`f.${path}.__idx`).map(String);
  if (raw.length) {
    const set = new Set<number>();
    for (const r of raw) {
      const n = Number(r);
      if (Number.isInteger(n) && n >= 0) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }
  // fallback: scan keys
  const prefix = `f.${path}[`;
  const set = new Set<number>();
  for (const key of formData.keys()) {
    if (key.startsWith(prefix)) {
      const end = key.indexOf("]", prefix.length);
      const n = Number(key.slice(prefix.length, end));
      if (Number.isInteger(n) && n >= 0) set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
}

function readFields(formData: FormData, fields: FieldDef[], prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    switch (f.kind) {
      case "ltext":
      case "ltextarea":
      case "lrichtext":
        out[f.name] = { ar: readScalar(formData, `${path}.ar`), en: readScalar(formData, `${path}.en`) };
        break;
      case "text":
      case "select":
      case "icon":
      case "image":
      case "link":
      case "formRef":
      case "videoRef":
        out[f.name] = readScalar(formData, path);
        break;
      case "number":
        out[f.name] = numOf(readScalar(formData, path)) ?? 0;
        break;
      case "toggle":
        out[f.name] = formData.get(`f.${path}`) === "on" || formData.get(`f.${path}`) === "true";
        break;
      case "datetime":
        out[f.name] = datetimeOf(readScalar(formData, path));
        break;
      case "refPicker":
        out[f.name] = formData.getAll(`f.${path}[]`).map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
        break;
      case "repeater": {
        const items: Array<Record<string, unknown>> = [];
        for (const i of repeaterIndices(formData, path)) {
          items.push(readFields(formData, f.items ?? [], `${path}[${i}]`));
        }
        out[f.name] = items;
        break;
      }
    }
  }
  return out;
}

export function readPropsFromForm(formData: FormData, fields: FieldDef[]): Record<string, unknown> {
  return readFields(formData, fields, "");
}
