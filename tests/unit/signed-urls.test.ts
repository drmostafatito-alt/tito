import { describe, expect, it } from "vitest";
import { signFileUrl, verifyFileSignature } from "~server/files/storage.server";

const env = { FILE_URL_SECRET: "unit-test-secret" } as unknown as Env;

describe("private-file signed URLs", () => {
  it("mint → verify roundtrip (view + download)", async () => {
    const url = await signFileUrl(env, "f1", "view", 60);
    const params = new URL(`https://x${url.path}`).searchParams;
    const verdict = await verifyFileSignature(env, {
      fileId: "f1",
      perm: params.get("perm")!,
      exp: params.get("exp")!,
      sig: params.get("sig")!,
    });
    expect(verdict).toEqual({ ok: true, perm: "view" });
  });

  it("rejects expired signatures", async () => {
    const url = await signFileUrl(env, "f1", "view", 1, Date.now() - 10_000);
    const params = new URL(`https://x${url.path}`).searchParams;
    const verdict = await verifyFileSignature(env, {
      fileId: "f1",
      perm: params.get("perm")!,
      exp: params.get("exp")!,
      sig: params.get("sig")!,
    });
    expect(verdict).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampered signatures and cross-file reuse", async () => {
    const url = await signFileUrl(env, "f1", "view", 60);
    const params = new URL(`https://x${url.path}`).searchParams;
    const sig = params.get("sig")!;
    expect(
      await verifyFileSignature(env, { fileId: "f2", perm: "view", exp: params.get("exp")!, sig })
    ).toEqual({ ok: false, reason: "bad_sig" });
    expect(
      await verifyFileSignature(env, { fileId: "f1", perm: "download", exp: params.get("exp")!, sig })
    ).toEqual({ ok: false, reason: "bad_sig" });
  });

  it("rejects malformed params", async () => {
    expect(await verifyFileSignature(env, { fileId: "f", perm: "view", exp: "NaN", sig: "ab" })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyFileSignature(env, { fileId: "f", perm: "evil", exp: "99", sig: "ab" })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
