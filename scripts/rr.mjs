#!/usr/bin/env node
/**
 * Runs the React Router CLI under the vendored Node 22 binary (RR8 requires
 * Node >= 22.22). Falls back to the current interpreter when the platform
 * package is absent (CI provides Node 22 via setup-node).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const vendored = resolve(process.cwd(), "node_modules/node-linux-x64/bin/node");
const nodeBin = existsSync(vendored) ? vendored : process.execPath;

const args = process.argv.slice(2);
const result = spawnSync(nodeBin, ["node_modules/.bin/react-router", ...args], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
