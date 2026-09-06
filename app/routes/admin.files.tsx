import type { Route } from "./+types/admin.files";
import { Form, useActionData, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  buildR2Key,
  deleteFile,
  detectKind,
  fileUsage,
  insertFile,
  listFiles,
  replaceFileBytes,
  sha256HexOf,
  signFileUrl,
  sizeCapFor,
  updateFileMeta,
} from "~server/files/storage.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { logAudit } from "~server/audit/log.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, type Locale } from "~/lib/i18n";

/**
 * Admin files: upload to R2 (public-assets or private-files per visibility),
 * registry row, signed-URL preview links. Raw R2 keys are admin-visible only.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth, settings } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const rows = await listFiles(db, 200);
  const ttl = settings.video.fileUrlTtlSeconds;
  const withLinks = await Promise.all(
    rows.map(async (f) => ({
      id: f.id,
      name: f.originalFilename,
      kind: f.kind,
      visibility: f.visibility,
      downloadAllowed: f.downloadAllowed,
      byteSize: f.byteSize,
      altAr: f.altAr ?? "",
      altEn: f.altEn ?? "",
      url: f.visibility === "private" ? (await signFileUrl(env, f.id, "view", ttl)).path : `/files/${f.id}`,
    }))
  );
  return { files: withLinks };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  if (intent === "rename") {
    await updateFileMeta(db, String(form.get("id") ?? ""), {
      originalFilename: String(form.get("name") ?? ""),
      altAr: String(form.get("altAr") ?? ""),
      altEn: String(form.get("altEn") ?? ""),
    });
    return { ok: true as const };
  }
  if (intent === "replace") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "validation" as const };
    const mime = file.type || "application/octet-stream";
    const kind = detectKind(mime);
    if (!kind) return { error: "bad_type" as const };
    if (file.size > sizeCapFor(kind)) return { error: "too_large" as const };
    await replaceFileBytes(db, env, String(form.get("id") ?? ""), await file.arrayBuffer(), mime, file.name);
    return { ok: true as const };
  }
  if (intent === "usage") {
    const usage = await fileUsage(db, String(form.get("id") ?? ""));
    return { ok: true as const, usage, usageId: String(form.get("id") ?? "") };
  }
  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    const usage = await fileUsage(db, id);
    if (usage.length) return { error: "in_use" as const, issues: usage };
    await deleteFile(db, env, id);
    return { ok: true as const };
  }
  if (intent !== "upload") return { error: "generic" as const };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "validation" as const };
  const mime = file.type || "application/octet-stream";
  const kind = detectKind(mime);
  if (!kind) return { error: "bad_type" as const };
  if (file.size > sizeCapFor(kind)) return { error: "too_large" as const };

  const visibility = String(form.get("visibility") ?? "private") === "public" ? "public" : "private";
  const downloadAllowed = form.get("downloadAllowed") === "on";

  const buf = await file.arrayBuffer();
  const checksum = await sha256HexOf(buf);
  const r2Key = buildR2Key(kind, file.name, visibility);
  const bucket = visibility === "public" ? env.PUBLIC_ASSETS : env.PRIVATE_FILES;
  await bucket.put(r2Key, buf, { httpMetadata: { contentType: mime } });

  const id = await insertFile(db, {
    r2Key,
    bucket: visibility === "public" ? "PUBLIC_ASSETS" : "PRIVATE_FILES",
    kind,
    originalFilename: file.name.slice(0, 200),
    mime,
    byteSize: file.size,
    checksumSha256: checksum,
    visibility,
    downloadAllowed,
    createdBy: auth.user.id,
  });
  await logAudit(db, {
    actorUserId: auth.user.id, actorRole: auth.user.roleId,
    action: "files.uploaded", entityType: "file", entityId: id,
    after: { r2Key, kind, visibility, byteSize: file.size },
    ipHash: await sha256Hex(clientIpOf(request) ?? "unknown"),
  });
  return { ok: true as const, id };
}

export default function AdminFiles({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const input = "rounded-lg border border-slate-300 px-3 py-2";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t(locale, "filesAdmin.title")} />
        <CardBody>
          <Form method="post" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="_action" value="upload" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "filesAdmin.upload")}</span>
              <input type="file" name="file" required className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span />
              <select name="visibility" className={input}>
                <option value="private">{t(locale, "filesAdmin.visibilityPrivate")}</option>
                <option value="public">{t(locale, "filesAdmin.visibilityPublic")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="downloadAllowed" className="h-4 w-4" />
              {t(locale, "filesAdmin.downloadAllowed")}
            </label>
            <div className="flex items-center gap-3">
              <SubmitButton>{t(locale, "filesAdmin.upload")}</SubmitButton>
              {actionData?.ok && <span className="text-sm text-green-600">{t(locale, "filesAdmin.uploaded")}</span>}
              {actionData && "error" in actionData && actionData.error && actionData.error !== "generic" && (
                <span className="text-sm text-red-600">
                  {actionData.error === "in_use"
                    ? `${t(locale, "filesAdmin.inUse")}${"issues" in actionData && actionData.issues ? `: ${actionData.issues.join(", ")}` : ""}`
                    : t(locale, actionData.error === "too_large" ? "filesAdmin.tooLarge" : "filesAdmin.badType")}
                </span>
              )}
            </div>
          </Form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "filesAdmin.title")} />
        <CardBody>
          <ul className="space-y-2">
            {loaderData.files.map((f) => (
              <li key={f.id} className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{f.kind}</Badge>
                  <Badge tone={f.visibility === "public" ? "success" : "warning"}>{f.visibility}</Badge>
                  {f.downloadAllowed && <Badge tone="brand">↓</Badge>}
                  <a href={f.url} target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                    {f.name}
                  </a>
                  <span className="text-xs text-slate-400">{Math.max(1, Math.round(f.byteSize / 1024))} KB</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Form method="post" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="_action" value="rename" />
                    <input type="hidden" name="id" value={f.id} />
                    <input name="name" defaultValue={f.name} className={`${input} w-40`} />
                    <input name="altAr" defaultValue={f.altAr} placeholder="alt AR" className={`${input} w-28`} />
                    <input name="altEn" defaultValue={f.altEn} placeholder="alt EN" className={`${input} w-28`} />
                    <SubmitButton>{t(locale, "filesAdmin.saveMeta")}</SubmitButton>
                  </Form>
                  <Form method="post" encType="multipart/form-data" className="flex items-end gap-2">
                    <input type="hidden" name="_action" value="replace" />
                    <input type="hidden" name="id" value={f.id} />
                    <input type="file" name="file" required className={input} />
                    <SubmitButton>{t(locale, "filesAdmin.replace")}</SubmitButton>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="_action" value="usage" />
                    <input type="hidden" name="id" value={f.id} />
                    <SubmitButton>{t(locale, "filesAdmin.usage")}</SubmitButton>
                  </Form>
                  <Form method="post" onSubmit={(e) => { if (!confirm(t(locale, "filesAdmin.confirmDelete"))) e.preventDefault(); }}>
                    <input type="hidden" name="_action" value="delete" />
                    <input type="hidden" name="id" value={f.id} />
                    <SubmitButton>{t(locale, "filesAdmin.delete")}</SubmitButton>
                  </Form>
                </div>
                {actionData && "usageId" in actionData && actionData.usageId === f.id && (
                  <p className="text-xs text-slate-500">
                    {t(locale, "filesAdmin.usage")}: {actionData.usage.length ? actionData.usage.join(", ") : t(locale, "filesAdmin.unused")}
                  </p>
                )}
              </li>
            ))}
            {loaderData.files.length === 0 && <li className="text-sm text-slate-400">{t(locale, "filesAdmin.empty")}</li>}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
