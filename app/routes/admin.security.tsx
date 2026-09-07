import type { Route } from "./+types/admin.security";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import {
  forceLogoutUser,
  listActiveSessions,
  listSecurityEvents,
  revokeSessionAdmin,
  type Actor,
} from "~server/users/service.server";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, formatDate, type Locale } from "~/lib/i18n";

const inputCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm";
// client-side literal mirroring SECURITY_EVENT_TYPES (component code must not touch .server imports)
const PAGE_SIZE = 25; // mirrors SECURITY_PAGE_SIZE (client-safe literal)
const EVENT_TYPE_OPTIONS = [
  "login_success", "login_failed", "logout", "device_added", "device_evicted",
  "device_limit_block", "device_change_limit_block", "device_revoked_login",
  "password_reset_requested", "password_reset_completed", "password_changed",
  "sessions_revoked_all", "session_revoked", "rate_limited", "permission_denied",
  "registration", "profile_updated",
] as const;
const selectCls = "h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "security.read"))) throw new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "sessions" ? "sessions" : "events";
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const type = url.searchParams.get("type") ?? "";
  const q = url.searchParams.get("q") ?? "";

  const canManage = await canPlatform(db, auth, "users.manage");
  if (tab === "sessions") {
    const sessionsQ = await listActiveSessions(db, page);
    return { tab, canManage, selfId: auth.user.id, sessionsQ, eventsQ: null, type, q };
  }
  const eventsQ = await listSecurityEvents(db, { type: type || null, q: q || undefined, page });
  return { tab, canManage, selfId: auth.user.id, sessionsQ: null, eventsQ, type, q };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  // viewing = security.read; revoking = users.manage (sensitive mutation)
  if (!(await canPlatform(db, auth, "users.manage"))) return { error: "denied" as const };
  const actor: Actor = { userId: auth.user.id, role: auth.user.roleId, rank: auth.user.rank };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  if (intent === "revoke-session") {
    const res = await revokeSessionAdmin(db, String(form.get("sessionId") ?? ""), actor);
    return res.ok ? { done: "session" } : { error: res.error };
  }
  if (intent === "force-logout") {
    const res = await forceLogoutUser(db, String(form.get("userId") ?? ""), actor);
    return res.ok ? { done: "force", sessionsRevoked: res.changed ?? 0 } : { error: res.error };
  }
  return { error: "bad_request" as const };
}

function Pager({ page, total, tab, extra }: { page: number; total: number; tab: string; extra: Record<string, string> }) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (totalPages <= 1) return null;
  const withPage = (p: number) => {
    const sp = new URLSearchParams({ tab });
    for (const [k, v] of Object.entries(extra)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    return `?${sp.toString()}`;
  };
  return (
    <div className="flex items-center justify-between pt-2 text-sm">
      {page > 1 ? <Link className="text-blue-700 hover:underline" to={withPage(page - 1)} data-testid="sec-prev">{t(locale, "securityAdmin.prevPage")}</Link> : <span />}
      <span className="text-xs text-slate-500">{t(locale, "securityAdmin.pageOf", { page, total: totalPages })}</span>
      {page < totalPages ? <Link className="text-blue-700 hover:underline" to={withPage(page + 1)} data-testid="sec-next">{t(locale, "securityAdmin.nextPage")}</Link> : <span />}
    </div>
  );
}

