#!/usr/bin/env node
/**
 * Runs a local bin under the vendored Node 22 binary (RR8/wrangler 4.12x require
 * Node >= 22). Falls back to the current interpreter when the platform package
 * is absent (e.g. CI provides Node 22 via setup-node, or Windows where the
 * vendored linux-only binary never installs).
 *
 * Portable bin resolution: reads the package's own package.json `bin` map
 * instead of node_modules/.bin shims (which are Unix shell scripts that cannot
 * be spawned directly on Windows).
 *
 * Usage: node scripts/nw.mjs <bin> [args...]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const vendored = resolve(process.cwd(), "node_modules/node-linux-x64/bin/node");
const nodeBin = existsSync(vendored) ? vendored : process.execPath;

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: node scripts/nw.mjs <bin|node> [args...]");
  process.exit(1);
}
// `node scripts/nw.mjs node <file>` runs a JS file under the vendored Node 22
if (cmd === "node") {
  const r = spawnSync(nodeBin, args, { stdio: "inherit", env: process.env });
  process.exit(r.status ?? 1);
}

function resolveBin(name) {
  // scoped package? e.g. @scope/cli -> node_modules/@scope/cli
  const scopeSplit = name.indexOf("/");
  const pkg =
    scopeSplit > 0 && name.startsWith("@")
      ? resolve(process.cwd(), "node_modules", name.slice(0, scopeSplit), name.slice(scopeSplit + 1))
      : resolve(process.cwd(), "node_modules", name);
  const manifest = resolve(pkg, "package.json");
  if (!existsSync(manifest)) return null;
  const json = JSON.parse(readFileSync(manifest, "utf8"));
  if (!json.bin) return null;
  const rel = typeof json.bin === "string" ? json.bin : json.bin[name];
  if (!rel) return null;
  return resolve(pkg, rel);
}

const binPath = resolveBin(cmd);
if (!binPath) {
  console.error(`nw: cannot resolve bin for "${cmd}"`);
  process.exit(1);
}
const result = spawnSync(nodeBin, [binPath, ...args], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
