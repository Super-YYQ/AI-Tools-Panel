#!/usr/bin/env node
/**
 * REL-102: verify the portable archive from a clean extracted directory.
 * 1. Extract release/*-portable-win.zip into a random temp dir.
 * 2. Assert the tree contains no symlink/junction (workspace links would
 *    break on another machine).
 * 3. Start the agent against a fresh temp Git repo, check /health, run a
 *    scan and wait for inventory, then stop.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const releaseDir = join(repoRoot, 'release');
const zips = readdirSync(releaseDir).filter((f) => f.endsWith('-portable-win.zip'));
if (zips.length === 0) {
  console.error('verify-portable: no portable zip found; run npm run package:portable first');
  process.exit(1);
}
const zip = zips.sort().pop();

// 1. Extract into a random directory (simulates a different machine path).
const extractRoot = mkdtempSync(join(tmpdir(), 'aitp-portable-verify-'));
const extractDir = join(extractRoot, 'extracted');
mkdirSync(extractDir, { recursive: true });
console.log(`verify-portable: extracting ${zip}`);
// -ExecutionPolicy Bypass mirrors package-portable so restricted-policy
// machines can load Microsoft.PowerShell.Archive for Expand-Archive.
execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -Path "${join(releaseDir, zip)}" -DestinationPath "${extractDir}"`]);

// 2. No symlink/junction anywhere in the extracted tree.
const extracted = join(extractDir, `AI-Tools-Panel-v${JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version}-portable`);
let links = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      links++;
      console.error(`verify-portable: LINK found at ${p}`);
    } else if (st.isDirectory()) {
      walk(p);
    }
  }
})(extracted);
if (links > 0) {
  console.error(`verify-portable: FAILED — ${links} link(s) in archive`);
  process.exit(1);
}

// 3. Boot the extracted agent against a fresh temp Git repo and scan.
const scanRepo = mkdtempSync(join(tmpdir(), 'aitp-portable-repo-'));
writeFileSync(join(scanRepo, 'CLAUDE.md'), '# Portable smoke\n\nDeterministic guidance.\n', 'utf8');
// Repo-level config keeps the scan provider-relevant even on a machine (or
// CI runner) without any ~/.claude user configuration.
mkdirSync(join(scanRepo, '.claude', 'skills', 'portable-smoke'), { recursive: true });
writeFileSync(
  join(scanRepo, '.claude', 'skills', 'portable-smoke', 'SKILL.md'),
  '---\nname: portable-smoke\ndescription: Verify the portable package end to end.\n---\nScan body.\n',
  'utf8',
);
execFileSync('git', ['init', '-q'], { cwd: scanRepo });

// Isolated HOME so the smoke test exercises exactly what a fresh machine sees.
const isolatedHome = mkdtempSync(join(tmpdir(), 'aitp-portable-home-'));
const agent = spawn(process.execPath, [join(extracted, 'agent', 'dist', 'start.js')], {
  cwd: scanRepo,
  env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const startup = await new Promise((resolvePromise, reject) => {
  let buffer = '';
  const timer = setTimeout(() => reject(new Error(`agent did not start: ${buffer.slice(0, 300)}`)), 30_000);
  agent.stdout?.on('data', (chunk) => {
    buffer += chunk.toString();
    const m = /http:\/\/127\.0\.0\.1:(\d+)\/#session=([0-9a-f]+)/.exec(buffer);
    if (m) {
      clearTimeout(timer);
      resolvePromise({ port: Number(m[1]), token: m[2] });
    }
  });
  agent.stderr?.on('data', (chunk) => {
    buffer += chunk.toString();
  });
});

const health = await fetch(`http://127.0.0.1:${startup.port}/health`);
if (health.status !== 200) {
  console.error(`verify-portable: health returned ${health.status}`);
  process.exit(1);
}
const healthBody = await health.json();
if (healthBody.repo !== 'ok') {
  console.error('verify-portable: health did not report an ok repository');
  process.exit(1);
}

await fetch(`http://127.0.0.1:${startup.port}/api/v1/scans`, {
  method: 'POST',
  headers: { 'x-aitp-session': startup.token },
});
let observations = 0;
for (let i = 0; i < 100; i++) {
  await new Promise((r) => setTimeout(r, 200));
  const inv = await (await fetch(`http://127.0.0.1:${startup.port}/api/v1/inventory`, { headers: { 'x-aitp-session': startup.token } })).json();
  if (inv.observations.length > 0) {
    observations = inv.observations.length;
    break;
  }
}
if (observations === 0) {
  console.error('verify-portable: scan produced no observations');
  process.exit(1);
}

agent.kill();
const checksumNote = createHash('sha256').update(zip).digest('hex').slice(0, 12);
rmSync(extractRoot, { recursive: true, force: true });
rmSync(scanRepo, { recursive: true, force: true });
rmSync(isolatedHome, { recursive: true, force: true });
console.log(`verify-portable passed (${observations} observations from extracted archive ${checksumNote})`);
