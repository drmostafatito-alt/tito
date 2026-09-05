#!/usr/bin/env node
/**
 * Runs a local bin under the vendored Node 22 binary (RR8/wrangler 4.12x require
 * Node >= 22). Falls back to the current interpreter when the platform package
 * is absent (e.g. CI provides Node 22 via setup-node).
 * Usage: node scripts/nw.mjs <bin> [args...]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
const bin = resolve(process.cwd(), "node_modules/.bin", cmd);
const result = spawnSync(nodeBin, [bin, ...args], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
