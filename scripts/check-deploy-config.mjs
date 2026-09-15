#!/usr/bin/env node
/** Static fail-closed check for the committed production Worker configuration. */
import { readFileSync } from "node:fs";

const raw = readFileSync("wrangler.jsonc", "utf8");
function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      output += "\n";
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < input.length - 1 && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++;
    } else {
      output += char;
    }
  }
  return output;
}
const stripped = stripJsonComments(raw);
let config;
try {
  config = JSON.parse(stripped);
} catch (error) {
  console.error("✗ wrangler.jsonc is not parseable JSONC", error instanceof Error ? error.name : "unknown");
  process.exit(2);
}

const failures = [];
const requireCheck = (ok, message) => { if (!ok) failures.push(message); };
const vars = config.vars ?? {};
const db = config.d1_databases?.find((item) => item.binding === "DB");
const buckets = new Map((config.r2_buckets ?? []).map((item) => [item.binding, item.bucket_name]));

requireCheck(vars.ENVIRONMENT === "production", 'vars.ENVIRONMENT must be exactly "production"');
requireCheck(vars.EMAIL_PROVIDER === "resend", 'vars.EMAIL_PROVIDER must be exactly "resend"');
try {
  const origin = new URL(String(vars.APP_ORIGIN ?? ""));
  const host = origin.hostname.toLowerCase();
  const reservedHost =
    host === "localhost" ||
    ["example.com", "example.org", "example.net"].includes(host) ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("[") ||
    /\.(?:localhost|local|test|example)$/.test(host);
  requireCheck(
    origin.protocol === "https:" &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash &&
      !origin.username &&
      !origin.password &&
      !reservedHost,
    "vars.APP_ORIGIN must be a real bare HTTPS application origin"
  );
} catch {
  failures.push("vars.APP_ORIGIN must be configured (a workers.dev origin is acceptable; a custom domain is not required)");
}
requireCheck(typeof vars.EMAIL_FROM === "string" && /@/.test(vars.EMAIL_FROM), "vars.EMAIL_FROM must be a verified Resend sender");
requireCheck(
  typeof vars.MUX_PLAYBACK_RESTRICTION_ID === "string" &&
    vars.MUX_PLAYBACK_RESTRICTION_ID.length >= 6 &&
    !/(?:placeholder|replace|example|dummy|your[-_ ])/i.test(vars.MUX_PLAYBACK_RESTRICTION_ID),
  "vars.MUX_PLAYBACK_RESTRICTION_ID must identify the real provider-side domain restriction"
);
requireCheck(db && db.database_id && db.database_id !== "local", "DB.database_id must be the real production D1 id, not local");
requireCheck(db && db.database_name && !/\b(dev|preview|test|local)\b/i.test(db.database_name), "DB must name a production D1 database");
for (const binding of ["PUBLIC_ASSETS", "PRIVATE_FILES", "VIDEO_MASTERS"]) {
  const bucketName = buckets.get(binding);
  requireCheck(
    Boolean(bucketName) && !/\b(dev|preview|test|local)\b/i.test(String(bucketName)),
    `${binding} must name a real production R2 bucket (not dev/test/local)`
  );
}

for (const forbidden of ["TEST_CAPTURE_SECRET", "MOCK_VIDEO_SECRET", "MOCK_PAYMENTS_SECRET", "EXPOSE_DEV_RESET_TOKEN"]) {
  requireCheck(!(forbidden in vars) && !new RegExp(`\\b${forbidden}\\b`).test(stripped), `${forbidden} must not be in deploy config`);
}
for (const secret of ["SESSION_PEPPER", "FILE_URL_SECRET", "RESEND_API_KEY", "MUX_TOKEN_SECRET", "MUX_SIGNING_PRIVATE_KEY"]) {
  requireCheck(!(secret in vars), `${secret} must be a Wrangler secret, never a plaintext [vars] value`);
}

if (failures.length) {
  console.error("\n✗ Production Worker configuration is incomplete — deployment refused:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nSee docs/DEPLOYMENT.md. Do not replace placeholders until the owner has created the real resources.");
  process.exit(1);
}
console.log("✓ committed production Worker configuration passes static safety checks");
