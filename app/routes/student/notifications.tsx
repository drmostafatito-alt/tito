import type { Route } from "./+types/notifications";
import { Form, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  markAllAnnouncementsRead,
  markAnnouncementRead,
  unreadAnnouncementsCount,
  visibleAnnouncements,
} from "~server/announcements/service.server";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Student notification center (FEATURE-SPEC §9 / P7 §12): published,
 * in-window, audience-matched announcements only. Drafts, archived,
 * future-scheduled and expired rows never appear (server-side filter).
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const user = { id: auth.user.id, roleId: auth.user.roleId };
  const [items, unread] = await Promise.all([visibleAnnouncements(db, user), unreadAnnouncementsCount(db, user)]);
  return { items, unread };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const user = { id: auth.user.id, roleId: auth.user.roleId };
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  if (intent === "mark-read") {
    const ok = await markAnnouncementRead(db, String(form.get("id") ?? ""), user);
    return ok ? { done: "read" } : { error: "not_found" };
  }
  if (intent === "mark-all-read") {
    const n = await markAllAnnouncementsRead(db, user);
    return { done: "all", n };
  }
  return { error: "bad_request" };
}

export default function StudentNotifications({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t(locale, "notifications.title")}</h1>
        {loaderData.unread > 0 && (
          <Form method="post">
            <input type="hidden" name="_action" value="mark-all-read" />
            <span data-testid="mark-all-read"><SubmitButton variant="secondary" size="sm">{t(locale, "notifications.markAllRead")}</SubmitButton></span>
          </Form>
        )}
      </div>

      {loaderData.items.length === 0 && (
        <Alert kind="info"><span data-testid="notifications-empty">{t(locale, "notifications.empty")}</span></Alert>
      )}

      <div className="flex flex-col gap-4">
        {loaderData.items.map((a) => {
          const title = locale === "ar" ? a.titleAr || a.titleEn : a.titleEn || a.titleAr;
          const body = locale === "ar" ? a.bodyAr || a.bodyEn : a.bodyEn || a.bodyAr;
          return (
            <Card key={a.id}>
              <CardBody className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900" data-testid={`notif-title-${a.id}`}>{title}</h2>
                  <span className="flex items-center gap-2">
                    {a.readAt ? (
                      <Badge tone="neutral">{t(locale, "notifications.readLabel")}</Badge>
                    ) : (
                      <span data-testid={`notif-unread-${a.id}`}><Badge tone="brand">{t(locale, "notifications.unreadLabel")}</Badge></span>
                    )}
                    <span className="text-xs text-slate-400">{formatDate(locale, a.publishedAt ?? a.createdAt)}</span>
                  </span>
                </div>
                {body && <p className="whitespace-pre-line text-sm text-slate-600" data-testid={`notif-body-${a.id}`}>{body}</p>}
                {a.expiresAt && (
                  <p className="text-xs text-slate-400">{t(locale, "notifications.expiresAt")}: {formatDate(locale, a.expiresAt)}</p>
                )}
                {!a.readAt && (
                  <Form method="post">
                    <input type="hidden" name="_action" value="mark-read" />
                    <input type="hidden" name="id" value={a.id} />
                    <span data-testid={`mark-read-${a.id}`}><SubmitButton variant="secondary" size="sm">{t(locale, "notifications.markRead")}</SubmitButton></span>
                  </Form>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
