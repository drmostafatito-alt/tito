import type { Route } from "./+types/admin.entitlements";
import { Form, useActionData, useLoaderData, useRouteLoaderData, useNavigation } from "react-router";
import { eq, isNull, desc } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { grantSchema, grantEntitlement, revokeEntitlement } from "~server/entitlements/grant.server";
import { users, subjects, courses, lessons, entitlements } from "~server/db/schema";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, formatDate, type Locale } from "~/lib/i18n";

type ResourceKind = "subject" | "course" | "lesson";
const KINDS: ResourceKind[] = ["subject", "course", "lesson"];
const isKind = (v: string): v is ResourceKind => (KINDS as string[]).includes(v);

type CatalogRow = { id: string; titleAr: string; titleEn: string; status: string };

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
      metadata: entitlements.metadata,
    })
    .from(entitlements)
    .leftJoin(users, eq(users.id, entitlements.studentId))
    .orderBy(desc(entitlements.grantedAt))
    .limit(100);

  // Content catalog powers (a) the grant form's resource picker and (b) title
  // resolution for existing grants — the admin list never shows raw uuid prefixes.
  const [subjectRows, courseRows, lessonRows] = await Promise.all([
    db.select({ id: subjects.id, titleAr: subjects.titleAr, titleEn: subjects.titleEn, status: subjects.status }).from(subjects).where(isNull(subjects.deletedAt)),
    db.select({ id: courses.id, titleAr: courses.titleAr, titleEn: courses.titleEn, status: courses.status }).from(courses).where(isNull(courses.deletedAt)),
    db.select({ id: lessons.id, titleAr: lessons.titleAr, titleEn: lessons.titleEn, status: lessons.status }).from(lessons).where(isNull(lessons.deletedAt)),
  ]);
  const catalog: Record<ResourceKind, CatalogRow[]> = { subject: subjectRows, course: courseRows, lesson: lessonRows };
  const titleOf = new Map<string, { kind: ResourceKind; titleAr: string; titleEn: string }>();
  for (const kind of KINDS) for (const r of catalog[kind]) titleOf.set(r.id, { kind, titleAr: r.titleAr, titleEn: r.titleEn });

  const grants = rows.map((g) => {
    let note: string | null = null;
    const meta = g.metadata;
    if (meta && typeof meta.note === "string" && meta.note.trim()) note = meta.note.trim().slice(0, 200);
    const title = g.resourceId ? titleOf.get(g.resourceId) : undefined;
    return {
      id: g.id,
      studentEmail: g.studentEmail,
      studentId: g.studentId,
      resourceType: g.resourceType,
      resourceId: g.resourceId,
      status: g.status,
      expiresAt: g.expiresAt,
      grantedAt: g.grantedAt,
      note,
      resourceTitleAr: title?.titleAr ?? null,
      resourceTitleEn: title?.titleEn ?? null,
    };
  });

  return { grants, catalog };
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
    // Resource picker submits "kind:id"; fall back to legacy separate fields.
    let resourceType = String(form.get("resourceType") ?? "").trim();
    let resourceId = String(form.get("resourceId") ?? "").trim();
    const picked = String(form.get("resource") ?? "").trim();
    if (picked.includes(":")) {
      const [kind, ...rest] = picked.split(":");
      if (isKind(kind) && rest.join(":")) {
        resourceType = kind;
        resourceId = rest.join(":");
      }
    }
    const parsed = grantSchema.safeParse({
      studentId: student.id,
      resourceType,
      resourceId,
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
  const input = "w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm";
  const busy = nav.state !== "idle";
  const { grants, catalog } = loaderData;

  const localTitle = (ar: string | null, en: string | null) =>
    (locale === "ar" ? ar || en : en || ar) || null;
  const statusSuffix = (status: string) =>
    status === "draft" ? ` ${t(locale, "entAdmin.draftSuffix")}` : status === "archived" ? ` ${t(locale, "entAdmin.archivedSuffix")}` : "";

  return (
    <div className="space-y-6">
      <h1 className="sr-only">{t(locale, "entAdmin.title")}</h1>
      <Card>
        <CardHeader title={t(locale, "entAdmin.title")} />
        <CardBody>
          <Form method="post" className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="_action" value="grant" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.studentEmail")}</span>
              <input name="email" type="email" required dir="ltr" className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.resource")}</span>
              <select name="resource" required className={input} defaultValue="">
                <option value="" disabled>
                  —
                </option>
                {KINDS.map((kind) => (
                  <optgroup key={kind} label={t(locale, `entAdmin.type_${kind}`)}>
                    {catalog[kind].map((r) => (
                      <option key={r.id} value={`${kind}:${r.id}`}>
                        {(locale === "ar" ? r.titleAr : r.titleEn) || r.titleEn}
                        {statusSuffix(r.status)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.days")}</span>
              <input name="days" type="number" min={1} max={3650} className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "entAdmin.reason")}</span>
              <input name="note" dir="auto" className={input} />
            </label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SubmitButton disabled={busy}>{t(locale, "entAdmin.grant")}</SubmitButton>
              {actionData?.ok && <span className="text-sm text-green-600">{t(locale, "entAdmin.granted")}</span>}
              {actionData && "error" in actionData && actionData.error === "student_not_found" && (
                <span className="text-sm text-red-600">{t(locale, "entAdmin.studentNotFound")}</span>
              )}
              {actionData && "error" in actionData && actionData.error === "validation" && (
                <span className="text-sm text-red-600">{t(locale, "entAdmin.validationError")}</span>
              )}
            </div>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "entAdmin.listTitle")} description={t(locale, "entAdmin.listHint")} />
        <CardBody>
          <ul className="space-y-2">
            {grants.map((g) => {
              const title = localTitle(g.resourceTitleAr, g.resourceTitleEn) ?? `${g.resourceType}:${g.resourceId?.slice(0, 8)}…`;
              return (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-2.5 bg-slate-50/50 hover:bg-slate-50 text-sm"
                  data-testid="entitlement-row"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                    <Badge tone={g.status === "active" ? "success" : "neutral"}>
                      {g.status === "active" ? t(locale, "entAdmin.active") : t(locale, "entAdmin.revokedStatus")}
                    </Badge>
                    <span className="text-slate-700 font-mono text-xs">{g.studentEmail ?? g.studentId}</span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-500 font-medium">
                      {isKind(g.resourceType) ? t(locale, `entAdmin.type_${g.resourceType}`) : g.resourceType}
                    </span>
                    <span className="min-w-0 truncate font-semibold text-slate-800">{title}</span>
                    {g.note && (
                      <span className="min-w-0 max-w-full truncate text-xs text-slate-500 italic" title={g.note}>
                        “{g.note}”
                      </span>
                    )}
                    {g.expiresAt ? (
                      <span className="text-xs text-slate-500" dir="ltr">→ {formatDate(locale, g.expiresAt)}</span>
                    ) : (
                      <span className="text-xs text-slate-500">{t(locale, "entAdmin.permanent")}</span>
                    )}
                  </div>
                  {g.status === "active" && (
                    <Form method="post" className="inline shrink-0">
                      <input type="hidden" name="_action" value="revoke" />
                      <input type="hidden" name="id" value={g.id} />
                      <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                        {t(locale, "entAdmin.revoke")}
                      </button>
                    </Form>
                  )}
                </li>
              );
            })}
            {grants.length === 0 && <li className="text-sm text-slate-500">{t(locale, "entAdmin.empty")}</li>}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
