import type { Route } from "./+types/admin.videos";
import { Form, useActionData, useLoaderData, useRouteLoaderData, useNavigation } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { listVideos, registerMockVideo, registerYouTubeVideo, ingestMaster, syncVideo } from "~server/video/service.server";
import { parseYouTubeId } from "~server/video/youtube";
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
      titleAr: (v.metadata as { titleAr?: string | null } | null)?.titleAr ?? null,
      titleEn: (v.metadata as { titleEn?: string | null } | null)?.titleEn ?? null,
      youtubeId: v.provider === "youtube" ? v.providerAssetId : null,
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
  if (intent === "register-youtube") {
    const url = String(form.get("url") ?? "").trim();
    // Validate before touching the DB so a bad paste costs nothing and the owner
    // gets an actionable message rather than a stored broken row.
    if (!parseYouTubeId(url)) return { error: "youtube_invalid" as const };
    const clip = (k: string, n: number) => String(form.get(k) ?? "").trim().slice(0, n) || undefined;
    const row = await registerYouTubeVideo(db, {
      url,
      title: clip("title", 200),
      titleAr: clip("titleAr", 200),
      titleEn: clip("titleEn", 200),
      descriptionAr: clip("descriptionAr", 2000),
      descriptionEn: clip("descriptionEn", 2000),
    });
    await logAudit(db, { actorUserId: auth.user.id, actorRole: auth.user.roleId, action: "videos.registered", entityType: "video", entityId: row.id, after: { provider: "youtube", youtubeId: row.providerAssetId }, ipHash });
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
  const input = "rounded-lg border border-line px-3 py-2";
  const statusKey = (s: string) => (s === "ready" ? "videosAdmin.statusReady" : s === "preparing" ? "videosAdmin.statusPreparing" : s === "errored" ? "videosAdmin.statusErrored" : "videosAdmin.statusPending");

  return (
    <div className="space-y-6">
      <h1 className="sr-only">{t(locale, "videosAdmin.title")}</h1>
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
          <Form method="post" className="grid gap-3 border-t border-line pt-4" data-testid="youtube-form">
            <input type="hidden" name="_action" value="register-youtube" />
            <div className="sm:col-span-3">
              <h2 className="text-sm font-semibold text-ink-soft">{t(locale, "videosAdmin.youtubeHeading")}</h2>
              <p className="text-xs text-ink-muted">{t(locale, "videosAdmin.youtubeHeadingHint")}</p>
            </div>
            <label className="grid gap-1 text-sm sm:col-span-3">
              <span>{t(locale, "videosAdmin.youtubeUrl")}</span>
              <input
                name="url"
                type="url"
                required
                dir="ltr"
                placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                className={input}
                data-testid="youtube-url"
              />
              <span className="text-xs text-sand-400">{t(locale, "videosAdmin.youtubeUrlHint")}</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "videosAdmin.titleAr")}</span>
              <input name="titleAr" dir="rtl" className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "videosAdmin.titleEn")}</span>
              <input name="titleEn" dir="ltr" className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "videosAdmin.descAr")}</span>
              <textarea name="descriptionAr" dir="rtl" rows={2} className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "videosAdmin.descEn")}</span>
              <textarea name="descriptionEn" dir="ltr" rows={2} className={input} />
            </label>
            <div className="flex items-end sm:col-span-3">
              <SubmitButton>{t(locale, "videosAdmin.registerYouTube")}</SubmitButton>
            </div>
          </Form>
          {actionData?.ok && <p className="text-sm text-green-600">✓</p>}
          {actionData && "error" in actionData && actionData.error === "youtube_invalid" && (
            <p className="text-sm text-error" data-testid="youtube-error">{t(locale, "videosAdmin.youtubeInvalid")}</p>
          )}
          {actionData && "error" in actionData && actionData.error === "provider" && (
            <p className="text-sm text-error">{(actionData as { detail?: string }).detail}</p>
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
                {v.durationSeconds != null && <span className="text-xs text-ink-muted">{v.durationSeconds}s</span>}
                {v.youtubeId && <span className="font-mono text-xs text-sand-400" data-testid="youtube-id">{v.youtubeId}</span>}
                {v.status !== "ready" && (
                  <Form method="post" className="inline">
                    <input type="hidden" name="_action" value="sync" />
                    <input type="hidden" name="videoId" value={v.id} />
                    <button className="rounded border border-line px-2 py-1 text-xs hover:bg-sand-100">
                      {t(locale, "videosAdmin.sync")}
                    </button>
                  </Form>
                )}
              </li>
            ))}
            {loaderData.videos.length === 0 && <li className="text-sm text-ink-muted">{t(locale, "videosAdmin.empty")}</li>}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
