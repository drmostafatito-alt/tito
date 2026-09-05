import type { ExecutionContext } from "@cloudflare/workers-types";
import { createContext } from "react-router";

export type CloudflareRequestScope = {
  env: Env;
  ctx: ExecutionContext;
};

/**
 * Router context definition for the Cloudflare request scope.
 *
 * TWO bundles reference this module: workers/app.ts (bundled by wrangler) and
 * the React Router server build (bundled by vite). Each inlines its own copy,
 * so a plain module-level constant would produce two different identities and
 * RouterContextProvider.get() would miss. The definition is therefore
 * memoized on globalThis via Symbol.for — the spec-guaranteed cross-bundle
 * symbol registry — yielding one shared identity (ADR-015).
 */
const REGISTRY_KEY = Symbol.for("educore.cloudflare-context");
const registry = globalThis as Record<symbol, unknown>;
const existing = registry[REGISTRY_KEY] as
  | ReturnType<typeof createContext<CloudflareRequestScope>>
  | undefined;

export const cloudflareContext =
  existing ?? createContext<CloudflareRequestScope>();
if (!existing) registry[REGISTRY_KEY] = cloudflareContext;
