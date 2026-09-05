import type { DB } from "../db/client.server";
import { securityEvents } from "../db/schema";

export type SecurityEventType =
  | "login_success"
  | "login_failed"
  | "logout"
  | "device_added"
  | "device_evicted"
  | "device_limit_block"
  | "device_change_limit_block"
  | "device_revoked_login"
  | "password_reset_requested"
  | "password_reset_completed"
  | "password_changed"
  | "sessions_revoked_all"
  | "session_revoked"
  | "rate_limited"
  | "permission_denied"
  | "registration";

export async function logSecurityEvent(
  db: DB,
  entry: {
    userId?: string | null;
    type: SecurityEventType;
    ipHash?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.insert(securityEvents).values({
    id: crypto.randomUUID(),
    userId: entry.userId ?? null,
    type: entry.type,
    ipHash: entry.ipHash ?? null,
    metadata: entry.metadata ?? null,
    createdAt: Date.now(),
  });
}
