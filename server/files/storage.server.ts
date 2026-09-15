import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { blocks, courses, files, lessonItems, pages, settings as settingsTable, subjects } from "../db/schema";
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
  // These routes parse multipart bodies inside a 128 MiB Worker isolate. Larger
  // media must use a future direct-to-R2 multipart flow instead of buffering a
  // 100–200 MiB request in application memory.
  pdf: 50 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  doc: 25 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  archive: 50 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

export const MAX_MULTIPART_UPLOAD_BYTES = 52 * 1024 * 1024;

export function normalizeUploadMime(mime: string): string {
  const normalized = mime.split(";")[0].trim().toLowerCase();
  if (normalized === "image/jpg" || normalized === "image/pjpeg") return "image/jpeg";
  if (normalized === "application/x-zip-compressed") return "application/zip";
  return normalized;
}

export function detectKind(mime: string): FileRow["kind"] | null {
  const norm = normalizeUploadMime(mime);
  for (const entry of KIND_BY_MIME) if (entry.mimes.includes(norm)) return entry.kind;
  return null;
}

function starts(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

/**
 * Validate the declared MIME against file magic before bytes enter R2. Browser
 * File.type is attacker-controlled and is never sufficient on its own.
 */
export function uploadBytesMatchMime(data: ArrayBuffer | Uint8Array, declaredMime: string): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const mime = normalizeUploadMime(declaredMime);
  if (bytes.length === 0 || !detectKind(mime)) return false;

  if (mime === "application/pdf") {
    return ascii(bytes.slice(0, Math.min(bytes.length, 1024)), 0, Math.min(bytes.length, 1024)).includes("%PDF-");
  }
  if (mime === "image/jpeg") return starts(bytes, [0xff, 0xd8, 0xff]);
  if (mime === "image/png") return starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === "image/gif") return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
  if (mime === "image/webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  if (mime === "image/svg+xml") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 16_384)).replace(/^\uFEFF/, "");
      return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text);
    } catch {
      return false;
    }
  }

  const zip = starts(bytes, [0x50, 0x4b, 0x03, 0x04]) || starts(bytes, [0x50, 0x4b, 0x05, 0x06]);
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return zip;
  if (mime === "application/x-7z-compressed") return starts(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  if (mime === "application/x-rar-compressed") return ascii(bytes, 0, 7) === "Rar!\x1a\x07\x00" || ascii(bytes, 0, 8) === "Rar!\x1a\x07\x01\x00";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return zip;
  if (mime === "application/msword" || mime === "application/vnd.ms-powerpoint") {
    return starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (mime === "text/plain" || mime === "text/markdown") {
    if (bytes.slice(0, 8_192).includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 8_192));
      return true;
    } catch {
      return false;
    }
  }

  const isoMedia = ascii(bytes, 4, 4) === "ftyp";
  if (mime === "video/mp4" || mime === "video/quicktime" || mime === "audio/mp4") return isoMedia;
  if (mime === "video/x-matroska") return starts(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if (mime === "audio/ogg") return ascii(bytes, 0, 4) === "OggS";
  if (mime === "audio/wav") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
  if (mime === "audio/mpeg") return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mime === "audio/aac") return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  return false;
}

export function requestBodyTooLarge(request: Request, cap = MAX_MULTIPART_UPLOAD_BYTES): boolean {
  const value = request.headers.get("content-length");
  if (!value) return false;
  const length = Number(value);
  return !Number.isSafeInteger(length) || length < 0 || length > cap;
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
    altAr: "",
    altEn: "",
    createdBy: row.createdBy ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86_400) {
    throw new Error("invalid signed-file TTL");
  }
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
  if (!Number.isSafeInteger(exp) || exp <= 0 || exp - now > 86_400_000) {
    return { ok: false, reason: "malformed" };
  }
  if (exp <= now) return { ok: false, reason: "expired" };
  const expected = await hmacSha256Hex(env.FILE_URL_SECRET, `${params.fileId}|${params.perm}|${params.exp}`);
  if (!timingSafeEqualHex(expected, params.sig)) return { ok: false, reason: "bad_sig" };
  return { ok: true, perm: params.perm };
}

/** Strict RFC 7233 single-range parser (`false` means 416, null means full body). */
export function parseByteRange(
  value: string | null,
  size: number
): { start: number; end: number } | null | false {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size <= 0 || value.length > 200 || value.includes(",")) return false;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return false;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

/** Content-disposition per permission: inline viewing vs forced download. */
export function dispositionFor(row: FileRow, perm: FilePerm): string {
  const fallback = row.kind === "image" || row.kind === "pdf" ? "inline" : "attachment";
  const type = perm === "download" ? "attachment" : fallback;
  const original = row.originalFilename.slice(0, 255).replace(/[\u0000-\u001f\u007f]/g, "");
  const safeName = original.replace(/[^\x20-\x7e]|["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(original || "file").replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${type}; filename="${safeName}"; filename*=UTF-8''${encoded}`;
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

export async function updateFileMeta(db: DB, id: string, patch: { originalFilename?: string; altAr?: string; altEn?: string }): Promise<void> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (typeof patch.originalFilename === "string" && patch.originalFilename.trim()) next.originalFilename = patch.originalFilename.trim().slice(0, 200);
  if (typeof patch.altAr === "string") next.altAr = patch.altAr.slice(0, 200);
  if (typeof patch.altEn === "string") next.altEn = patch.altEn.slice(0, 200);
  await db.update(files).set(next).where(eq(files.id, id));
}

/** Replace bytes in place (same file id — CMS references stay valid). */
export async function replaceFileBytes(
  db: DB,
  env: Env,
  id: string,
  buf: ArrayBuffer,
  mime: string,
  originalFilename: string
): Promise<boolean> {
  const row = await getFile(db, id);
  const nextKind = detectKind(mime);
  if (!row || !nextKind || nextKind !== row.kind || !uploadBytesMatchMime(buf, mime)) return false;
  const checksum = await sha256HexOf(buf);
  await bucketOf(env, row).put(row.r2Key, buf, { httpMetadata: { contentType: mime } });
  await db.update(files).set({
    mime,
    byteSize: buf.byteLength,
    checksumSha256: checksum,
    originalFilename: originalFilename.slice(0, 200),
    updatedAt: Date.now(),
  }).where(eq(files.id, id));
  return true;
}

export async function fileUsage(db: DB, fileId: string): Promise<string[]> {
  const like = `%${fileId}%`;
  const hits: string[] = [];
  const [pageHits, blockHits, settingHits, courseHits, subjectHits] = await Promise.all([
    db.select({ id: pages.id, slug: pages.slug }).from(pages).where(sql`cast(${pages.publishedSnapshot} as text) like ${like}`).limit(20),
    db.select({ id: blocks.id, pageId: blocks.pageId }).from(blocks).where(sql`cast(${blocks.props} as text) like ${like}`).limit(20),
    db.select({ key: settingsTable.key }).from(settingsTable).where(sql`cast(${settingsTable.value} as text) like ${like}`).limit(20),
    db.select({ id: courses.id }).from(courses).where(eq(courses.thumbnailFileId, fileId)).limit(20),
    db.select({ id: subjects.id }).from(subjects).where(eq(subjects.thumbnailFileId, fileId)).limit(20),
  ]);
  for (const p of pageHits) hits.push(`page:${p.slug}`);
  for (const b of blockHits) hits.push(`block:${b.id}`);
  for (const s of settingHits) hits.push(`settings:${s.key}`);
  for (const c of courseHits) hits.push(`course:${c.id}`);
  for (const s of subjectHits) hits.push(`subject:${s.id}`);
  return hits;
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
