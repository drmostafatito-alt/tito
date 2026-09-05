// Secrets & non-resource bindings are merged into the wrangler-generated Env
// (see worker-configuration.d.ts). Keep this list in sync with docs/DEPLOYMENT.md §3.
interface Env {
  /** Pepper mixed into session-token hashing. Set via .dev.vars / wrangler secret. */
  SESSION_PEPPER?: string;
  /** PBKDF2 iterations — see docs/SECURITY.md §2 for the Workers CPU tradeoff. */
  AUTH_PBKDF2_ITERATIONS?: string;
  /** Seed-only: super admin email for `npm run db:seed:local`. */
  ADMIN_BOOTSTRAP_EMAIL?: string;
  /** dev | preview | production */
  ENVIRONMENT?: string;
}
