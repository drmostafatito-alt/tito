import type { Route } from "./+types/admin.users";
import { Form, Link } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import { listUsers, USER_ROLES, USER_STATUSES } from "~server/users/service.server";
import { Card, CardBody } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { t, formatDate, type Locale } from "~/lib/i18n";
import { useRouteLoaderData } from "react-router";

const inputCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm";
// client-side literals mirroring USER_ROLES/USER_STATUSES (component code must not touch .server imports)
const ROLE_OPTIONS = ["student", "teacher", "admin", "super_admin"] as const;
const STATUS_OPTIONS = ["active", "suspended"] as const;
const selectCls = "h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm";

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
  return { canManage: await canPlatform(db, auth, "users.manage"), users: result, q: url.searchParams.get("q") ?? "", role: role ?? "", status: status ?? "" };
}

const ROLE_TONE: Record<string, "neutral" | "brand" | "warning" | "success"> = {
  student: "neutral",
  teacher: "brand",
  admin: "warning",
  super_admin: "success",
};

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { users } = loaderData;
  const totalPages = Math.max(1, Math.ceil(users.total / users.pageSize));
  const withPage = (p: number) => {
    const sp = new URLSearchParams();
    if (loaderData.q) sp.set("q", loaderData.q);
    if (loaderData.role) sp.set("role", loaderData.role);
    if (loaderData.status) sp.set("status", loaderData.status);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `?${s}` : ".";
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">{t(locale, "adminUsers.title")}</h1>

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

          <p className="text-xs text-slate-500" data-testid="users-total">
            {t(locale, "adminUsers.totalCount", { n: users.total })}
          </p>

          {users.rows.length === 0 && <p className="text-sm text-slate-500">{t(locale, "adminUsers.empty")}</p>}

          {users.rows.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2.5 text-sm last:border-0" data-testid="admin-user-row">
              <div className="flex min-w-0 flex-col">
                <Link to={`/admin/users/${u.id}`} className="truncate font-medium text-blue-700 hover:underline" data-testid="user-link">
                  {u.fullName}
                </Link>
                <span className="truncate text-xs text-slate-500" dir="ltr">{u.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={ROLE_TONE[u.roleId] ?? "neutral"}>{t(locale, `adminUsers.role_${u.roleId}`)}</Badge>
                <span data-testid={`user-status-${u.id}`}>
                  <Badge tone={u.status === "active" ? "success" : "danger"}>{t(locale, `adminUsers.status_${u.status}`)}</Badge>
                </span>
                <span className="text-xs text-slate-500">{formatDate(locale, u.createdAt)}</span>
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm">
              {users.page > 1 ? (
                <Link className="text-blue-700 hover:underline" to={withPage(users.page - 1)} data-testid="users-prev">{t(locale, "adminUsers.prevPage")}</Link>
              ) : <span />}
              <span className="text-xs text-slate-500">{t(locale, "adminUsers.pageOf", { page: users.page, total: totalPages })}</span>
              {users.page < totalPages ? (
                <Link className="text-blue-700 hover:underline" to={withPage(users.page + 1)} data-testid="users-next">{t(locale, "adminUsers.nextPage")}</Link>
              ) : <span />}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
