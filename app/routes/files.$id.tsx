import type { Route } from "./+types/files.$id";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  bucketOf,
  dispositionFor,
  getFile,
  sandboxCspFor,
  verifyFileSignature,
} from "~server/files/storage.server";

/**
 * File streaming route (ARCHITECTURE §5): /files/:id?perm=&exp=&sig=
 * - public files: streamed directly (cacheable)
 * - private files: require a valid short-TTL HMAC signature (minted server-side
 *   AFTER an entitlement check); download additionally requires the file's
 *   download_allowed flag. Raw R2 keys/URLs are never exposed.
 * Range requests supported for PDF/video scrubbing.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const row = await getFile(db, params.id);
  if (!row) throw new Response("Not Found", { status: 404 });

  const url = new URL(request.url);
  let perm: "view" | "download" = "view";

  if (row.visibility === "private") {
    const sig = url.searchParams.get("sig");
    const exp = url.searchParams.get("exp");
    const permRaw = url.searchParams.get("perm");
    if (!sig || !exp || !permRaw) throw new Response("Not Found", { status: 404 }); // 404-shaped: no existence leak
    const verdict = await verifyFileSignature(env, { fileId: row.id, perm: permRaw, exp, sig });
    if (!verdict.ok) throw new Response("Not Found", { status: 404 });
    perm = verdict.perm;
    if (perm === "download" && !row.downloadAllowed) {
      throw new Response("Forbidden", { status: 403 });
    }
  } else if (url.searchParams.get("perm") === "download") {
    perm = "download";
    if (!row.downloadAllowed) throw new Response("Forbidden", { status: 403 });
  }

  const bucket = bucketOf(env, row);
  // H5: sandbox active/HTML-renderable content (SVG etc.) so direct navigation
  // can't execute scripts in our origin. Subresource <img> rendering is unaffected.
  const csp = sandboxCspFor(row.mime);
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : row.byteSize - 1;
      const obj = await bucket.get(row.r2Key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) throw new Response("Not Found", { status: 404 });
      return new Response(obj.body, {
        status: 206,
        headers: {
          "Content-Type": row.mime,
          "Content-Disposition": dispositionFor(row, perm),
          "Content-Range": `bytes ${start}-${end}/${row.byteSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": row.visibility === "public" ? "public, max-age=3600" : "private, no-store",
          ...(csp ? { "Content-Security-Policy": csp } : {}),
        },
      });
    }
  }

  const obj = await bucket.get(row.r2Key);
  if (!obj) throw new Response("Not Found", { status: 404 });
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": dispositionFor(row, perm),
      "Content-Length": String(row.byteSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": row.visibility === "public" ? "public, max-age=3600" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(csp ? { "Content-Security-Policy": csp } : {}),
    },
  });
}
