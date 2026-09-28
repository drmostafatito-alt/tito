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
import { EmptyNote } from "~/components/tito/ui";
import { WorkHead } from "~/components/tito/page";
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

/**
 * Announcements are a reading list, not an inbox of cards: each one is a dated
 * entry on a rule, unread ones marked with the highlighter.
 */
export default function StudentNotifications({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";

  return (
    <div>
      <WorkHead
        eyebrow={t(locale, "common.dashboard")}
        title={t(locale, "notifications.title")}
        actions={
          loaderData.unread > 0 ? (
            <Form method="post">
              <input type="hidden" name="_action" value="mark-all-read" />
              <span data-testid="mark-all-read">
                <SubmitButton variant="secondary" size="sm">
                  {t(locale, "notifications.markAllRead")}
                </SubmitButton>
              </span>
            </Form>
          ) : undefined
        }
      />

      {loaderData.items.length === 0 ? (
        <span data-testid="notifications-empty">
          <EmptyNote title={t(locale, "notifications.empty")} />
        </span>
      ) : (
        <ul className="flex flex-col">
          {loaderData.items.map((a) => {
            const title = ar ? a.titleAr || a.titleEn : a.titleEn || a.titleAr;
            const body = ar ? a.bodyAr || a.bodyEn : a.bodyEn || a.bodyAr;
            return (
              <li key={a.id} className="border-b border-pub-line py-6 first:border-t first:border-pub-ink">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <h2 className="min-w-0 font-display text-pub-md font-extrabold leading-pub-snug text-pub-ink" data-testid={`notif-title-${a.id}`}>
                    {title}
                  </h2>
                  <span className="flex shrink-0 items-center gap-2">
                    {a.readAt ? (
                      <Badge tone="neutral">{t(locale, "notifications.readLabel")}</Badge>
                    ) : (
                      <span data-testid={`notif-unread-${a.id}`}>
                        <Badge tone="brand">{t(locale, "notifications.unreadLabel")}</Badge>
                      </span>
                    )}
                    <span className="text-pub-xs text-pub-muted" data-numeral>
                      {formatDate(locale, a.publishedAt ?? a.createdAt)}
                    </span>
                  </span>
                </div>
                {body && (
                  <p className="mt-3 max-w-[62ch] whitespace-pre-line text-pub-sm leading-pub-normal text-pub-ink-soft" data-testid={`notif-body-${a.id}`}>
                    {body}
                  </p>
                )}
                {a.expiresAt && (
                  <p className="mt-3 text-pub-xs text-pub-muted" data-numeral>
                    {t(locale, "notifications.expiresAt")}: {formatDate(locale, a.expiresAt)}
                  </p>
                )}
                {!a.readAt && (
                  <Form method="post" className="mt-4">
                    <input type="hidden" name="_action" value="mark-read" />
                    <input type="hidden" name="id" value={a.id} />
                    <span data-testid={`mark-read-${a.id}`}>
                      <SubmitButton variant="secondary" size="sm">
                        {t(locale, "notifications.markRead")}
                      </SubmitButton>
                    </span>
                  </Form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
