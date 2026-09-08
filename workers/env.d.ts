// Secrets & non-resource bindings are merged into the wrangler-generated Env
// (see worker-configuration.d.ts). Keep this list in sync with docs/DEPLOYMENT.md §3.
interface Env {
  /** Pepper mixed into session-token hashing. Set via .dev.vars / wrangler secret. */
  SESSION_PEPPER?: string;
  /** PBKDF2 iterations — see docs/SECURITY.md §2 for the Workers CPU tradeoff. */
  AUTH_PBKDF2_ITERATIONS?: string;
  /** Seed-only: super admin email for `npm run db:seed:local`. */
  ADMIN_BOOTSTRAP_EMAIL?: string;
  /** dev | preview | production — unknown/missing is treated as production-safe. */
  ENVIRONMENT?: string;
  /**
   * Explicit dev-only opt-in (C1): when "true", the raw password-reset token is
   * returned for local testing. MUST NOT be set in preview/production — the
   * production-readiness gate refuses a deploy config that carries it.
   */
  EXPOSE_DEV_RESET_TOKEN?: string;

  /**
   * Transactional email channel (server/email): none/unset = fail-closed (no
   * delivery, never claimed); `log` = DEV-ONLY log channel (refused in a
   * `production` ENVIRONMENT); `capture` = TEST-ONLY in-memory capture. A real
   * provider requires a recorded verification ADR + owner credentials (DEPLOYMENT.md).
   */
  EMAIL_PROVIDER?: string;
}
