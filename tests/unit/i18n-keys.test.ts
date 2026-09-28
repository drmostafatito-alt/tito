import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ar } from "../../app/locales/ar";
import { en } from "../../app/locales/en";

/**
 * `t(locale, "some.key")` is a plain string lookup: a typo (or a key invented
 * while building a new screen) does not fail the typecheck, it silently ships
 * the raw key as visible UI text — which is exactly how `contact.phone` ended
 * up rendered on /about during the rebuild.
 *
 * This test closes that hole for every LITERAL key in the app source.
 */

const ROOT = path.resolve(__dirname, "../../app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name) && !p.includes(`${path.sep}locales${path.sep}`)) out.push(p);
  }
  return out;
}

function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
}

/** `t(<expr>, "literal.key")` — only literal second arguments can be checked. */
const CALL = /\bt\(\s*[A-Za-z_$][\w$.]*\s*,\s*"([A-Za-z0-9_.]+)"/g;
const CALL_LITERAL_LOCALE = /\bt\(\s*"(?:ar|en)"\s*,\s*"([A-Za-z0-9_.]+)"/g;

describe("i18n dictionary coverage", () => {
  const files = walk(ROOT);
  const used = new Map<string, string>();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const re of [CALL, CALL_LITERAL_LOCALE]) {
      re.lastIndex = 0;
      for (const m of src.matchAll(re)) if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, file));
    }
  }

  it("finds translation calls to check", () => {
    expect(used.size).toBeGreaterThan(200);
  });

  it("every literal key used in app/ exists in the Arabic dictionary", () => {
    const missing = [...used].filter(([k]) => typeof lookup(ar, k) !== "string").map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });

  it("every literal key used in app/ exists in the English dictionary", () => {
    const missing = [...used].filter(([k]) => typeof lookup(en, k) !== "string").map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });
});
