import { RouterContextProvider, createRequestHandler } from "react-router";
import { cloudflareContext } from "../server/cloudflare-context.server";

declare global {
  interface CloudflareEnvironment extends Env {}
}

// Classic Workers architecture (ADR-015, docs/DECISIONS.md): React Router 7
// builds to build/server (SSR bundle) + build/client (static assets); this
// entry — served by `wrangler dev` locally and shipped by `wrangler deploy`
// in production — wraps the server build and carries the Cloudflare request
// scope (env bindings + execution context) through RR7 middleware-enabled
// load context: a RouterContextProvider seeded with cloudflareContext
// (server/cloudflare-context.server.ts), which getEnv(context) reads in
// loaders/actions.
const requestHandler = createRequestHandler(
  // @ts-expect-error — generated build output has no type declarations
  () => import("../build/server/index.js"),
  // import.meta.env exists only under vite; wrangler bundling leaves it undefined
  (import.meta as { env?: { MODE?: string } }).env?.MODE ?? "production"
);

export default {
  async fetch(request, env, ctx) {
    const loadContext = new RouterContextProvider(
      new Map([[cloudflareContext, { env, ctx }]])
    );
    return requestHandler(request, loadContext);
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
