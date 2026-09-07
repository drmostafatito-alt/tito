import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright E2E (W4, Phase 8).
 *
 * - webServer: `node scripts/e2e-reset.mjs && npm run dev` — the cold D1/R2
 *   reset + seed runs FIRST (Playwright starts the webServer plugin *before*
 *   globalSetup, so the seed must precede `wrangler dev`, otherwise the dev
 *   server boots against an empty D1 and 500s on `no such table: menus`).
 * - globalSetup: assembles the self-contained headless Chromium (scripts/
 *   e2e-browser-setup.mjs) ONLY when no registry browser is installed.
 * - Browser strategy: prefer the Playwright-registry Chromium (modern build,
 *   currently 153) when present; fall back to the self-contained assembled
 *   Chromium (scripts/e2e-browser-setup.mjs — for sandboxes where every
 *   browser CDN is blocked). Both are real browsers, no mocks.
 *
 * Run:  npm run test:e2e   (see package.json)
 */
const LIBDIR = resolve(__dirname, ".e2e/browser/lib");
const ASSEMBLED = resolve(__dirname, ".e2e/browser/chromium");

/** Registry Chromium present? (a chromium-N or chromium_headless_shell-N dir under the Playwright browsers path) */
function registryChromiumPresent(): boolean {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(homedir(), ".cache", "ms-playwright");
  try {
    return existsSync(root) && readdirSync(root).some((d) => /^chromium(_headless_shell)?-\d+/.test(d));
  } catch {
    return false;
  }
}

const useAssembled = !registryChromiumPresent() && existsSync(ASSEMBLED);

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
    // registry Chromium (preferred) or self-contained assembled Chromium
    launchOptions: useAssembled
      ? {
          executablePath: ASSEMBLED,
          args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-zygote"],
          env: { ...process.env, LD_LIBRARY_PATH: LIBDIR },
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
    command: "node scripts/e2e-reset.mjs && npm run dev",
    url: "http://127.0.0.1:5173",
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
