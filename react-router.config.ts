import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // RR7-native flag: activates route middleware (root.tsx CSRF + security
  // headers). Runtime still accepts our plain AppLoadContext from
  // workers/app.ts — the RouterContextProvider-only restriction is RR8.
  future: {
    v8_middleware: true,
  },
} satisfies Config;
