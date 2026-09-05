/**
 * Pure commerce helpers — NO `.server` suffix on purpose: routes render money
 * and code strings on both server and client, and this module must stay free
 * of DB/env/crypto-subtle dependencies (client-bundle safe).
 *
 * MONEY RULE (FEATURE-SPEC §7 / DATABASE-SCHEMA conventions): every amount is
 * an INTEGER in minor units (piasters for EGP). Floating point is never used
 * for money math — display strings are built with integer division only.
 */

/** "12345" → "123.45" — integer arithmetic only (no floats ever touch money). */
export function formatMinorUnits(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minor));
  const major = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}${major}.${rest}`;
}

export function formatMoney(minor: number, currency: string): string {
  return `${formatMinorUnits(minor)} ${currency}`;
}

/**
 * Discount amount for an order subtotal — integer math only.
 * percent: floor(subtotal × value / 100); fixed: capped at the subtotal.
 */
export function calcDiscountMinor(
  subtotalMinor: number,
  type: "percent" | "fixed",
  value: number
): number {
  const subtotal = Math.max(0, Math.trunc(subtotalMinor));
  if (type === "percent") {
    const pct = Math.min(100, Math.max(0, Math.trunc(value)));
    return Math.floor((subtotal * pct) / 100);
  }
  return Math.min(subtotal, Math.max(0, Math.trunc(value)));
}

/**
 * Code normalization for hashed storage: case-insensitive, dash/space agnostic.
 * The sha-256 of this normalized form is what the DB stores — plaintext never.
 */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Unambiguous alphabet (no 0/O/1/I/L) — activation codes are read aloud/typed by humans. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Cryptographically random activation code: EDU-XXXX-XXXX-XXXX (12 symbols ≈ 59
 * bits of entropy). Rejection sampling avoids modulo bias.
 */
export function generateActivationCode(): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  const chars: string[] = [];
  while (chars.length < 12) {
    const bytes = crypto.getRandomValues(new Uint8Array(12 - chars.length + 8));
    for (const b of bytes) {
      if (b < limit) chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
      if (chars.length === 12) break;
    }
  }
  return `EDU-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

/** Days → ms (integer). */
export const DAY_MS = 86_400_000;
