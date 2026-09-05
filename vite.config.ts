import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Classic Workers architecture (ADR-015): plain React Router build
// (build/client + build/server), wrapped by workers/app.ts and served by
// wrangler (dev + production). No vite-plugin in the runtime path — see
// docs/DECISIONS.md ADR-015 for rationale (sandbox memory limits + upstream
// RR8 dev-mode issue cloudflare/workers-sdk#14555).
export default defineConfig({
  plugins: [reactRouter(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
});
