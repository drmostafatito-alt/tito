import { describe, expect, it } from "vitest";
import {
  MuxVideoProvider,
  decodeMuxJwt,
  importEd25519PrivateKey,
  signMuxPlaybackJwt,
} from "~server/video/providers/mux.server";
import { VideoNotConfiguredError } from "~server/video/provider";

/** Mux adapter coverage WITHOUT credentials: request shapes, mappings, JWT crypto. */

async function b64(buffer: ArrayBuffer): Promise<string> {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

async function testKey(): Promise<{ priv: CryptoKey; pub: CryptoKey; privB64: string; pubB64: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    priv: pair.privateKey,
    pub: pair.publicKey,
    privB64: await b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    pubB64: await b64(await crypto.subtle.exportKey("spki", pair.publicKey)),
  };
}

describe("mux Ed25519 signing", () => {
  it("imports raw-base64 PKCS8 keys", async () => {
    const key = await testKey();
    const imported = await importEd25519PrivateKey(key.privB64);
    expect(imported.algorithm.name).toBe("Ed25519");
  });

  it("imports PEM-wrapped PKCS8 keys", async () => {
    const key = await testKey();
    const pem = `-----BEGIN PRIVATE KEY-----\n${key.privB64.replace(/(.{64})/g, "$1\n").trim()}\n-----END PRIVATE KEY-----`;
    const imported = await importEd25519PrivateKey(pem);
    expect(imported.algorithm.name).toBe("Ed25519");
  });

  it("signs playback JWTs with correct header + claims, verifiable with the public key", async () => {
    const key = await testKey();
    const claims = { sub: "pb123", aud: "v" as const, exp: Math.floor(Date.now() / 1000) + 45, kid: "key-1" };
    const token = await signMuxPlaybackJwt(key.priv, claims);

    const decoded = decodeMuxJwt(token);
    expect(decoded.header).toMatchObject({ alg: "EdDSA", typ: "JWT", kid: "key-1" });
    expect(decoded.claims).toMatchObject({ sub: "pb123", aud: "v", exp: claims.exp });

    const pub = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(atob(key.pubB64), (c) => c.charCodeAt(0)) as unknown as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const [h, p, s] = token.split(".");
    const ok = await crypto.subtle.verify(
      "Ed25519",
      pub,
      Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${h}.${p}`) as unknown as ArrayBuffer
    );
    expect(ok).toBe(true);
  });

  it("tampered payloads fail verification", async () => {
    const key = await testKey();
    const token = await signMuxPlaybackJwt(key.priv, { sub: "pb1", aud: "v", exp: 999, kid: "k" });
    const parts = token.split(".");
    const forgedClaims = btoa('{"sub":"pb2","aud":"v","exp":999,"kid":"k"}')
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const pub = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(atob(key.pubB64), (c) => c.charCodeAt(0)) as unknown as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "Ed25519",
      pub,
      Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${parts[0]}.${forgedClaims}`) as unknown as ArrayBuffer
    );
    expect(ok).toBe(false);
  });
});

