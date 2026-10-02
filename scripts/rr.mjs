#!/usr/bin/env node
/**
 * Runs the React Router CLI (RR8 requires Node >= 22.22). Falls back to the
 * current interpreter when the vendored Node 22 platform package is absent
 * (e.g. Windows where only the node binary itself matters, or CI which
 * provides Node 22 via setup-node).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const vendored = resolve(process.cwd(), "node_modules/node-linux-x64/bin/node");
const nodeBin = existsSync(vendored) ? vendored : process.execPath;

const args = process.argv.slice(2);
const cli = resolve(process.cwd(), "node_modules/@react-router/dev/bin.js");
const result = spawnSync(nodeBin, [cli, ...args], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
