#!/usr/bin/env node
/**
 * Prepare a current self-contained Chromium for Playwright when the registry
 * browser is unavailable. @sparticuz/chromium ships through npm, extracts its
 * own Amazon Linux runtime libraries, and avoids the obsolete Chromium 92 /
 * chrome-aws-lambda dependency chain.
 */
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import chromium, { inflate } from "@sparticuz/chromium";

const root = resolve(process.cwd());
chromium.setGraphicsMode = false;
const link = resolve(root, ".e2e", "browser", "chromium");
mkdirSync(dirname(link), { recursive: true });

// Local CI images are not necessarily Amazon Linux, so the package does not
// auto-extract its NSS/NSPR compatibility pack there. Extract it explicitly;
// Playwright receives this directory through LD_LIBRARY_PATH below.
await inflate(resolve(root, "node_modules", "@sparticuz", "chromium", "bin", "al2023.tar.br"));
const executable = await chromium.executablePath();
if (!executable || !existsSync(executable)) {
  console.error("✗ @sparticuz/chromium did not produce an executable");
  process.exit(2);
}

let current = "";
try {
  current = readlinkSync(link);
} catch {
  // absent or an old regular binary
}
if (current !== executable) {
  rmSync(link, { force: true });
  symlinkSync(executable, link);
}

console.log(`✓ Current E2E Chromium ready: ${executable}`);
