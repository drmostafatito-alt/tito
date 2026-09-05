import { VideoNotConfiguredError, type AssetStatus, type CreateAssetInput, type CreateAssetResult, type PlaybackInfo, type VideoProvider, type VideoRowLike } from "../provider";

/**
 * Mux adapter — verified against official docs 2026-09-05 (Phase 2 scaffold re-check):
 * - Direct uploads: POST https://api.mux.com/video/v1/uploads (HTTP Basic tokenId:secret),
 *   body { cors_origin, new_asset_settings: { playback_policy: ["signed"], passthrough } };
 *   upload the master bytes with a single PUT to data.url; poll
 *   GET /video/v1/uploads/{id} → data.asset_id; then GET /video/v1/assets/{id}.
 * - Signed playback: JWT claims { sub: playbackId, aud: "v", exp, kid } with an
 *   Ed25519 signing key; URL https://stream.mux.com/{PLAYBACK_ID}.m3u8?token={JWT};
 *   thumbnails https://image.mux.com/{id}/thumbnail.jpg?token={JWT(aud:"t")}.
 * Sources: mux.com/docs/api-reference/video/direct-uploads/create-direct-upload,
 * docs.mux.com/docs/security-signed-urls (see docs/DECISIONS.md verification queue).
 * All API credentials are server-only secrets; nothing here reaches the browser.
 */

const API = "https://api.mux.com";

export interface MuxEnv {
  MUX_TOKEN_ID?: string;
  MUX_TOKEN_SECRET?: string;
  MUX_SIGNING_KEY_ID?: string;
  /** base64 (raw or PEM) Ed25519 private key from the Mux dashboard/System API */
  MUX_SIGNING_PRIVATE_KEY?: string;
}

export interface MuxDeps {
  env: MuxEnv;
  /** injectable for tests — defaults to global fetch */
  fetchImpl?: typeof fetch;
}

function requireCreds(env: MuxEnv) {
  const missing: string[] = [];
  if (!env.MUX_TOKEN_ID) missing.push("MUX_TOKEN_ID");
  if (!env.MUX_TOKEN_SECRET) missing.push("MUX_TOKEN_SECRET");
  if (missing.length) throw new VideoNotConfiguredError("mux", missing);
}

function requireSigning(env: MuxEnv) {
  const missing: string[] = [];
  if (!env.MUX_SIGNING_KEY_ID) missing.push("MUX_SIGNING_KEY_ID");
  if (!env.MUX_SIGNING_PRIVATE_KEY) missing.push("MUX_SIGNING_PRIVATE_KEY");
  if (missing.length) throw new VideoNotConfiguredError("mux", missing);
}

function basicAuth(env: MuxEnv): string {
  return `Basic ${btoa(`${env.MUX_TOKEN_ID}:${env.MUX_TOKEN_SECRET}`)}`;
}

