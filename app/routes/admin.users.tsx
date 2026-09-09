import { useState } from "react";
import type { Route } from "./+types/admin.users";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import {
  bulkSetUserStatus,
  listUsers,
  USER_ROLES,
  USER_STATUSES,
  type BulkUserResult,
} from "~server/users/service.server";
import { Card, CardBody } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Modal } from "~/components/ui/Modal";
import { Alert } from "~/components/ui/Alert";
import { t, formatDate, type Locale } from "~/lib/i18n";

const inputCls = "rounded-lg border border-line px-3 py-2 text-sm";
const ROLE_OPTIONS = ["student", "teacher", "admin", "super_admin"] as const;
const STATUS_OPTIONS = ["active", "suspended"] as const;
const selectCls = "h-[42px] rounded-lg border border-line bg-white px-3 text-sm";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "users.read"))) throw new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const role = url.searchParams.get("role");
  const status = url.searchParams.get("status");
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const result = await listUsers(db, {
    q: url.searchParams.get("q") ?? undefined,
    role: USER_ROLES.includes(role as never) ? (role as (typeof USER_ROLES)[number]) : null,
    status: USER_STATUSES.includes(status as never) ? (status as (typeof USER_STATUSES)[number]) : null,
    page,
  });
  return {
    canManage: await canPlatform(db, auth, "users.manage"),
    users: result,
    q: url.searchParams.get("q") ?? "",
    role: role ?? "",
    status: status ?? "",
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "users.manage"))) return { error: "denied" as const };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  if (intent !== "bulk-status") return { error: "bad_request" as const };
  const status = String(form.get("status") ?? "");
  if (status !== "active" && status !== "suspended") return { error: "bad_request" as const };
  const ids = form.getAll("ids").map((x) => String(x));
  if (!ids.length) return { error: "empty" as const };
  const bulk = await bulkSetUserStatus(db, ids, status, {
    userId: auth.user.id,
    role: auth.user.roleId,
    rank: auth.user.rank,
  });
  return { bulk };
}

const ROLE_TONE: Record<string, "neutral" | "brand" | "warning" | "success"> = {
  student: "neutral",
  teacher: "brand",
  admin: "warning",
  super_admin: "success",
};

