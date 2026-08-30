#!/usr/bin/env node
/** docs:check — verify all relative markdown links in docs/ and README resolve. */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
let failures = 0;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory() && name !== 'node_modules' && name !== '.git') out.push(...walk(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = [join(repoRoot, 'README.md'), ...walk(join(repoRoot, 'docs'))];
const linkRe = /\[([^\]]*)\]\(([^)#]+)(?:#[^)]*)?\)/g;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(linkRe)) {
    const target = match[2].trim();
    if (/^[a-z]+:/i.test(target)) continue; // external
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    if (!existsSync(resolved)) {
      failures++;
      console.error(`broken link in ${file}: ${target}`);
    }
  }
}

if (failures > 0) {
  console.error(`docs:check: ${failures} broken link(s)`);
  process.exit(1);
}
console.log('docs:check passed');
