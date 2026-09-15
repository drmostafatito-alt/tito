import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MuxVideoProvider,
  decodeMuxJwt,
  importMuxRsaPrivateKey,
  signMuxPlaybackJwt,
} from "~server/video/providers/mux.server";
import { VideoNotConfiguredError } from "~server/video/provider";

/** Mux adapter coverage WITHOUT credentials: request shapes, mappings, JWT crypto. */

function b64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromB64Url(value: string): Uint8Array {
  const b64Value = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64Value + "=".repeat((4 - (b64Value.length % 4)) % 4));
  return Uint8Array.from(bin, (char) => char.charCodeAt(0));
}

let generatedKey: Promise<{ priv: CryptoKey; pub: CryptoKey; privB64: string; pem: string }> | undefined;
function testKey(): Promise<{ priv: CryptoKey; pub: CryptoKey; privB64: string; pem: string }> {
  generatedKey ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: Uint8Array.of(1, 0, 1),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    const privB64 = b64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${privB64.replace(/(.{64})/g, "$1\n").trim()}\n-----END PRIVATE KEY-----`;
    return { priv: pair.privateKey, pub: pair.publicKey, privB64, pem };
  })();
  return generatedKey;
}

describe("Mux RS256 signing", () => {
  it("imports raw-base64 and PEM-wrapped PKCS8 keys", async () => {
    const key = await testKey();
    const raw = await importMuxRsaPrivateKey(key.privB64);
    const pem = await importMuxRsaPrivateKey(key.pem);
    expect(raw.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
    expect(pem.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
  });

  it("imports Mux's base64-encoded PEM response and traditional PKCS1 PEM", async () => {
    const key = await testKey();
    const outerBase64 = btoa(key.pem);
    expect((await importMuxRsaPrivateKey(outerBase64)).algorithm.name).toBe("RSASSA-PKCS1-v1_5");

    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pkcs1Pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    expect((await importMuxRsaPrivateKey(pkcs1Pem)).algorithm.name).toBe("RSASSA-PKCS1-v1_5");
  });

  it("signs RS256 playback JWTs with correct claims and a verifiable signature", async () => {
    const key = await testKey();
    const claims = { sub: "pb123", aud: "v" as const, exp: Math.floor(Date.now() / 1000) + 7200, kid: "key-1" };
    const token = await signMuxPlaybackJwt(key.priv, claims);

    const decoded = decodeMuxJwt(token);
    expect(decoded.header).toMatchObject({ alg: "RS256", typ: "JWT", kid: "key-1" });
    expect(decoded.claims).toMatchObject({ sub: "pb123", aud: "v", exp: claims.exp });

    const [header, payload, signature] = token.split(".");
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key.pub,
      fromB64Url(signature) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${header}.${payload}`) as unknown as ArrayBuffer
    );
    expect(ok).toBe(true);
  });

  it("tampered payloads fail verification", async () => {
    const key = await testKey();
    const token = await signMuxPlaybackJwt(key.priv, { sub: "pb1", aud: "v", exp: 999, kid: "k" });
    const [header, , signature] = token.split(".");
    const forgedClaims = btoa('{"sub":"pb2","aud":"v","exp":999,"kid":"k"}')
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key.pub,
      fromB64Url(signature) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${header}.${forgedClaims}`) as unknown as ArrayBuffer
    );
    expect(ok).toBe(false);
  });
});

describe("mux adapter API calls (injected fetch)", () => {
  const env = {
    MUX_TOKEN_ID: "tid",
    MUX_TOKEN_SECRET: "tsecret",
    MUX_SIGNING_KEY_ID: "kid1",
    MUX_PLAYBACK_RESTRICTION_ID: "restrict1",
  };

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

  it("getPlayback signs with the environment key and supplied viewing-session TTL", async () => {
    const key = await testKey();
    const provider = new MuxVideoProvider({
      env: { ...env, MUX_SIGNING_PRIVATE_KEY: key.privB64 },
      fetchImpl: stub([]),
    });
    const before = Date.now();
    const playback = await provider.getPlayback(
      { id: "v1", provider: "mux", providerAssetId: "a", playbackId: "pbZZ", status: "ready", durationSeconds: null, width: null, height: null },
      { studentId: "s1", ttlSeconds: 7200 }
    );
    expect(playback.url).toBe("https://stream.mux.com/pbZZ.m3u8");
    const claims = decodeMuxJwt(playback.token!).claims;
    expect(claims.sub).toBe("pbZZ");
    expect(claims.aud).toBe("v");
    expect(claims.kid).toBe("kid1");
    expect(claims.playback_restriction_id).toBe("restrict1");
    expect((claims.exp as number) * 1000).toBeGreaterThanOrEqual(before + 7_199_000);
    expect((claims.exp as number) * 1000).toBeLessThanOrEqual(before + 7_200_000);
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
      playbackProvider.getPlayback({ id: "v", provider: "mux", providerAssetId: "a", playbackId: "p", status: "ready", durationSeconds: null, width: null, height: null }, { studentId: "s", ttlSeconds: 3600 })
    ).rejects.toBeInstanceOf(VideoNotConfiguredError);
  });
});
