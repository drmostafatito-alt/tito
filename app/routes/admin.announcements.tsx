import type { Route } from "./+types/admin.announcements";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import {
  announcementInputSchema,
  ANNOUNCEMENT_STATUSES,
  archiveAnnouncement,
  createAnnouncement,
  listAnnouncementsAdmin,
  publishAnnouncement,
  unpublishAnnouncement,
  updateAnnouncement,
  type AnnouncementStatus,
} from "~server/announcements/service.server";
import { announcements as announcementsTable } from "~server/db/schema";
import { eq } from "drizzle-orm";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { et, t, formatDate, type Locale } from "~/lib/i18n";

const inputCls = "w-full rounded-lg border border-line px-3 py-2 text-sm";
// client-side literals mirroring AUDIENCES/ANNOUNCEMENT_STATUSES (component code must not touch .server imports)
const AUDIENCE_OPTIONS = ["all", "students", "teachers"] as const;
const STATUS_OPTIONS = ["draft", "published", "archived"] as const;
const selectCls = "h-[42px] rounded-lg border border-line bg-white px-3 text-sm";

/** datetime-local (wall clock, treated as UTC — same convention as exam windows) ↔ epoch ms */
const toLocalInput = (ms: number | null) => (ms == null ? "" : new Date(ms).toISOString().slice(0, 16));
const fromLocalInput = (v: string | null) => (v ? new Date(`${v}:00Z`).getTime() : null);

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "announcements.manage"))) throw new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const editId = url.searchParams.get("edit");
  const isNew = url.searchParams.get("new") === "1";

  const list = await listAnnouncementsAdmin(db, {
    status: ANNOUNCEMENT_STATUSES.includes(status as never) ? (status as AnnouncementStatus) : null,
    page,
  });
  let editing: Awaited<ReturnType<typeof listAnnouncementsAdmin>>["rows"][number] | null = null;
  if (editId) {
    const rows = await db.select().from(announcementsTable).where(eq(announcementsTable.id, editId)).limit(1);
    editing = rows[0] ?? null;
  }
  // Read-only recipient preview (admins only — this route is announcements.manage gated).
  const previewId = url.searchParams.get("preview");
  let preview: Awaited<ReturnType<typeof listAnnouncementsAdmin>>["rows"][number] | null = null;
  if (previewId) {
    const rows = await db.select().from(announcementsTable).where(eq(announcementsTable.id, previewId)).limit(1);
    preview = rows[0] ?? null;
  }
  return { list, editing, isNew, statusFilter: status ?? "", preview };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  if (!(await canPlatform(db, auth, "announcements.manage"))) return { error: "denied" as const };
  const actor = { userId: auth.user.id, role: auth.user.roleId };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  if (intent === "create" || intent === "update") {
    const parsed = announcementInputSchema.safeParse({
      titleAr: String(form.get("titleAr") ?? ""),
      titleEn: String(form.get("titleEn") ?? ""),
      bodyAr: String(form.get("bodyAr") ?? ""),
      bodyEn: String(form.get("bodyEn") ?? ""),
      audience: String(form.get("audience") ?? "all"),
      publishAt: fromLocalInput(form.get("publishAt") == null ? null : String(form.get("publishAt"))),
      expiresAt: fromLocalInput(form.get("expiresAt") == null ? null : String(form.get("expiresAt"))),
    });
    if (!parsed.success) return { error: "validation" as const };
    if (intent === "create") {
      const res = await createAnnouncement(db, parsed.data, actor);
      return res.ok ? { done: "created", id: res.id } : { error: res.error };
    }
    const res = await updateAnnouncement(db, String(form.get("id") ?? ""), parsed.data, actor);
    return res.ok ? { done: "updated" } : { error: res.error };
  }
  if (intent === "publish" || intent === "unpublish" || intent === "archive") {
    const id = String(form.get("id") ?? "");
    const res =
      intent === "publish"
        ? await publishAnnouncement(db, id, actor)
        : intent === "unpublish"
          ? await unpublishAnnouncement(db, id, actor)
          : await archiveAnnouncement(db, id, actor);
    return res.ok ? { done: intent === "publish" ? "published" : intent === "unpublish" ? "unpublished" : "archived" } : { error: res.error };
  }
  return { error: "bad_request" as const };
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warning"> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
};

