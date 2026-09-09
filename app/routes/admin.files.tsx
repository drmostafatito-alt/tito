import type { Route } from "./+types/admin.files";
import { useMemo, useState } from "react";
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
import { EmptyState } from "~/components/ui/EmptyState";
import { t, formatDate, type Locale } from "~/lib/i18n";

/**
 * Admin Media Library (Phase 1). Reuses the existing storage backend/actions
 * (upload/rename/replace/usage/delete are unchanged) behind a real library UI:
 * drag & drop upload, image/video previews, search + type/visibility filters,
 * copy-link, per-file details and safe delete with in-use guarding.
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
      createdAt: f.createdAt,
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
    actorUserId: auth.user.id,
    actorRole: auth.user.roleId,
    action: "files.uploaded",
    entityType: "file",
    entityId: id,
    after: { r2Key, kind, visibility, byteSize: file.size },
    ipHash: await sha256Hex(clientIpOf(request) ?? "unknown"),
  });
  return { ok: true as const, id };
}

const KINDS = ["image", "video", "pdf", "doc", "audio", "archive"] as const;
const KIND_LABEL: Record<string, string> = {
  image: "kindImage",
  video: "kindVideo",
  pdf: "kindPdf",
  doc: "kindDoc",
  audio: "kindAudio",
  archive: "kindArchive",
};

type FileRow = Awaited<ReturnType<typeof loader>>["files"][number];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function KindIcon({ kind }: { kind: FileRow["kind"] }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {kind === "image" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </>
      )}
      {kind === "video" && (
        <>
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <path d="m16 10 6-3v10l-6-3" />
        </>
      )}
      {(kind === "pdf" || kind === "doc" || kind === "archive") && (
        <>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
        </>
      )}
      {kind === "audio" && (
        <>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </>
      )}
    </svg>
  );
}

export default function AdminFiles({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const files = loaderData.files;

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [visFilter, setVisFilter] = useState<string>("all");
  const [preview, setPreview] = useState<FileRow | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const L = (k: string, p?: Record<string, string | number>) => t(locale, `filesAdmin.${k}`, p);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (kindFilter !== "all" && f.kind !== kindFilter) return false;
      if (visFilter !== "all" && f.visibility !== visFilter) return false;
      if (q && !f.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, query, kindFilter, visFilter]);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    // Only a single file is accepted by the action; send the first dropped file.
    const input = document.getElementById("media-file-input") as HTMLInputElement | null;
    const form = document.getElementById("media-upload-form") as HTMLFormElement | null;
    if (!input || !form) return;
    input.files = list;
    setUploading(true);
    form.requestSubmit();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  }

  async function copyUrl(f: FileRow) {
    try {
      await navigator.clipboard.writeText(f.url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = f.url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopiedId(f.id);
    window.setTimeout(() => setCopiedId((id) => (id === f.id ? null : id)), 1500);
  }

  const inputCls = "h-[42px] w-full rounded-lg border border-line bg-white px-3 text-sm focus:border-brand-800 focus:outline-none";
  const chipCls =
    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">{L("libraryTitle")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{L("librarySubtitle")}</p>
      </div>

      {/* Upload */}
      <Card>
        <CardBody>
          <Form
            id="media-upload-form"
            method="post"
            encType="multipart/form-data"
            data-testid="media-upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="_action" value="upload" />
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-slate-50/60 px-6 py-8 text-center transition-colors hover:border-ink hover:bg-slate-100/40"
            >
              <input
                id="media-file-input"
                type="file"
                name="file"
                required
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    setUploading(true);
                    (document.getElementById("media-upload-form") as HTMLFormElement | null)?.requestSubmit();
                  }
                }}
              />
              <span className="text-2xl font-bold text-ink-muted" aria-hidden="true">＋</span>
              <span className="text-sm font-medium text-ink">{L("libraryHint")}</span>
              <span className="inline-flex min-h-9 items-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white">
                {uploading ? L("uploading") : L("browseFiles")}
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <span>{L("filterVisibility")}</span>
                <select name="visibility" defaultValue="public" className={`${inputCls} w-auto`}>
                  <option value="public">{L("visibilityPublic")}</option>
                  <option value="private">{L("visibilityPrivate")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="downloadAllowed" defaultChecked className="h-4 w-4" />
                {L("downloadAllowed")}
              </label>
            </div>
          </Form>
          {actionData && "ok" in actionData && actionData.ok && (
            <p className="mt-3 text-sm font-medium text-green-600">{L("uploaded")}</p>
          )}
          {actionData && "error" in actionData && actionData.error && actionData.error !== "generic" && (
            <p className="mt-3 text-sm font-medium text-red-600">
              {actionData.error === "too_large"
                ? L("tooLarge")
                : actionData.error === "bad_type"
                  ? L("badType")
                  : actionData.error === "in_use"
                    ? L("inUse")
                    : actionData.error}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4-4" />
            </svg>
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={L("searchPlaceholder")}
            aria-label={L("searchLabel")}
            className="h-[42px] w-full rounded-lg border border-line bg-white ps-9 pe-3 text-sm focus:border-brand-800 focus:outline-none"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">{L("filterKind")}:</span>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className={`${inputCls} w-auto`}>
            <option value="all">{L("allKinds")}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>{L(KIND_LABEL[k])}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">{L("filterVisibility")}:</span>
          <select value={visFilter} onChange={(e) => setVisFilter(e.target.value)} className={`${inputCls} w-auto`}>
            <option value="all">{L("allVisibility")}</option>
            <option value="public">{L("visibilityPublicShort")}</option>
            <option value="private">{L("visibilityPrivateShort")}</option>
          </select>
        </label>
        <p className="ms-auto text-xs text-ink-muted">{L("count", { count: filtered.length })}</p>
      </div>

      {/* Grid */}
      {files.length === 0 ? (
        <EmptyState
          icon="○"
          title={L("empty")}
          action={<span className="text-sm text-ink-muted">{L("browseFiles")} ↑</span>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="○" title={L("noResults")} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((f) => {
            const isImage = f.kind === "image";
            const inUseMsg =
              actionData && "usageId" in actionData && actionData.usageId === f.id ? actionData.usage : null;
            return (
              <li
                key={f.id}
                className="flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm"
                data-testid="media-card"
              >
                {/* preview */}
                <button
                  type="button"
                  onClick={() => setPreview(f)}
                  className="group relative flex aspect-video w-full items-center justify-center overflow-hidden bg-slate-100"
                  aria-label={`${L("preview")}: ${f.name}`}
                >
                  {isImage ? (
                    <img src={f.url} alt={f.altAr || f.name} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  ) : (
                    <span className="flex flex-col items-center gap-2 text-ink-muted">
                      <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-white text-ink-muted shadow-sm">
                        <KindIcon kind={f.kind} />
                      </span>
                      <span className="text-xs font-medium">{L(KIND_LABEL[f.kind] ?? "kindDoc")}</span>
                    </span>
                  )}
                  <span className="absolute end-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
                  </span>
                </button>

                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink" title={f.name} dir="auto">{f.name}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{L(KIND_LABEL[f.kind] ?? "kindDoc")}</Badge>
                    <span className={`${chipCls} ${f.visibility === "public" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {f.visibility === "public" ? L("visibilityPublicShort") : L("visibilityPrivateShort")}
                    </span>
                    <span className="text-[11px] text-ink-muted">{humanSize(f.byteSize)}</span>
                  </div>
                  <p className="text-[11px] text-ink-muted">
                    {formatDate(locale, f.createdAt)}
                  </p>

                  <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line pt-2">
                    <button
                      type="button"
                      onClick={() => copyUrl(f)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-muted hover:bg-slate-50"
                    >
                      {copiedId === f.id ? `✓ ${L("copied")}` : L("copy")}
                    </button>
                    <Form method="post" className="inline-flex">
                      <input type="hidden" name="_action" value="usage" />
                      <input type="hidden" name="id" value={f.id} />
                      <SubmitButton variant="secondary" size="sm">{L("usage")}</SubmitButton>
                    </Form>
                  </div>
                  {inUseMsg && (
                    <p className="text-[11px] text-ink-muted">
                      {L("usage")}: {inUseMsg.length ? inUseMsg.join(", ") : L("unused")}
                    </p>
                  )}

                  {/* Details (rename / alt) + replace + delete */}
                  <details className="group mt-1 rounded-lg border border-line bg-slate-50 p-2.5 text-xs">
                    <summary className="cursor-pointer select-none font-medium text-ink-muted hover:text-ink">
                      {L("details")}
                    </summary>
                    <Form method="post" className="mt-2 flex flex-col gap-2">
                      <input type="hidden" name="_action" value="rename" />
                      <input type="hidden" name="id" value={f.id} />
                      <input name="name" defaultValue={f.name} aria-label="File name" className="rounded-md border border-line px-2 py-1.5" />
                      <input name="altAr" defaultValue={f.altAr} aria-label="Alt Arabic" placeholder="alt AR" dir="rtl" className="rounded-md border border-line px-2 py-1.5" />
                      <input name="altEn" defaultValue={f.altEn} aria-label="Alt English" placeholder="alt EN" dir="ltr" className="rounded-md border border-line px-2 py-1.5" />
                      <SubmitButton variant="secondary" size="sm">{L("saveMeta")}</SubmitButton>
                    </Form>
                    <Form method="post" encType="multipart/form-data" className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="_action" value="replace" />
                      <input type="hidden" name="id" value={f.id} />
                      <label className="grow cursor-pointer rounded-md border border-line bg-white px-2 py-1.5 text-ink-muted hover:bg-slate-100">
                        <span className="pointer-events-none">{L("replace")}</span>
                        <input type="file" name="file" className="sr-only" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
                      </label>
                    </Form>
                    <Form
                      method="post"
                      className="mt-2"
                      onSubmit={(e) => {
                        if (!confirm(L("confirmDelete"))) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="_action" value="delete" />
                      <input type="hidden" name="id" value={f.id} />
                      <SubmitButton variant="danger" size="sm">{L("delete")}</SubmitButton>
                    </Form>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreview(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={`${L("preview")}: ${preview.name}`}
        >
          <div className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="truncate text-sm font-semibold text-ink" dir="auto">{preview.name}</p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label={L("showLess")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-950 p-4">
              {preview.kind === "image" ? (
                <img src={preview.url} alt={preview.altAr || preview.name} className="mx-auto max-h-[70vh] w-auto object-contain" />
              ) : (
                <a href={preview.url} target="_blank" rel="noopener noreferrer" className="flex min-h-40 flex-col items-center justify-center gap-2 text-sm text-white">
                  <KindIcon kind={preview.kind} />
                  <span className="text-slate-300">{preview.url}</span>
                </a>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-ink-muted">
              <span>
                {L(KIND_LABEL[preview.kind] ?? "kindDoc")} · {humanSize(preview.byteSize)} ·{" "}
                {preview.visibility === "public" ? L("visibilityPublicShort") : L("visibilityPrivateShort")}
              </span>
              <a href={preview.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:underline" dir="ltr">
                {preview.url}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
