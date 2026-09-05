/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { bucketOf, dispositionFor, getFile, insertFile, listFiles, signFileUrl, verifyFileSignature } from "~server/files/storage.server";

/**
 * Private-file protection with REAL R2 + registry rows: signed-URL lifecycle at
 * the service level (the /files/:id route is a thin adapter over exactly these
 * functions; its HTTP behavior — 404 shapes, streaming, Range — is verified in
 * the live `wrangler dev` smoke pass and recorded in TEST-PLAN §6).
 */
const db = getDb(env);

async function putPrivateFile(content: string, opts: { visibility?: "public" | "private"; downloadAllowed?: boolean } = {}) {
  const visibility = opts.visibility ?? "private";
  const nonce = crypto.randomUUID();
  const key = `${visibility === "public" ? "public" : "private"}/pdf/${nonce}/doc.pdf`;
  const bucket = visibility === "public" ? env.PUBLIC_ASSETS : env.PRIVATE_FILES;
  await bucket.put(key, content, { httpMetadata: { contentType: "application/pdf" } });
  const id = await insertFile(db, {
    r2Key: key,
    bucket: visibility === "public" ? "PUBLIC_ASSETS" : "PRIVATE_FILES",
    kind: "pdf",
    originalFilename: "doc.pdf",
    mime: "application/pdf",
    byteSize: content.length,
    checksumSha256: "test",
    visibility,
    downloadAllowed: opts.downloadAllowed ?? false,
  });
  return id;
}

beforeEach(async () => {
  await db.run("DELETE FROM files");
});

describe("private file protection (R2 + signed URLs)", () => {
  it("insertFile returns EXACTLY the persisted row id (file-ID mismatch regression guard)", async () => {
    // The historical bug: a helper returned one id while the registry row was
    // persisted under a different generated id → signed URLs 404'd. The returned
    // id MUST be the row id — verified against the table, not the helper.
    const id = await putPrivateFile("ID-GUARD");
    const row = await getFile(db, id);
    expect(row).toBeTruthy();
    expect(row!.id).toBe(id);
    const all = await listFiles(db, 10);
    expect(all.length).toBe(1);
    expect(all[0]!.id).toBe(id);
    expect(all[0]!.r2Key).toBe(row!.r2Key);
    // a signature minted for the returned id verifies against the persisted row
    const signed = await signFileUrl(env, id, "view", 60);
    const p = new URL(`https://x${signed.path}`).searchParams;
    expect(
      await verifyFileSignature(env, { fileId: row!.id, perm: p.get("perm")!, exp: p.get("exp")!, sig: p.get("sig")! })
    ).toEqual({ ok: true, perm: "view" });
  });

  it("registry row + R2 object roundtrip; raw bytes land in the PRIVATE bucket", async () => {
    const id = await putPrivateFile("SECRET-PDF-BYTES");
    const row = await getFile(db, id);
    expect(row).toBeTruthy();
    expect(row!.visibility).toBe("private");
    const bucket = bucketOf(env, row!);
    const obj = await bucket.get(row!.r2Key);
    expect(obj).toBeTruthy();
    expect(await obj!.text()).toBe("SECRET-PDF-BYTES");
    // not present in the public bucket
    expect(await env.PUBLIC_ASSETS.get(row!.r2Key)).toBeNull();
  });

  it("mint → verify roundtrip against the real env secret; tamper/expiry reject", async () => {
    const id = await putPrivateFile("X");
    const signed = await signFileUrl(env, id, "view", 60);
    const params = new URL(`https://x${signed.path}`).searchParams;
    expect(await verifyFileSignature(env, { fileId: id, perm: params.get("perm")!, exp: params.get("exp")!, sig: params.get("sig")! })).toEqual({ ok: true, perm: "view" });
    expect(await verifyFileSignature(env, { fileId: "other", perm: "view", exp: params.get("exp")!, sig: params.get("sig")! })).toEqual({ ok: false, reason: "bad_sig" });

    const expired = await signFileUrl(env, id, "view", 1, Date.now() - 5_000);
    const p2 = new URL(`https://x${expired.path}`).searchParams;
    expect(await verifyFileSignature(env, { fileId: id, perm: "view", exp: p2.get("exp")!, sig: p2.get("sig")! })).toEqual({ ok: false, reason: "expired" });
  });

  it("download disposition requires the row's download_allowed flag (route gate parity)", async () => {
    const viewOnly = await getFile(db, await putPrivateFile("A", { downloadAllowed: false }));
    const downloadable = await getFile(db, await putPrivateFile("B", { downloadAllowed: true }));
    expect(viewOnly!.downloadAllowed).toBe(false);
    expect(downloadable!.downloadAllowed).toBe(true);
    // the same gating logic the route applies:
    expect(viewOnly!.downloadAllowed ? "download" : "view").toBe("view");
    expect(dispositionFor(viewOnly!, "view")).toContain("inline");
    expect(dispositionFor(downloadable!, "download")).toContain("attachment");
    expect(dispositionFor(downloadable!, "download")).toContain('filename="doc.pdf"');
  });

  it("public files live in the public bucket with cacheable intent (route: no signature)", async () => {
    const id = await putPrivateFile("<svg/>", { visibility: "public" });
    const row = await getFile(db, id);
    expect(row!.visibility).toBe("public");
    const obj = await bucketOf(env, row!).get(row!.r2Key);
    expect(await obj!.text()).toBe("<svg/>");
  });

  it("filename sanitization in disposition headers (header injection blocked)", async () => {
    const row = await getFile(db, await putPrivateFile("Z"));
    const hostile = { ...row!, originalFilename: 'evil"; header="injection\r\nX-Evil: 1' };
    const disp = dispositionFor(hostile, "view");
    expect(disp).not.toContain("\r");
    expect(disp).not.toContain("\n");
  });
});
