import type { ExecutionContext } from "@cloudflare/workers-types";
import { cloudflareContext } from "./cloudflare-context.server";

/**
 * Narrow, single place where the Cloudflare request context is extracted.
 * Routes/loaders use these helpers instead of importing bindings ad hoc.
 *
 * Two context shapes are accepted:
 * 1. RouterContextProvider (production + wrangler dev, middleware enabled):
 *    the provider constructed in workers/app.ts seeded with cloudflareContext.
 * 2. Plain `{ cloudflare: { env, ctx } }` (direct service calls, tests).
 */
export interface AppLoadContextShape {
  cloudflare: {
    env: Env;
    ctx: ExecutionContext;
  };
}

type ProviderShape = {
  get: (definition: typeof cloudflareContext) => {
    env: Env;
    ctx: ExecutionContext;
  };
};

function scope(context: unknown): AppLoadContextShape["cloudflare"] {
  const provider = context as ProviderShape | undefined;
  if (provider && typeof provider.get === "function") {
    return provider.get(cloudflareContext);
  }
  return (context as AppLoadContextShape).cloudflare;
}

export function getEnv(context: unknown): Env {
  return scope(context).env;
}

export function getWaitUntil(context: unknown): (fn: Promise<unknown>) => void {
  const ctx = scope(context).ctx;
  return (fn) => ctx.waitUntil(fn);
}
