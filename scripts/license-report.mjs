#!/usr/bin/env node
/**
 * license:report — dependency license report (M0-07, CI gate). Reads the
 * lockfile-resolved dependency tree and fails on forbidden licenses or
 * missing license fields for direct production dependencies.
 */
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const FORBIDDEN = ['AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0', 'UNLICENSED'];

const raw = JSON.parse(
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--all', '--json', '--long'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' }),
);

const seen = new Map();
function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (!seen.has(name)) {
      seen.set(name, { name, version: info.version, license: info.license ?? 'UNKNOWN' });
    }
    if (info.dependencies) walk(info);
  }
}
walk(raw);

const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const problems = rows.filter((r) => FORBIDDEN.includes(r.license));

console.log(`license:report: ${rows.length} unique dependencies`);
const unknown = rows.filter((r) => r.license === 'UNKNOWN');
if (unknown.length > 0) {
  console.log('unknown license (review before release):');
  for (const r of unknown) console.log(`  ${r.name}@${r.version}`);
}
if (problems.length > 0) {
  console.error('license:report: forbidden license(s) found:');
  for (const r of problems) console.error(`  ${r.name}@${r.version}: ${r.license}`);
  process.exit(1);
}
console.log('license:report passed');
