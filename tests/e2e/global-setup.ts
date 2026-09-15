import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, env: process.env });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  }
}

/** Registry Chromium present? (mirrors the detection in playwright.config.ts) */
function registryChromiumPresent(): boolean {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(homedir(), ".cache", "ms-playwright");
  try {
    return existsSync(root) && readdirSync(root).some((d) => /^chromium(_headless_shell)?-\d+/.test(d));
  } catch {
    return false;
  }
}

/**
 * Global setup — prepare the current npm-pinned self-contained Chromium only
 * when the Playwright registry has no browser installed. The fallback requires
 * no CDN download and carries none of the obsolete chrome-aws-lambda toolchain.
 *
 * NOTE: the D1/R2 cold-reset + seed intentionally lives in `webServer.command`
 * (playwright.config.ts), NOT here — Playwright starts the webServer plugin
 * *before* globalSetup, so a reset here would wipe `.wrangler` out from under
 * the already-running dev server and leave it serving an empty D1.
 */
export default function globalSetup() {
  if (registryChromiumPresent()) {
    console.log("· Playwright registry Chromium present — skipping self-contained browser assembly");
    return;
  }
  run(process.execPath, ["scripts/e2e-browser-setup.mjs"]);
}
