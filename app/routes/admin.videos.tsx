import type { Route } from "./+types/admin.videos";
import { Form, useActionData, useLoaderData, useRouteLoaderData, useNavigation } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { listVideos, registerMockVideo, ingestMaster, syncVideo } from "~server/video/service.server";
import { getSettings } from "~server/settings/service.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { logAudit } from "~server/audit/log.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, type Locale } from "~/lib/i18n";

/** Admin videos: register mock / ingest master through the ACTIVE provider; list + sync. */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { settings } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const rows = await listVideos(db, 200);
  return {
    provider: settings.video.provider,
    videos: rows.map((v) => ({
      id: v.id,
      provider: v.provider,
      status: v.status,
      durationSeconds: v.durationSeconds,
      title: (v.metadata as { title?: string } | null)?.title ?? v.playbackId ?? v.id,
    })),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");

  if (intent === "register-mock") {
    const duration = Number(form.get("duration") ?? 60);
    const row = await registerMockVideo(db, {
      durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.min(duration, 7200) : 60,
      title: String(form.get("title") ?? "").slice(0, 200) || undefined,
    });
    await logAudit(db, { actorUserId: auth.user.id, actorRole: auth.user.roleId, action: "videos.registered", entityType: "video", entityId: row.id, after: { provider: "mock" }, ipHash });
    return { ok: true as const };
  }
  if (intent === "ingest") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "validation" as const };
    const settings = await getSettings(db);
    const title = String(form.get("title") ?? file.name).slice(0, 200);
    try {
      const row = await ingestMaster(db, env, {
        masterStream: file.stream(),
        masterSize: file.size,
        originalFilename: file.name,
        title,
      });
      await logAudit(db, { actorUserId: auth.user.id, actorRole: auth.user.roleId, action: "videos.ingested", entityType: "video", entityId: row.id, after: { provider: settings.video.provider, status: row.status }, ipHash });
      return { ok: true as const };
    } catch (err) {
      return { error: "provider" as const, detail: err instanceof Error ? err.message : String(err) };
    }
  }
  if (intent === "sync") {
    const id = String(form.get("videoId") ?? "");
    try {
      const row = await syncVideo(db, env, id);
      return row ? { ok: true as const } : { error: "not_found" as const };
    } catch (err) {
      return { error: "provider" as const, detail: err instanceof Error ? err.message : String(err) };
    }
  }
  return { error: "generic" as const };
}

export default function AdminVideos({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const input = "rounded-lg border border-slate-300 px-3 py-2";
  const statusKey = (s: string) => (s === "ready" ? "videosAdmin.statusReady" : s === "preparing" ? "videosAdmin.statusPreparing" : s === "errored" ? "videosAdmin.statusErrored" : "videosAdmin.statusPending");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={`${t(locale, "videosAdmin.title")} — ${t(locale, "videosAdmin.provider")}: ${loaderData.provider}`} />
        <CardBody className="space-y-4">
          <Form method="post" className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="_action" value="register-mock" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "videosAdmin.registerMock")}</span>
              <input name="title" dir="auto" className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>⏱ (s)</span>
              <input name="duration" type="number" min={10} max={7200} defaultValue={60} className={input} />
            </label>
            <div className="flex items-end">
              <SubmitButton>{t(locale, "videosAdmin.registerMock")}</SubmitButton>
            </div>
          </Form>
          <Form method="post" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="_action" value="ingest" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "videosAdmin.ingestMaster")}</span>
              <input type="file" name="file" accept="video/mp4,video/quicktime" required className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Title</span>
              <input name="title" dir="auto" className={input} />
            </label>
            <div className="flex items-end gap-3">
              <SubmitButton>{t(locale, "videosAdmin.ingestMaster")}</SubmitButton>
            </div>
          </Form>
          {actionData?.ok && <p className="text-sm text-green-600">✓</p>}
          {actionData && "error" in actionData && actionData.error === "provider" && (
            <p className="text-sm text-red-600">{(actionData as { detail?: string }).detail}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "videosAdmin.title")} description={t(locale, "videosAdmin.attachedHint")} />
        <CardBody>
          <ul className="space-y-2">
            {loaderData.videos.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="brand">{v.provider}</Badge>
                <Badge tone={v.status === "ready" ? "success" : v.status === "errored" ? "warning" : "neutral"}>
                  {t(locale, statusKey(v.status))}
                </Badge>
                <span className="max-w-[40%] truncate">{v.title}</span>
                {v.durationSeconds != null && <span className="text-xs text-slate-400">{v.durationSeconds}s</span>}
                {v.status !== "ready" && (
                  <Form method="post" className="inline">
                    <input type="hidden" name="_action" value="sync" />
                    <input type="hidden" name="videoId" value={v.id} />
                    <button className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                      {t(locale, "videosAdmin.sync")}
                    </button>
                  </Form>
                )}
              </li>
            ))}
            {loaderData.videos.length === 0 && <li className="text-sm text-slate-400">{t(locale, "videosAdmin.empty")}</li>}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
