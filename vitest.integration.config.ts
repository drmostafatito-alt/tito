import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Runs tests inside workerd with real wrangler.jsonc bindings (isolated storage).
// Migrations are embedded (scripts/gen-migrations-manifest.mjs) and applied by the setup.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "wrangler.jsonc" },
      // Hermetic test secrets: the suite must not depend on the gitignored
      // `.dev.vars` being present (CI never has it). These are obviously-fake,
      // test-only values — real secrets live ONLY in `.dev.vars` (local dev) and
      // `wrangler secret` (production); nothing here is a credential. When a
      // local `.dev.vars` exists, its values take precedence — tests are
      // value-agnostic (they sign and verify with the same env).
      miniflare: {
        bindings: {
          SESSION_PEPPER: "integration-test-session-pepper",
          FILE_URL_SECRET: "integration-test-file-url-secret",
          MOCK_VIDEO_SECRET: "integration-test-mock-video-secret",
          MOCK_PAYMENTS_SECRET: "integration-test-mock-payments-secret",
          // Transactional email uses the test-only in-memory capture channel so the
          // request→send flows can be asserted hermetically (never a real provider).
          EMAIL_PROVIDER: "capture",
          AUTH_PBKDF2_ITERATIONS: "100000",
          // Development context so the reset-token dev flow is exercised here;
          // fail-closed variants (production/staging/undefined) are asserted by
          // passing overridden env objects directly in auth.test.ts (C1).
          ENVIRONMENT: "development",
        },
      },
    }),
  ],
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/apply-migrations.setup.ts"],
    // per-file storage isolation (D1/R2 rollback) is only deterministic with
    // sequential files — parallel runs leak R2 state across files
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "~server": fileURLToPath(new URL("./server", import.meta.url)),
    },
  },
});
