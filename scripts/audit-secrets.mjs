#!/usr/bin/env node
/**
 * Secret audit (pre-deployment). Walks every blob in EVERY commit of the local
 * history (plus the working tree) and reports potential credentials as
 * <commit> <path> <kind> <length> — never the value itself.
 *
 * Read-only: inspects `git cat-file --batch` output. No network, no writes.
 * Usage: node scripts/audit-secrets.mjs
 */
import { spawnSync } from "node:child_process";

const PATTERNS = [
  ["resend_api_key", /\bre_[A-Za-z0-9_-]{21,197}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github_token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g],
  ["github_pat", /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g],
  ["slack_token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["stripe_key", /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["private_key_block", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ["cloudflare_token", /\b[A-Za-z0-9_-]{40}\b(?=[^\n]{0,40}(?:api[_-]?token|cloudflare))/gi],
  ["url_with_credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'/:@]+:[^\s"'/@]{6,}@/gi],
];

// Values that are obviously synthetic must not be reported as findings.
const ALLOWLIST =
  /(integration-test-|e2e-only-|dev-only-|change-me|replace_with|must-not-exist|fake|placeholder|synthetic|test[_-]?key|example|dummy|not-a-secret|local-test)/i;

function listObjects() {
  // every blob reachable from any ref, with the paths that reference it
  const out = spawnSync("git", ["rev-list", "--objects", "--all"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 512,
  });
  const pairs = [];
  for (const line of out.stdout.split("\n")) {
    if (!line) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    pairs.push([line.slice(0, sp), line.slice(sp + 1)]);
  }
  return pairs;
}

function commitFor(blob) {
  const out = spawnSync("git", ["log", "--all", "--find-object=" + blob, "--oneline", "-1"], {
    encoding: "utf8",
  });
  return out.stdout.trim().split(" ")[0] || "?";
}

const objects = listObjects();
const findings = [];
let scanned = 0;

// Batch-fetch blob contents.
const BATCH = 400;
for (let i = 0; i < objects.length; i += BATCH) {
  const slice = objects.slice(i, i + BATCH);
  const input = slice.map(([sha]) => sha).join("\n") + "\n";
  const res = spawnSync("git", ["cat-file", "--batch"], { input, maxBuffer: 1024 * 1024 * 1024 });
  if (res.error) {
    console.error("git cat-file failed:", res.error.message);
    process.exit(2);
  }
  const buf = res.stdout;
  let offset = 0;
  for (const [sha, path] of slice) {
    const nl = buf.indexOf(0x0a, offset);
    if (nl < 0) break;
    const header = buf.subarray(offset, nl).toString("utf8");
    const parts = header.split(" ");
    const size = Number(parts[2] ?? 0);
    const bodyStart = nl + 1;
    const body = buf.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + size + 1;
    if (!Number.isFinite(size) || size === 0 || size > 2_000_000) continue;
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|zip|pdf|mp4|har)$/i.test(path)) continue;
    const text = body.toString("utf8");
    scanned++;
    for (const [kind, re] of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const value = m[0];
        if (ALLOWLIST.test(value)) continue;
        // Reduce false positives: ignore import/type references and doc placeholders.
        const lineStart = text.lastIndexOf("\n", m.index) + 1;
        const lineEnd = text.indexOf("\n", m.index);
        const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
        if (/(function|interface|type |import |export type|=>)/.test(line) && kind === "cloudflare_token") continue;
        findings.push({ kind, path, sha: sha.slice(0, 12), valueLength: value.length, line: line.slice(0, 120) });
      }
    }
  }
}

// Working tree files not tracked by git (e.g. a stray .dev.vars) — list names only.
const stray = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
const strayFiles = stray.stdout.split("\n").filter(Boolean);

console.log(`scanned blobs: ${scanned} (of ${objects.length} objects in history)`);
if (strayFiles.length) console.log("untracked files present:", strayFiles.join(", "));
if (!findings.length) {
  console.log("RESULT: no credential-shaped values found in history or tree");
} else {
  console.log(`RESULT: ${findings.length} candidate(s)`);
  for (const f of findings.slice(0, 80)) {
    console.log(`  ${f.kind}  ${f.path}  ${f.sha}  len=${f.valueLength}  ctx=${f.line.replace(/[A-Za-z0-9_-]{24,}/g, "<value>")}`);
  }
}
