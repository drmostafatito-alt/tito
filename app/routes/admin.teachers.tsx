import { useState } from "react";
import type { Route } from "./+types/admin.teachers";
import { Form, Link, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { listUsers, setUserStatus } from "~server/users/service.server";
import {
  canManageTeachers,
  canViewTeachers,
  setTeacherPermission,
  teacherPermissionMatrix,
} from "~server/teachers/service.server";
import { Card, CardBody } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { Modal } from "~/components/ui/Modal";
import { Alert } from "~/components/ui/Alert";
import { t, formatDate, type Locale } from "~/lib/i18n";

const inputCls = "rounded-lg border border-line px-3 py-2 text-sm";
const selectCls = "h-[42px] rounded-lg border border-line bg-surface px-3 text-sm";

type ActionData =
  | { status?: { id: string; ok: boolean; error?: string } }
  | { perm?: { ok: boolean; code?: string } };

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canViewTeachers(db, auth.user))) throw new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const teachers = await listUsers(db, {
    q: url.searchParams.get("q") ?? undefined,
    role: "teacher",
    status: status === "active" || status === "suspended" ? status : null,
    page,
  });
  const matrix = await teacherPermissionMatrix(db);
  return {
    canManage: await canManageTeachers(db, auth.user),
    teachers,
    matrix,
    q: url.searchParams.get("q") ?? "",
    status: status ?? "",
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const actor = { userId: auth.user.id, role: auth.user.roleId, rank: auth.user.rank };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  if (intent === "status") {
    if (!(await canManageTeachers(db, auth.user))) return { status: { id: "", ok: false, error: "denied" } };
    const id = String(form.get("id") ?? "");
    const s = String(form.get("status") ?? "");
    if (!id || (s !== "active" && s !== "suspended")) return { status: { id, ok: false, error: "bad_request" } };
    const out = await setUserStatus(db, id, s, actor);
    return { status: { id, ok: out.ok, error: out.ok ? undefined : out.error } };
  }

  if (intent === "perm") {
    if (!(await canManageTeachers(db, auth.user))) return { perm: { ok: false, code: "denied" } };
    const permission = String(form.get("permission") ?? "");
    const granted = form.get("granted") === "1";
    const out = await setTeacherPermission(db, { ...actor, roleId: actor.role, ipHash: null }, permission, granted);
    return { perm: { ok: out.ok, code: out.ok ? undefined : out.code } };
  }

  return { perm: { ok: false, code: "bad_request" } };
}