export default function AdminAnnouncements({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { list, editing, isNew, statusFilter, preview } = loaderData;
  const showForm = isNew || editing !== null;
  const pvTitle = locale === "ar" ? preview?.titleAr || preview?.titleEn : preview?.titleEn || preview?.titleAr;
  const pvBody = locale === "ar" ? preview?.bodyAr || preview?.bodyEn : preview?.bodyEn || preview?.bodyAr;
  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const withPage = (p: number) => {
    const sp = new URLSearchParams();
    if (statusFilter) sp.set("status", statusFilter);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `?${s}` : ".";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">{t(locale, "announcementsAdmin.title")}</h1>
        {!showForm && (
          <Link to="/admin/announcements?new=1" className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800" data-testid="new-announcement">
            {t(locale, "announcementsAdmin.newBtn")}
          </Link>
        )}
      </div>

      {actionData && "error" in actionData && (
        <Alert kind="error"><span data-testid="ann-error">{et(locale, "announcementsAdmin", String(actionData.error))}</span></Alert>
      )}
      {actionData && "done" in actionData && (
        <Alert kind="success"><span data-testid="ann-done">{t(locale, `announcementsAdmin.done_${actionData.done}`)}</span></Alert>
      )}

      {preview && (
        <Card data-testid="ann-preview-panel">
          <CardHeader
            title={t(locale, "announcementsAdmin.previewTitle")}
            action={<Link to="/admin/announcements" className="text-sm text-ink hover:underline" data-testid="ann-preview-close">{t(locale, "announcementsAdmin.closePreview")}</Link>}
          />
          <CardBody className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <Badge tone={STATUS_TONE[preview.status] ?? "neutral"}>{t(locale, `announcementsAdmin.status_${preview.status}`)}</Badge>
              <Badge tone="neutral">{t(locale, `announcementsAdmin.aud_${preview.audience}`)}</Badge>
              {preview.publishAt ? <span>{t(locale, "announcementsAdmin.fieldPublishAt")}: {formatDate(locale, preview.publishAt)}</span> : null}
              {preview.expiresAt ? <span>{t(locale, "announcementsAdmin.fieldExpiresAt")}: {formatDate(locale, preview.expiresAt)}</span> : null}
            </div>
            <p className="text-xs text-ink-muted">{t(locale, "announcementsAdmin.previewNote")}</p>
            <div className="rounded-lg border border-line bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink" data-testid="ann-preview-title">{pvTitle || "—"}</span>
                <Badge tone="brand">{t(locale, "notifications.unreadLabel")}</Badge>
              </div>
              {pvBody ? <p className="mt-2 whitespace-pre-line text-sm text-ink-muted" data-testid="ann-preview-body">{pvBody}</p> : <p className="mt-2 text-sm text-ink-muted">{t(locale, "announcementsAdmin.noBody")}</p>}
            </div>
          </CardBody>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader title={editing ? t(locale, "announcementsAdmin.editTitle") : t(locale, "announcementsAdmin.createTitle")} description={t(locale, "announcementsAdmin.visibilityNote")} />
          <CardBody>
            <Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="_action" value={editing ? "update" : "create"} />
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink">{t(locale, "announcementsAdmin.fieldTitleAr")}</span>
                  <input name="titleAr" className={inputCls} defaultValue={editing?.titleAr ?? ""} required maxLength={200} data-testid="ann-title-ar" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink">{t(locale, "announcementsAdmin.fieldTitleEn")}</span>
                  <input name="titleEn" className={inputCls} defaultValue={editing?.titleEn ?? ""} required maxLength={200} dir="ltr" data-testid="ann-title-en" />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink">{t(locale, "announcementsAdmin.fieldBodyAr")}</span>
                  <textarea name="bodyAr" className={`${inputCls} min-h-24`} defaultValue={editing?.bodyAr ?? ""} maxLength={5000} data-testid="ann-body-ar" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink">{t(locale, "announcementsAdmin.fieldBodyEn")}</span>
                  <textarea name="bodyEn" className={`${inputCls} min-h-24`} defaultValue={editing?.bodyEn ?? ""} maxLength={5000} dir="ltr" data-testid="ann-body-en" />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink">{t(locale, "announcementsAdmin.fieldAudience")}</span>
                  <select name="audience" className={selectCls} defaultValue={editing?.audience ?? "all"} data-testid="ann-audience">
                    {AUDIENCE_OPTIONS.map((a) => (
                      <option key={a} value={a}>{t(locale, `announcementsAdmin.aud_${a}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink">{t(locale, "announcementsAdmin.fieldPublishAt")} <span className="text-xs text-ink-muted">({t(locale, "announcementsAdmin.optional")})</span></span>
                  <input type="datetime-local" name="publishAt" className={selectCls} defaultValue={toLocalInput(editing?.publishAt ?? null)} data-testid="ann-publish-at" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink">{t(locale, "announcementsAdmin.fieldExpiresAt")} <span className="text-xs text-ink-muted">({t(locale, "announcementsAdmin.optional")})</span></span>
                  <input type="datetime-local" name="expiresAt" className={selectCls} defaultValue={toLocalInput(editing?.expiresAt ?? null)} data-testid="ann-expires-at" />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span data-testid="ann-save"><SubmitButton>{editing ? t(locale, "announcementsAdmin.save") : t(locale, "announcementsAdmin.saveDraft")}</SubmitButton></span>
                <Link to="/admin/announcements" className="inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:bg-slate-100">{t(locale, "announcementsAdmin.cancel")}</Link>
              </div>
            </Form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-3">
          <Form method="get" className="flex flex-wrap items-center gap-2">
            <select name="status" className={selectCls} defaultValue={statusFilter} aria-label={t(locale, "announcementsAdmin.filterByStatus")} data-testid="ann-status-filter">
              <option value="">{t(locale, "announcementsAdmin.allStatuses")}</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{t(locale, `announcementsAdmin.status_${s}`)}</option>
              ))}
            </select>
            <SubmitButton variant="secondary">{t(locale, "announcementsAdmin.filter")}</SubmitButton>
          </Form>
          <p className="text-xs text-ink-muted" data-testid="ann-total">{t(locale, "announcementsAdmin.totalCount", { n: list.total })}</p>
          {list.rows.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "announcementsAdmin.empty")}</p>}
          {list.rows.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 text-sm last:border-0" data-testid="announcement-row">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-ink">{locale === "ar" ? a.titleAr : a.titleEn}</span>
                <span className="text-xs text-ink-muted">
                  {t(locale, "adminUsers.colUpdated")}: {formatDate(locale, a.updatedAt)}
                  {a.publishAt ? ` · ${t(locale, "announcementsAdmin.fieldPublishAt")}: ${formatDate(locale, a.publishAt)}` : ""}
                  {a.expiresAt ? ` · ${t(locale, "announcementsAdmin.fieldExpiresAt")}: ${formatDate(locale, a.expiresAt)}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{t(locale, `announcementsAdmin.aud_${a.audience}`)}</Badge>
                <span data-testid={`ann-status-${a.id}`}><Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{t(locale, `announcementsAdmin.status_${a.status}`)}</Badge></span>
                <Link to={`/admin/announcements?edit=${a.id}`} className="text-xs text-ink hover:underline" data-testid={`ann-edit-${a.id}`}>{t(locale, "announcementsAdmin.edit")}</Link>
                <Link to={`/admin/announcements?preview=${a.id}`} className="text-xs text-ink hover:underline" data-testid={`ann-preview-${a.id}`}>{t(locale, "announcementsAdmin.preview")}</Link>
                {a.status === "draft" && (
                  <Form method="post">
                    <input type="hidden" name="_action" value="publish" />
                    <input type="hidden" name="id" value={a.id} />
                    <span data-testid={`ann-publish-${a.id}`}><SubmitButton variant="secondary" size="sm">{t(locale, "announcementsAdmin.publish")}</SubmitButton></span>
                  </Form>
                )}
                {a.status === "published" && (
                  <Form method="post">
                    <input type="hidden" name="_action" value="unpublish" />
                    <input type="hidden" name="id" value={a.id} />
                    <span data-testid={`ann-unpublish-${a.id}`}><SubmitButton variant="secondary" size="sm">{t(locale, "announcementsAdmin.unpublish")}</SubmitButton></span>
                  </Form>
                )}
                {a.status !== "archived" && (
                  <Form method="post" onSubmit={(e) => { if (!confirm(t(locale, "announcementsAdmin.confirmArchive"))) e.preventDefault(); }}>
                    <input type="hidden" name="_action" value="archive" />
                    <input type="hidden" name="id" value={a.id} />
                    <span data-testid={`ann-archive-${a.id}`}><SubmitButton variant="danger" size="sm">{t(locale, "announcementsAdmin.archive")}</SubmitButton></span>
                  </Form>
                )}
              </div>
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm">
              {list.page > 1 ? <Link className="text-ink hover:underline" to={withPage(list.page - 1)} data-testid="ann-prev">{t(locale, "announcementsAdmin.prevPage")}</Link> : <span />}
              <span className="text-xs text-ink-muted">{t(locale, "announcementsAdmin.pageOf", { page: list.page, total: totalPages })}</span>
              {list.page < totalPages ? <Link className="text-ink hover:underline" to={withPage(list.page + 1)} data-testid="ann-next">{t(locale, "announcementsAdmin.nextPage")}</Link> : <span />}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