async function api<T>(deps: MuxDeps, path: string, init?: RequestInit): Promise<T> {
  const f = deps.fetchImpl ?? fetch;
  const res = await f(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(deps.env as MuxEnv),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`mux api ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Ed25519 JWT (EdDSA) — WebCrypto, native in Workers.
// ---------------------------------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeToJson(s: string): unknown {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Accepts raw-base64 or PEM-wrapped PKCS8 Ed25519 keys. */
export async function importEd25519PrivateKey(secret: string): Promise<CryptoKey> {
  let b64 = secret.trim();
  if (b64.includes("-----BEGIN")) {
    b64 = b64
      .replace(/-----BEGIN [A-Z ]*KEY-----/, "")
      .replace(/-----END [A-Z ]*KEY-----/, "")
      .replace(/\s+/g, "");
  }
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", bytes as unknown as ArrayBuffer, { name: "Ed25519" }, false, ["sign"]);
}

export interface MuxJwtClaims {
  sub: string; // playback id
  aud: "v" | "t";
  exp: number; // unix seconds
  kid: string;
}

export async function signMuxPlaybackJwt(
  signingKey: CryptoKey,
  claims: MuxJwtClaims
): Promise<string> {
  const header = { alg: "EdDSA", typ: "JWT", kid: claims.kid };
  const enc = (obj: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc(header)}.${enc(claims)}`;
  const sig = await crypto.subtle.sign(
    "Ed25519",
    signingKey,
    new TextEncoder().encode(signingInput) as unknown as ArrayBuffer
  );
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

export function decodeMuxJwt(token: string): { header: Record<string, unknown>; claims: Record<string, unknown> } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  return {
    header: b64urlDecodeToJson(parts[0]) as Record<string, unknown>,
    claims: b64urlDecodeToJson(parts[1]) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

interface UploadResponse {
  data: { id: string; url: string; status: string };
}
interface AssetResponse {
  data: {
    id: string;
    status: string;
    duration?: number;
    max_stored_resolution?: string;
    aspect_ratio?: string;
    playback_ids?: Array<{ id: string; policy: string }>;
  };
}

function mapResolution(res: string | undefined): { width?: number; height?: number } {
  // Mux returns e.g. "1920x1080" or a preset like "1080p"
  if (!res) return {};
  const m = /^(\d+)x(\d+)$/.exec(res);
  if (m) return { width: Number(m[1]), height: Number(m[2]) };
  const preset = /^(\d+)p$/.exec(res);
  if (preset) return { height: Number(preset[1]) };
  return {};
}

export class MuxVideoProvider implements VideoProvider {
  readonly id = "mux" as const;
  private deps: MuxDeps;

  constructor(deps: MuxDeps) {
    this.deps = { fetchImpl: deps.fetchImpl ?? fetch, env: deps.env };
  }

  async createAsset(input: CreateAssetInput): Promise<CreateAssetResult> {
    requireCreds(this.deps.env);
    const upload = await api<UploadResponse>(this.deps, "/video/v1/uploads", {
      method: "POST",
      body: JSON.stringify({
        cors_origin: input.corsOrigin ?? "https://example.invalid",
        new_asset_settings: {
          playback_policy: ["signed"],
          passthrough: input.title.slice(0, 200),
        },
      }),
    });
    // Server-side completion of the direct upload from the R2 master stream.
    if (input.masterStream) {
      const f = this.deps.fetchImpl ?? fetch;
      const put = await f(upload.data.url, {
        method: "PUT",
        headers: input.masterSize ? { "Content-Length": String(input.masterSize) } : {},
        body: input.masterStream as unknown as BodyInit,
      });
      if (!put.ok) throw new Error(`mux upload PUT → ${put.status}`);
    }
    return { providerAssetId: upload.data.id, status: "preparing" };
  }

  async getAssetStatus(providerAssetId: string): Promise<AssetStatus> {
    requireCreds(this.deps.env);
    // providerAssetId may be an upload id (pre asset creation) or an asset id.
    if (!providerAssetId.startsWith("mux-asset-")) {
      const upload = await api<{ data: { asset_id?: string; status: string } }>(
        this.deps,
        `/video/v1/uploads/${providerAssetId}`
      );
      if (!upload.data.asset_id) {
        return { status: upload.data.status === "timed_out" ? "errored" : "pending" };
      }
      providerAssetId = upload.data.asset_id;
    }
    return this.assetStatus(providerAssetId);
  }

  private async assetStatus(assetId: string): Promise<AssetStatus> {
    const asset = await api<AssetResponse>(this.deps, `/video/v1/assets/${assetId}`);
    const data = asset.data;
    const signed = data.playback_ids?.find((p) => p.policy === "signed") ?? data.playback_ids?.[0];
    return {
      status: data.status === "ready" ? "ready" : data.status === "errored" ? "errored" : "preparing",
      durationSeconds: data.duration ? Math.round(data.duration) : undefined,
      ...mapResolution(data.max_stored_resolution),
      playbackId: signed?.id,
      providerAssetId: `mux-asset-${data.id}`,
    };
  }

  async deleteAsset(providerAssetId: string): Promise<void> {
    requireCreds(this.deps.env);
    const assetId = providerAssetId.replace(/^mux-asset-/, "");
    await api(this.deps, `/video/v1/assets/${assetId}`, { method: "DELETE" });
  }

  async getPlayback(video: VideoRowLike, _ctx?: { studentId: string; lessonId?: string }): Promise<PlaybackInfo> {
    requireSigning(this.deps.env);
    if (!video.playbackId) throw new Error("mux asset has no playback id yet");
    const key = await importEd25519PrivateKey(this.deps.env.MUX_SIGNING_PRIVATE_KEY!);
    const exp = Math.floor(Date.now() / 1000) + 45;
    const token = await signMuxPlaybackJwt(key, {
      sub: video.playbackId,
      aud: "v",
      exp,
      kid: this.deps.env.MUX_SIGNING_KEY_ID!,
    });
    return {
      type: "hls",
      url: `https://stream.mux.com/${video.playbackId}.m3u8`,
      token,
      expiresAt: exp * 1000,
    };
  }

  async getThumbnail(video: VideoRowLike): Promise<{ url: string; expiresAt: number }> {
    requireSigning(this.deps.env);
    if (!video.playbackId) throw new Error("mux asset has no playback id yet");
    const key = await importEd25519PrivateKey(this.deps.env.MUX_SIGNING_PRIVATE_KEY!);
    const exp = Math.floor(Date.now() / 1000) + 45;
    const token = await signMuxPlaybackJwt(key, {
      sub: video.playbackId,
      aud: "t",
      exp,
      kid: this.deps.env.MUX_SIGNING_KEY_ID!,
    });
    return { url: `https://image.mux.com/${video.playbackId}/thumbnail.jpg?token=${token}`, expiresAt: exp * 1000 };
  }

  async syncMetadata(providerAssetId: string): Promise<Partial<AssetStatus>> {
    return this.getAssetStatus(providerAssetId);
  }
}
