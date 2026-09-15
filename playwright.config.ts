import { defineConfig, devices } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Headless functional/a11y tests do not need WebGL. Disabling the packaged
// SwiftShader Vulkan path avoids GPU initialization failures in restricted CI.
chromium.setGraphicsMode = false;

/**
 * Playwright E2E (W4, Phase 8).
 *
 * - webServer: `node scripts/e2e-reset.mjs && npm run dev` — the cold D1/R2
 *   reset + seed runs FIRST (Playwright starts the webServer plugin *before*
 *   globalSetup, so the seed must precede `wrangler dev`, otherwise the dev
 *   server boots against an empty D1 and 500s on `no such table: menus`).
 * - globalSetup: prepares the npm-pinned current @sparticuz/chromium binary.
 * - Browser strategy: prefer the Playwright-registry Chromium when present;
 *   otherwise use that current self-contained binary. Both are real browsers,
 *   with no network download, obsolete Chromium fallback, or browser mock.
 *
 * Run:  npm run test:e2e   (see package.json)
 */
const PACKAGED_CHROMIUM = resolve(__dirname, ".e2e/browser/chromium");
const PACKAGED_LIBDIR = resolve(tmpdir(), "al2023", "lib");

/** Registry Chromium present? (a chromium-N or chromium_headless_shell-N dir under the Playwright browsers path) */
function registryChromiumPresent(): boolean {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(homedir(), ".cache", "ms-playwright");
  try {
    return existsSync(root) && readdirSync(root).some((d) => /^chromium(_headless_shell)?-\d+/.test(d));
  } catch {
    return false;
  }
}

/**
 * Optional override for sandboxes/CI images that ship their own Chromium:
 * `E2E_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`. Keeps the default
 * behaviour (registry browser, else the packaged bundle) untouched.
 */
const OVERRIDE = process.env.E2E_CHROMIUM_PATH;
const executable = OVERRIDE ?? PACKAGED_CHROMIUM;
// Config is evaluated before globalSetup creates the symlink, so intentionally
// do not gate this on existsSync(PACKAGED_CHROMIUM).
const usePackaged = Boolean(OVERRIDE) || !registryChromiumPresent();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // deterministic ordering; the app shares one seeded DB
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  globalSetup: resolve(__dirname, "tests/e2e/global-setup.ts"),

  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    // registry Chromium (preferred) or current self-contained npm binary
    launchOptions: usePackaged
      ? {
          executablePath: executable,
          // Keep browser security semantics intact: unlike serverless Lambda
          // defaults, do not disable web security/site isolation or force a
          // fragile single-process browser in local CI.
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--use-gl=disabled",
            "--disable-dev-shm-usage",
          ],
          env: {
            ...process.env,
            LD_LIBRARY_PATH: [PACKAGED_LIBDIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
          },
        }
      : { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] },
  },

  projects: [
    // 1) auth setup: logs in admin + student once and persists storage states
    //    (device keys + session cookies) so tests share ONE device per account —
    //    the platform's 1-device policy would otherwise block every re-login.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // reset+seed FIRST, then build + `wrangler dev` — the dev server must boot
    // against the already-migrated/seeded local D1 (see header comment).
    command: "node scripts/e2e-reset.mjs && npm run build && node scripts/nw.mjs wrangler dev --ip 0.0.0.0 --port 5173 --env-file tests/e2e/test.env",
    url: "http://127.0.0.1:5173",
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
