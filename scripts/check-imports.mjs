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
  // Regression guard: React Router's client build strips server-only exports
  // (loader/action/middleware/headers) and then dead-code-eliminates imports
  // that those exports referenced. But an import specifier that is NEVER used
  // anywhere (e.g. a leftover named import) is not "previously referenced", so
  // it survives elimination and keeps the `~server/*` module in the client
  // bundle → the dot-server plugin aborts the production build. Fail fast here.
  if (isRoute) {
    for (const unused of unusedServerImports(src)) {
      errors.push(`${file}: unused ~server/* import "${unused.name}" would break the client build (remove it, or use it in loader/action/middleware/headers)`);
    }
  }
});

/**
 * Finds named/default value imports from `~server/*` whose local binding is not
 * referenced elsewhere in the file. Type-only imports (`import type {…}` and
 * inline `type X` specifiers) are erased before bundling and are skipped.
 */
function unusedServerImports(src) {
  const unused = [];
  // `[^;]*?` keeps the match inside a single statement (imports never contain `;`)
  const importRe = /import\s+(type\s+)?([^;]*?)\s+from\s+["']~server\/[^"']+["'];?/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    if (m[1]) continue; // whole statement is `import type {…}` — erased before bundling
    const clause = m[2];
    const body = src.slice(0, m.index) + src.slice(m.index + m[0].length);
    const locals = [];
    // namespace import: `* as ns`
    const nsMatch = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (nsMatch) locals.push(nsMatch[1]);
    // default import (leading identifier before `{` or `,` or end)
    const defMatch = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause.trim());
    if (defMatch) locals.push(defMatch[1]);
    // named specifiers inside {…}
    const braceMatch = /\{([^}]*)\}/.exec(clause);
    if (braceMatch) {
      for (let spec of braceMatch[1].split(",")) {
        spec = spec.trim();
        if (!spec || spec.startsWith("type ")) continue; // inline type specifier — erased
        const asMatch = /(?:^|\s)as\s+([A-Za-z_$][\w$]*)$/.exec(spec);
        const name = asMatch ? asMatch[1] : spec;
        if (/^[A-Za-z_$][\w$]*$/.test(name)) locals.push(name);
      }
    }
    for (const name of locals) {
      if (!new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(body)) unused.push({ name });
    }
  }
  return unused;
}

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
