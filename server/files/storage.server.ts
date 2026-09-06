import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { files, lessonItems } from "../db/schema";
import { hmacSha256Hex, timingSafeEqualHex } from "../crypto/hmac.server";

/**
 * R2 file storage (ARCHITECTURE §5 route map: /files/:id — signed-URL streaming).
 *
 * Security model (SECURITY.md / brief §28):
 * - `visibility=public`  → served via /files/:id without a signature (thumbnails etc.),
 *   cacheable at the edge.
 * - `visibility=private` → NEVER exposed by raw R2 key. The worker streams bytes only
 *   after (a) a short-lived HMAC-signed URL minted *after* an entitlement check, or
 *   (b) an inline entitlement check in the route. `download` permission additionally
 *   requires files.download_allowed.
 * - Signature covers id|perm|exp with FILE_URL_SECRET (server-only secret).
 */

export type FilePerm = "view" | "download";

export interface FileRow {
  id: string;
  r2Key: string;
  bucket: "PUBLIC_ASSETS" | "PRIVATE_FILES" | "VIDEO_MASTERS";
  kind: "pdf" | "image" | "doc" | "audio" | "archive" | "video";
  originalFilename: string;
  mime: string;
  byteSize: number;
  visibility: "public" | "private";
  downloadAllowed: boolean;
}

