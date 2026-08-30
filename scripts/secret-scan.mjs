#!/usr/bin/env node
/**
 * secret:scan — scan git-tracked text files for credential-like content
 * (SECURITY_AND_GIT §7, CI gate). Fixture markers use example values that are
 * themselves redacted-safe; real-looking secrets fail the build.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const patterns = [
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{30,}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{15,}\b/ },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'credential-url', re: /\b\w+:\/\/[^/\s:@]+:[^/\s:@]{6,}@/ },
  { name: 'high-entropy-assignment', re: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][A-Za-z0-9+/_-]{32,}['"]/i },
];

// Committed test fixtures intentionally contain fake credentials with obvious
// example markers; they are redaction test data, not leaks.
// Example secrets inside test code are test data, not leaks.
const ALLOWLIST = [/tests[\\/]fixtures[\\/]/, /package-lock\.json$/, /[\\/]test[\\/]/, /REAUDIT[\_]2026-08-30\.md$/];
// AWS's documented example access key used verbatim in redaction tests and
// audit pattern tables — recognized example data, not a credential.
const EXAMPLE_TOKENS = [/AKIAIOSFODNN7EXAMPLE/g];

const tracked = execFileSync('git', ['-C', repoRoot, 'ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

let failures = 0;
for (const file of tracked) {
  if (ALLOWLIST.some((re) => re.test(file))) continue;
  let text;
  try {
    text = readFileSync(join(repoRoot, file), 'utf8');
  } catch {
    continue; // binary or unreadable
  }
  for (const tokenRe of EXAMPLE_TOKENS) {
    text = text.replace(tokenRe, '<aws-docs-example>');
  }
  for (const { name, re } of patterns) {
    if (re.test(text)) {
      failures++;
      console.error(`SECRET-LIKELY ${file}: ${name}`);
    }
  }
}

if (failures > 0) {
  console.error(`secret:scan: ${failures} finding(s)`);
  process.exit(1);
}
console.log('secret:scan passed');
