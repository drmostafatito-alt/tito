import type { Route } from "./+types/admin.users.$id";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import {
  forceLogoutUser,
  resetUserDevices,
  revokeSessionAdmin,
  setUserRole,
  setUserStatus,
  userAdminDetail,
  USER_ROLES,
  type Actor,
} from "~server/users/service.server";
import { revokeEntitlement } from "~server/entitlements/grant.server";
import { logAudit } from "~server/audit/log.server";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, formatDate, type Locale } from "~/lib/i18n";

const selectCls = "h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm";
// client-side literal mirroring USER_ROLES (component code must not touch .server imports)
const ROLE_OPTIONS = ["student", "teacher", "admin", "super_admin"] as const;
const inputCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "users.read"))) throw new Response("Forbidden", { status: 403 });
  const detail = await userAdminDetail(db, params.id);
  if (!detail) throw new Response("Not found", { status: 404 });
  return {
    detail,
    selfId: auth.user.id,
    perms: { manage: await canPlatform(db, auth, "users.manage"), superAdmin: auth.user.rank >= 4, rank: auth.user.rank },
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "users.manage"))) return { error: "denied" as const };
  const actor: Actor = { userId: auth.user.id, role: auth.user.roleId, rank: auth.user.rank };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  if (intent === "set-status") {
    const status = String(form.get("status") ?? "");
    if (status !== "active" && status !== "suspended") return { error: "bad_request" as const };
    const res = await setUserStatus(db, params.id, status, actor);
    return res.ok ? { done: "status", sessionsRevoked: res.sessionsRevoked ?? 0 } : { error: res.error };
  }
  if (intent === "set-role") {
    const roleId = String(form.get("roleId") ?? "");
    if (!USER_ROLES.includes(roleId as never)) return { error: "bad_request" as const };
    const res = await setUserRole(db, params.id, roleId as (typeof USER_ROLES)[number], actor);
    return res.ok ? { done: "role" } : { error: res.error };
  }
  if (intent === "force-logout") {
    const res = await forceLogoutUser(db, params.id, actor);
    return res.ok ? { done: "force", sessionsRevoked: res.changed ?? 0 } : { error: res.error };
  }
  if (intent === "reset-devices") {
    const res = await resetUserDevices(db, params.id, actor);
    return res.ok ? { done: "devices" } : { error: res.error };
  }
  if (intent === "revoke-session") {
    const res = await revokeSessionAdmin(db, String(form.get("sessionId") ?? ""), actor);
    return res.ok ? { done: "session" } : { error: res.error };
  }
  if (intent === "revoke-entitlement") {
    // Through the EXISTING entitlement service only (P7 §8) — no parallel access system.
    const id = String(form.get("entitlementId") ?? "");
    const reason = String(form.get("reason") ?? "admin_revoke").slice(0, 200) || "admin_revoke";
    const ok = await revokeEntitlement(db, id, reason, { userId: actor.userId, role: actor.role });
    if (!ok) return { error: "not_found" as const };
    await logAudit(db, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "users.entitlement_revoke",
      entityType: "entitlement",
      entityId: id,
      after: { userId: params.id, reason },
    });
    return { done: "entitlement" };
  }
  return { error: "bad_request" as const };
}

