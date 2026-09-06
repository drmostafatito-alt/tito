import { defineConfig, devices } from "@playwright/test";

/**
 * Live Visual/Admin/Template QA — uses Playwright Chromium 153 (Tailwind v4).
 * Does NOT reset D1 and does NOT start wrangler: run `node scripts/e2e-reset.mjs`
 * then `npm run dev` first. Never pointed at chrome-aws-lambda Chromium ~100.
 */
export default defineConfig({
  testDir: "./tests/qa",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: {
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    },
  },
});