interface BulkActionData {
  bulk?: { requested: number; succeeded: number; failed: number; results: BulkUserResult[] };
  error?: "denied" | "bad_request" | "empty";
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<BulkActionData>();
  const { users, canManage } = loaderData;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);

  const totalPages = Math.max(1, Math.ceil(users.total / users.pageSize));
  const studentIdsOnPage = users.rows.filter((u) => u.roleId === "student").map((u) => u.id);
  const allVisibleSelected = studentIdsOnPage.length > 0 && studentIdsOnPage.every((id) => selected.has(id));

  const withPage = (p: number) => {
    const sp = new URLSearchParams();
    if (loaderData.q) sp.set("q", loaderData.q);
    if (loaderData.role) sp.set("role", loaderData.role);
    if (loaderData.status) sp.set("status", loaderData.status);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `?${s}` : ".";
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const id of studentIdsOnPage) next.delete(id);
      else for (const id of studentIdsOnPage) next.add(id);
      return next;
    });
  };

  const bulkOut = actionData && "bulk" in actionData ? actionData.bulk : null;
  const actError = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">{t(locale, "adminUsers.title")}</h1>

      {actError === "denied" && <Alert kind="error">{t(locale, "adminUsers.noManagePerm")}</Alert>}
      {actError === "empty" && <Alert kind="warning">{t(locale, "adminUsers.bulkNoSelection")}</Alert>}

      {bulkOut && (
        <Alert kind={bulkOut.failed === 0 ? "success" : "warning"}>
          {t(locale, "adminUsers.bulkPerformed", { succeeded: bulkOut.succeeded, failed: bulkOut.failed })}
          {bulkOut.failed > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs">
              {bulkOut.results.filter((r) => !r.ok).slice(0, 10).map((r) => (
                <li key={r.id}>{r.error ?? "error"}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <Card>
        <CardBody className="space-y-3">
          <Form method="get" className="flex flex-wrap items-center gap-2">
            <input name="q" className={inputCls} defaultValue={loaderData.q} placeholder={t(locale, "adminUsers.searchPh")} dir="ltr" data-testid="users-search" />
            <select name="role" className={selectCls} defaultValue={loaderData.role} aria-label={t(locale, "adminUsers.filterByRole")} data-testid="users-role-filter">
              <option value="">{t(locale, "adminUsers.allRoles")}</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{t(locale, `adminUsers.role_${r}`)}</option>
              ))}
            </select>
            <select name="status" className={selectCls} defaultValue={loaderData.status} aria-label={t(locale, "adminUsers.filterByStatus")} data-testid="users-status-filter">
              <option value="">{t(locale, "adminUsers.allStatuses")}</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{t(locale, `adminUsers.status_${s}`)}</option>
              ))}
            </select>
            <SubmitButton variant="secondary">{t(locale, "adminUsers.filter")}</SubmitButton>
          </Form>

          <p className="text-xs text-ink-muted" data-testid="users-total">
            {t(locale, "adminUsers.totalCount", { n: users.total })}
          </p>

          {canManage && studentIdsOnPage.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2" data-testid="bulk-bar">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="h-4 w-4" data-testid="bulk-select-all" />
                {t(locale, "adminUsers.selectAllVisible")}
              </label>
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-ink hover:underline" data-testid="bulk-clear">
                {t(locale, "adminUsers.clearSelection")}
              </button>
              <span className="text-xs text-ink-muted" data-testid="bulk-selected">{t(locale, "adminUsers.selectedCount", { n: selected.size })}</span>
              {selected.size > 0 && (
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Form method="post">
                    <input type="hidden" name="_action" value="bulk-status" />
                    <input type="hidden" name="status" value="active" />
                    {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
                    <SubmitButton variant="secondary" size="sm">{t(locale, "adminUsers.bulkActivate")}</SubmitButton>
                  </Form>
                  <button type="button" onClick={() => setConfirmingSuspend(true)} data-testid="bulk-suspend-open"
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                    {t(locale, "adminUsers.bulkSuspend")}
                  </button>
                </div>
              )}
            </div>
          )}

          {users.rows.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "adminUsers.empty")}</p>}

          {users.rows.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 text-sm last:border-0" data-testid="admin-user-row">
              <div className="flex min-w-0 items-center gap-3">
                {canManage && u.roleId === "student" && (
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                    aria-label={t(locale, "adminUsers.selectRow")}
                    className="h-4 w-4"
                    data-testid={`select-user-${u.id}`}
                  />
                )}
                <div className="flex min-w-0 flex-col">
                  <Link to={`/admin/users/${u.id}`} className="truncate font-medium text-ink hover:underline" data-testid="user-link">
                    {u.fullName}
                  </Link>
                  <span className="truncate text-xs text-ink-muted" dir="ltr">{u.email}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={ROLE_TONE[u.roleId] ?? "neutral"}>{t(locale, `adminUsers.role_${u.roleId}`)}</Badge>
                <span data-testid={`user-status-${u.id}`}>
                  <Badge tone={u.status === "active" ? "success" : "danger"}>{t(locale, `adminUsers.status_${u.status}`)}</Badge>
                </span>
                <span className="text-xs text-ink-muted">{formatDate(locale, u.createdAt)}</span>
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm">
              {users.page > 1 ? (
                <Link className="text-ink hover:underline" to={withPage(users.page - 1)} data-testid="users-prev">{t(locale, "adminUsers.prevPage")}</Link>
              ) : <span />}
              <span className="text-xs text-ink-muted">{t(locale, "adminUsers.pageOf", { page: users.page, total: totalPages })}</span>
              {users.page < totalPages ? (
                <Link className="text-ink hover:underline" to={withPage(users.page + 1)} data-testid="users-next">{t(locale, "adminUsers.nextPage")}</Link>
              ) : <span />}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={confirmingSuspend}
        onClose={() => setConfirmingSuspend(false)}
        title={t(locale, "adminUsers.confirmBulkSuspendTitle")}
      >
        <p className="text-sm text-ink-muted">{t(locale, "adminUsers.confirmBulkSuspendBody", { n: selected.size })}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmingSuspend(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-slate-50">
            {t(locale, "adminUsers.cancel")}
          </button>
          <Form method="post" onSubmit={() => setConfirmingSuspend(false)}>
            <input type="hidden" name="_action" value="bulk-status" />
            <input type="hidden" name="status" value="suspended" />
            {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
            <SubmitButton variant="danger">{t(locale, "adminUsers.bulkSuspendConfirm")}</SubmitButton>
          </Form>
        </div>
      </Modal>
    </div>
  );
}