describe("mux adapter API calls (injected fetch)", () => {
  const env = { MUX_TOKEN_ID: "tid", MUX_TOKEN_SECRET: "tsecret", MUX_SIGNING_KEY_ID: "kid1" };

  function stub(calls: Array<{ match: (url: string) => boolean; reply: () => unknown }>): typeof fetch {
    return (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      for (const c of calls) {
        if (c.match(url)) {
          const body = c.reply();
          return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      }
      return new Response("no stub", { status: 500 });
    }) as unknown as typeof fetch;
  }

  it("createAsset → POST /video/v1/uploads with Basic auth + signed policy; PUTs master", async () => {
    const seen: Array<{ url: string; method: string; auth?: string; body?: unknown }> = [];
    const f = stub([
      {
        match: (u) => u.endsWith("/video/v1/uploads"),
        reply: () => ({ data: { id: "u1", url: "https://upload.example/xyz", status: "waiting" } }),
      },
      {
        match: (u) => u.startsWith("https://upload.example/"),
        reply: () => ({}),
      },
    ]);
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      seen.push({ url: String(input), method: init?.method ?? "GET", auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""), body });
      return f(input, init);
    }) as unknown as typeof fetch;

    const provider = new MuxVideoProvider({ env, fetchImpl: wrapped });
    const res = await provider.createAsset({
      masterR2Key: "masters/x/a.mp4",
      masterStream: new ReadableStream({ start(c) { c.close(); } }),
      masterSize: 3,
      title: "Lesson 1",
      corsOrigin: "https://app.example",
    });

    expect(res.providerAssetId).toBe("u1");
    expect(res.status).toBe("preparing");
    expect(seen[0]).toMatchObject({ url: "https://api.mux.com/video/v1/uploads", method: "POST" });
    expect(seen[0].auth).toBe(`Basic ${btoa("tid:tsecret")}`);
    expect(seen[0].body).toMatchObject({
      cors_origin: "https://app.example",
      new_asset_settings: { playback_policy: ["signed"], passthrough: "Lesson 1" },
    });
    expect(seen[1]).toMatchObject({ url: "https://upload.example/xyz", method: "PUT" });
  });

  it("getAssetStatus maps upload → asset → ready + playback id + resolution", async () => {
    const provider = new MuxVideoProvider({
      env,
      fetchImpl: stub([
        { match: (u) => u.includes("/uploads/u1"), reply: () => ({ data: { asset_id: "a9", status: "asset_created" } }) },
        {
          match: (u) => u.includes("/assets/a9"),
          reply: () => ({
            data: {
              id: "a9",
              status: "ready",
              duration: 61.4,
              max_stored_resolution: "1280x720",
              playback_ids: [{ id: "pbX", policy: "signed" }],
            },
          }),
        },
      ]),
    });
    const status = await provider.getAssetStatus("u1");
    expect(status).toMatchObject({
      status: "ready",
      durationSeconds: 61,
      width: 1280,
      height: 720,
      playbackId: "pbX",
      providerAssetId: "mux-asset-a9",
    });
  });

  it("getAssetStatus: upload without asset yet → pending", async () => {
    const provider = new MuxVideoProvider({
      env,
      fetchImpl: stub([{ match: (u) => u.includes("/uploads/u1"), reply: () => ({ data: { status: "waiting" } }) }]),
    });
    expect((await provider.getAssetStatus("u1")).status).toBe("pending");
  });

  it("getPlayback signs with the environment key (kid header, aud v, ≤60s TTL)", async () => {
    const key = await testKey();
    const provider = new MuxVideoProvider({
      env: { ...env, MUX_SIGNING_PRIVATE_KEY: key.privB64 },
      fetchImpl: stub([]),
    });
    const before = Date.now();
    const playback = await provider.getPlayback(
      { id: "v1", provider: "mux", providerAssetId: "a", playbackId: "pbZZ", status: "ready", durationSeconds: null, width: null, height: null },
      { studentId: "s1" }
    );
    expect(playback.url).toBe("https://stream.mux.com/pbZZ.m3u8");
    const claims = decodeMuxJwt(playback.token!).claims;
    expect(claims.sub).toBe("pbZZ");
    expect(claims.aud).toBe("v");
    expect(claims.kid).toBe("kid1");
    expect((claims.exp as number) * 1000).toBeLessThanOrEqual(before + 60_000);
    // thumbnail audience
    const thumb = await provider.getThumbnail({ id: "v1", provider: "mux", providerAssetId: "a", playbackId: "pbZZ", status: "ready", durationSeconds: null, width: null, height: null });
    expect(thumb.url).toContain("https://image.mux.com/pbZZ/thumbnail.jpg?token=");
    expect(decodeMuxJwt(thumb.url.split("token=")[1]).claims.aud).toBe("t");
  });

  it("throws typed VideoNotConfiguredError when credentials are missing", async () => {
    const provider = new MuxVideoProvider({ env: {}, fetchImpl: stub([]) });
    await expect(
      provider.createAsset({ masterR2Key: "k", masterStream: null, masterSize: 0, title: "t" })
    ).rejects.toBeInstanceOf(VideoNotConfiguredError);
    const playbackProvider = new MuxVideoProvider({ env: {}, fetchImpl: stub([]) });
    await expect(
      playbackProvider.getPlayback({ id: "v", provider: "mux", providerAssetId: "a", playbackId: "p", status: "ready", durationSeconds: null, width: null, height: null }, { studentId: "s" })
    ).rejects.toBeInstanceOf(VideoNotConfiguredError);
  });
});
