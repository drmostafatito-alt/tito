/**
 * Type declarations for scripts/backup-lib.mjs (a Node ESM script that is also
 * imported by the unit test tests/unit/backup-safety.test.ts). Declared
 * separately because the project's tsconfig includes all files but does not
 * typecheck .mjs sources as JS, so imports of the module need explicit types.
 */

export const TABLES: string[];
export const R2_BUCKETS: string[];
export const MIGRATION_TABLE: string;

export function sha256Hex(bytes: Uint8Array): Promise<string>;
export function timestampSlug(now?: Date): string;

export type GuardResult = { ok: boolean; reason: string };

export function validateBackupTarget(
  target: string,
  opts: { allowRemote: boolean },
): GuardResult;

export function validateRestoreTarget(
  target: string,
  opts: { allowUnsafeRestore: boolean; force: boolean },
): GuardResult;
