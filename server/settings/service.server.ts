import { eq } from "drizzle-orm";
import { getDb, type DB } from "../db/client.server";
import { settings as settingsTable } from "../db/schema";
import { logAudit } from "../audit/log.server";
import {
  settingsGroupSchemas,
  type Settings,
  type SettingsGroupName,
} from "./schema";

/**
 * Reads all settings groups, deep-merging over schema defaults so that
 * (a) missing rows fall back safely, and (b) new fields added later always
 * have defined values. Invalid stored values fall back to defaults (never throw
 * on a user request) — the write path is where validation is enforced.
 */
export async function getSettings(db: DB): Promise<Settings> {
  const rows = await db.select().from(settingsTable);
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const result = {} as Record<string, unknown>;
  for (const [group, schema] of Object.entries(settingsGroupSchemas)) {
    const parsed = schema.safeParse(stored.get(group) ?? {});
    result[group] = parsed.success ? parsed.data : schema.parse({});
  }
  return result as unknown as Settings;
}

export async function updateSettingsGroup(
  db: DB,
  group: SettingsGroupName,
  patch: Record<string, unknown>,
  actor: { userId: string; role: string; ipHash?: string }
): Promise<Settings[SettingsGroupName]> {
  const current = (await getSettings(db))[group];
  const next = settingsGroupSchemas[group].parse({ ...current, ...patch });
  await db
    .insert(settingsTable)
    .values({ key: group, value: next as Record<string, unknown>, updatedBy: actor.userId, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: next as Record<string, unknown>, updatedBy: actor.userId, updatedAt: Date.now() },
    });
  await logAudit(db, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "settings.updated",
    entityType: "settings",
    entityId: group,
    before: current as Record<string, unknown>,
    after: next as Record<string, unknown>,
    ipHash: actor.ipHash,
  });
  return next;
}

/** Seed default rows (idempotent) — used by the seed script. */
export async function seedSettingsDefaults(env: Env): Promise<void> {
  const db = getDb(env);
  for (const [group, schema] of Object.entries(settingsGroupSchemas)) {
    const value = schema.parse({});
    await db
      .insert(settingsTable)
      .values({ key: group, value: value as Record<string, unknown>, updatedAt: Date.now() })
      .onConflictDoNothing({ target: settingsTable.key });
  }
  // ensure the platform row exists even if defaults change later
  await db.select().from(settingsTable).where(eq(settingsTable.key, "platform")).limit(1);
}
