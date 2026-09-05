import type { Route } from "./+types/favicon[.]ico";
import { getEnv } from "~server/cf.server";
import { getDb } from "~server/db/client.server";
import { getSettings } from "~server/settings/service.server";
import { getFile, bucketOf } from "~server/files/storage.server";

/**
 * Favicon from site identity (admin-uploaded file). EMPTY-FIRST: when no
 * favicon is configured this returns 204 — no placeholder asset ships.
 * The file is streamed server-side from its bucket (this endpoint is the
 * deliberate public exposure chosen by the admin in Branding settings).
 */
export async function loader({ context }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);
  const fileId = settings.identity.faviconFileId;
  if (!fileId) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const row = await getFile(db, fileId);
  if (!row) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const obj = await bucketOf(env, row).get(row.r2Key);
  if (!obj) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.mime || "image/x-icon",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
