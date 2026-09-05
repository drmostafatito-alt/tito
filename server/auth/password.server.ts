/**
 * Password hashing (SECURITY.md §2): PBKDF2-SHA256 via WebCrypto, per-user salt,
 * versioned format string so parameters can be raised later (rehash on next login).
 *
 * Iterations: default 100k, overridable with AUTH_PBKDF2_ITERATIONS.
 * The default is a deliberate tradeoff for the Workers free plan's CPU budget —
 * see SECURITY.md §2 and raise it (600k, OWASP guidance) when on a paid plan.
 */
const ITER_DEFAULT = 100_000;
const ITER_MIN = 50_000;
const ITER_MAX = 2_000_000;

const encoder = new TextEncoder();

function iterationsOf(env: Env | undefined): number {
  const raw = Number(env?.AUTH_PBKDF2_ITERATIONS ?? ITER_DEFAULT);
  const iter = Number.isFinite(raw) ? raw : ITER_DEFAULT;
  return Math.min(ITER_MAX, Math.max(ITER_MIN, Math.round(iter)));
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** timing-safe compare for equal-length byte arrays */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(
  password: string,
  env?: Env,
  iterationsOverride?: number
): Promise<string> {
  const iterations = iterationsOverride ?? iterationsOf(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
  env?: Env
): Promise<{ valid: boolean; needsRehash: boolean }> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") {
    return { valid: false, needsRehash: true };
  }
  const iterations = Number(parts[2]);
  const salt = fromB64(parts[3]);
  const expected = fromB64(parts[4]);
  const actual = await derive(password, salt, iterations);
  const valid = constantTimeEqual(actual, expected);
  return { valid, needsRehash: valid && iterations < iterationsOf(env) };
}

const COMMON_PASSWORDS = new Set([
  "password", "123456", "12345678", "qwerty", "abc123", "monkey", "letmein",
  "dragon", "111111", "baseball", "iloveyou", "trustno1", "sunshine", "master",
  "welcome", "shadow", "ashley", "football", "hostinger", "zaq12wsx", "password1",
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
