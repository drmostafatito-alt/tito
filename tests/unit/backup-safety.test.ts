import { describe, expect, it } from "vitest";
import { validateBackupTarget, validateRestoreTarget } from "../../scripts/backup-lib.mjs";

/**
 * W5 — critical-safeguard regression tests for the backup/restore scripts.
 *
 * These pin the environment guards so the tooling can never accidentally
 * (a) back up a remote/production database without an explicit opt-in, or
 * (b) restore over production — restore is destructive and must always be
 * force-confirmed, with remote restore additionally gated behind an explicit
 * unsafe-restore flag.
 */
describe("backup target guard", () => {
  it("allows a local backup", () => {
    expect(validateBackupTarget("local", { allowRemote: false }).ok).toBe(true);
  });

  it("refuses a remote backup without an explicit opt-in", () => {
    const r = validateBackupTarget("remote", { allowRemote: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/EDUCORE_ALLOW_REMOTE/);
  });

  it("allows a remote backup only with the explicit opt-in", () => {
    expect(validateBackupTarget("remote", { allowRemote: true }).ok).toBe(true);
  });

  it("rejects unknown targets", () => {
    expect(validateBackupTarget("prod", { allowRemote: false }).ok).toBe(false);
  });
});

describe("restore target guard", () => {
  it("refuses restore without --force (destructive)", () => {
    const r = validateRestoreTarget("local", { allowUnsafeRestore: false, force: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/--force/);
  });

  it("refuses a remote restore even with --force unless unsafe-restore is opted in", () => {
    const r = validateRestoreTarget("remote", { allowUnsafeRestore: false, force: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/EDUCORE_ALLOW_UNSAFE_RESTORE|REFUSED/);
  });

  it("allows a remote restore only with BOTH --force and the unsafe-restore opt-in", () => {
    expect(validateRestoreTarget("remote", { allowUnsafeRestore: true, force: true }).ok).toBe(true);
  });

  it("allows a local restore with --force", () => {
    expect(validateRestoreTarget("local", { allowUnsafeRestore: false, force: true }).ok).toBe(true);
  });

  it("rejects unknown targets", () => {
    expect(validateRestoreTarget("prod", { allowUnsafeRestore: true, force: true }).ok).toBe(false);
  });
});
