#!/usr/bin/env node
/**
 * Module-boundary linter (ARCHITECTURE §16): client code must never import server
 * modules. Only route files (app/routes/**) and app/root.tsx may import `~server/*`,
 * and only `*.server` files under server/ may exist there. Everything under app/
 * except routes must stay client-safe.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const errors = [];
function walk(dir, fn) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, fn);
    else if (/\.(ts|tsx)$/.test(entry)) fn(full);
  }
}

walk("app", (file) => {
  const isRoute = file.startsWith("app/routes/") || file === "app/root.tsx";
  const src = readFileSync(file, "utf8");
  const importsServer = /from\s+["']~server\//.test(src);
  if (importsServer && !isRoute) {
    errors.push(`${file}: client code imports ~server/* (only app/routes/** and app/root.tsx may)`);
  }
});

walk("server", (file) => {
  const src = readFileSync(file, "utf8");
  if (/from\s+["']~\//.test(src)) {
    errors.push(`${file}: server code imports app code (~/*) — boundary violation`);
  }
});

if (errors.length) {
  console.error("✗ module boundary violations:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log("✓ module boundaries clean");