const KIND_BY_MIME: Array<{ kind: FileRow["kind"]; mimes: string[] }> = [
  { kind: "pdf", mimes: ["application/pdf"] },
  { kind: "image", mimes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"] },
  { kind: "doc", mimes: ["text/plain", "text/markdown", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
  { kind: "audio", mimes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav"] },
  { kind: "archive", mimes: ["application/zip", "application/x-zip-compressed", "application/x-7z-compressed", "application/x-rar-compressed"] },
  { kind: "video", mimes: ["video/mp4", "video/quicktime", "video/x-matroska"] },
];

/** Max bytes per kind (upload validation). */
const SIZE_CAPS: Record<FileRow["kind"], number> = {
  pdf: 100 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  doc: 50 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  archive: 200 * 1024 * 1024,
  video: 200 * 1024 * 1024,
};

export function detectKind(mime: string): FileRow["kind"] | null {
  const norm = mime.split(";")[0].trim().toLowerCase();
  for (const entry of KIND_BY_MIME) if (entry.mimes.includes(norm)) return entry.kind;
  return null;
}

export function sizeCapFor(kind: FileRow["kind"]): number {
  return SIZE_CAPS[kind];
}

/** Neutral, filesystem-safe R2 key; never derived from user input alone. */
export function buildR2Key(kind: FileRow["kind"], originalFilename: string, visibility: "public" | "private"): string {
  const safe = originalFilename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(-80) || "file";
  const prefix = visibility === "public" ? "public" : "private";
  return `${prefix}/${kind}/${crypto.randomUUID()}/${safe}`;
}

export async function sha256HexOf(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function insertFile(
  db: DB,
  row: {
    r2Key: string;
    bucket: FileRow["bucket"];
    kind: FileRow["kind"];
    originalFilename: string;
    mime: string;
    byteSize: number;
    checksumSha256: string;
    visibility: "public" | "private";
    downloadAllowed?: boolean;
    createdBy?: string | null;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(files).values({
    id,
    r2Key: row.r2Key,
    bucket: row.bucket,
    kind: row.kind,
    originalFilename: row.originalFilename,
    mime: row.mime,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    visibility: row.visibility,
    downloadAllowed: row.downloadAllowed ?? false,
    createdBy: row.createdBy ?? null,
    createdAt: Date.now(),
  });
  return id;
}

export async function getFile(db: DB, id: string): Promise<FileRow | null> {
  const rows = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return (rows[0] as FileRow) ?? null;
}

export async function listFiles(db: DB, limit = 100) {
  return db.select().from(files).orderBy(files.createdAt).limit(limit);
}

/** Bucket binding for a row (R2Bucket from workers-types). */
export function bucketOf(env: Env, row: Pick<FileRow, "bucket">): R2Bucket {
  switch (row.bucket) {
    case "PUBLIC_ASSETS":
      return env.PUBLIC_ASSETS;
    case "VIDEO_MASTERS":
      return env.VIDEO_MASTERS;
    default:
      return env.PRIVATE_FILES;
  }
}

// ---------------------------------------------------------------------------
// Signed URLs — mint AFTER the caller has verified entitlement (the streaming
// route re-verifies the signature; possession of a fresh URL is the grant).
// ---------------------------------------------------------------------------

export interface SignedFileUrl {
  path: string;
  expiresAt: number;
}

export async function signFileUrl(
  env: Env,
  fileId: string,
  perm: FilePerm,
  ttlSeconds: number,
  now = Date.now()
): Promise<SignedFileUrl> {
  const exp = now + ttlSeconds * 1000;
  const sig = await hmacSha256Hex(env.FILE_URL_SECRET, `${fileId}|${perm}|${exp}`);
  return { path: `/files/${fileId}?perm=${perm}&exp=${exp}&sig=${sig}`, expiresAt: exp };
}

export async function verifyFileSignature(
  env: Env,
  params: { fileId: string; perm: string; exp: string; sig: string },
  now = Date.now()
): Promise<{ ok: true; perm: FilePerm } | { ok: false; reason: "malformed" | "expired" | "bad_sig" }> {
  if (params.perm !== "view" && params.perm !== "download") return { ok: false, reason: "malformed" };
  const exp = Number(params.exp);
  if (!Number.isFinite(exp) || exp <= 0) return { ok: false, reason: "malformed" };
  if (exp <= now) return { ok: false, reason: "expired" };
  const expected = await hmacSha256Hex(env.FILE_URL_SECRET, `${params.fileId}|${params.perm}|${params.exp}`);
  if (!timingSafeEqualHex(expected, params.sig)) return { ok: false, reason: "bad_sig" };
  return { ok: true, perm: params.perm };
}

/** Content-disposition per permission: inline viewing vs forced download. */
export function dispositionFor(row: FileRow, perm: FilePerm): string {
  const fallback = row.kind === "image" || row.kind === "pdf" ? "inline" : "attachment";
  const type = perm === "download" ? "attachment" : fallback;
  const safeName = row.originalFilename.replace(/["\\\r\n]/g, "");
  return `${type}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(row.originalFilename)}`;
}

/**
 * H5 (Phase 8): active/HTML-renderable content served at our origin could run
 * scripts when navigated to directly (stored XSS via SVG, for example). A
 * `sandbox` CSP neutralizes script execution + same-origin access for these
 * documents WITHOUT affecting <img>/subresource rendering (browsers ignore the
 * response CSP in subresource contexts). This is the least-impact defense —
 * SVG uploads stay permitted; only direct document navigation is sandboxed.
 */
export function sandboxCspFor(mime: string): string | null {
  const norm = mime.split(";")[0].trim().toLowerCase();
  const active = norm === "image/svg+xml" || norm === "text/html" || norm === "application/xhtml+xml";
  return active ? "sandbox" : null;
}

export async function deleteFile(db: DB, env: Env, id: string): Promise<boolean> {
  const row = await getFile(db, id);
  if (!row) return false;
  await bucketOf(env, row).delete(row.r2Key);
  await db.delete(files).where(eq(files.id, id));
  return true;
}

/** Files attached to a lesson (entitlement context for private streams). */
export async function filesForLesson(db: DB, lessonId: string) {
  return db
    .select({ fileId: lessonItems.fileId, required: lessonItems.required, sortOrder: lessonItems.sortOrder })
    .from(lessonItems)
    .where(and(eq(lessonItems.lessonId, lessonId), eq(lessonItems.itemType, "file")));
}
