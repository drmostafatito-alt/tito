import type { Route } from "./+types/admin.cms.menus";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import {
  CmsReferenceError,
  CmsValidationError,
  addMenuItem,
  canCms,
  deleteMenuItem,
  menuItemsFor,
  moveMenuItem,
  toggleMenuItem,
  updateMenuItem,
} from "~server/cms/service.server";
import { cmsLabel, ICON_IDS } from "~/cms/registry";
import { Icon } from "~/cms/icons";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import type { Locale } from "~/lib/i18n";

/** Navigation builder (Phase 3 stage 2). Menus drive the public header/footer chrome; links are validated (safeHref) and cannot bypass authorization — target routes still enforce their own guards. */

const LOCATIONS = ["header", "footer", "student", "legal"] as const;
type Loc = (typeof LOCATIONS)[number];

export async function loader({ context, request }: Route.LoaderArgs) {
  const guarded = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const allowed = await canCms(db, guarded.auth, "cms.manage_navigation");
  const url = new URL(request.url);
  const locParam = url.searchParams.get("loc");
  const location: Loc = LOCATIONS.includes(locParam as Loc) ? (locParam as Loc) : "header";
  if (!allowed) return { denied: true as const, location, menu: null };
  const menu = await menuItemsFor(db, location);
  return {
    denied: false as const,
    location,
    menu: {
      items: menu.items,
      topLevel: menu.topLevel.map((i) => ({ ...i, childIds: menu.items.filter((c) => c.parentId === i.id).map((c) => c.id) })),
    },
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  if (!(await canCms(db, guarded.auth, "cms.manage_navigation"))) return { error: "denied" as const };
  const actor = { userId: guarded.auth.user.id, role: guarded.auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const location = String(form.get("location") ?? "header") as Loc;

  try {
    if (intent === "add") {
      const parentId = String(form.get("parentId") ?? "") || null;
      await addMenuItem(
        db,
        LOCATIONS.includes(location) ? location : "header",
        {
          labelAr: String(form.get("labelAr") ?? ""),
          labelEn: String(form.get("labelEn") ?? ""),
          href: String(form.get("href") ?? ""),
          icon: String(form.get("icon") ?? "") || undefined,
          parentId,
        },
        actor
      );
      return { ok: true as const };
    }
    const itemId = String(form.get("itemId") ?? "");
    if (intent === "update") {
      await updateMenuItem(db, itemId, {
        labelAr: String(form.get("labelAr") ?? ""),
        labelEn: String(form.get("labelEn") ?? ""),
        href: String(form.get("href") ?? ""),
        icon: String(form.get("icon") ?? "") || null,
      }, actor);
      return { ok: true as const };
    }
    if (intent === "move-up") { await moveMenuItem(db, itemId, "up", actor); return { ok: true as const }; }
    if (intent === "move-down") { await moveMenuItem(db, itemId, "down", actor); return { ok: true as const }; }
    if (intent === "toggle") { await toggleMenuItem(db, itemId, actor); return { ok: true as const }; }
    if (intent === "delete") { await deleteMenuItem(db, itemId, actor); return { ok: true as const }; }
    return { error: "generic" as const };
  } catch (err) {
    if (err instanceof CmsValidationError) return { error: "validation" as const, issues: err.issues.map((i) => `${i.path}: ${i.message}`) };
    if (err instanceof CmsReferenceError) return { error: "reference" as const, issues: [err.message] };
    throw err;
  }
}

type Loc2 = "ar" | "en";

function MiniForm({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Form method="post" className={`inline ${className}`}>{children}</Form>;
}

function ToolButton({ label, danger = false }: { label: string; danger?: boolean }) {
  return (
    <button type="submit" className={`inline-flex min-h-9 items-center rounded-lg border px-2.5 text-xs font-medium ${danger ? "border-red-200 text-red-600 hover:bg-red-50" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
      {label}
    </button>
  );
}

export default function AdminCmsMenus({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = (root?.locale ?? "ar") as Loc2;
  const L = (k: string) => cmsLabel(k, locale);
  const actionData = useActionData<typeof action>();

  if (loaderData.denied || !loaderData.menu) {
    return <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>;
  }
  const { menu, location } = loaderData;
  const label = (ar: string, en: string) => (locale === "ar" ? ar || en : en || ar);

  const renderItem = (item: { id: string; labelAr: string; labelEn: string; href: string; external: boolean; icon: string | null; visible: boolean }, depth: number) => (
    <li key={item.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 ${item.visible ? "bg-white" : "bg-slate-50 opacity-60"} ${depth > 0 ? "ms-6" : ""}`}>
      {item.icon && <Icon name={item.icon} size="sm" colorRole="muted" />}
      <span className="text-sm font-medium text-slate-800">{label(item.labelAr, item.labelEn)}</span>
      <span className="text-xs text-slate-400" dir="ltr">{item.href}</span>
      {item.external && <Badge tone="neutral">↗</Badge>}
      <span className="ms-auto flex flex-wrap items-center gap-1.5">
        <MiniForm>
          <input type="hidden" name="_action" value="move-up" />
          <input type="hidden" name="itemId" value={item.id} />
          <ToolButton label="↑" />
        </MiniForm>
        <MiniForm>
          <input type="hidden" name="_action" value="move-down" />
          <input type="hidden" name="itemId" value={item.id} />
          <ToolButton label="↓" />
        </MiniForm>
        <MiniForm>
          <input type="hidden" name="_action" value="toggle" />
          <input type="hidden" name="itemId" value={item.id} />
          <ToolButton label={item.visible ? L("cms.ui.hide") : L("cms.ui.show")} />
        </MiniForm>
        <MiniForm>
          <input type="hidden" name="_action" value="delete" />
          <input type="hidden" name="itemId" value={item.id} />
          <ToolButton label={L("cms.ui.delete")} danger />
        </MiniForm>
      </span>
      <details className="w-full">
        <summary className="min-h-9 cursor-pointer text-xs font-medium text-brand-700">{L("cms.ui.edit")}</summary>
        <Form method="post" className="mt-2 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="_action" value="update" />
          <input type="hidden" name="itemId" value={item.id} />
          <Input label={`${L("cms.ui.label")} (عربي)`} name="labelAr" defaultValue={item.labelAr} dir="rtl" />
          <Input label={`${L("cms.ui.label")} (English)`} name="labelEn" defaultValue={item.labelEn} dir="ltr" />
          <Input label={L("cms.ui.href")} name="href" defaultValue={item.href} dir="ltr" hint={L("cms.ui.linkHint")} />
          <div className="flex flex-col">
            <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.f.icon")}</span>
            <select name="icon" defaultValue={item.icon ?? ""} className="h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm">
              <option value="">—</option>
              {ICON_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <SubmitButton variant="secondary" className="w-fit">{L("cms.ui.save")}</SubmitButton>
        </Form>
      </details>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/cms" className="inline-flex min-h-11 items-center text-sm text-slate-600 hover:text-slate-900"><span aria-hidden="true" className="inline-block rtl:rotate-180">←</span> {L("cms.ui.backToPages")}</Link>
        <h1 className="text-2xl font-bold text-slate-900">{L("cms.ui.menus")}</h1>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label={L("cms.ui.menus")}>
        {LOCATIONS.map((loc) => (
          <Link
            key={loc}
            to={`/admin/cms/menus?loc=${loc}`}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium ${location === loc ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {L(`cms.ui.menu.${loc}`)}
          </Link>
        ))}
      </nav>

      {actionData && "error" in actionData && actionData.error === "denied" && <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>}
      {actionData && "issues" in actionData && actionData.issues && <Alert kind="error">{actionData.issues.join(" — ")}</Alert>}

      <Card>
        <CardHeader title={L(`cms.ui.menu.${location}`)} />
        <CardBody>
          <ul className="flex flex-col gap-2">
            {menu.topLevel.map((item) => {
              const children = menu.items.filter((c) => item.childIds.includes(c.id));
              return (
                <li key={item.id} className="flex flex-col gap-2">
                  <ul className="flex flex-col gap-2">{renderItem(item, 0)}</ul>
                  {children.length > 0 && (
                    <ul className="flex flex-col gap-2">{children.map((c) => renderItem(c, 1))}</ul>
                  )}
                </li>
              );
            })}
            {menu.topLevel.length === 0 && <p className="py-4 text-center text-sm text-slate-500">{L("cms.ui.emptyPicker")}</p>}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={L("cms.ui.addItem")} />
        <CardBody>
          <Form method="post" className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="_action" value="add" />
            <input type="hidden" name="location" value={location} />
            <Input label={`${L("cms.ui.label")} (عربي)`} name="labelAr" dir="rtl" required />
            <Input label={`${L("cms.ui.label")} (English)`} name="labelEn" dir="ltr" />
            <Input label={L("cms.ui.href")} name="href" dir="ltr" required hint={L("cms.ui.linkHint")} placeholder="/courses" />
            <div className="flex flex-col">
              <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.f.icon")}</span>
              <select name="icon" defaultValue="" className="h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm">
                <option value="">—</option>
                {ICON_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.ui.parent")}</span>
              <select name="parentId" defaultValue="" className="h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm">
                <option value="">{L("cms.ui.topLevel")}</option>
                {menu.topLevel.map((i) => (
                  <option key={i.id} value={i.id}>{label(i.labelAr, i.labelEn)}</option>
                ))}
              </select>
            </div>
            <SubmitButton className="w-fit">{L("cms.ui.addItem")}</SubmitButton>
          </Form>
        </CardBody>
      </Card>
    </div>
  );
}
