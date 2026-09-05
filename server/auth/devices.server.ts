import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { devices, sessions } from "../db/schema";
import { sha256Hex } from "../http/rate-limit.server";
import { logSecurityEvent } from "../security/events.server";
import { parseCookieHeader } from "./cookies.server";
import { newOpaqueToken } from "./session.server";
import { DEVICE_COOKIE } from "./session.server";
import type { DeviceSettings } from "../settings/schema";

export interface DeviceOutcome {
  ok: boolean;
  deviceId?: string;
  newDeviceKey?: string; // set => route must set the device cookie
  errorCode?: "device_limit" | "device_change_limit" | "device_revoked";
}

function platformOf(userAgent: string): { platform: DevicePlatform; label: string } {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) {
    return { platform: "ios", label: /ipad/.test(ua) ? "iPad" : "iPhone" };
  }
  if (/android/.test(ua)) return { platform: "android", label: "Android" };
  if (/windows/.test(ua)) return { platform: "windows", label: "Windows PC" };
  if (/mac os|macintosh/.test(ua)) return { platform: "mac", label: "Mac" };
  if (/linux/.test(ua)) return { platform: "linux", label: "Linux" };
  return { platform: "other", label: "Unknown device" };
}
type DevicePlatform = "ios" | "android" | "windows" | "mac" | "linux" | "other";

/**
 * ADR-005: durable random device key (HttpOnly cookie), hashed at rest.
 * Policy-driven: max devices, block vs replace-oldest, 30d change limit.
 * Mere logout does NOT free a slot — only explicit revocation does.
 */
export async function resolveDevice(
  db: DB,
  env: Env,
  opts: {
    request: Request;
    userId: string;
    policy: DeviceSettings;
    ipHash?: string | null;
  }
): Promise<DeviceOutcome> {
  const cookies = parseCookieHeader(opts.request.headers.get("cookie"));
  const existingKey = cookies.get(DEVICE_COOKIE);
  const now = Date.now();

  if (existingKey) {
    const keyHash = await sha256Hex(existingKey, env.SESSION_PEPPER ?? "dk");
    const found = await db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, opts.userId), eq(devices.keyHash, keyHash)))
      .limit(1);

    if (found[0]) {
      const device = found[0];
      if (device.status === "revoked") {
        await logSecurityEvent(db, {
          userId: opts.userId,
          type: "device_revoked_login",
          ipHash: opts.ipHash ?? null,
          metadata: { deviceId: device.id },
        });
        return { ok: false, errorCode: "device_revoked" };
      }
      await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
      return { ok: true, deviceId: device.id };
    }
  }

  // new device — enforce policy
  const active = await db
    .select({ id: devices.id, firstSeenAt: devices.firstSeenAt })
    .from(devices)
    .where(and(eq(devices.userId, opts.userId), eq(devices.status, "active")));

  if (opts.policy.changeLimitPer30d > 0) {
    const addedLast30d = active.filter((d) => now - d.firstSeenAt < 30 * 86_400_000).length;
    if (addedLast30d >= opts.policy.changeLimitPer30d && active.length >= opts.policy.maxPerStudent) {
      await logSecurityEvent(db, {
        userId: opts.userId,
        type: "device_change_limit_block",
        ipHash: opts.ipHash ?? null,
        metadata: { activeDevices: active.length, limit: opts.policy.changeLimitPer30d },
      });
      return { ok: false, errorCode: "device_change_limit" };
    }
  }

  if (active.length >= opts.policy.maxPerStudent) {
    if (opts.policy.onLimit === "replace_oldest") {
      const oldest = active.slice().sort((a, b) => a.firstSeenAt - b.firstSeenAt)[0];
      await db
        .update(devices)
        .set({ status: "revoked", revokedAt: now })
        .where(eq(devices.id, oldest.id));
      await db.run(sql`UPDATE sessions SET revoked_at = ${now}, revoked_reason = 'device_replaced'
         WHERE device_id = ${oldest.id} AND revoked_at IS NULL`);
      await logSecurityEvent(db, {
        userId: opts.userId,
        type: "device_evicted",
        ipHash: opts.ipHash ?? null,
        metadata: { evictedDeviceId: oldest.id },
      });
    } else {
      await logSecurityEvent(db, {
        userId: opts.userId,
        type: "device_limit_block",
        ipHash: opts.ipHash ?? null,
        metadata: { activeDevices: active.length, max: opts.policy.maxPerStudent },
      });
      return { ok: false, errorCode: "device_limit" };
    }
  }

  // register the new device
  const key = existingKey ?? newOpaqueToken();
  const keyHash = await sha256Hex(key, env.SESSION_PEPPER ?? "dk");
  const ua = opts.request.headers.get("user-agent") ?? "";
  const { platform, label } = platformOf(ua);
  const id = crypto.randomUUID();
  await db.insert(devices).values({
    id,
    userId: opts.userId,
    keyHash,
    label,
    platform,
    userAgentHash: await sha256Hex(ua),
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
  });
  await logSecurityEvent(db, {
    userId: opts.userId,
    type: "device_added",
    ipHash: opts.ipHash ?? null,
    metadata: { platform, label },
  });

  return { ok: true, deviceId: id, newDeviceKey: existingKey ? undefined : key };
}

export const DEVICE_COOKIE_MAX_AGE = 400 * 86_400; // ~13 months (cookie cap)
export { DEVICE_COOKIE };
