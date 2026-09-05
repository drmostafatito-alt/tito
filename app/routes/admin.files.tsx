import type { Route } from "./+types/admin.files";
import { Form, useActionData, useLoaderData, useRouteLoaderData, useNavigation } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  buildR2Key,
  bucketOf,
  detectKind,
  insertFile,
  listFiles,
  sha256HexOf,
  signFileUrl,
  sizeCapFor,
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
  if (String(form.get("_action")) !== "upload") return { error: "generic" as const };

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
  const nav = useNavigation();
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
                  {t(locale, actionData.error === "too_large" ? "filesAdmin.tooLarge" : "filesAdmin.badType")}
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
              <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="neutral">{f.kind}</Badge>
                <Badge tone={f.visibility === "public" ? "success" : "warning"}>{f.visibility}</Badge>
                {f.downloadAllowed && <Badge tone="brand">↓</Badge>}
                <a href={f.url} target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                  {f.name}
                </a>
                <span className="text-xs text-slate-400">{Math.max(1, Math.round(f.byteSize / 1024))} KB</span>
              </li>
            ))}
            {loaderData.files.length === 0 && <li className="text-sm text-slate-400">{t(locale, "filesAdmin.empty")}</li>}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
