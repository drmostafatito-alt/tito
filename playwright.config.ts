import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright E2E (W4, Phase 8).
 *
 * - webServer: `node scripts/e2e-reset.mjs && npm run dev` — the cold D1/R2
 *   reset + seed runs FIRST (Playwright starts the webServer plugin *before*
 *   globalSetup, so the seed must precede `wrangler dev`, otherwise the dev
 *   server boots against an empty D1 and 500s on `no such table: menus`).
 * - globalSetup: assembles the self-contained headless Chromium (scripts/
 *   e2e-browser-setup.mjs — the sandbox blocks every browser CDN, so the browser
 *   + its NSS/NSPR shared libs are built from npm + source).
 * - launchOptions: executablePath + LD_LIBRARY_PATH point at the assembled
 *   Chromium (real browser, no mocks). Chromium ~100 needs --no-sandbox here.
 *
 * Run:  npm run test:e2e   (see package.json)
 */
const LIBDIR = resolve(__dirname, ".e2e/browser/lib");
const CHROMIUM = resolve(__dirname, ".e2e/browser/chromium");

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
    // self-contained Chromium (see scripts/e2e-browser-setup.mjs)
    launchOptions: {
      executablePath: CHROMIUM,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-zygote"],
      env: { ...process.env, LD_LIBRARY_PATH: LIBDIR },
    },
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
