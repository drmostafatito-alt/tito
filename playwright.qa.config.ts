import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Live visual/admin/template QA. It does not reset D1 or start Wrangler; prepare
 * the local fixture server first. The same current npm-pinned Chromium fallback
 * as the hermetic E2E config is used when no Playwright registry browser exists.
 */
function registryChromiumPresent(): boolean {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(homedir(), ".cache", "ms-playwright");
  try {
    return existsSync(root) && readdirSync(root).some((entry) => /^chromium(_headless_shell)?-\d+/.test(entry));
  } catch {
    return false;
  }
}

const override = process.env.E2E_CHROMIUM_PATH;
const usePackaged = Boolean(override) || !registryChromiumPresent();
const packaged = resolve(".e2e/browser/chromium");
const libdir = resolve(tmpdir(), "al2023", "lib");

export default defineConfig({
  testDir: "./tests/qa",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: resolve("tests/e2e/global-setup.ts"),
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: usePackaged
      ? {
          executablePath: override ?? packaged,
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
            LD_LIBRARY_PATH: [libdir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
          },
        }
      : { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] },
  },
});
