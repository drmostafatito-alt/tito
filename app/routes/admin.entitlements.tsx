import type { Route } from "./+types/admin.entitlements";
import { Form, useActionData, useLoaderData, useRouteLoaderData, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { grantSchema, grantEntitlement, revokeEntitlement } from "~server/entitlements/grant.server";
import { users } from "~server/db/schema";
import { desc } from "drizzle-orm";
import { entitlements } from "~server/db/schema";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, formatDate, type Locale } from "~/lib/i18n";

/** Admin entitlements: grant/revoke resource-level access (admin_grant source). */
export async function loader({ context, request }: Route.LoaderArgs) {
  await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const rows = await db
    .select({
      id: entitlements.id,
      studentId: entitlements.studentId,
      studentEmail: users.email,
      resourceType: entitlements.resourceType,
      resourceId: entitlements.resourceId,
      status: entitlements.status,
      expiresAt: entitlements.expiresAt,
      grantedAt: entitlements.grantedAt,
    })
    .from(entitlements)
    .leftJoin(users, eq(users.id, entitlements.studentId))
    .orderBy(desc(entitlements.grantedAt))
    .limit(100);
  return { grants: rows };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const actor = { userId: auth.user.id, role: auth.user.roleId };

  if (intent === "grant") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const studentRows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    const student = studentRows[0];
    if (!student) return { error: "student_not_found" as const };
    const parsed = grantSchema.safeParse({
      studentId: student.id,
      resourceType: form.get("resourceType"),
      resourceId: form.get("resourceId"),
      days: form.get("days") ? Number(form.get("days")) : null,
      note: String(form.get("note") ?? "").slice(0, 500) || undefined,
    });
    if (!parsed.success) return { error: "validation" as const };
    await grantEntitlement(db, parsed.data, actor);
    return { ok: true as const };
  }
  if (intent === "revoke") {
    const id = String(form.get("id") ?? "");
    const ok = await revokeEntitlement(db, id, "admin revoke", actor);
    return ok ? { ok: true as const } : { error: "not_found" as const };
  }
  return { error: "generic" as const };
}

export default function AdminEntitlements({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const input = "rounded-lg border border-slate-300 px-3 py-2";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t(locale, "entAdmin.title")} />
        <CardBody>
          <Form method="post" className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="_action" value="grant" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.studentEmail")}</span>
              <input name="email" type="email" required dir="ltr" className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.resourceType")}</span>
              <select name="resourceType" className={input}>
                <option value="subject">subject</option>
                <option value="course">course</option>
                <option value="lesson">lesson</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.resourceId")}</span>
              <input name="resourceId" required dir="ltr" className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.days")}</span>
              <input name="days" type="number" min={1} max={3650} className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.reason")}</span>
              <input name="note" dir="auto" className={input} />
            </label>
            <div className="flex items-end gap-3">
              <SubmitButton>{t(locale, "entAdmin.grant")}</SubmitButton>
              {actionData?.ok && <span className="text-sm text-green-600">{t(locale, "entAdmin.granted")}</span>}
              {actionData && "error" in actionData && actionData.error === "student_not_found" && (
                <span className="text-sm text-red-600">{t(locale, "entAdmin.studentNotFound")}</span>
              )}
            </div>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "entAdmin.title")} />
        <CardBody>
          <ul className="space-y-2">
            {loaderData.grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={g.status === "active" ? "success" : "neutral"}>{g.status}</Badge>
                <span className="text-slate-700">{g.studentEmail ?? g.studentId}</span>
                <span className="text-xs text-slate-400">
                  {g.resourceType}:{g.resourceId?.slice(0, 8)}…
                </span>
                {g.expiresAt ? (
                  <span className="text-xs text-slate-400">→ {formatDate(locale, g.expiresAt)}</span>
                ) : (
                  <span className="text-xs text-slate-400">∞</span>
                )}
                {g.status === "active" && (
                  <Form method="post" className="inline">
                    <input type="hidden" name="_action" value="revoke" />
                    <input type="hidden" name="id" value={g.id} />
                    <button className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                      {t(locale, "entAdmin.revoke")}
                    </button>
                  </Form>
                )}
              </li>
            ))}
            {loaderData.grants.length === 0 && <li className="text-sm text-slate-400">{t(locale, "entAdmin.empty")}</li>}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