export default function AdminSecurity({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { tab, canManage, selfId } = loaderData;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">{t(locale, "securityAdmin.title")}</h1>

      {actionData && "error" in actionData && (
        <Alert kind="error"><span data-testid="sec-action-error">{et(locale, "securityAdmin", String(actionData.error))}</span></Alert>
      )}
      {actionData && "done" in actionData && (
        <Alert kind="success">
          <span data-testid="sec-action-done">
            {t(locale, `securityAdmin.done_${actionData.done}`)}
            {"sessionsRevoked" in actionData && actionData.sessionsRevoked ? ` (${t(locale, "adminUsers.sessionsRevoked", { n: actionData.sessionsRevoked })})` : ""}
          </span>
        </Alert>
      )}

      <div className="flex gap-2" data-testid="sec-tabs">
        {(["events", "sessions"] as const).map((tb) => (
          <Link
            key={tb}
            to={`/admin/security?tab=${tb}`}
            data-testid={`sec-tab-${tb}`}
            className={`inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-sm font-medium ${tab === tb ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {t(locale, `securityAdmin.tab_${tb}`)}
          </Link>
        ))}
      </div>

      {tab === "events" && loaderData.eventsQ && (
        <Card>
          <CardBody className="space-y-3">
            <Form method="get" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tab" value="events" />
              <input name="q" className={inputCls} defaultValue={loaderData.q} placeholder={t(locale, "securityAdmin.searchPh")} dir="ltr" data-testid="sec-q" />
              <select name="type" className={selectCls} defaultValue={loaderData.type} aria-label={t(locale, "securityAdmin.filterByType")} data-testid="sec-type-filter">
                <option value="">{t(locale, "securityAdmin.allTypes")}</option>
                {EVENT_TYPE_OPTIONS.map((ty) => (
                  <option key={ty} value={ty}>{t(locale, `securityAdmin.ev_${ty}`)}</option>
                ))}
              </select>
              <SubmitButton variant="secondary">{t(locale, "securityAdmin.filter")}</SubmitButton>
            </Form>
            <p className="text-xs text-slate-500" data-testid="sec-events-total">{t(locale, "securityAdmin.totalCount", { n: loaderData.eventsQ.total })}</p>
            {loaderData.eventsQ.rows.length === 0 && <p className="text-sm text-slate-500">{t(locale, "securityAdmin.emptyEvents")}</p>}
            {loaderData.eventsQ.rows.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0" data-testid="security-event-row">
                <span className="text-xs font-medium text-slate-700" title={e.type}>
                  {t(locale, `securityAdmin.ev_${e.type}`)}
                </span>
                {e.userEmail ? (
                  <Link to={`/admin/users/${e.userId}`} className="text-xs text-blue-700 hover:underline" dir="ltr">{e.userEmail}</Link>
                ) : (
                  <span className="text-xs text-slate-500">{t(locale, "securityAdmin.anonymous")}</span>
                )}
                {e.userRole && <Badge tone={e.userRole === "student" ? "neutral" : "warning"}>{t(locale, `adminUsers.role_${e.userRole}`)}</Badge>}
                <span className="text-xs text-slate-500">{formatDate(locale, e.createdAt)}</span>
              </div>
            ))}
            <Pager page={loaderData.eventsQ.page} total={loaderData.eventsQ.total} tab="events" extra={{ q: loaderData.q, type: loaderData.type }} />
          </CardBody>
        </Card>
      )}

      {tab === "sessions" && loaderData.sessionsQ && (
        <Card>
          <CardBody className="space-y-3">
            <p className="text-xs text-slate-500" data-testid="sec-sessions-total">{t(locale, "securityAdmin.activeSessions", { n: loaderData.sessionsQ.total })}</p>
            {loaderData.sessionsQ.rows.length === 0 && <p className="text-sm text-slate-500">{t(locale, "securityAdmin.emptySessions")}</p>}
            {loaderData.sessionsQ.rows.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0" data-testid="session-row">
                <div className="flex min-w-0 flex-col">
                  <Link to={`/admin/users/${s.userId}`} className="truncate text-xs text-blue-700 hover:underline" dir="ltr">{s.userEmail}</Link>
                  <span className="truncate text-xs text-slate-500">{s.deviceLabel} · {s.devicePlatform}</span>
                </div>
                <span className="text-xs text-slate-500">{t(locale, "securityAdmin.lastSeen")}: {formatDate(locale, s.lastSeenAt)}</span>
                {canManage && s.userId !== selfId && (
                  <div className="flex gap-2">
                    <Form method="post">
                      <input type="hidden" name="_action" value="revoke-session" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <span data-testid={`sec-revoke-${s.id}`}><SubmitButton variant="danger" size="sm">{t(locale, "securityAdmin.revokeSession")}</SubmitButton></span>
                    </Form>
                    <Form method="post" onSubmit={(ev) => { if (!confirm(t(locale, "adminUsers.confirmForce"))) ev.preventDefault(); }}>
                      <input type="hidden" name="_action" value="force-logout" />
                      <input type="hidden" name="userId" value={s.userId} />
                      <span data-testid={`sec-force-${s.userId}`}><SubmitButton variant="secondary" size="sm">{t(locale, "securityAdmin.forceLogout")}</SubmitButton></span>
                    </Form>
                  </div>
                )}
              </div>
            ))}
            <Pager page={loaderData.sessionsQ.page} total={loaderData.sessionsQ.total} tab="sessions" extra={{}} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
