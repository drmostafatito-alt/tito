import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Runs tests inside workerd with real wrangler.jsonc bindings (isolated storage).
// Migrations are embedded (scripts/gen-migrations-manifest.mjs) and applied by the setup.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "wrangler.jsonc" } })],
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
