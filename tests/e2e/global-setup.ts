import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, env: process.env });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  }
}

/**
 * Global setup — assemble the self-contained headless Chromium (+ NSS/NSPR libs).
 *
 * NOTE: the D1/R2 cold-reset + seed intentionally lives in `webServer.command`
 * (playwright.config.ts), NOT here — Playwright starts the webServer plugin
 * *before* globalSetup, so a reset here would wipe `.wrangler` out from under
 * the already-running dev server and leave it serving an empty D1.
 */
export default function globalSetup() {
  run(process.execPath, ["scripts/e2e-browser-setup.mjs"]);
}
