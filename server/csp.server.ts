import { createContext } from "react-router";

/**
 * Shared router-context key for the per-request CSP nonce.
 *
 * The nonce is generated once per request in `workers/app.ts` and stored on the
 * RouterContextProvider, then read in TWO places that live in the SAME server
 * bundle (`app/entry.server.tsx` → `<ServerRouter nonce>`, and `app/root.tsx`
 * middleware → `applySecurityHeaders`). Because workers/app.ts (bundled by
 * wrangler) and the server build (bundled by vite) both reference this module,
 * the key is memoized on globalThis via Symbol.for — the same cross-bundle
 * identity trick as `server/cloudflare-context.server.ts` (ADR-015).
 *
 * Why this exists: React Router v7 injects inline <script> tags (hydration
 * context, streaming, module bootstrap) with no `src`. A strict
 * `script-src 'self'` CSP blocks them and the app never hydrates. A nonce on
 * both the CSP header and the inline scripts is the secure fix (vs
 * `'unsafe-inline'`).
 */
const REGISTRY_KEY = Symbol.for("educore.csp-nonce");
const registry = globalThis as Record<symbol, unknown>;
const existing = registry[REGISTRY_KEY] as
  | ReturnType<typeof createContext<string>>
  | undefined;

export const cspNonceContext =
  existing ?? createContext<string>();
if (!existing) registry[REGISTRY_KEY] = cspNonceContext;
