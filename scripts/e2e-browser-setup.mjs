#!/usr/bin/env node
/**
 * Self-contained headless-Chromium setup for Playwright E2E (W4, Phase 8).
 *
 * WHY THIS EXISTS
 * ---------------
 * The sandbox/CI network blocks every browser download CDN (cdn.playwright.dev,
 * storage.googleapis.com, objects.githubusercontent.com). Only registry.npmjs.org
 * and github.com (git) are reachable. This script assembles a working headless
 * Chromium entirely from those two channels:
 *
 *   1. `chrome-aws-lambda` (npm)  → a real Chromium (~100) binary, brotli-packed
 *      inside the npm tarball, plus `aws.tar` which bundles the NSS shared libs
 *      (libnss3.so / libnssutil3.so / libsoftokn3.so) that headless Chromium needs.
 *   2. `mozilla/nspr` (git)       → built from source (gcc + make) to produce the
 *      three NSPR shared libs (libnspr4.so / libplc4.so / libplds4.so) that are
 *      NOT present on the Debian base image and are not bundled in aws.tar.
 *
 * The result is a real Chromium driven by @playwright/test — no mocks, no
 * synthetic browser. Output lands under `.e2e/browser/` (gitignored).
 *
 * PREREQUISITES: node >= 22, gcc, make, git, network to npmjs.org + github.com.
 *
 * USAGE: node scripts/e2e-browser-setup.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = join(ROOT, ".e2e", "browser");
const LIBDIR = join(OUT, "lib");
const CHROMIUM_BIN = join(OUT, "chromium");

function brotliDecompress(inPath, outPath) {
  const out = zlib.brotliDecompressSync(readFileSync(inPath));
  writeFileSync(outPath, out);
  return outPath;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd ?? ROOT, env: process.env });
  if (r.status !== 0) {
    console.error(`\n✗ ${cmd} ${args.join(" ")} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

function resolvePkg(name) {
  const p = require.resolve(`${name}/package.json`);
  return dirname(p);
}

// 1) chromium binary from chrome-aws-lambda
const calDir = resolvePkg("chrome-aws-lambda");
const chromiumBr = join(calDir, "bin", "chromium.br");
if (!existsSync(chromiumBr)) {
  console.error("✗ chrome-aws-lambda/bin/chromium.br not found — is chrome-aws-lambda installed?");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
if (!existsSync(CHROMIUM_BIN)) {
  console.log("· extracting Chromium binary (brotli)…");
  brotliDecompress(chromiumBr, CHROMIUM_BIN);
  chmodSync(CHROMIUM_BIN, 0o755);
}

// 2) NSS shared libs from chrome-aws-lambda aws.tar
mkdirSync(LIBDIR, { recursive: true });
if (!existsSync(join(LIBDIR, "libnss3.so"))) {
  console.log("· extracting NSS shared libs (aws.tar)…");
  const awsBr = join(calDir, "bin", "aws.tar.br");
  const awsTar = join(OUT, "aws.tar");
  brotliDecompress(awsBr, awsTar);
  run("tar", ["xf", awsTar, "-C", OUT, "lib"]);
  rmSync(awsTar, { force: true });
}

// 3) NSPR shared libs — build from source (the only reliable channel for these)
if (!existsSync(join(LIBDIR, "libnspr4.so"))) {
  console.log("· building NSPR from source (mozilla/nspr)…");
  const nsprDir = join(OUT, "nspr-src");
  if (!existsSync(join(nsprDir, "configure"))) {
    rmSync(nsprDir, { recursive: true, force: true });
    run("git", ["clone", "--depth", "1", "https://github.com/mozilla/nspr.git", nsprDir]);
  }
  const objDir = join(nsprDir, "obj");
  rmSync(objDir, { recursive: true, force: true });
  mkdirSync(objDir, { recursive: true });
  run("../configure", ["--prefix=" + LIBDIR, "--enable-64bit", "--disable-debug", "--enable-optimize"], { cwd: objDir });
  run("make", ["-j4"], { cwd: objDir });
  // copy the three .so we need into LIBDIR, dereferencing the dist/lib symlinks
  const distLib = join(objDir, "dist", "lib");
  for (const f of ["libnspr4.so", "libplc4.so", "libplds4.so"]) {
    run("cp", ["-L", join(distLib, f), join(LIBDIR, f)]);
  }
}

const libs = ["libnss3.so", "libnssutil3.so", "libsoftokn3.so", "libnspr4.so", "libplc4.so", "libplds4.so"];
const missing = libs.filter((l) => !existsSync(join(LIBDIR, l)));
if (missing.length) {
  console.error(`✗ still missing libs: ${missing.join(", ")}`);
  process.exit(2);
}

console.log(`\n✓ E2E browser ready:`);
console.log(`  chromium : ${CHROMIUM_BIN}`);
console.log(`  libs     : ${LIBDIR} (${libs.length} shared libraries)`);
console.log(`  LD_LIBRARY_PATH=${LIBDIR}`);