function Row({ label, value, ltr }: { label: string; value: string | number | null; ltr?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium text-slate-800 ${ltr ? "font-mono text-xs" : ""}`} dir={ltr ? "ltr" : undefined}>{value ?? "—"}</span>
    </div>
  );
}

export default function AdminUserDetail({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { detail, perms, selfId } = loaderData;
  const actionData = useActionData<typeof action>();
  const u = detail.user;
  const isSelf = u.id === selfId;
  const canAct = perms.manage && !isSelf;
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6" key={`user-${detail?.user?.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">{u.fullName}</h1>
        <Link to="/admin/users" className="text-sm text-blue-700 hover:underline">{t(locale, "adminUsers.backToList")}</Link>
      </div>

      {actionData && "error" in actionData && (
        <Alert kind="error">
          <span data-testid="user-action-error">{et(locale, "adminUsers", String(actionData.error))}</span>
        </Alert>
      )}
      {actionData && "done" in actionData && (
        <Alert kind="success">
          <span data-testid="user-action-done">
            {t(locale, `adminUsers.done_${actionData.done}`)}
            {"sessionsRevoked" in actionData && actionData.sessionsRevoked ? ` (${t(locale, "adminUsers.sessionsRevoked", { n: actionData.sessionsRevoked })})` : ""}
          </span>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t(locale, "adminUsers.secProfile")} />
          <CardBody>
            <Row label={t(locale, "adminUsers.colEmail")} value={u.email} ltr />
            <Row label={t(locale, "adminUsers.colRole")} value={t(locale, `adminUsers.role_${u.roleId}`)} />
            <Row label={t(locale, "adminUsers.colStatus")} value={t(locale, `adminUsers.status_${u.status}`)} />
            <Row label={t(locale, "adminUsers.colJoined")} value={formatDate(locale, u.createdAt)} />
            <Row label={t(locale, "adminUsers.colLastLogin")} value={u.lastLoginAt ? formatDate(locale, u.lastLoginAt) : null} />
            <Row label={t(locale, "adminUsers.userId")} value={u.id} ltr />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "adminUsers.secActions")} />
          <CardBody className="flex flex-col gap-3">
            {!perms.manage && <Alert kind="warning">{t(locale, "adminUsers.noManagePerm")}</Alert>}
            {isSelf && <Alert kind="warning">{t(locale, "adminUsers.selfNote")}</Alert>}

            {u.roleId === "student" && (
              <Link to={`/admin/students/${u.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                {t(locale, "adminUsers.open360")}
              </Link>
            )}

            <div className="flex flex-wrap gap-2">
              <Form method="post" onSubmit={(e) => { if (!confirm(t(locale, "adminUsers.confirmSuspend"))) e.preventDefault(); }}>
                <input type="hidden" name="_action" value="set-status" />
                <input type="hidden" name="status" value={u.status === "active" ? "suspended" : "active"} />
                <span data-testid="toggle-status-btn"><SubmitButton variant={u.status === "active" ? "danger" : "secondary"} disabled={!canAct}>
                  {u.status === "active" ? t(locale, "adminUsers.suspend") : t(locale, "adminUsers.activate")}
                </SubmitButton></span>
              </Form>
              <Form method="post" onSubmit={(e) => { if (!confirm(t(locale, "adminUsers.confirmForce"))) e.preventDefault(); }}>
                <input type="hidden" name="_action" value="force-logout" />
                <span data-testid="force-logout-btn"><SubmitButton variant="secondary" disabled={!canAct}>{t(locale, "adminUsers.forceLogout")}</SubmitButton></span>
              </Form>
              <Form method="post" onSubmit={(e) => { if (!confirm(t(locale, "adminUsers.confirmReset"))) e.preventDefault(); }}>
                <input type="hidden" name="_action" value="reset-devices" />
                <span data-testid="reset-devices-btn"><SubmitButton variant="secondary" disabled={!canAct}>{t(locale, "adminUsers.resetDevices")}</SubmitButton></span>
              </Form>
            </div>

            {perms.superAdmin && !isSelf && (
              <Form method="post" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="_action" value="set-role" />
                <select name="roleId" aria-label={t(locale, "adminUsers.filterByRole")} className={selectCls} defaultValue={u.roleId} data-testid="role-select">
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{t(locale, `adminUsers.role_${r}`)}</option>
                  ))}
                </select>
                <span data-testid="set-role-btn"><SubmitButton variant="secondary">{t(locale, "adminUsers.applyRole")}</SubmitButton></span>
                <p className="w-full text-xs text-slate-500">{t(locale, "adminUsers.roleNote")}</p>
              </Form>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
        {[
          { label: t(locale, "adminUsers.cEntitlements"), value: detail.counts.activeEntitlements },
          { label: t(locale, "adminUsers.cLessons"), value: detail.counts.lessonsCompleted },
          { label: t(locale, "adminUsers.cVideos"), value: detail.counts.videosWatched },
          { label: t(locale, "adminUsers.cAttempts"), value: detail.counts.attempts },
          { label: t(locale, "adminUsers.cOrders"), value: detail.counts.orders },
          { label: t(locale, "adminUsers.cDevices"), value: detail.counts.devicesActive },
          { label: t(locale, "adminUsers.cSessions"), value: detail.counts.sessionsActive },
        ].map((s) => (
          <Card key={s.label}>
            <CardBody>
              <p className="text-2xl font-bold text-slate-900" dir="ltr">{s.value}</p>
              <p className="mt-0.5 text-xs text-slate-500">{s.label}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title={t(locale, "adminUsers.secEntitlements")}
          description={t(locale, "adminUsers.entitlementsNote")}
          action={<Link to="/admin/entitlements" className="text-sm text-blue-700 hover:underline">{t(locale, "admin.navEntitlements")}</Link>}
        />
        <CardBody className="space-y-2">
          {detail.entitlements.length === 0 && <p className="text-sm text-slate-500">{t(locale, "adminUsers.noRows")}</p>}
          {detail.entitlements.map((e) => {
            const active = e.status === "active" && e.startsAt <= now && (e.expiresAt === null || e.expiresAt > now);
            return (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0" data-testid="user-entitlement-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={active ? "success" : e.status === "revoked" ? "danger" : "neutral"}>{t(locale, `adminUsers.ent_${active ? "active" : e.status}`)}</Badge>
                  <span className="font-medium">
                    {t(locale, `adminUsers.res_${e.resourceType}`)}{" "}
                    {(locale === "ar" ? e.resourceTitleAr || e.resourceTitleEn : e.resourceTitleEn || e.resourceTitleAr) ??
                      (e.resourceId ? <span className="font-mono text-xs text-slate-500" dir="ltr"> #{e.resourceId.slice(0, 8)}</span> : null)}
                  </span>
                  <span className="text-xs text-slate-500">{t(locale, `adminUsers.src_${e.sourceType}`)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500" dir="ltr">
                    {formatDate(locale, e.startsAt)} → {e.expiresAt ? formatDate(locale, e.expiresAt) : t(locale, "adminUsers.noExpiry")}
                  </span>
                  {active && perms.manage && (
                    <Form method="post" onSubmit={(ev) => { if (!confirm(t(locale, "adminUsers.confirmRevokeEnt"))) ev.preventDefault(); }}>
                      <input type="hidden" name="_action" value="revoke-entitlement" />
                      <input type="hidden" name="entitlementId" value={e.id} />
                      <span data-testid={`revoke-ent-${e.id}`}><SubmitButton variant="danger" size="sm">{t(locale, "adminUsers.revokeEnt")}</SubmitButton></span>
                    </Form>
                  )}
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t(locale, "adminUsers.secProgress")} />
          <CardBody className="space-y-1.5">
            {detail.recentProgress.length === 0 && <p className="text-sm text-slate-500">{t(locale, "adminUsers.noRows")}</p>}
            {detail.recentProgress.map((p) => (
              <div key={p.lessonId} className="flex items-center justify-between gap-2 text-sm" data-testid="user-progress-row">
                <span className="truncate">{locale === "ar" ? p.titleAr || p.titleEn : p.titleEn || p.titleAr}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={p.status === "completed" ? "success" : "neutral"}>{p.status === "completed" ? t(locale, "adminUsers.completed") : t(locale, "adminUsers.inProgress")}</Badge>
                  <span className="text-xs text-slate-500">{formatDate(locale, p.lastActivityAt)}</span>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "adminUsers.secAttempts")} />
          <CardBody className="space-y-1.5">
            {detail.recentAttempts.length === 0 && <p className="text-sm text-slate-500">{t(locale, "adminUsers.noRows")}</p>}
            {detail.recentAttempts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 text-sm" data-testid="user-attempt-row">
                <Link to={`/admin/assessment/attempts/${a.id}`} className="truncate text-slate-700 hover:text-brand-700 hover:underline">
                  {locale === "ar" ? a.examTitleAr || a.examTitleEn : a.examTitleEn || a.examTitleAr}
                </Link>
                <span className="flex items-center gap-2">
                  {a.status === "graded" && a.score != null && a.maxScore != null && (
                    <span className="text-xs font-semibold" dir="ltr">{a.score}/{a.maxScore}{a.passed != null ? (a.passed ? " ✓" : " ✗") : ""}</span>
                  )}
                  <Badge tone={a.status === "graded" ? (a.passed ? "success" : "danger") : "neutral"}>{t(locale, `adminUsers.attempt_${a.status}`)}</Badge>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "adminUsers.secOrders")} />
          <CardBody className="space-y-1.5">
            {detail.recentOrders.length === 0 && <p className="text-sm text-slate-500">{t(locale, "adminUsers.noRows")}</p>}
            {detail.recentOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 text-sm" data-testid="user-order-row">
                <Link to={`/admin/commerce/orders/${o.id}`} className="font-mono text-xs text-blue-700 hover:underline" dir="ltr">{o.orderNumber}</Link>
                <span className="flex items-center gap-2">
                  <Badge tone={o.status === "paid" ? "success" : o.status === "pending" ? "warning" : "neutral"}>{t(locale, `commerce.order_${o.status}`)}</Badge>
                  <span className="text-xs text-slate-500">{formatDate(locale, o.createdAt)}</span>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "adminUsers.secSecurity")} />
          <CardBody className="space-y-1.5">
            {detail.recentSecurity.length === 0 && <p className="text-sm text-slate-500">{t(locale, "adminUsers.noRows")}</p>}
            {detail.recentSecurity.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm" data-testid="user-security-row">
                <span className="font-mono text-xs text-slate-600" dir="ltr">{s.type}</span>
                <span className="text-xs text-slate-500">{formatDate(locale, s.createdAt)}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "adminUsers.secDevices")} />
          <CardBody className="space-y-1.5">
            {detail.devicesList.length === 0 && <p className="text-sm text-slate-500">{t(locale, "adminUsers.noRows")}</p>}
            {detail.devicesList.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm" data-testid="user-device-row">
                <span className="truncate">{d.label} <span className="text-xs text-slate-500">({d.platform})</span></span>
                <span className="flex items-center gap-2">
                  <Badge tone={d.status === "active" ? "success" : "danger"}>{d.status === "active" ? t(locale, "adminUsers.devActive") : t(locale, "adminUsers.devRevoked")}</Badge>
                  <span className="text-xs text-slate-500">{formatDate(locale, d.lastSeenAt)}</span>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t(locale, "adminUsers.secSessions")} />
          <CardBody className="space-y-1.5">
            {detail.activeSessions.length === 0 && <p className="text-sm text-slate-500">{t(locale, "adminUsers.noRows")}</p>}
            {detail.activeSessions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="user-session-row">
                <span className="truncate">{s.deviceLabel} <span className="text-xs text-slate-500">{formatDate(locale, s.lastSeenAt)}</span></span>
                {perms.manage && !isSelf && (
                  <Form method="post">
                    <input type="hidden" name="_action" value="revoke-session" />
                    <input type="hidden" name="sessionId" value={s.id} />
                    <span data-testid={`revoke-session-${s.id}`}><SubmitButton variant="danger" size="sm">{t(locale, "adminUsers.revokeSession")}</SubmitButton></span>
                  </Form>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