export default function AdminTeachers({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { teachers, matrix, canManage } = loaderData;
  const data = actionData as ActionData | undefined;
  const [suspendId, setSuspendId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(teachers.total / teachers.pageSize));
  const actStatus = data && "status" in data ? data.status : undefined;
  const actPerm = data && "perm" in data ? data.perm : undefined;

  const withPage = (p: number) => {
    const sp = new URLSearchParams();
    if (loaderData.q) sp.set("q", loaderData.q);
    if (loaderData.status) sp.set("status", loaderData.status);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `?${s}` : ".";
  };

  const suspendTarget = teachers.rows.find((r) => r.id === suspendId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">{t(locale, "teachers.title")}</h1>

      {actStatus && !actStatus.ok && (
        <Alert kind="error">
          {actStatus.error === "denied"
            ? t(locale, "teachers.noManagePerm")
            : actStatus.error === "forbidden_rank"
              ? t(locale, "teachers.cannotManageRole")
              : t(locale, "teachers.opFailed")}
        </Alert>
      )}
      {actPerm && !actPerm.ok && (
        <Alert kind="error">
          {actPerm.code === "denied"
            ? t(locale, "teachers.noManagePerm")
            : t(locale, "teachers.opFailed")}
        </Alert>
      )}

      <Card>
        <CardBody className="space-y-3">
          <Form method="get" className="flex flex-wrap items-center gap-2">
            <input name="q" className={inputCls} defaultValue={loaderData.q} placeholder={t(locale, "teachers.searchPh")} dir="ltr" data-testid="teachers-search" />
            <select name="status" className={selectCls} defaultValue={loaderData.status} aria-label={t(locale, "teachers.filterByStatus")} data-testid="teachers-status-filter">
              <option value="">{t(locale, "teachers.allStatuses")}</option>
              <option value="active">{t(locale, "teachers.status_active")}</option>
              <option value="suspended">{t(locale, "teachers.status_suspended")}</option>
            </select>
            <SubmitButton variant="secondary">{t(locale, "teachers.filter")}</SubmitButton>
          </Form>

          <p className="text-xs text-ink-muted" data-testid="teachers-total">
            {t(locale, "teachers.totalCount", { n: teachers.total })}
          </p>

          {teachers.rows.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "teachers.empty")}</p>}

          {teachers.rows.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 text-sm last:border-0" data-testid="teacher-row">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex min-w-0 flex-col">
                  <Link to={`/admin/users/${u.id}`} className="truncate font-medium text-brand-800 hover:underline">
                    {u.fullName}
                  </Link>
                  <span className="truncate text-xs text-ink-muted" dir="ltr">{u.email}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="brand">{t(locale, "teachers.role_teacher")}</Badge>
                <Badge tone={u.status === "active" ? "success" : "danger"}>{t(locale, `teachers.status_${u.status}`)}</Badge>
                <span className="text-xs text-ink-muted">{formatDate(locale, u.createdAt)}</span>
                {canManage && (
                  u.status === "active" ? (
                    <button type="button" onClick={() => setSuspendId(u.id)} data-testid={`suspend-${u.id}`}
                      className="rounded-lg border border-error/30 px-3 py-1.5 text-xs font-medium text-error hover:bg-error-soft">
                      {t(locale, "teachers.suspend")}
                    </button>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="_action" value="status" />
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="status" value="active" />
                      <SubmitButton variant="secondary" size="sm">{t(locale, "teachers.activate")}</SubmitButton>
                    </Form>
                  )
                )}
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm">
              {teachers.page > 1 ? (
                <Link className="text-brand-800 hover:underline" to={withPage(teachers.page - 1)}>{t(locale, "teachers.prevPage")}</Link>
              ) : <span />}
              <span className="text-xs text-ink-muted">{t(locale, "teachers.pageOf", { page: teachers.page, total: totalPages })}</span>
              {teachers.page < totalPages ? (
                <Link className="text-brand-800 hover:underline" to={withPage(teachers.page + 1)}>{t(locale, "teachers.nextPage")}</Link>
              ) : <span />}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-ink">{t(locale, "teachers.matrixTitle")}</h2>
              <p className="mt-1 text-xs text-ink-muted">{t(locale, "teachers.matrixHint")}</p>
            </div>
            {!canManage && <span className="text-xs text-sand-400">{t(locale, "teachers.matrixReadOnly")}</span>}
          </div>

          {matrix.map((m) => (
            <div key={m.permission} className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-sm last:border-0" data-testid={`matrix-${m.permission}`}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate">{locale === "ar" ? m.labelAr : m.labelEn}</span>
                {!m.authoring && <Badge tone="warning">{t(locale, "teachers.privileged")}</Badge>}
              </div>
              {canManage ? (
                <Form method="post">
                  <input type="hidden" name="_action" value="perm" />
                  <input type="hidden" name="permission" value={m.permission} />
                  <input type="hidden" name="granted" value={m.granted ? "0" : "1"} />
                  <SubmitButton variant={m.granted ? "secondary" : "primary"} size="sm">
                    {m.granted ? t(locale, "teachers.revoke") : t(locale, "teachers.grant")}
                  </SubmitButton>
                </Form>
              ) : (
                <Badge tone={m.granted ? "success" : "neutral"}>{m.granted ? t(locale, "teachers.granted") : t(locale, "teachers.notGranted")}</Badge>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      <Modal
        open={suspendId !== null}
        onClose={() => setSuspendId(null)}
        title={t(locale, "teachers.confirmSuspendTitle")}
      >
        <p className="text-sm text-ink-muted">
          {suspendTarget
            ? t(locale, "teachers.confirmSuspendBody", { name: suspendTarget.fullName })
            : t(locale, "teachers.confirmSuspendBodyGeneric")}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setSuspendId(null)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:bg-sand-100">
            {t(locale, "teachers.cancel")}
          </button>
          {suspendTarget && (
            <Form method="post" onSubmit={() => setSuspendId(null)}>
              <input type="hidden" name="_action" value="status" />
              <input type="hidden" name="id" value={suspendTarget.id} />
              <input type="hidden" name="status" value="suspended" />
              <SubmitButton variant="danger">{t(locale, "teachers.suspendConfirm")}</SubmitButton>
            </Form>
          )}
        </div>
      </Modal>
    </div>
  );
}
