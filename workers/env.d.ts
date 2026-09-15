// Secrets & non-resource bindings are merged into the wrangler-generated Env
// (see worker-configuration.d.ts). Keep this list in sync with docs/DEPLOYMENT.md §3.
interface Env {
  /** Pepper mixed into opaque session/reset token and rate-limit digests. */
  SESSION_PEPPER: string;
  /** PBKDF2 iterations — see docs/SECURITY.md §2 for the Workers CPU tradeoff. */
  AUTH_PBKDF2_ITERATIONS?: string;
  /** Seed-only: super admin email for bootstrap tooling. */
  ADMIN_BOOTSTRAP_EMAIL?: string;
  /** development | test | preview | production; unknown/missing fails closed. */
  ENVIRONMENT?: string;

  /** Canonical HTTPS app origin used for security-sensitive email links and CSRF. */
  APP_ORIGIN?: string;
  /** `resend` in production; `log` is development-only; `capture` is test-only. */
  EMAIL_PROVIDER?: string;
  /** Resend Transactional Email API key. Server secret; never exposed to React. */
  RESEND_API_KEY?: string;
  /** Verified Resend sender, e.g. `Dr Mostafa Tito <no-reply@example.com>`. */
  EMAIL_FROM?: string;

  /** Browser-E2E capture endpoint gate; fake test value only, never production. */
  TEST_CAPTURE_SECRET?: string;
  /** Non-secret Mux playback restriction attached to signed playback JWTs. */
  MUX_PLAYBACK_RESTRICTION_ID?: string;
}
